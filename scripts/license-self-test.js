'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { hardwareIdFromRaw } = require('../hardware-id');
const {
  LICENSE_VERSION,
  PRODUCT_ID,
  createLicenseDocument,
  verifyLicenseDocument
} = require('../license');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const hardwareId = hardwareIdFromRaw('self-test-machine');
const otherHardwareId = hardwareIdFromRaw('another-machine');
const now = Date.parse('2026-11-13T12:00:00.000Z');

const payload = {
  version: LICENSE_VERSION,
  product: PRODUCT_ID,
  licenseId: 'self-test-license',
  customer: 'Self Test',
  hardwareId,
  issuedAt: '2026-11-12T12:00:00.000Z'
};
const valid = createLicenseDocument(payload, privatePem);

assert.equal(verifyLicenseDocument(valid, { publicKey: publicPem, hardwareId, now }).code, 'VALID');
assert.equal(
  verifyLicenseDocument(valid, { publicKey: publicPem, hardwareId: otherHardwareId, now }).code,
  'WRONG_HARDWARE'
);

const tampered = JSON.parse(JSON.stringify(valid));
tampered.payload.customer = 'Tampered Customer';
assert.equal(verifyLicenseDocument(tampered, { publicKey: publicPem, hardwareId, now }).code, 'INVALID_SIGNATURE');

const expired = createLicenseDocument({
  ...payload,
  expiresAt: '2026-11-13T11:59:59.000Z'
}, privatePem);
assert.equal(verifyLicenseDocument(expired, { publicKey: publicPem, hardwareId, now }).code, 'EXPIRED');

const future = createLicenseDocument({
  ...payload,
  issuedAt: '2026-11-15T12:00:00.000Z'
}, privatePem);
assert.equal(verifyLicenseDocument(future, { publicKey: publicPem, hardwareId, now }).code, 'NOT_YET_VALID');

const reordered = {
  signature: valid.signature,
  payload: {
    customer: payload.customer,
    hardwareId: payload.hardwareId,
    issuedAt: payload.issuedAt,
    licenseId: payload.licenseId,
    product: payload.product,
    version: payload.version
  }
};
assert.equal(verifyLicenseDocument(reordered, { publicKey: publicPem, hardwareId, now }).code, 'VALID');

console.log('License self-test passed: valid, hardware-bound, tamper-proof, expiry-aware, canonical.');
