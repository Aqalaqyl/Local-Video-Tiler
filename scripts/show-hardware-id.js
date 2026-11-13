'use strict';

const { getHardwareIdentity } = require('../hardware-id');

try {
  const identity = getHardwareIdentity();
  console.log(identity.id);
  console.error('Source: ' + identity.source);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
