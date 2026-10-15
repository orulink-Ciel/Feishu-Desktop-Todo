import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createManifest(dir, tag, notes) {
  if (!/^v\d+\.\d+\.\d+-preview\.\d+$/.test(tag)) throw new Error('Pass a preview release tag.');
  const version = tag.slice(1).split('-')[0];
  const platforms = {};
  for (const name of readdirSync(dir).filter(n => n.endsWith('-updater.json'))) {
    const entry = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (entry.version !== version || !entry.signature || !existsSync(join(dir, entry.file)) || !/^[A-Za-z0-9_.-]+$/.test(entry.file)) throw new Error(`Invalid updater entry: ${name}`);
    if (platforms[entry.target]) throw new Error(`Duplicate update channel: ${entry.target}`);
    platforms[entry.target] = { signature: entry.signature, url: `https://github.com/orulink-Ciel/Feishu-Desktop-Todo/releases/download/${tag}/${entry.file}` };
  }
  for (const target of ['windows-x86_64', 'windows-internal-x86_64', 'darwin-aarch64', 'darwin-x86_64']) {
    if (!platforms[target]) throw new Error(`Missing update channel: ${target}; keep the previous feed unchanged.`);
  }
  return { version, notes, pub_date: new Date().toISOString(), platforms };
}
if (process.argv[1]?.endsWith('update-manifest.mjs')) {
  const [dir, tag, notesFile] = process.argv.slice(2);
  const notes = readFileSync(notesFile, 'utf8');
  const manifest = createManifest(dir, tag, notes);
  writeFileSync(join(dir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Prepared signed update manifest for ${Object.keys(manifest.platforms).length} channels at ${manifest.version}.`);
}
