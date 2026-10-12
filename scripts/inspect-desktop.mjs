import { chromium } from '@playwright/test';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
for (const page of browser.contexts().flatMap(context => context.pages())) {
  console.log(JSON.stringify({ url:page.url(), title:await page.title(), footer:await page.locator('footer').innerText().catch(()=>null), alerts:await page.getByRole('alert').allTextContents(), select:await page.locator('select').inputValue().catch(()=>null), testTasks:await page.getByRole('button',{name:/同步验证/}).allTextContents() }));
}
await browser.close();
