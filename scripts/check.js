import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';

// syntax check every source and test file with node's own parser. no linter, no new
// dependency, just catches a typo before npm test spends a minute finding it
const files = [...globSync('src/**/*.js'), ...globSync('test/*.js'), ...globSync('scripts/*.js')];
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch {
    failed++;
    console.error(`syntax error in ${file}`);
  }
}
if (failed) {
  console.error(`${failed} file(s) failed --check`);
  process.exit(1);
}
console.log(`checked ${files.length} files`);
