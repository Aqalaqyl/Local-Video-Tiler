'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getHardwareIdentity } = require('./hardware-id');
const { verifyLicenseDocument } = require('./license');

const LICENSE_FILE_MAX_BYTES = 64 * 1024;
const PUBLIC_KEY_MAX_BYTES = 16 * 1024;

function publicKeyPathForApp(app) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'license-public-key.pem')
    : path.join(__dirname, 'license-public-key.pem');
}

function installedLicensePath(app) {
  return path.join(app.getPath('userData'), 'license.json');
}

function readSmallFile(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
    throw new Error('file size is invalid');
  }
  return fs.readFileSync(filePath, 'utf8');
}

function loadPublicKey(app, overridePath) {
  const filePath = overridePath || publicKeyPathForApp(app);
  try {
    const pem = readSmallFile(filePath, PUBLIC_KEY_MAX_BYTES);
    const key = crypto.createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('public key is not Ed25519');
    return { ok: true, filePath, pem };
  } catch (error) {
    return {
      ok: false,
      filePath,
      error: `License verification key is missing or invalid (${error.message}).`
    };
  }
}

function readLicenseDocument(filePath) {
  try {
    let text = readSmallFile(filePath, LICENSE_FILE_MAX_BYTES);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const document = JSON.parse(text);
    return { ok: true, document };
  } catch (error) {
    return { ok: false, error: `Could not read the license file (${error.message}).` };
  }
}

function verifyLicenseFile(filePath, publicKey, hardwareId, now) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, code: 'NOT_INSTALLED', message: 'No license is installed on this computer yet.' };
  }
  const read = readLicenseDocument(filePath);
  if (!read.ok) return { ok: false, code: 'READ_ERROR', message: read.error };
  return {
    ...verifyLicenseDocument(read.document, { publicKey, hardwareId, now }),
    document: read.document
  };
}

function installLicenseDocument(app, document) {
  const destination = installedLicensePath(app);
  const directory = path.dirname(destination);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = destination + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
  try {
    fs.renameSync(temporary, destination);
  } catch (_) {
    try { fs.unlinkSync(destination); } catch (_) { /* no previous license */ }
    fs.renameSync(temporary, destination);
  }
  try { fs.chmodSync(destination, 0o600); } catch (_) { /* Windows ACLs apply instead */ }
  return destination;
}

async function showConfigurationError(dialog, keyResult) {
  await dialog.showMessageBox({
    type: 'error',
    buttons: ['Quit'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'License configuration error',
    message: 'Local Video Tiler cannot verify licenses.',
    detail:
      keyResult.error + '\n\n' +
      'The software publisher must package license-public-key.pem with the application.'
  });
}

async function ensureLicensed({
  app,
  dialog,
  clipboard,
  publicKeyPath,
  getHardwareIdentityFn = getHardwareIdentity
}) {
  const keyResult = loadPublicKey(app, publicKeyPath);
  if (!keyResult.ok) {
    await showConfigurationError(dialog, keyResult);
    return { ok: false, code: 'PUBLIC_KEY_MISSING' };
  }

  let identity;
  try {
    identity = getHardwareIdentityFn();
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      buttons: ['Quit'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Hardware ID unavailable',
      message: 'Local Video Tiler could not identify this computer.',
      detail: error.message + '\n\nContact the software publisher for help.'
    });
    return { ok: false, code: 'HARDWARE_ID_UNAVAILABLE' };
  }

  const destination = installedLicensePath(app);
  let current = verifyLicenseFile(destination, keyResult.pem, identity.id);
  if (current.ok) return { ok: true, hardwareId: identity.id, license: current.payload };

  while (true) {
    const prompt = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Import license…', 'Copy hardware ID', 'Quit'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: 'License required',
      message: 'Local Video Tiler needs a license for this computer.',
      detail:
        `Hardware ID:\n${identity.id}\n\n` +
        `${current.message || 'No valid license is installed.'}\n\n` +
        'Send the hardware ID to the software publisher, then import the signed license file you receive.'
    });

    if (prompt.response === 2) return { ok: false, code: 'USER_QUIT' };
    if (prompt.response === 1) {
      clipboard.writeText(identity.id);
      continue;
    }

    const selected = await dialog.showOpenDialog({
      title: 'Import Local Video Tiler license',
      properties: ['openFile'],
      filters: [
        { name: 'Local Video Tiler license', extensions: ['json', 'license'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (selected.canceled || !selected.filePaths || !selected.filePaths[0]) continue;

    const candidate = verifyLicenseFile(selected.filePaths[0], keyResult.pem, identity.id);
    if (!candidate.ok) {
      current = candidate;
      await dialog.showMessageBox({
        type: 'error',
        buttons: ['Try again'],
        defaultId: 0,
        noLink: true,
        title: 'License rejected',
        message: 'That license cannot activate this computer.',
        detail: candidate.message
      });
      continue;
    }

    try {
      installLicenseDocument(app, candidate.document);
    } catch (error) {
      current = { ok: false, message: `Could not install the license (${error.message}).` };
      await dialog.showMessageBox({
        type: 'error',
        buttons: ['Try again'],
        defaultId: 0,
        noLink: true,
        title: 'License install failed',
        message: 'The license is valid but could not be saved.',
        detail: current.message
      });
      continue;
    }

    await dialog.showMessageBox({
      type: 'info',
      buttons: ['Continue'],
      defaultId: 0,
      noLink: true,
      title: 'License activated',
      message: 'Local Video Tiler is licensed for this computer.',
      detail: `Licensed to: ${candidate.payload.customer}`
    });
    return { ok: true, hardwareId: identity.id, license: candidate.payload };
  }
}

module.exports = {
  LICENSE_FILE_MAX_BYTES,
  ensureLicensed,
  installLicenseDocument,
  installedLicensePath,
  loadPublicKey,
  publicKeyPathForApp,
  readLicenseDocument,
  verifyLicenseFile
};
