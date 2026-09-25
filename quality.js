'use strict';

/** Long-edge steps so a resize does not build a new encode for every pixel. */
const EDGE_STEPS = [256, 384, 512, 768, 1024, 1280, 1600, 1920];

/** Favorites receive this multiple of the tile-sized bitrate, and a higher cap. */
const FAVORITE_BITRATE_SCALE = 2.5;

/** Bits per displayed pixel. 1280×720 → about 2.3 Mbps before the favorite boost. */
const BITS_PER_PIXEL = 2.5;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function quantizeEdge(edge) {
  const n = Math.max(2, Math.round(edge));
  for (const step of EDGE_STEPS) {
    if (n <= step) return step;
  }
  return EDGE_STEPS[EDGE_STEPS.length - 1];
}

function quantizeBitrate(bps) {
  const step = 100000;
  return Math.max(step, Math.round(bps / step) * step);
}

/**
 * Decode budget for one tile.
 * Bitrate follows the tile's pixel area. A favorite keeps the same rule with a
 * higher scale and a larger frame cap so it stays sharper than its neighbors.
 * Passthrough when the source is already within that frame size.
 */
function planQuality(opts) {
  const o = opts || {};
  const w = Math.max(2, Math.round(Number(o.tileWidth) || 320));
  const h = Math.max(2, Math.round(Number(o.tileHeight) || 180));
  const fav = !!o.favorite;
  let edge = Math.max(w, h);
  if (fav) edge = Math.round(edge * 1.35);
  edge = quantizeEdge(clamp(edge, fav ? 384 : 256, fav ? 1920 : 1280));

  let bitrate = quantizeBitrate(w * h * BITS_PER_PIXEL);
  if (fav) bitrate = quantizeBitrate(bitrate * FAVORITE_BITRATE_SCALE);
  bitrate = clamp(bitrate, fav ? 700000 : 280000, fav ? 12000000 : 5000000);

  const srcW = Number(o.srcWidth) || 0;
  const srcH = Number(o.srcHeight) || 0;
  const srcEdge = srcW && srcH ? Math.max(srcW, srcH) : 0;
  const passthrough = !!(srcEdge && srcEdge <= edge * 1.08);

  return {
    passthrough,
    maxEdge: edge,
    bitrate,
    audioBitrate: fav ? 160000 : 96000,
    favorite: fav,
    key: passthrough ? 'orig' : edge + '@' + bitrate
  };
}

module.exports = {
  planQuality,
  quantizeEdge,
  FAVORITE_BITRATE_SCALE
};
