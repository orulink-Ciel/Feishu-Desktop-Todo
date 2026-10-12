// Source: State Council General Office, 国办发明电〔2025〕7号, published 2025-11-04.
export const source='https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html';
export const calendar2026=[{date:'2026-01-01',kind:'年度已核验',note:'2026 年官方放假调休日历已核验',source}];
for(const [name,month,first,last] of [['元旦',1,1,3],['春节',2,15,23],['清明节',4,4,6],['劳动节',5,1,5],['端午节',6,19,21],['中秋节',9,25,27],['国庆节',10,1,7]]){
  for(let day=first;day<=last;day++) calendar2026.push({date:`2026-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,kind:'休息',note:name,source});
}
for(const date of ['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10']) calendar2026.push({date,kind:'补班',note:'国家规定调休上班',source});
