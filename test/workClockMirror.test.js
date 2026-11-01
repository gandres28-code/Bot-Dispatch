'use strict';
const assert=require('node:assert/strict');
const {splitClock}=require('../services/workClock'),S=require('../services/workSupport');
const row={id:'clock',employee:'Ana',clock_in:'2026-10-31T14:00:00Z',clock_out:'2026-10-31T14:11:24Z',rate_cents:2200};
assert.equal(splitClock(row)[0].total,4.18,'calculate money from exact elapsed time, not rounded displayed hours');
assert.equal(S.inside({lat:36,lng:-93,accuracy:10},{latitude:36,longitude:-93,radius_m:100}),true);
assert.equal(S.inside({lat:36,lng:-93,accuracy:110},{latitude:36,longitude:-93,radius_m:100}),false);
assert.throws(()=>S.gps({lat:null,lng:-93,accuracy:1,capturedAt:new Date().toISOString()}));
assert.throws(()=>S.gps({lat:36,lng:-93,accuracy:1,capturedAt:'2000-01-01T00:00:00Z'}));
assert.throws(()=>S.gps({lat:100,lng:-93,accuracy:1,capturedAt:new Date().toISOString()}));
console.log('Time Clock: exact elapsed pay, GPS accuracy, null coordinates and stale fixes passed.');

assert.equal(S.payrollSnapshot({records:[{cleaner:'Ana',amount:55}]},[{employee:'Ana',hourlyRate:22,total:44}]).summary.total,99);
const open=[];open.warnings=['Missing clock out'];assert.equal(S.payrollSnapshot({records:[]},open).valid,false);
assert.equal(S.payrollSnapshot({records:[]},[{employee:'Ana',hourlyRate:0,total:0}]).valid,false);
