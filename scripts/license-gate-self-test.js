'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLicenseDocument, LICENSE_VERSION, PRODUCT_ID } = require('../license');
const {
  ensureLicensed,
  installLicenseDocument,
  installedLicensePath,
  verifyLicenseFile
} = require('../license-gate');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lvt-license-test-'));
  try {
    const userData = path.join(temporary, 'user-data');
    const app = { isPackaged: false, getPath: () => userData };
    const hardwareId = 'LVT-1111-2222-3333-4444-5555-6666-7777-8888';
    const otherHardwareId = 'LVT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-9999';
    const identity = () => ({ id: hardwareId, source: 'self-test' });
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicPath = path.join(temporary, 'license-public-key.pem');
    fs.writeFileSync(publicPath, publicPem);

    const payload = {
      version: LICENSE_VERSION,
      product: PRODUCT_ID,
      licenseId: 'gate-test',
      customer: 'Gate Test',
      hardwareId,
      issuedAt: new Date(Date.now() - 60_000).toISOString()
    };
    const valid = createLicenseDocument(payload, privatePem);
    installLicenseDocument(app, valid);

    let dialogCalls = 0;
    const noDialog = {
      showMessageBox: async () => { dialogCalls++; return { response: 2 }; },
      showOpenDialog: async () => { throw new Error('unexpected file dialog'); }
    };
    const installed = await ensureLicensed({
      app,
      dialog: noDialog,
      clipboard: { writeText() {} },
      publicKeyPath: publicPath,
      getHardwareIdentityFn: identity
    });
    assert.equal(installed.ok, true);
    assert.equal(dialogCalls, 0);

    const wrong = createLicenseDocument({ ...payload, hardwareId: otherHardwareId }, privatePem);
    installLicenseDocument(app, wrong);
    assert.equal(
      verifyLicenseFile(installedLicensePath(app), publicPem, hardwareId).code,
      'WRONG_HARDWARE'
    );
    const rejected = await ensureLicensed({
      app,
      dialog: noDialog,
      clipboard: { writeText() {} },
      publicKeyPath: publicPath,
      getHardwareIdentityFn: identity
    });
    assert.equal(rejected.code, 'USER_QUIT');

    fs.rmSync(installedLicensePath(app), { force: true });
    const candidatePath = path.join(temporary, 'candidate.license.json');
    fs.writeFileSync(candidatePath, JSON.stringify(valid));
    const imported = await ensureLicensed({
      app,
      publicKeyPath: publicPath,
      getHardwareIdentityFn: identity,
      clipboard: { writeText() {} },
      dialog: {
        showMessageBox: async (options) => {
          if (options.title === 'License required') return { response: 0 };
          return { response: 0 };
        },
        showOpenDialog: async () => ({ canceled: false, filePaths: [candidatePath] })
      }
    });
    assert.equal(imported.ok, true);
    assert.equal(
      verifyLicenseFile(installedLicensePath(app), publicPem, hardwareId).code,
      'VALID'
    );

    const missingKey = await ensureLicensed({
      app,
      publicKeyPath: path.join(temporary, 'missing.pem'),
      getHardwareIdentityFn: identity,
      clipboard: { writeText() {} },
      dialog: {
        showMessageBox: async () => ({ response: 0 }),
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      }
    });
    assert.equal(missingKey.code, 'PUBLIC_KEY_MISSING');

    console.log('License gate self-test passed: installed, rejected, imported, and unconfigured flows.');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
