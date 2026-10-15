import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Public releases always use the placeholder duty configuration, even on an administrator's PC.
execFileSync(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), 'build', ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, FEISHU_TODO_PUBLIC_BUILD: '1' },
  stdio: 'inherit',
});
