'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const publicKeyPath = path.join(__dirname, '..', 'license-public-key.pem');

if (!fs.existsSync(publicKeyPath)) {
  console.error(
    'Missing license-public-key.pem. Generate your owner key pair before packaging:\n' +
    'npm run license:keygen -- --private-key <secure-path-outside-this-repository>'
  );
  process.exit(1);
}

try {
  const stat = fs.statSync(publicKeyPath);
  if (!stat.isFile() || stat.size < 80 || stat.size > 16 * 1024) throw new Error('unexpected key file size');
  const key = crypto.createPublicKey(fs.readFileSync(publicKeyPath, 'utf8'));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('key is not Ed25519');
} catch (error) {
  console.error('license-public-key.pem is invalid: ' + error.message);
  process.exit(1);
}

console.log('License public key is configured.');
