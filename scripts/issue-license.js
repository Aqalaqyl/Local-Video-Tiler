'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LICENSE_VERSION, PRODUCT_ID, createLicenseDocument } = require('../license');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const hardwareId = option('--hardware-id').trim().toUpperCase();
const customer = option('--customer').trim();
const privatePath = option('--private-key');
const expiresArg = option('--expires');
const force = process.argv.includes('--force');

if (!hardwareId || !customer || !privatePath) {
  fail(
    'Usage: npm run license:issue -- --hardware-id <LVT-...> --customer <name> ' +
    '--private-key <secure-key.pem> [--expires <ISO date>] [--output <license.json>] [--force]'
  );
}
if (!/^LVT-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(hardwareId)) {
  fail('The hardware ID format is invalid.');
}
if (customer.length > 256) fail('The customer name must be 256 characters or fewer.');

const privateKeyPath = path.resolve(privatePath);
let privateKey;
try {
  privateKey = fs.readFileSync(privateKeyPath, 'utf8');
} catch (_) {
  fail('Could not read the private signing key: ' + privateKeyPath);
}

let expiresAt;
if (expiresArg) {
  const timestamp = Date.parse(expiresArg);
  if (!Number.isFinite(timestamp)) fail('The expiration date is invalid.');
  if (timestamp <= Date.now()) fail('The expiration date must be in the future.');
  expiresAt = new Date(timestamp).toISOString();
}

const payload = {
  version: LICENSE_VERSION,
  product: PRODUCT_ID,
  licenseId: crypto.randomUUID(),
  customer,
  hardwareId,
  issuedAt: new Date().toISOString()
};
if (expiresAt) payload.expiresAt = expiresAt;

let document;
try {
  document = createLicenseDocument(payload, privateKey);
} catch (error) {
  fail('Could not sign the license: ' + error.message);
}

const defaultName = `local-video-tiler-${hardwareId.slice(-9).replace(/-/g, '')}.license.json`;
const outputPath = path.resolve(option('--output') || defaultName);
if (!force && fs.existsSync(outputPath)) fail('The output file already exists. Pass --force to replace it.');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(document, null, 2) + '\n', {
  encoding: 'utf8',
  mode: 0o644,
  flag: force ? 'w' : 'wx'
});

console.log('License written: ' + outputPath);
console.log('Customer: ' + customer);
console.log('Hardware ID: ' + hardwareId);
console.log('Expires: ' + (expiresAt || 'never'));
