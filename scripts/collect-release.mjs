import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const target = process.argv[2];
if (!target) throw new Error('Pass the Rust target, e.g. x86_64-pc-windows-msvc.');
const built = join(root, 'src-tauri/target', target, 'release');
const internal = process.env.FEISHU_TODO_PUBLIC_BUILD === '0';
const outputTarget = internal ? `internal-${target}` : target;
const out = join(root, 'release', outputTarget);
mkdirSync(out, { recursive: true });
const prefix = internal ? `Feishu-Desktop-Todo-${version}-internal-windows-x64` : `Feishu-Desktop-Todo-${version}-${target}`;
let executable;
let files;
let updaterFile;
if (process.platform === 'win32') {
  const stage = join(root, 'artifacts', `portable-${target}`);
  mkdirSync(stage, { recursive: true });
  copyFileSync(join(built, 'feishu-desktop-todo.exe'), join(stage, 'feishu-desktop-todo.exe'));
  mkdirSync(join(stage, 'resources'), { recursive: true });
  for (const name of ['lark-cli.exe', 'LARK-CLI-LICENSE']) {
    copyFileSync(join(root, 'src-tauri/resources', name), join(stage, 'resources', name));
  }
  executable = join(stage, 'feishu-desktop-todo.exe');
  const installers = readdirSync(join(built, 'bundle/nsis')).filter(n => n.endsWith('.exe') && n.includes(`_${version}_`));
  if (installers.length !== 1) throw new Error('Expected exactly one Windows installer.');
  const installer = `${prefix}-setup.exe`;
  copyFileSync(join(built, 'bundle/nsis', installers[0]), join(out, installer));
  files = [installer];
  updaterFile = installer;
  copyFileSync(join(built, 'bundle/nsis', `${installers[0]}.sig`), join(out, `${updaterFile}.sig`));
} else if (process.platform === 'darwin') {
  const apps = readdirSync(join(built, 'bundle/macos')).filter(n => n.endsWith('.app'));
  if (apps.length !== 1) throw new Error('Expected exactly one macOS app.');
  const app = join(built, 'bundle/macos', apps[0]);
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  executable = join(app, 'Contents/MacOS/feishu-desktop-todo');
  const dmgs = readdirSync(join(built, 'bundle/dmg')).filter(n => n.endsWith('.dmg') && n.includes(`_${version}_`));
  if (dmgs.length !== 1) throw new Error('Expected exactly one DMG.');
  const dmg = `${prefix}.dmg`;
  copyFileSync(join(built, 'bundle/dmg', dmgs[0]), join(out, dmg));
  execFileSync('hdiutil', ['verify', join(out, dmg)], { stdio: 'inherit' });
  files = [dmg];
  updaterFile = `${prefix}.app.tar.gz`;
  copyFileSync(`${app}.tar.gz`, join(out, updaterFile));
  copyFileSync(`${app}.tar.gz.sig`, join(out, `${updaterFile}.sig`));
  files.push(updaterFile);
} else {
  throw new Error('Preview distribution currently supports Windows and macOS.');
}
const check = JSON.parse(execFileSync(executable, ['--check-runtime'], { encoding: 'utf8', timeout: 30000 }));
if (!check.ok || !check.cliVersion.includes('1.0.76') || check.dutyConfigured !== internal) {
  throw new Error(`Package runtime check failed: ${JSON.stringify(check)}`);
}
const expectedTarget = `${check.platform === 'macos' ? 'darwin' : check.platform}${internal ? '-internal' : ''}-${check.arch}`;
if (check.updateTarget !== expectedTarget) throw new Error('Updater channel does not match packaged duty configuration.');
writeFileSync(join(out, `${prefix}-updater.json`), `${JSON.stringify({ version, target: check.updateTarget, file: updaterFile, signature: readFileSync(join(out, `${updaterFile}.sig`), 'utf8').trim() }, null, 2)}\n`);
writeFileSync(join(out, `${prefix}-runtime.json`), `${JSON.stringify(check, null, 2)}\n`);
copyFileSync(join(root, 'docs/打包与试用发布.md'), join(out, 'Trial-Guide.md'));
copyFileSync(join(root, 'src-tauri/resources/LARK-CLI-LICENSE'), join(out, 'LARK-CLI-LICENSE'));
const sums = files.map(n => `${createHash('sha256').update(readFileSync(join(out, n))).digest('hex')}  ${n}`).join('\n');
writeFileSync(join(out, `${prefix}-SHA256SUMS.txt`), `${sums}\n`);
console.log(JSON.stringify({ output: out, runtime: check, files }, null, 2));
