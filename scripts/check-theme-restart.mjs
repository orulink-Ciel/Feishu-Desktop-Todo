import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420'));
if (!page) throw new Error('Native app page not found');
await page.getByRole('heading',{name:'今日待办',exact:true}).waitFor();
if (!process.argv.includes('--prepare')) {
  await expect(page.locator('html')).toHaveAttribute('data-theme','graphite');
  await writeFile('artifacts/theme-restart-check.json',JSON.stringify({passed:true,retainedAfterNativeProcessRestart:'graphite',resetForDelivery:'mist'},null,2));
}
await page.getByRole('button',{name:'切换主题',exact:true}).click();
await page.getByRole('button',{name:process.argv.includes('--prepare')?'主题：墨夜':'主题：雾蓝',exact:true}).click();
await page.getByRole('button',{name:'关闭外观面板',exact:true}).click();
await page.getByRole('button',{name:'退出',exact:true}).click();
await browser.close();
console.log(process.argv.includes('--prepare')?'Saved graphite and closed native app.':'Native process restart retained chosen theme.');
