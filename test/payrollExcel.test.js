const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
let saved;
class Workbook {
  constructor() { this.worksheets = []; this.xlsx = { writeFile: async (file) => { saved = { file, sheets: this.worksheets }; } }; }
  addWorksheet(name) {
    const sheet = { name, rows: [], addRow(row) { this.rows.push(row); }, getRow() { return {}; }, eachRow() {} };
    this.worksheets.push(sheet); return sheet;
  }
}
const ctx = vm.createContext({ console: { warn() {} }, process: { env: {} }, Date, Map, Set,
  validatePayrollRange() {},
  getPayrollRecordsWithSource: async () => ({ records: [{ date: '2026-09-28', cleaner: 'Ana', unit: '331A', roomType: '2', amount: 45 }], source: 'central-notion' }),
  getHourlyPayrollRecords: async () => { throw new Error('Could not find data_source'); },
  ExcelJS: { Workbook }, normalizeCleaner: (v)=>v, cleanEmployeeText: (v)=>v.toLowerCase(), roundMoney: (v)=>Math.round(Number(v)*100)/100,
  uniqueSheetName: (_,name)=>name, fs: { existsSync: ()=>true }, path, __dirname: '/tmp', payrollFileName: ()=> 'payroll-test.xlsx',
});
vm.runInContext(source.slice(source.indexOf('async function generateWeeklyPayrollExcel('),source.indexOf('// ■ Actualizar habitación principal')),ctx);
(async () => {
 const result = await ctx.generateWeeklyPayrollExcel('2026-09-28','2026-10-04');
 assert.ok(saved, 'Export must write a workbook when optional Time Clock is unavailable');
 assert.equal(result.totalRecords,1);
 const summary = saved.sheets.find(s=>s.name==='Payroll Summary');
 assert.equal(summary.rows[0].total,45);
 assert.ok(summary.rows.some(r=>r.employee.includes('INCOMPLETA')));
 assert.ok(saved.sheets.find(s=>s.name==='Payroll Warnings').rows.some(r=>r.type==='INCOMPLETE'));
 // A working Time Clock must still contribute to the same weekly export.
 ctx.getHourlyPayrollRecords = async ()=>[{employee:'Ana',role:'Runner',workDate:'2026-10-04',clockIn:'2026-10-05T02:00:00Z',clockOut:'2026-10-05T04:00:00Z',hours:2,hourlyRate:20,total:40}];
 await ctx.generateWeeklyPayrollExcel('2026-09-28','2026-10-04');
 assert.equal(saved.sheets.find(s=>s.name==='Payroll Summary').rows[0].total,85);
 assert.equal(saved.sheets.find(s=>s.name==='Payroll Summary').rows.length,1);
 console.log('Excel export checks passed: unavailable Time Clock, visible incomplete warning, cleaning totals preserved, normal hourly totals.');
})().catch(e=>{console.error(e);process.exitCode=1;});
