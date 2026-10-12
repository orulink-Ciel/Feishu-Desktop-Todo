import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const portable = path.join(root,'release/Feishu-Desktop-Todo-0.1.0');
const raw = execFileSync(path.join(portable,'feishu-desktop-todo.exe'),['--diagnose'],{
  encoding:'utf8',windowsHide:true,timeout:45000,
  env:{...process.env,FEISHU_TODO_CLI:path.join(portable,'resources/lark-cli.exe')},
});
const result = JSON.parse(raw);
if (!result.ok || !Array.isArray(result.tasks)) throw new Error('Packaged read-only diagnostic failed');
if (!result.duty || result.duty.error || !result.duty.payload) throw new Error('Packaged duty read failed');
if (!Array.isArray(result.duty.payload.calendar) || !Array.isArray(result.duty.payload.leave)) throw new Error('Packaged duty calendar/leave schema missing');
await writeFile(new URL('../artifacts/release-diagnostic.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:result.ok,userName:result.userName,taskCount:result.taskCount,bundledCliVerified:true,dutyReadVerified:true,rosterCount:result.duty.payload.roster.length},null,2));
