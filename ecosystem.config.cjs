const fs = require('fs');
const path = require('path');
const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const [key, ...rest] = line.split('=');
  env[key.trim()] = rest.join('=').trim();
});

module.exports = {
  apps: [{
    name: 'co-host-local',
    script: 'node_modules/.bin/tsx',
    args: 'server/index.ts',
    cwd: __dirname,
    env,
  }]
};
