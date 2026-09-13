// Secrets stay outside release directories and are readable only by the service account.
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync('/etc/spendly/backend.json', 'utf8'));
for (const [key, value] of Object.entries(config)) {
  if (typeof value !== 'string') throw new Error('Invalid backend configuration');
  process.env[key] = value;
}
process.env.NODE_ENV = 'production';
process.argv = [process.execPath, 'next', 'start', '--hostname', '127.0.0.1', '--port', '3000'];
require('next/dist/bin/next');
