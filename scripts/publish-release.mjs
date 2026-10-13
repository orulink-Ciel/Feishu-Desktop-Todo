import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createManifest } from './update-manifest.mjs';

const [dir, tag, commit] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('Pass the verified build commit SHA.');
const repo = 'orulink-Ciel/Feishu-Desktop-Todo';
const gh = args => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8' });
const api = path => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${path}`], { encoding: 'utf8' }));
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const notes = '新增应用内更新：启动后检查，每 6 小时检查一次；设置中可手动检查。点击下载安装后重启，保留登录、主题及窗口位置。公司版和通用版分别更新，下载包验证签名。';
const manifest = createManifest(dir, tag, notes);
if (manifest.version !== version) throw new Error('Tag does not match source version.');
// Never let an older completed workflow roll a newer update feed back.
try {
  const feed = api('releases/tags/desktop-updates');
  const asset = feed.assets.find(a => a.name === 'latest.json');
  if (asset) {
    const previous = JSON.parse(await (await fetch(asset.browser_download_url)).text());
    const compare = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
    if (compare(previous.version, version) > 0) throw new Error('Refusing to downgrade the update feed.');
  }
} catch (error) {
  if (!String(error).includes('404')) throw error;
}
const notesFile = join(dir, 'Release-Notes.md');
writeFileSync(notesFile, `飞书桌面待办 v${version} 内部试用版\n\n${notes}\n\n旧版本 0.1.1 需手动安装一次。公司 Windows 使用 internal 安装包；Mac 使用对应架构 DMG。Mac 仍为临时签名、未公证，首次授权与真实 Mac 更新需实机验收。\n`);
let release;
try { release = api(`releases/tags/${tag}`); }
catch (error) {
  if (!String(error).includes('404')) throw error;
  gh(['release', 'create', tag, '--target', commit, '--title', `飞书桌面待办 ${tag}：应用内更新`, '--notes-file', notesFile, '--draft', '--prerelease']);
  release = api(`releases/tags/${tag}`);
}
const ref = api(`git/ref/tags/${tag}`);
if (ref.object.sha !== commit) throw new Error('Existing tag points to a different build commit.');
// Published packages are immutable; an identical rerun can repair a failed feed publication.
const files = readdirSync(dir).filter(n => n !== 'latest.json');
if (release.draft) gh(['release', 'upload', tag, ...files.map(n => join(dir, n)), '--clobber']);
release = api(`releases/tags/${tag}`);
for (const name of files) {
  const asset = release.assets.find(a => a.name === name);
  const digest = `sha256:${createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')}`;
  if (asset?.state !== 'uploaded' || asset.digest !== digest) throw new Error(`Upload integrity check failed: ${name}`);
}
if (release.draft) gh(['release', 'edit', tag, '--draft=false', '--latest=false']);
try { api('releases/tags/desktop-updates'); }
catch (error) {
  if (!String(error).includes('404')) throw error;
  gh(['release', 'create', 'desktop-updates', '--target', commit, '--title', '桌面应用更新入口', '--notes', '应用自动读取 latest.json。首次安装请下载版本发布页中的安装包。', '--prerelease', '--latest=false']);
}
const manifestFile = join(dir, 'latest.json');
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
gh(['release', 'upload', 'desktop-updates', manifestFile, '--clobber']);
const feedAsset = api('releases/tags/desktop-updates').assets.find(a => a.name === 'latest.json');
const feedDigest = `sha256:${createHash('sha256').update(readFileSync(manifestFile)).digest('hex')}`;
if (feedAsset?.digest !== feedDigest) throw new Error('Update feed upload failed integrity check.');
console.log(`Published ${tag} and updater feed for ${Object.keys(manifest.platforms).length} channels.`);
