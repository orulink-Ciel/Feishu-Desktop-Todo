import { chromium } from '@playwright/test';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420'));
if(!page) throw new Error('Native app missing');
await page.getByRole('button',{name:'退出',exact:true}).click();
await browser.close();
