const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const text = (value) => ({ rich_text: [{ plain_text: value }] });
const pages = [
 { id: 'a', properties: { Date: { date: { start: '2026-09-28' } }, 'Room Number': text('331A'), cleaner: text('Ana / Maria / Julia'), 'Room Type': { select: { name: '2' } }, Rate: { number: 0 } } },
 { id: 'b', properties: { Date: { date: { start: '2026-10-04' } }, 'Room Number': text('405 (S)'), 'Assigned Cleaner': text('Ana'), Amount: { number: 22 } } },
];
let calls = 0;
const ctx = vm.createContext({ console: { log() {} }, process: { env: {} }, NOTION_DATABASE_ID: 'rooms', NOTION_TIME_CLOCK_DATABASE_ID: 'clock', ROOM_RATES: { '2': 45, S: 22 },
 normalizeCleaner: (v) => v.trim(), cleanEmployeeText: (v) => v.toLowerCase().trim(),
 getPayrollPropertyFromUnit: () => 'ALL',
 getNotionDatabaseSchema: async () => ({ Date: { type: 'date' } }),
 notion: { databases: { query: async (body) => {
   if (body.database_id === 'rooms') {
     assert.equal(body.filter.and[0].date.on_or_after, '2026-09-28');
     calls++;
     return body.start_cursor ? { results: [pages[1]], has_more: false } : { results: [pages[0]], has_more: true, next_cursor: 'next' };
   }
   const p = { id: body.start_cursor || 'first', properties: { Employee: text('Runner'), 'Clock In': { date: { start: body.start_cursor ? '2026-10-05T02:00:00Z' : '2026-09-28T13:00:00Z' } }, 'Clock Out': { date: { start: body.start_cursor ? '2026-10-05T04:00:00Z' : '2026-09-28T15:00:00Z' } }, 'Hourly Rate': { number: 20 } } };
   return { results: [p], has_more: !body.start_cursor, next_cursor: body.start_cursor ? null : 'next' };
 } } }, app: { get() {} },
});
vm.runInContext(section('function findPropName(', 'function buildTextProperty(') + section('function getRoomType(', '// ■ Semana de nómina') + section('function splitCleanerNames(', '// ■ Crear registro de nómina') + section('function readCentralPropertyText(', 'async function getPayrollRecordsWithSource(') + section('async function getHourlyPayrollRecords(', 'async function getEmployeesCached('), ctx);
(async () => {
 const records = await ctx.getPayrollRecordsFromNotion('2026-09-28', '2026-10-04');
 assert.equal(calls, 2); assert.equal(records.length, 4);
 assert.equal(records.reduce((s,r) => s+r.amount, 0), 67);
 assert.equal(records.filter(r=>r.cleaner==='Ana').reduce((s,r)=>s+r.amount,0), 37);
 // Cent allocation must conserve the unit total, including three-way splits.
 pages[0].properties.Rate.number = 20;
 const split = await ctx.getPayrollRecordsFromNotion('2026-09-28', '2026-10-04');
 assert.equal(split.filter(r=>r.sourcePageId==='a').reduce((s,r)=>s+Math.round(r.amount*100),0), 2000);
 const hourly = await ctx.getHourlyPayrollRecords('2026-09-28', '2026-10-04');
 assert.equal(hourly.length, 2); assert.equal(hourly[1].workDate, '2026-10-04');
 assert.equal(hourly.reduce((s,r)=>s+r.total,0),80);
 console.log('Payroll regression checks passed: pagination, lowercase cleaner, Room Type rates, weekly/person totals, split cents, hourly dates and calculation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
