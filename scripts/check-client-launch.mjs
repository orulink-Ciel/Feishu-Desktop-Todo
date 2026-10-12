import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420'));
if (!page) throw new Error('Native app page not found');
await page.locator('.task-title').first().waitFor();
const start = await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_snapshot'));
if(start.preferences.intervalSeconds!==300) throw new Error('Legacy interval was not migrated');
await page.getByRole('button',{name:'设置',exact:true}).click();
await expect(page.getByLabel('自动同步间隔')).toHaveValue('300');
for(const seconds of [120,600,300]) {
 await page.getByLabel('自动同步间隔').selectOption(String(seconds));
 await page.waitForFunction(async seconds=>(await window.__TAURI_INTERNALS__.invoke('get_snapshot')).preferences.intervalSeconds===seconds,seconds);
}
await page.getByRole('button',{name:'设置',exact:true}).click();
const title = await page.locator('.task-title').first().innerText();
const selected = start.tasks.find(task=>task.title===title);
if(!selected) throw new Error('Rendered task not found in native snapshot');
await page.locator('.task-title').first().click();
await expect(page.getByRole('alert')).toHaveCount(0);
await writeFile('artifacts/low-frequency-client-check.json',JSON.stringify({
 passed:true,migratedInterval:300,availableIntervals:[120,300,600],selectedGuid:selected.guid,
 clientProtocol:'feishu://applink/client/todo/detail',nativeOpenCommandReturned:true,
 taskWritesPerformed:false,clientDetailVisualConfirmation:'pending'
},null,2));
await browser.close();
console.log('Native settings migration and task-open command passed; no task writes.');
