'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const eventSource=fs.readFileSync('services/eventEngine.js','utf8'),syncSource=fs.readFileSync('services/payrollSyncService.js','utf8');
const records=[];
const canonical=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const query=async(sql,p=[])=>{
 if(sql.trim().startsWith('SELECT id FROM payroll_records'))return {rows:records.filter(r=>r.workDate===p[0]&&r.employee===p[1]&&canonical(r.unit)===canonical(p[2])).slice(0,1)};
 if(sql.includes('UPDATE payroll_records SET notion_id=')){const r=records.find(r=>!r.notionId&&r.workDate===p[1]&&r.employee===p[2]&&canonical(r.unit)===canonical(p[3]));if(r)r.notionId=p[0];return {rows:[]};}
 if(sql.includes('INSERT INTO payroll_records')){
  if(sql.includes('source_event_id')){const record={id:records.length+1,eventId:p[0],workDate:p[1],employee:p[3],unit:p[4],amount:p[10]};records.push(record);return {rows:[record],rowCount:1};}
  const existing=records.find(r=>r.notionId===p[0]);if(existing)return {rows:[existing]};
  const record={id:records.length+1,notionId:p[0],workDate:p[1],employee:p[3],unit:p[4],amount:p[10]};records.push(record);return {rows:[record],rowCount:1};
 }
 throw Error('Unexpected SQL');
};
const ctx=vm.createContext({console,process:{env:{}},query,
 roundMoney:n=>Math.round((Number(n)+Number.EPSILON)*100)/100,
 splitEmployeeNames:s=>s.split(' / '),normalizeEmployee:s=>s.toLowerCase(),
 getPayrollWeek:()=>({weekStart:'2026-10-26',weekEnd:'2026-11-01'}),resolvePayrollRate:async()=>({amount:20,roomType:'M',propertyName:'ALL'})});
function between(source,start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
vm.runInContext(between(eventSource,'function allocateUnitPay(','function stableHash(')+between(eventSource,'async function createPayrollFromDone(','async function insertNotification(')+between(syncSource,'async function upsertPayrollRecord(','async function syncPayrollFromNotion('),ctx);
(async()=>{
 const room={id:1,room_number:'101 A (M)',assigned_cleaners:['Ana','Maria','Julia']};
 const first=await ctx.createPayrollFromDone({query},'evt-one',room,'Ana','2026-10-28');assert.equal(first.created,3);assert.equal(records.reduce((n,r)=>n+Math.round(r.amount*100),0),2000);
 const again=await ctx.createPayrollFromDone({query},'evt-two',room,'Ana','2026-10-28');assert.equal(again.created,0);assert.equal(again.skipped,3,'a different retry ID must not pay the same unit/person/day again');assert.equal(records.length,3);
 await ctx.upsertPayrollRecord({notionId:'notion-ana',workDate:'2026-10-28',employee:'Ana',normalizedEmployee:'ana',unit:'101 A (M)',payType:'unit',amount:6.67});
 assert.equal(records.length,3,'importing the Notion mirror must attach, not duplicate, the committed payment');assert.equal(records[0].notionId,'notion-ana');
 await ctx.upsertPayrollRecord({notionId:'notion-ana',workDate:'2026-10-28',employee:'Ana',normalizedEmployee:'ana',unit:'101 A (M)',payType:'unit',amount:6.67});assert.equal(records.length,3);
 console.log('Payroll reliability: conserved cents, one unit/person/day payment and repeat-safe Notion mirror reconciliation passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
