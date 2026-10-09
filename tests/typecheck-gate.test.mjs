import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.match(pkg.scripts.typecheck, /^cross-env NODE_OPTIONS=.*vue-tsc --noEmit/);
const deploy = readFileSync('../../../scripts/deploy_thingspanel.sh', 'utf8');
assert(deploy.indexOf('pnpm run typecheck') >= 0);
assert(deploy.indexOf('pnpm run typecheck') < deploy.indexOf('./node_modules/.bin/vite build'));
console.log('PASS full typecheck is a release gate');
