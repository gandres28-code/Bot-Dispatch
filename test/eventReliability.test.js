'use strict';
const assert=require('node:assert/strict');
// Inject an isolated SQL client. No production database is accessed.
const dbPath=require.resolve('../db');const original=require.cache[dbPath];
let events=new Map(),room={id:1,room_number:'101 A',normalized_room:'101A',assigned_cleaner:'Alice',assigned_cleaners:['Alice'],cleaning_status:'Pending',work_date:'2026-10-28'};
let statements=[],emitted=[],failCommit=false;
const client={release(){},async query(sql,p=[]){
 statements.push(sql);
 if(sql==='COMMIT'&&failCommit)throw Error('commit failed');
 if(sql.includes('FROM system_events')&&sql.includes('event_id = $1'))return {rows:events.has(p[0])?[events.get(p[0])]:[]};
 if(sql.includes('SELECT *')&&sql.includes('FROM rooms'))return {rows:[{...room}]};
 if(sql.includes('UPDATE rooms')){room={...room,operational_state_at:p[1],cleaning_status:sql.includes("'In Progress'")?'In Progress':room.cleaning_status};return {rows:[room]};}
 if(sql.includes('INSERT INTO system_events')){const event={id:events.size+1,event_id:p[0],payload:JSON.parse(p[7])};events.set(p[0],event);return {rows:[event]};}
 return {rows:[{id:1}],rowCount:1};
}};
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{getPool:()=>({connect:async()=>client}),query:async()=>({rows:[]})}};
const {createEventEngine,allocateUnitPay}=require('../services/eventEngine');
if(original)require.cache[dbPath]=original;else delete require.cache[dbPath];
(async()=>{
 assert.deepEqual(allocateUnitPay(20,3),[6.67,6.67,6.66]);assert.equal(allocateUnitPay(20,3).reduce((sum,n)=>sum+Math.round(n*100),0),2000);assert.deepEqual(allocateUnitPay(20,2,true),[20,20]);
 const engine=createEventEngine({io:{emit:(...e)=>emitted.push(e)}});
 const body={action:'START',unit:'101 A',employee:'Alice',role:'Cleaner',workDate:'2026-10-28',occurredAt:'2026-10-28T14:00:00.000Z',requestId:'one-request'};
 const first=await engine.publish(body);assert.equal(first.ok,true);assert.equal(first.duplicate,false);
 assert(statements.findIndex(s=>s.includes('pg_advisory_xact_lock'))<statements.findIndex(s=>s.includes('FROM system_events')),'retry lock precedes effects');
 const roomCount=statements.filter(s=>s.includes('UPDATE rooms')).length;
 const repeat=await engine.publish(body);assert.equal(repeat.duplicate,true);assert.equal(statements.filter(s=>s.includes('UPDATE rooms')).length,roomCount,'repeated key cannot update room/payroll again');
 const before=emitted.length;room.operational_state_at='2026-10-28T16:00:00.000Z';await assert.rejects(engine.publish({...body,requestId:'stale'}),/más reciente/);assert.equal(emitted.length,before);
 room.operational_state_at=null;failCommit=true;await assert.rejects(engine.publish({...body,requestId:'failed'}),/commit failed/);assert.equal(emitted.length,before,'failed commits must not broadcast success');assert.equal(statements.at(-1),'ROLLBACK');
 console.log('Event reliability: transaction ordering, duplicate-key effects, stale-event rejection, no success broadcast before commit and exact-cent unit splits passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
