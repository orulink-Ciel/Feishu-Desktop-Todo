import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const native = process.argv.includes('--native');
const variants = [['mist','雾蓝'],['paper','暖纸'],['graphite','墨夜'],['ocean','深海'],['rose','暮紫'],['minimal','素白']];
const browser = native
  ? await chromium.connectOverCDP('http://127.0.0.1:9223')
  : await chromium.launch({channel:'msedge',headless:true});
const page = native
  ? browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420'))
  : await browser.newPage({viewport:{width:420,height:700}});
if (!page) throw new Error('App page not found');
const errors = [];
page.on('pageerror', e=>errors.push(e.message));
if (!native) await page.goto('http://127.0.0.1:1420'); else await page.reload();
await page.getByRole('heading',{name:'今日待办',exact:true}).waitFor();
await page.locator('.task-title').first().waitFor();
if (native && await page.locator('.preview-banner').count()) throw new Error('Native app showing demo');
const applied = [];
for (const [id,name] of variants) {
  await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await page.getByRole('button',{name:'主题：'+name,exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',id);
  await expect(page.getByRole('button',{name:'主题：'+name,exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'关闭外观面板',exact:true}).click();
  await page.screenshot({animations:'disabled',path:'artifacts/'+(native?'desktop':'preview')+'-theme-'+id+'.png'});
  await page.reload();
  await page.getByRole('heading',{name:'今日待办',exact:true}).waitFor();
await page.locator('.task-title').first().waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-theme',id);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('.settings-panel').waitFor();
  const colors = await page.evaluate(()=>({
    surface:getComputedStyle(document.querySelector('.widget')).backgroundColor,
    settings:getComputedStyle(document.querySelector('.settings-panel')).backgroundColor,
    text:getComputedStyle(document.querySelector('.task-title')).color,
  }));
  if (['graphite','ocean'].includes(id) && colors.settings === 'rgb(250, 251, 252)') throw new Error('Unthemed light settings surface');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  applied.push({id,name,...colors,reloadRetained:true});
}
await page.getByRole('button',{name:'设置',exact:true}).click();
await page.getByRole('button',{name:'外观主题',exact:true}).click();
await page.getByRole('button',{name:'主题：雾蓝',exact:true}).click();
await page.keyboard.press('Escape');
await expect(page.getByRole('dialog',{name:'选择你的风格'})).toHaveCount(0);
await page.getByRole('button',{name:'设置',exact:true}).click();
if (!native) {
  await page.setViewportSize({width:360,height:460});
  for (const [,name] of variants) {
    await page.getByRole('button',{name:'切换主题',exact:true}).click();
    await page.getByRole('button',{name:'主题：'+name,exact:true}).click();
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if (overflow) throw new Error('Narrow overflow: '+name);
    await page.getByRole('button',{name:'关闭外观面板',exact:true}).click();
    await expect(page.locator('footer')).toBeInViewport();
  }
  await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await page.getByRole('button',{name:'主题：雾蓝',exact:true}).click();
  await page.screenshot({animations:'disabled',path:'artifacts/theme-picker-narrow.png'});
  await page.getByRole('button',{name:'关闭外观面板',exact:true}).click();
} else {
  await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await page.screenshot({animations:'disabled',path:'artifacts/desktop-theme-picker.png'});
  await page.getByRole('button',{name:'关闭外观面板',exact:true}).click();
}
if(errors.length) throw new Error(JSON.stringify(errors));
await writeFile('artifacts/'+(native?'desktop':'preview')+'-theme-check.json',JSON.stringify({passed:true,themes:applied,keyboardDismiss:true,settingsEntry:true,narrowChecked:!native,pageErrors:errors},null,2));
await browser.close();
console.log((native?'Native':'Preview')+': six themes, saved selection, settings entry, keyboard dismissal passed.');
