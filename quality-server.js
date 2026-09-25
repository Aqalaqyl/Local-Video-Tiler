'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { app, protocol } = require('electron');
const { planQuality } = require('./quality');

/** Live encodes at once. Further tiles keep the original file until a slot frees. */
const MAX_ENCODERS = 3;

let server = null;
let port = 0;
let ffmpegOk = null;
let cacheDir = '';
let activeEncoders = 0;
const jobs = new Map();
const probes = new Map();

function tryAcquire() {
  if (activeEncoders >= MAX_ENCODERS) return false;
  activeEncoders++;
  return true;
}

function releaseEncoder() {
  activeEncoders = Math.max(0, activeEncoders - 1);
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let settled = false;
    const child = spawn(cmd, args, { windowsHide: true });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
      resolve({ code: -1, out, err: err || 'timeout' });
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e && e.message ? e.message : e) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code == null ? -1 : code, out, err });
    });
  });
}

async function ensureFfmpeg() {
  if (ffmpegOk != null) return ffmpegOk;
  const probe = await run('ffmpeg', ['-version'], 4000);
  ffmpegOk = probe.code === 0;
  return ffmpegOk;
}

async function probeFile(filePath) {
  let st;
  try { st = fs.statSync(filePath); } catch (_) { return null; }
  const cached = probes.get(filePath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached;
  const result = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    filePath
  ], 8000);
  let width = 0;
  let height = 0;
  let duration = 0;
  try {
    const json = JSON.parse(result.out || '{}');
    const stream = json.streams && json.streams[0];
    if (stream) {
      width = Number(stream.width) || 0;
      height = Number(stream.height) || 0;
    }
    duration = Number(json.format && json.format.duration) || 0;
  } catch (_) { /* ignore */ }
  const info = { width, height, duration, mtimeMs: st.mtimeMs, size: st.size };
  probes.set(filePath, info);
  return info;
}

function cachePaths(filePath, plan, info) {
  const h = crypto.createHash('sha1')
    .update([filePath, info.mtimeMs, info.size, plan.key].join('|'))
    .digest('hex');
  return {
    finalPath: path.join(cacheDir, h + '.mp4'),
    partPath: path.join(cacheDir, h + '.part.mp4')
  };
}

function passthrough(filePath, duration, plan) {
  return {
    url: pathToFileURL(filePath).href,
    seekable: true,
    passthrough: true,
    origin: 0,
    duration: duration || 0,
    key: 'orig',
    bitrate: plan ? plan.bitrate : 0,
    maxEdge: plan ? plan.maxEdge : 0
  };
}

function serveFile(req, res, filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch (_) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (!m) {
      res.statusCode = 416;
      res.end();
      return;
    }
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : stat.size - 1;
    if (!(start <= end) || start >= stat.size) {
      res.statusCode = 416;
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
      'Accept-Ranges': 'bytes',
      'Content-Length': (end - start + 1)
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes'
  });
  fs.createReadStream(filePath).pipe(res);
}

function ffmpegArgs(filePath, plan, start) {
  const ss = Math.max(0, Number(start) || 0);
  const edge = plan.maxEdge;
  const scale = 'scale=' + edge + ':' + edge +
    ':force_original_aspect_ratio=decrease:flags=fast_bilinear,' +
    'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (ss > 0.05) args.push('-ss', ss.toFixed(3));
  args.push(
    '-i', filePath,
    '-vf', scale,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-b:v', String(plan.bitrate),
    '-maxrate', String(plan.bitrate),
    '-bufsize', String(plan.bitrate * 2),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', String(plan.audioBitrate),
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4'
  );
  return args;
}

function startQualityServer() {
  if (server) return;
  cacheDir = path.join(app.getPath('userData'), 'quality-cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) { /* ignore */ }
  server = http.createServer((req, res) => {
    let id = '';
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      id = u.searchParams.get('id') || '';
    } catch (_) { /* ignore */ }
    const job = jobs.get(id);
    if (!job) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (job.finalPath && fs.existsSync(job.finalPath)) {
      serveFile(req, res, job.finalPath);
      return;
    }
    if (job.mode !== 'live') {
      res.statusCode = 404;
      res.end();
      return;
    }
    streamEncode(job, req, res);
  });
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    port = addr && addr.port ? addr.port : 0;
    protocol.handle('lvtq', (request) => {
      let id = '';
      try {
        const u = new URL(request.url);
        id = (u.pathname || '').split('/').filter(Boolean)[0] || '';
      } catch (_) { /* ignore */ }
      const headers = {};
      const range = request.headers.get('range');
      if (range) headers.Range = range;
      return fetch('http://127.0.0.1:' + port + '/q?id=' + encodeURIComponent(id), { headers });
    });
  });
}

function streamEncode(job, req, res) {
  if (job.started) {
    res.statusCode = 409;
    res.end();
    return;
  }
  job.started = true;
  clearTimeout(job.idleTimer);
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-store'
  });
  const args = ffmpegArgs(job.filePath, job.plan, job.start);
  args.push('pipe:1');
  const child = spawn('ffmpeg', args, { windowsHide: true });
  let released = false;
  let finished = false;
  let aborted = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseEncoder();
  };
  const writer = job.start < 0.05 ? fs.createWriteStream(job.partPath) : null;
  child.stdout.pipe(res);
  if (writer) child.stdout.pipe(writer);
  child.stderr.on('data', () => { /* discard */ });
  child.on('error', () => {
    aborted = true;
    release();
    if (!res.writableEnded) res.end();
  });
  const kill = () => {
    setTimeout(() => {
      if (finished || child.exitCode != null) return;
      aborted = true;
      try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
    }, 200);
  };
  res.on('close', kill);
  req.on('close', kill);
  child.on('close', (code) => {
    finished = true;
    release();
    const doneWriting = () => {
      if (code === 0 && writer && !aborted) void remuxCache(job);
      else if (writer) {
        try { fs.unlinkSync(job.partPath); } catch (_) { /* ignore */ }
      }
    };
    if (writer) writer.end(doneWriting);
    else doneWriting();
    if (!res.writableEnded) res.end();
  });
}

async function remuxCache(job) {
  const remux = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', job.partPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    job.finalPath
  ], 10 * 60 * 1000);
  try { fs.unlinkSync(job.partPath); } catch (_) { /* ignore */ }
  if (remux.code !== 0) {
    try { fs.unlinkSync(job.finalPath); } catch (_) { /* ignore */ }
    return;
  }
  job.mode = 'file';
}

async function resolveQuality(opts) {
  const filePath = opts && opts.path ? path.resolve(String(opts.path)) : '';
  if (!filePath) {
    return { url: '', seekable: true, passthrough: true, origin: 0, duration: 0, key: 'orig', bitrate: 0, maxEdge: 0 };
  }
  const start = Math.max(0, Number(opts.start) || 0);
  const ready = await ensureFfmpeg();
  const info = ready ? await probeFile(filePath) : null;
  const duration = info && info.duration ? info.duration : 0;
  const plan = planQuality({
    tileWidth: opts.tileWidth,
    tileHeight: opts.tileHeight,
    favorite: !!opts.favorite,
    srcWidth: info && info.width,
    srcHeight: info && info.height
  });
  if (!ready || !port || plan.passthrough) return passthrough(filePath, duration, plan);

  const paths = cachePaths(filePath, plan, info || { mtimeMs: 0, size: 0 });
  if (start < 0.05 && fs.existsSync(paths.finalPath)) {
    const id = crypto.randomBytes(8).toString('hex');
    jobs.set(id, { mode: 'file', finalPath: paths.finalPath });
    return {
      url: 'lvtq://media/' + id,
      seekable: true,
      passthrough: false,
      origin: 0,
      duration,
      key: plan.key,
      bitrate: plan.bitrate,
      maxEdge: plan.maxEdge
    };
  }

  if (!tryAcquire()) return passthrough(filePath, duration, plan);

  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    mode: 'live',
    filePath,
    plan,
    start,
    finalPath: paths.finalPath,
    partPath: paths.partPath,
    started: false,
    clientGone: false
  };
  job.idleTimer = setTimeout(() => {
    if (!job.started) {
      jobs.delete(id);
      releaseEncoder();
    }
  }, 15000);
  jobs.set(id, job);
  return {
    url: 'lvtq://media/' + id,
    seekable: false,
    passthrough: false,
    origin: start,
    duration,
    key: plan.key,
    bitrate: plan.bitrate,
    maxEdge: plan.maxEdge
  };
}

module.exports = { startQualityServer, resolveQuality };
