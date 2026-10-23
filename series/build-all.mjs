// rebuilds every series page in series.json, then the hub's bundle. a new series only needs its
// series.json entry and build script
// usage: node series/build-all.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REG = JSON.parse(readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'));

const run = (script) => {
  console.log('build:', script);
  const res = spawnSync(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`build failed: ${script}`);
};

for (const [slug, cfg] of Object.entries(REG)) {
  if (!cfg.build) { console.log(`[${slug}] no build script, skipped`); continue; }
  run(cfg.build);
}
run(path.join('web', 'build.mjs'));
console.log('all built. redeploy with: node series/refresh.mjs --deploy-only');
