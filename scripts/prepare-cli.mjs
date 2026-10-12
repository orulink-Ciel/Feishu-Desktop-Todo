import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve('@larksuite/cli/package.json'));
const expected = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version;
const filename = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli';
const source = join(packageDir, 'bin', filename);
if (!existsSync(source)) {
  // The official installer verifies the platform archive against its pinned checksum.
  execFileSync(process.execPath, [join(packageDir, 'scripts/install.js')], { stdio: 'inherit' });
}
const version = execFileSync(source, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
if (!version.includes(expected)) throw new Error(`CLI version mismatch: expected ${expected}, got ${version}`);
const resources = join(root, 'src-tauri', 'resources');
mkdirSync(resources, { recursive: true });
copyFileSync(source, join(resources, filename));
copyFileSync(join(packageDir, 'LICENSE'), join(resources, 'LARK-CLI-LICENSE'));
if (process.platform !== 'win32') chmodSync(join(resources, filename), 0o755);
console.log(`Embedded ${version} (${process.platform}/${process.arch}); no credentials or configuration copied.`);
