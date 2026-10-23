import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'src');

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return files(full);
  return entry.name.endsWith('.js') ? [full] : [];
});

// what the Dockerfile copies besides the packages. the bot crashed on Railway once importing series/configs.mjs,
// which is only in the repo
const inImage = () => {
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  return [...dockerfile.matchAll(/^COPY (\S+) /gm)].map((match) => path.join(root, match[1]));
};

test('everything the bot imports is in the Docker image', () => {
  const copied = inImage();
  assert.ok(copied.includes(src), 'the Dockerfile copies src/');
  const outside = [];
  for (const file of files(src)) {
    const text = readFileSync(file, 'utf8');
    for (const [, spec] of text.matchAll(/(?:^import|^export)[^'"]*from '(\.[^']+)'|import\('(\.[^']+)'\)/gm)) {
      if (!spec) continue;
      const target = path.resolve(path.dirname(file), spec);
      if (!copied.some((dir) => target === dir || target.startsWith(dir + path.sep))) outside.push(`${path.relative(root, file)} -> ${spec}`);
    }
  }
  assert.deepEqual(outside, []);
});
