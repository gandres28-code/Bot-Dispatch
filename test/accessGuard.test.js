'use strict';
const assert=require('node:assert/strict'),{createAccessGuard,digest,clientInfo}=require('../services/accessGuard');
let devices=[],events=[],online=true,employee={id:'emp1',code:'1234',name:'Ana',role:'Cleaner',active:true};
const origin='https://care.example',env={CARE_PUBLIC_ORIGIN:origin,CARE_OWNER_SECRET:'a'.repeat(48)};
const clean=d=>{const {token_hash,user,...safe}=d;return safe;};
async function query(sql,p=[]){
 if(!online)throw Error('db');
 if(sql.startsWith('CREATE'))return{rows:[]};
 if(sql.startsWith('INSERT INTO care_access_events')){
  events.push({id:p[0],device_id:p[1],event_type:p[2],path:p[3],client_info:JSON.parse(p[4]),actor_id:p[5],occurred_at:new Date()});return{rows:[]};
 }
 if(sql.startsWith('INSERT INTO care_access_devices')){
  devices.push({id:p[0],token_hash:p[1],employee_id:p[2],employee_name:p[3],label:p[4],access_level:p[5],status:p[6],expires_at:p[7],created_at:new Date()});return{rows:[]};
 }
 if(sql.startsWith('SELECT *'))return{rows:devices.filter(d=>d.token_hash===p[0]&&(!sql.includes('expires_at>now()')||d.expires_at>Date.now()))};
 if(sql.startsWith('SELECT employee_id,'))return{rows:[{employee_id:employee.id,employee_name:employee.name,device_count:devices.filter(d=>d.employee_id===employee.id).length,approved_count:devices.filter(d=>d.employee_id===employee.id&&d.status==='approved').length}]};
 if(sql.startsWith('SELECT id,'))return{rows:devices.filter(d=>!p[0]||d.employee_id===p[0]).slice(p[1],p[1]+101).map(clean)};
 if(sql.startsWith('SELECT e.id,'))return{rows:events.filter(e=>!p[0]||e.device_id===p[0]).slice().reverse().slice(p[1],p[1]+101).map(e=>({...e,...{employee_name:devices.find(d=>d.id===e.device_id).employee_name}}))};
 if(sql.startsWith('UPDATE care_access_devices SET last_seen')){
  const d=devices.find(d=>d.id===p[0]);d.client_info=JSON.parse(p[1]);d.last_seen_at=new Date();
  if(['app_open','app_resume'].includes(p[2])){d.first_open_at||=new Date();d.last_open_at=new Date();}return{rows:[]};
 }
 if(sql.includes('RETURNING id')){
  const d=devices.find(d=>d.id===p[0]&&(!sql.includes("access_level<>'owner'")||d.access_level!=='owner'));
  if(d){d.status=sql.includes("status='revoked'")?'revoked':p[1];if(!sql.includes("status='revoked'"))d.access_level=p[2];}return{rows:d?[{id:d.id}]:[]};
 }
 if(sql.startsWith('UPDATE')){devices.find(d=>d.id===p[0]).status='revoked';return{rows:[]};}
 throw Error(sql);
}
const guard=createAccessGuard({query,env,resolveEmployee:async({id,code})=>(id===employee.id||code===employee.code)?employee:null,listEmployees:async()=>[employee]});
async function call(path,method='GET',body={},cookie='',headers={},search={}){
 let next=false;const req={path,method,body,query:search,ip:'test',socket:{remoteAddress:'test'},headers:{origin,cookie,'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',...headers},get(n){return this.headers[n.toLowerCase()]},accepts:()=>false};
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(b){this.body=b;return this},redirect(u){this.statusCode=302;this.location=u;return this},sendFile(){this.file=true;return this}};
 await guard.middleware(req,res,()=>next=true);return{...res,next,req};
}
(async()=>{
 assert.equal((await call('/api/payroll')).statusCode,401);
 assert.equal((await call('/payroll_exports/private.xlsx')).statusCode,401);
 assert.equal((await call('/api/timeline')).statusCode,401);
 assert.equal((await call('/access/request','POST',{code:'Ana'})).statusCode,401);
 assert.equal((await call('/access/request','POST',{code:'1234'},'',{origin:'https://bad.example'})).statusCode,403);
 const request=await call('/access/request','POST',{code:'1234',label:'Ana phone'});
 assert.equal(request.statusCode,202);const staffCookie=request.headers['Set-Cookie'].split(';')[0];
 assert.match(request.headers['Set-Cookie'],/Secure; HttpOnly; SameSite=Strict/);
 assert.equal(devices[0].token_hash,digest(staffCookie.split('=')[1]));
 assert.equal(events[0].event_type,'access_request');
 assert.equal((await call('/access/request','POST',{code:'1234'},staffCookie)).body.id,devices[0].id,'retry must reuse pending request');
 assert.equal(devices.length,1);
 assert.equal(events[0].client_info.os,'iOS / iPadOS');
 assert.equal((await call('/api/work/bootstrap','GET',{},staffCookie)).statusCode,401);
 const owner=await call('/access/owner','POST',{secret:env.CARE_OWNER_SECRET}),ownerCookie=owner.headers['Set-Cookie'].split(';')[0],ownerId=devices[1].id;
 assert.equal((await call('/access/review','POST',{id:devices[0].id,status:'approved',level:'staff'},staffCookie)).statusCode,403);
 assert.equal((await call('/access/review','POST',{id:devices[0].id,status:'approved',level:'staff'},ownerCookie)).statusCode,200);
 assert.equal(events.at(-1).event_type,'approved');assert.equal(events.at(-1).actor_id,ownerId);
 assert.equal((await call('/api/work/bootstrap','GET',{},staffCookie)).next,true);
 assert.equal((await call('/api/payroll','GET',{},staffCookie)).statusCode,403);
 assert.equal((await call('/api/work/bootstrap','GET',{},staffCookie,{'x-care-code':'9999'})).statusCode,403);
 assert.equal((await call('/api/work/jobs','POST',{},staffCookie,{origin:'https://bad.example'})).statusCode,403);
 assert.equal(await guard.allowSocket({headers:{cookie:staffCookie,origin}}),false);
 assert.equal(await guard.allowSocket({headers:{cookie:ownerCookie,origin}}),true);
 assert.equal((await call('/work','GET',{},staffCookie,{'sec-fetch-dest':'document'})).next,true);
 assert.equal(events.at(-1).event_type,'app_open');assert.ok(devices[0].first_open_at);assert.ok(devices[0].last_open_at);
 const eventCount=events.length;
 await call('/api/work/bootstrap','GET',{},staffCookie);await call('/js/app.js','GET',{},staffCookie);
 assert.equal(events.length,eventCount,'API polls and assets must not appear as app opens');
 assert.equal((await call('/access/visit','POST',{kind:'resume',path:'/work',occurredAt:'1900-01-01'},staffCookie)).statusCode,200);
 assert.equal(events.at(-1).event_type,'app_resume');assert.ok(events.at(-1).occurred_at.getFullYear()>2020,'server sets timestamps');
 assert.equal((await call('/access/visit','POST',{kind:'resume',path:'/work?code=secret'},staffCookie)).statusCode,400);
 assert.equal((await call('/access/events','GET',{},staffCookie)).statusCode,403);
 assert.equal((await call('/access/people','GET',{},staffCookie)).statusCode,403);
 assert.equal((await call('/access/events','GET',{},ownerCookie,{}, {offset:'-1'})).statusCode,400);
 assert.equal((await call('/access/events','GET',{},ownerCookie)).body.events.length,events.length);
 const list=await call('/access/devices','GET',{},ownerCookie);
 assert.equal(list.body.devices.length,2);assert.equal(list.body.devices[0].token_hash,undefined);
 assert.equal((await call('/access/people','GET',{},ownerCookie)).body.people[0].name,'Ana');
 employee.active=false;assert.equal((await call('/access/status','GET',{},staffCookie)).body.status,'inactive');assert.equal((await call('/api/work/bootstrap','GET',{},staffCookie)).statusCode,401);employee.active=true;
 assert.equal((await call('/access/block','POST',{id:ownerId},ownerCookie)).statusCode,400,'cannot accidentally block own owner session');
 assert.equal((await call('/access/block','POST',{id:devices[0].id},staffCookie)).statusCode,403);
 assert.equal((await call('/access/block','POST',{id:devices[0].id},ownerCookie)).statusCode,200);
 assert.equal((await call('/api/work/bootstrap','GET',{},staffCookie)).statusCode,401);
 assert.equal((await call('/access/request','POST',{code:'1234'},staffCookie)).statusCode,403,'revoked credential cannot request its own replacement');
 await call('/work','GET',{},staffCookie,{'sec-fetch-dest':'document'});
 assert.equal(events.at(-1).event_type,'blocked_open');assert.equal(events.filter(e=>e.event_type==='app_open').length,1,'revocation preserves history');
 assert.equal((await call('/access/visit','POST',{kind:'resume',path:'/work'},staffCookie)).statusCode,401);
 const secondOwner=await call('/access/owner','POST',{secret:env.CARE_OWNER_SECRET});
 assert.equal((await call('/access/block','POST',{id:devices[2].id},ownerCookie)).statusCode,200);
 assert.equal(await guard.allowSocket({headers:{cookie:secondOwner.headers['Set-Cookie'].split(';')[0],origin}}),false,'revoked owner cannot stay connected');
 const originalDevices=devices.slice(),originalEvents=events.slice();
 for(let i=0;i<102;i++){devices.push({...devices[0],id:require('node:crypto').randomUUID()});events.push({...events[0],id:require('node:crypto').randomUUID()});}
 const firstDevices=(await call('/access/devices','GET',{},ownerCookie)).body;
 assert.equal(firstDevices.devices.length,100);assert.equal(firstDevices.nextOffset,100);
 const nextDevices=(await call('/access/devices','GET',{},ownerCookie,{}, {offset:'100'})).body;
 assert.equal(nextDevices.devices.length,5);assert.equal(nextDevices.nextOffset,null);
 const firstEvents=(await call('/access/events','GET',{},ownerCookie)).body;
 assert.equal(firstEvents.events.length,100);assert.equal(firstEvents.nextOffset,100);
 assert.ok((await call('/access/events','GET',{},ownerCookie,{}, {offset:'100'})).body.events.length>0);
 devices=originalDevices;events=originalEvents;
 devices[1].expires_at=new Date(0);assert.equal((await call('/api/payroll','GET',{},ownerCookie)).statusCode,401);
 const closed=createAccessGuard({query,resolveEmployee:async()=>employee,env:{}});let status;await closed.middleware({path:'/api/test'}, {setHeader(){},status(n){status=n;return this},json(){}},()=>assert.fail());assert.equal(status,503);
 online=false;assert.equal((await call('/api/payroll','GET',{},staffCookie)).statusCode,503);
 assert.equal(clientInfo({headers:{'user-agent':'x'.repeat(2000)}}).userAgent.length,500);
 console.log('Access guard: authorization, audit, timestamps, privacy, revocation, owner blocking and foreground activity checks passed (mock persistence).');
})().catch(e=>{console.error(e);process.exitCode=1});
