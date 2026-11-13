'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const privateArg = option('--private-key');
const publicArg = option('--public-key') || path.join(repoRoot, 'license-public-key.pem');
const force = process.argv.includes('--force');

if (!privateArg) {
  fail(
    'Usage: npm run license:keygen -- --private-key <secure-path-outside-repository> ' +
    '[--public-key license-public-key.pem] [--force]'
  );
}

const privatePath = path.resolve(privateArg);
const publicPath = path.resolve(publicArg);
const relativePrivate = path.relative(repoRoot, privatePath);
if (!relativePrivate.startsWith('..' + path.sep) && relativePrivate !== '..') {
  fail('Refusing to place the private signing key inside the repository. Choose a secure external path.');
}
if (!force && (fs.existsSync(privatePath) || fs.existsSync(publicPath))) {
  fail('A key file already exists. Move it or pass --force to replace both key files.');
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });

fs.mkdirSync(path.dirname(privatePath), { recursive: true });
fs.mkdirSync(path.dirname(publicPath), { recursive: true });
fs.writeFileSync(privatePath, privatePem, { mode: 0o600, flag: force ? 'w' : 'wx' });
try { fs.chmodSync(privatePath, 0o600); } catch (_) { /* Windows ACLs apply instead */ }
fs.writeFileSync(publicPath, publicPem, { mode: 0o644, flag: force ? 'w' : 'wx' });

console.log('Public verification key: ' + publicPath);
console.log('Private signing key: ' + privatePath);
console.log('Keep the private key secret, backed up, and outside the application repository.');
