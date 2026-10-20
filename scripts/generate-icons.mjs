import { copyFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
execFileSync(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), 'icon',
  join(root, 'app-icon.png'), '--output', join(root, 'src-tauri/icons')], { stdio: 'inherit' });
mkdirSync(join(root, 'public'), { recursive: true });
copyFileSync(join(root, 'src-tauri/icons/128x128.png'), join(root, 'public/app-icon.png'));
console.log('Generated native Windows/macOS icons and the shared application mark.');
