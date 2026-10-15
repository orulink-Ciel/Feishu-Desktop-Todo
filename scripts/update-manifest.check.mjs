import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest } from './update-manifest.mjs';

test('does not advertise partial builds or confuse internal and generic installers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feishu-update-test-'));
  try {
    for (const target of ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64']) {
      writeFileSync(join(dir, `${target}.bin`), 'test package');
      writeFileSync(join(dir, `${target}-updater.json`), JSON.stringify({ version: '0.1.2', target, file: `${target}.bin`, signature: 'test signature' }));
    }
    assert.throws(() => createManifest(dir, 'v0.1.2-preview.1', 'notes'), /Missing update channel/);
    const target = 'windows-internal-x86_64';
    writeFileSync(join(dir, `${target}.bin`), 'internal package');
    writeFileSync(join(dir, `${target}-updater.json`), JSON.stringify({ version: '0.1.2', target, file: `${target}.bin`, signature: 'test signature' }));
    const manifest = createManifest(dir, 'v0.1.2-preview.1', 'notes');
    assert.notEqual(manifest.platforms[target].url, manifest.platforms['windows-x86_64'].url);
    assert.match(manifest.platforms[target].url, /v0.1.2-preview.1\/windows-internal-x86_64.bin$/);
    writeFileSync(join(dir, `${target}-updater.json`), JSON.stringify({ version: '0.1.1', target, file: `${target}.bin`, signature: 'test signature' }));
    assert.throws(() => createManifest(dir, 'v0.1.2-preview.1', 'notes'), /Invalid updater entry/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
