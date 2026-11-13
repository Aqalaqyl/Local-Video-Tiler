'use strict';

const crypto = require('crypto');

const PRODUCT_ID = 'local-video-tiler';
const LICENSE_VERSION = 1;

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('License data contains a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  throw new TypeError('License data contains an unsupported value');
}

function keyObject(key, kind) {
  const parsed = kind === 'private' ? crypto.createPrivateKey(key) : crypto.createPublicKey(key);
  if (parsed.asymmetricKeyType !== 'ed25519') {
    throw new Error(`The ${kind} license key must be an Ed25519 key`);
  }
  return parsed;
}

function createLicenseDocument(payload, privateKey) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('License payload must be an object');
  }
  const signature = crypto.sign(
    null,
    Buffer.from(canonicalJson(payload), 'utf8'),
    keyObject(privateKey, 'private')
  );
  return { payload, signature: signature.toString('base64') };
}

function failure(code, message) {
  return { ok: false, code, message };
}

function verifyLicenseDocument(document, options) {
  const hardwareId = String(options && options.hardwareId || '').trim().toUpperCase();
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return failure('INVALID_FORMAT', 'The license file must contain a JSON object.');
  }
  const payload = document.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_FORMAT', 'The license payload is missing.');
  }
  if (typeof document.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(document.signature)) {
    return failure('INVALID_FORMAT', 'The license signature is missing or malformed.');
  }

  let signature;
  let publicKey;
  try {
    signature = Buffer.from(document.signature, 'base64');
    if (signature.length !== 64) throw new Error('bad signature length');
    publicKey = keyObject(options && options.publicKey, 'public');
  } catch (error) {
    return failure('INVALID_SIGNATURE', 'The license signature or configured public key is invalid.');
  }

  let signatureValid = false;
  try {
    signatureValid = crypto.verify(
      null,
      Buffer.from(canonicalJson(payload), 'utf8'),
      publicKey,
      signature
    );
  } catch (_) {
    signatureValid = false;
  }
  if (!signatureValid) {
    return failure('INVALID_SIGNATURE', 'The license signature is invalid.');
  }

  if (payload.version !== LICENSE_VERSION || payload.product !== PRODUCT_ID) {
    return failure('WRONG_PRODUCT', 'This license is not for this version of Local Video Tiler.');
  }
  if (!hardwareId || String(payload.hardwareId || '').trim().toUpperCase() !== hardwareId) {
    return failure('WRONG_HARDWARE', 'This license was issued for a different computer.');
  }
  if (typeof payload.customer !== 'string' || !payload.customer.trim() || payload.customer.length > 256) {
    return failure('INVALID_CUSTOMER', 'The license customer is missing or invalid.');
  }
  const issuedAt = Date.parse(payload.issuedAt);
  if (!Number.isFinite(issuedAt)) {
    return failure('INVALID_DATE', 'The license issue date is invalid.');
  }
  const now = options && options.now != null ? Number(options.now) : Date.now();
  if (issuedAt > now + 24 * 60 * 60 * 1000) {
    return failure('NOT_YET_VALID', 'The license issue date is in the future.');
  }
  if (payload.expiresAt != null) {
    const expiresAt = Date.parse(payload.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      return failure('INVALID_DATE', 'The license expiration date is invalid.');
    }
    if (now >= expiresAt) {
      return failure('EXPIRED', 'This license has expired.');
    }
  }

  return {
    ok: true,
    code: 'VALID',
    payload,
    message: 'License verified.'
  };
}

module.exports = {
  LICENSE_VERSION,
  PRODUCT_ID,
  canonicalJson,
  createLicenseDocument,
  verifyLicenseDocument
};
