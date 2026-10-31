'use strict';
const assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),vm=require('node:vm');
const {createLanguageService}=require('../services/employeeLanguage');
const data=require('../public/js/i18n-data'),core=require('../public/js/i18n-core');
async function main(){
 assert.equal(core.translate('Tap to Finish','es'),'Toca para terminar');
 assert.equal(core.translate('📦 Pedir','en'),'📦 Request supplies');
 assert.equal(core.translate('15 de 15 revisados','en'),'15 of 15 reviewed');
 assert.equal(core.translate('0 of 84 reviewed','es'),'0 de 84 revisados');
 assert.equal(core.translate('Solicitud #12 enviada · 101 A','en'),'Request #12 sent · 101 A');
 assert.equal(core.translate('Guardado en Care OS · 102 A','en'),'Saved in Care OS · 102 A');
 assert.equal(core.translate('Ready','es'),'Lista');
 assert.equal(core.translate('1. Puerta y marco','en'),'1. Door and frame');
 assert.equal(core.product('Linen - Fitted - Queen','es'),'Sábana ajustable Queen');
 assert.equal(core.product('Custom guest item','en'),'Custom guest item');
 assert.equal(core.translate('Andrés García','en'),'Andrés García');
 for(const file of ['exit-checklist-data.js','deep-clean-checklist-data.js']){
  const c={};c.globalThis=c;vm.runInNewContext(fs.readFileSync('public/js/'+file,'utf8'),c);const list=c.CareExitChecklistData||c.CareDeepCleanChecklistData;
  for(const item of list.items)for(const prop of ['title','detail','group'])if(item[prop])assert(Object.hasOwn(data.en,item[prop]),`${file}: missing ${prop} ${item.id}`);
 }
 // Background notifications use the same saved language without a running page.
 const listeners={},notices=[],cached=new Map();let pending=[];
 const worker={console,Response,caches:{open:async()=>({put:async(k,v)=>cached.set(k,v),match:async k=>cached.get(k)?.clone()})},registration:{showNotification:async(...args)=>notices.push(args)},addEventListener:(name,fn)=>{listeners[name]=fn;}};
 worker.self=worker;vm.createContext(worker);worker.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync('public'+file,'utf8'),worker));
 vm.runInContext(fs.readFileSync('public/firebase-messaging-sw.js','utf8'),worker);
 listeners.message({data:{type:'care-language',language:'en'},waitUntil:p=>pending.push(p)});await Promise.all(pending);pending=[];
 listeners.push({data:{json:()=>({title:'🚨 Orden urgente · 101 A',body:'Tienes una actualización.'})},waitUntil:p=>pending.push(p)});await Promise.all(pending);
 assert.equal(notices[0][0],'🚨 Urgent order · 101 A');assert.equal(notices[0][1].body,'You have an update.');
 assert.equal(core.translate('1 piezas','en'),'1 piece');assert.equal(core.translate('1 units','es'),'1 unidad');
 const users={admin:{code:'admin',name:'Admin',role:'admin',active:true},worker:{code:'worker',name:'Worker',role:'cleaner',active:true},inactive:{code:'inactive',role:'admin',active:false}};
 let saved='es',fail=false,writes=0;const events=[];
 const service=createLanguageService({resolveUser:async code=>users[code],emit:(...args)=>events.push(args),query:async(sql,p)=>{
  if(fail)throw Error('database unavailable');
  if(sql.startsWith('SELECT'))return {rows:p[0]==='worker'?[{app_language:saved}]:[]};
  if(sql.startsWith('UPDATE')){if(p[1]!=='2')return {rows:[]};saved=p[0];writes++;return {rows:[{id:2,code:'worker',app_language:saved}]};}
  throw Error('Unexpected query');
 }});
 const app=express();app.use(express.json());app.use('/api',service.router);app.get('/api/unrelated',(q,r)=>r.json({ok:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path,code,method='GET',body)=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json',...(code?{'X-Care-Code':code}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json()};};
 try{
  assert.equal((await call('/unrelated')).status,200,'language guard does not change other routes');
  assert.equal((await call('/employee-preferences')).status,401);
  assert.equal((await call('/employee-preferences','inactive')).status,401);
  assert.equal((await call('/employee-preferences','worker')).body.language,'es');
  assert.equal((await call('/v2/employees/2/language','worker','PATCH',{language:'en',role:'admin'})).status,403,'browser cannot claim manager role');
  assert.equal((await call('/v2/employees/2/language','admin','PATCH',{language:'fr'})).status,400);
  assert.equal((await call('/v2/employees/bad/language','admin','PATCH',{language:'en'})).status,400);
  assert.equal((await call('/v2/employees/999/language','admin','PATCH',{language:'en'})).status,404);
  const save=await call('/v2/employees/2/language','admin','PATCH',{language:'en'});assert.equal(save.status,200);assert.equal(save.body.employee.language,'en');assert.equal(save.body.employee.code,undefined);assert.equal(writes,1);
  assert.equal((await call('/employee-preferences','worker')).body.language,'en','saved setting invalidates cache');
  await call('/v2/employees/2/language','admin','PATCH',{language:'es'});
  assert.equal((await call('/employee-preferences','worker')).body.language,'es','switching back works');assert.equal(events.length,2);
  fail=true;assert.equal((await call('/v2/employees/2/language','admin','PATCH',{language:'en'})).status,503,'failed saves never report success');
 }finally{await new Promise(r=>server.close(r));}
 console.log('Languages: full regular/deep checklist coverage, catalog labels, dynamic confirmations, role checks, persistent preference, cache invalidation, rollback to Spanish and no false success passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
