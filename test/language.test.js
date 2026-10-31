'use strict';
const assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),vm=require('node:vm');
const {createLanguageService}=require('../services/employeeLanguage');
const {readEmployeeLanguage}=require('../services/employeeLanguageValue');
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
 const page=value=>({properties:{Idioma:{type:'select',select:value?{name:value}:null}}});
 for(const value of ['Inglés','INGLES','English','en'])assert.equal(readEmployeeLanguage(page(value)),'en');
 for(const value of ['Español','ESPAÑOL','Spanish','es','',null,'French'])assert.equal(readEmployeeLanguage(page(value)),'es');
 assert.equal(readEmployeeLanguage({properties:{Idioma:{type:'rich_text',rich_text:[{plain_text:'Inglés'}]}}}),'es','only a Select is authoritative');
 assert.equal(readEmployeeLanguage({properties:{Language:{type:'select',select:{name:'English'}}}}),'en');
 // The normal employee sync mirrors the Notion Select, never restores the old local setting.
 const mirrorWrites=[];const syncContext={module:{exports:{}},require:name=>name==='../db'?{query:async(sql,params)=>{if(sql.includes('INSERT INTO employees'))mirrorWrites.push({sql,params});return {rows:[{}]};}}:require('../services/employeeLanguageValue'),console,Date};
 vm.runInNewContext(fs.readFileSync('services/employeeSyncService.js','utf8'),syncContext);
 const person={id:'worker-page',properties:{...page('Inglés').properties,Employee:{title:[{plain_text:'Worker'}]},Code:{rich_text:[{plain_text:'worker'}]}}};
 const sync=await syncContext.module.exports.syncEmployeesFromNotion({databaseId:'employees-test',queryDatabase:async()=>({results:[person],has_more:false})});
 assert.equal(sync.saved,1);assert.equal(mirrorWrites[0].params[8],'en');assert(mirrorWrites[0].sql.includes('app_language = EXCLUDED.app_language'));
 const users={admin:{id:'admin-page',code:'admin',name:'Admin',role:'admin',active:true},worker:{id:'worker-page',code:'worker',name:'Worker',role:'cleaner',active:true},inactive:{id:'inactive-page',code:'inactive',role:'admin',active:false}};
 let notionSelection='Español',fail=false,reads=0,now=0;
 const service=createLanguageService({clock:()=>now,resolveUser:async code=>users[code],readPage:async id=>{
  reads++;assert.equal(id,'worker-page');if(fail)throw Error('Notion unavailable');return page(notionSelection);
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
  assert.equal((await call('/v2/employees/2/language','admin','PATCH',{language:'en'})).status,409,'old app clients cannot override Notion');
  assert.equal(reads,1,'blocked local writes do not contact or change Notion');
  notionSelection='Inglés';now=61000;
  assert.equal((await call('/employee-preferences','worker')).body.language,'en','changing the Notion Select changes the app after refresh');
  notionSelection='Español';now=122000;
  assert.equal((await call('/employee-preferences','worker')).body.language,'es','Notion can switch the app back to Spanish');
  fail=true;now=183000;assert.equal((await call('/employee-preferences','worker')).status,503,'Notion failures do not invent a new preference');

 }finally{await new Promise(r=>server.close(r));}
 console.log('Languages: regular/deep coverage, Select aliases, Notion as source, cached refresh in both directions, rejected local overrides, role checks, push translations and Notion failure behavior passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
