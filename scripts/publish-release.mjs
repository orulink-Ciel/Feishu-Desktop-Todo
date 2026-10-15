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
// The get-by-tag endpoint omits drafts. Authenticated release listing includes them.
const findRelease = tagName => api('releases?per_page=100').find(r => r.tag_name === tagName);
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const notes = '设置中新增开机自启动，可在 Windows 和 macOS 登录后自动打开轻列便签；自启动状态与系统保持同步。';
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
let release = findRelease(tag);
if (!release) {
  // Release listings can briefly lag behind creation. Keep the POST response's
  // ID instead of immediately depending on that eventually consistent list.
  release = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/releases`, '--method', 'POST', '--input', '-'], {
    encoding: 'utf8',
    input: JSON.stringify({ tag_name: tag, target_commitish: commit, name: `轻列便签 ${tag}：开机自启动`, body: readFileSync(notesFile, 'utf8'), draft: true, prerelease: true, make_latest: 'false' }),
  }));
}
if (!release) throw new Error('Unable to read back the created draft release.');
let ref;
try { ref = api(`git/ref/tags/${tag}`); }
catch (error) {
  if (!String(error).includes('404') || !release.draft || release.target_commitish !== commit) throw error;
  // A draft does not create its tag until publication. Pin it now to the verified build SHA.
  ref = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${commit}`], { encoding: 'utf8' }));
}
if (ref.object.sha !== commit) throw new Error('Existing tag points to a different build commit.');
// Published packages are immutable; an identical rerun can repair a failed feed publication.
const files = readdirSync(dir).filter(n => n !== 'latest.json');
if (release.draft) gh(['release', 'upload', tag, ...files.map(n => join(dir, n)), '--clobber']);
release = api(`releases/${release.id}`);
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
