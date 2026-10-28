const assert = require('node:assert/strict');
const express = require('express');
const {createControlRouter,summarize,taskInput,dateValue,canManage}=require('../services/controlCenter');
const users={ops:{name:'Encargada',role:'dispatch / inspector',active:true},cleaner:{name:'Cleaner',role:'cleaner',active:true},inactive:{name:'Ex',role:'admin',active:false}};
async function main(){
 assert.equal(canManage(users.ops),true); assert.equal(canManage(users.cleaner),false);assert.equal(canManage({role:'notadmin'}),false);
 assert.throws(()=>dateValue('2026-02-30'));assert.throws(()=>dateValue('wrong'));assert.equal(dateValue('2026-10-28'),'2026-10-28');
 assert.throws(()=>taskInput({title:'x'}));assert.throws(()=>taskInput({title:'x',owner:'y',dueAt:'bad'}));
 assert.equal(summarize([{statusGroup:'awaitingInspection',arrival:true}],[],[]).ready,0);
 assert.equal(summarize([{statusGroup:'ready',arrival:true}],[],[]).arrivalsPending,0);
 assert.equal(summarize([], [{status:'cancelled',priority:'urgent'},{status:'new',assigned_to:'Runner'}],[]).unassignedOrders,1);
 const writes=[];let task=null,version=1,shift=null;
 const query=async(sql,params=[])=>{
   writes.push(sql);
   if(sql.includes('INSERT INTO care_control_tasks')){
     if(task)return {rows:[]};task={id:1,work_date:params[0],title:params[1],owner:params[2],status:'pending',version:1,request_id:params[8]};return {rows:[task]};
   }
   if(sql.includes('SELECT * FROM care_control_tasks WHERE request_id'))return {rows:[task]};
   if(sql.includes('UPDATE care_control_tasks')){if(params[3]!==version)return {rows:[]};version++;task={...task,status:params[0],version};return {rows:[task]};}
   if(sql.includes('INSERT INTO care_control_shifts')){if(shift)return {rows:[]};shift={work_date:params[0],version:1};return {rows:[shift]};}
   if(sql.includes('SELECT * FROM care_control_shifts'))return {rows:shift?[shift]:[]};
   if(sql.includes('SELECT * FROM care_control_tasks'))return {rows:task?[task]:[]};
   return {rows:[]};
 };
 const app=express();app.use(express.json());app.use('/api',createControlRouter({query,pool:()=>({connect:async()=>({query,release(){}})}),resolveUser:async code=>users[code],today:()=> '2026-10-28',listRooms:async()=>[],listEmployees:async()=>[{name:'A',role:'admin',code:'SECRET',hourlyRate:99}]}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path,code,method='GET',body)=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json',...(code?{'X-Care-Code':code}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};};
 try{
 assert.equal((await call('/day')).status,401);assert.equal((await call('/day','inactive')).status,401);assert.equal((await call('/day','cleaner')).status,403);
 const day=await call('/day','ops');assert.equal(day.status,200);assert.equal(day.data.employees[0].code,undefined);assert.equal(day.data.employees[0].hourlyRate,undefined);
 const body={date:'2026-10-28',title:'Preparar blancos',owner:'A',requestId:'request-id-1234567890'};
 assert.equal((await call('/tasks','ops','POST',body)).status,200);assert.equal((await call('/tasks','ops','POST',body)).data.task.id,1);
 assert.equal(writes.filter(s=>s.includes('INSERT INTO care_control_audit')).length,1,'retry must not duplicate the event');
 assert.equal((await call('/tasks/1','ops','PATCH',{status:'done',version:1})).status,200);
 assert.equal((await call('/tasks/1','ops','PATCH',{status:'pending',version:1})).status,409,'stale devices must not overwrite task status');
 assert(writes.includes('ROLLBACK'),'conflict must roll back');
 assert.equal((await call('/shift','ops','PUT',{date:'2026-10-28',version:0,settings:{operations:'A',backup:'A'}})).status,400);
 const shiftBody={date:'2026-10-28',version:0,settings:{operations:'A',backup:'B'},status:'reviewed'};
 assert.equal((await call('/shift','ops','PUT',shiftBody)).status,200);assert.equal((await call('/shift','ops','PUT',shiftBody)).status,409);
 assert.equal((await call('/orders/bad/delegate','ops','PATCH',{owner:'A'})).status,400);
 console.log('Control Center: access, privacy, date validation, READY separation, idempotency, audit, rollback and concurrency passed.');
 }finally{await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1});
