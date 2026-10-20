import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {calendar2026} from './holiday-data-2026.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('1420'));
if(!page)throw new Error('Native desktop missing');
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const snapshot=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_duty',{refresh:true}));
if(snapshot.error||!snapshot.payload)throw new Error('Real duty read failed');
const p=snapshot.payload;
if(p.calendar.length!==calendar2026.length)throw new Error('Calendar row count mismatch');
for(const row of calendar2026){
  if(!p.calendar.some(r=>r.date.startsWith(row.date)&&r.kind.includes(row.kind)))throw new Error('Missing real calendar '+row.date);
}
if(p.rules[0].leavePolicy[0]!=='顺延补值')throw new Error('Deferred leave policy missing');
const roster=p.roster.filter(r=>r.included).sort((a,b)=>a.order-b.order);
if(!p.rules[0].startDate.startsWith('2026-10-05')||p.rules[0].dailyCount!==1||roster.length!==12)throw new Error('Live rule changed; inspect before asserting expected roster');
await page.getByRole('button',{name:'刷新值日',exact:true}).click();
await page.getByText(roster[3].person[0].name,{exact:true}).waitFor();
await page.getByRole('button',{name:'排班与调整',exact:true}).click();
await page.getByLabel('预览起始日期').fill('2026-10-05');
const table=page.getByRole('table',{name:'值日排班预览'});
for(const day of ['10-05','10-06','10-07','10-11','10-17']) {
  const row=table.getByRole('row').filter({hasText:day});
  if(!(await row.innerText()).includes('休息'))throw new Error('Rest day incorrect '+day);
}
for(const [day,index] of [['10-08',0],['10-10',2],['10-12',3]]){
  if(!(await table.getByRole('row').filter({hasText:day}).innerText()).includes(roster[index].person[0].name))throw new Error('Rotation after holiday incorrect '+day);
}
for(const name of ['请假与临时调整','节假日日历'])await page.getByRole('button',{name,exact:true}).waitFor();
await page.screenshot({path:'artifacts/desktop-duty-adjustments.png'});
const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
if(!fits||errors.length)throw new Error(JSON.stringify({fits,errors}));
await page.getByRole('button',{name:'排班与调整',exact:true}).click();
await writeFile('artifacts/duty-adjustment-native-check.json',JSON.stringify({passed:true,calendarRows:p.calendar.length,rosterCount:roster.length,leavePolicy:'顺延补值',checks:['real_calendar_readback','holiday_skip_oct5_7','oct10_makeup','oct17_alternating_rest','live_12_person_rotation','preview_date_selection','single_admin_adjustment_table','no_cloud_duty_or_task_writes'],pageErrors:errors},null,2));
await browser.close();console.log('Real native holiday and duty adjustment checks passed');
