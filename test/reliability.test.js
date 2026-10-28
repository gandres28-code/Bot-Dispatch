'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const {createActionHandler}=require('../services/operationalActions');
const {createRequestHandlers}=require('../services/requestReliability');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Storage {
 constructor(){this.data=new Map();this.fail=false;}
 get length(){return this.data.size;} key(i){return [...this.data.keys()][i]??null;}
 getItem(k){return this.data.get(k)??null;}
 setItem(k,v){if(this.fail)throw Error('quota');this.data.set(k,String(v));}
 removeItem(k){this.data.delete(k);}
}
function browser(storage=new Storage()){
 storage.setItem('employeeName','Alice');
 let transport=async()=>({ok:true,status:200,json:async()=>({ok:true,success:true,postgresUpdated:true})});
 const events=[];
 const c={console,localStorage:storage,crypto:webcrypto,AbortController,URL,Date,Intl,Uint8Array,Math,JSON,Promise,Error,Map,Set,
  setTimeout,clearTimeout,setInterval:()=>0,document:{readyState:'loading',hidden:false,addEventListener(){}},navigator:{onLine:true},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},addEventListener(){},dispatchEvent:e=>events.push(e),fetch:(...args)=>transport(...args)};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('public/js/resilience.js','utf8'),c);
 return {c,api:c.OSResilience,events,storage,setFetch:f=>transport=f};
}
function res(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}
async function frontend(){
 const b=browser();let calls=0;
 b.setFetch(async()=>{calls++;return {ok:false,status:403,json:async()=>({error:'No autorizado'})};});
 await assert.rejects(b.api.fetchJson('/read'),/No autorizado/);assert.equal(calls,1,'403 must not be retried');
 calls=0;await assert.rejects(b.api.fetchJson('/write',{method:'POST'},{retries:4}));assert.equal(calls,1,'unsafe writes must not be blindly retried');
 calls=0;let complete;
 b.setFetch(()=>{calls++;return new Promise(r=>complete=r);});
 const read1=b.api.fetchJson('/rooms?name=Alice&t=123'),read2=b.api.fetchJson('/rooms?name=Alice&t=456');
 assert.equal(read1,read2,'concurrent reads are coalesced');
 complete({ok:true,status:200,json:async()=>({ok:true})});await read1;assert.equal(calls,1);
 b.c.navigator.onLine=false;
 const queued=await b.api.postAction('/action',{action:'START',unit:'101 A',name:'Alice'});
 assert.equal(queued.queuedOffline,true);assert.equal(queued.success,false);assert.equal(b.api.pendingCount(),1);
 b.storage.setItem('employeeName','Bob');assert.equal(b.api.pendingCount(),0);await b.api.flushQueue();assert.equal(b.storage.length>1,true,'another user must not flush Alice work');b.storage.setItem('employeeName','Alice');
 // Enqueue while a flush is in flight. The new entry must survive completion of the old flush.
 b.c.navigator.onLine=true;let release;
 b.setFetch(()=>new Promise(r=>release=r));const flushing=b.api.flushQueue();await tick();b.c.navigator.onLine=false;
 await b.api.postAction('/action',{action:'START',unit:'102 A',name:'Alice'});
 release({ok:true,status:200,json:async()=>({success:true,postgresUpdated:true})});await flushing;
 assert.equal(b.api.pendingCount(),1,'newly queued work must not be lost by a stale flush snapshot');
 b.c.navigator.onLine=true;b.setFetch(async()=>({ok:false,status:409,json:async()=>({success:false,retryable:false,message:'Turno anterior'})}));await b.api.flushQueue();
 assert.equal(b.api.pendingItems()[0].state,'blocked');assert.equal(b.api.pendingCount(),1,'permanent errors stay visible');
 const failing=browser();failing.c.navigator.onLine=false;failing.storage.fail=true;await assert.rejects(failing.api.postAction('/action',{action:'DONE',unit:'101 A',name:'Alice'}),/No se pudo guardar/);
 const success=browser();const result=await success.api.postAction('/action',{action:'START',unit:'101 A',name:'Alice'});assert.equal(result.postgresUpdated,true);assert.equal(success.api.pendingCount(),0);assert(success.events.some(e=>e.type==='care:action-confirmed'));
 success.api.saveSnapshot('units',{ok:true});success.storage.setItem('employeeName','Bob');assert.equal(success.api.loadSnapshot('units'),null,'cached assignments are user-scoped');
 console.log('Frontend reliability: read coalescing, no blind retries, offline persistence, cross-user isolation, concurrent enqueue, retained errors, storage failure and confirmed-only success passed.');
}
async function actionHandlers(){
 let resolve,followups=0;
 const handler=createActionHandler({kind:'cleaner',today:()=> '2026-10-28',engine:{handleCleanerAction:()=>new Promise(r=>resolve=r)},afterCommit:()=>{followups++;return new Promise(()=>{});}});
 const response=res();const pending=handler({body:{action:'START',unit:'101 A',name:'Alice',requestId:'same-request',workDate:'2026-10-28'}},response);
 assert.equal(response.body,undefined,'no success before the engine commits');resolve({eventId:'evt1'});await pending;
 assert.equal(response.body.postgresUpdated,true);assert.equal(response.body.notionSync,'queued');await tick();assert.equal(followups,1,'slow followups must not hold the response');
 const failed=createActionHandler({kind:'inspector',today:()=> '2026-10-28',engine:{handleInspectorAction:async()=>{throw Error('database unavailable');}}});
 const fail=res();await failed({body:{action:'READY_GUEST',unit:'101 A',name:'I'}},fail);assert.equal(fail.statusCode,503);assert.equal(fail.body.success,false,'database failure must not become a 202 background success');
 const old=res();await handler({body:{action:'START',unit:'101 A',name:'A',workDate:'2026-10-27'}},old);assert.equal(old.statusCode,409);assert.equal(old.body.retryable,false);
 console.log('Action handlers: commit-before-success, background-only followups, no false fallback success and expired-shift protection passed.');
}
async function orderHandlers(){
 let order=null,eventCount=0,releases=0,commits=0,followup=0;const emitted=[];
 const query=async(sql,p=[])=>{
  if(sql==='COMMIT')commits++;
  if(sql.includes('SELECT * FROM service_orders WHERE request_id'))return {rows:order?[order]:[]};
  if(sql.includes('SELECT * FROM service_orders WHERE id='))return {rows:order?[order]:[]};
  if(sql.includes('INSERT INTO service_orders ')){order={id:1,room:p[0],category:p[1],items:JSON.parse(p[2]),priority:p[3],assigned_to:p[4],requested_by:p[5],notes:p[6],status:'new',request_id:p[8]};return {rows:[order]};}
  if(sql.includes('INSERT INTO service_order_events'))eventCount++;
  if(sql.includes('UPDATE service_orders SET status=')){order={...order,status:p[0]};return {rows:[order]};}
  return {rows:[]};
 };
 const h=createRequestHandlers({pool:()=>({connect:async()=>({query,release(){releases++;}})}),emit:(...args)=>emitted.push(args),onCreated:()=>{followup++;return new Promise(()=>{});}});
 const body={room:'101 A',items:[{name:'Towel',quantity:3}],requestedBy:'Alice',requestId:'request-123456789'};
 const first=res();await h.create({body},first);assert.equal(first.statusCode,201);assert.equal(releases,1,'pool connection released before external followups');
 const repeated=res();await h.create({body},repeated);assert.equal(repeated.body.duplicate,true);assert.equal(eventCount,1);assert.equal(emitted.length,1);
 const changed=res();await h.create({body:{...body,room:'102 A'}},changed);assert.equal(changed.statusCode,409);
 const skip=res();await h.status({params:{id:'1'},body:{status:'completed',actor:'Runner'}},skip);assert.equal(skip.statusCode,409,'cannot skip states');
 const accepted=res();await h.status({params:{id:'1'},body:{status:'accepted',actor:'Runner'}},accepted);assert.equal(accepted.body.order.status,'accepted');
 const double=res();await h.status({params:{id:'1'},body:{status:'accepted',actor:'Runner'}},double);assert.equal(double.body.duplicate,true);assert.equal(eventCount,2,'double touch creates one status event');
 const backwards=res();await h.status({params:{id:'1'},body:{status:'new'}},backwards);assert.equal(backwards.statusCode,400);
 await tick();assert.equal(followup,1);assert(commits>=4);
 console.log('Request handlers: pool release, background-only Notion, idempotent creation, conflicting keys and ordered/double-tap-safe status changes passed.');
}
(async()=>{await frontend();await actionHandlers();await orderHandlers();})().catch(e=>{console.error(e);process.exitCode=1});
