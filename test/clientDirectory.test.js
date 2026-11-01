'use strict';
const assert=require('node:assert/strict'),express=require('express');
const {randomUUID}=require('node:crypto');
const {createDirectoryRouter,input,legacyLocation,key,canManage,DEFAULT_LOCATION}=require('../services/clientDirectory');
async function main(){
 assert.equal(canManage({role:'cleaner / inspector'}),false);assert.equal(canManage({role:'notadmin'}),false);assert.equal(canManage({role:'admin / dispatch'}),true);
 assert.equal(key(' villa  101 '),'VILLA 101');assert.notEqual(key('Villa 101'),key('Cabin 101'));
 assert.equal(legacyLocation([{room_number:'101',raw_data:{}}]),DEFAULT_LOCATION);
 assert.equal(legacyLocation([{room_number:'Chateau 101',raw_data:{}}]),null);
 assert.equal(legacyLocation([{raw_data:{properties:{Property:{select:{name:'Rock Lane'}}}}}]),null);
 assert.equal(legacyLocation([{raw_data:{properties:{Hotel:{select:{name:'Still Waters Resort'}}}}}]),DEFAULT_LOCATION);
 assert.equal(legacyLocation([{raw_data:{properties:{Location:{relation:[{id:'x'}]}}}}]),null);
 assert.throws(()=>input('clients',{name:'Test',email:'invalid'}));assert.throws(()=>input('units',{name:'101',location_id:'wrong'}));
 const a=randomUUID(),b=randomUUID(),u=randomUUID();assert.throws(()=>input('units',{name:'101',location_id:a,bedrooms:1.5}));
 assert.equal(input('units',{name:'101',location_id:a,bathrooms:2.5}).bathrooms,2.5);
 const tables={clients:new Map(),locations:new Map(),units:new Map()},audit=[];let rollbacks=0,snapshot;
 const query=async(sql,p=[])=>{
  if(sql==='BEGIN'){snapshot=structuredClone(tables);return{rows:[]};}
  if(sql==='COMMIT')return{rows:[]};
  if(sql==='ROLLBACK'){for(const k of Object.keys(tables))tables[k]=snapshot[k];rollbacks++;return{rows:[]};}
  if(sql.includes('INSERT INTO care_directory_audit')){audit.push(p);return{rows:[]};}
  if(sql.startsWith('SELECT l.*')){const l=tables.locations.get(p[0]);return{rows:l?[{...l,client_active:tables.clients.get(l.client_id)?.active}]:[]};}
  const kind=sql.match(/care_(clients|locations|units)/)?.[1];if(!kind)throw Error(sql);const table=tables[kind];
  if(sql.startsWith('SELECT *'))return{rows:sql.includes('WHERE id=')?[table.get(p[0])].filter(Boolean):[...table.values()]};
  if(sql.startsWith('SELECT 1')){const f=sql.match(/WHERE (\w+)=/)[1];return{rows:[...table.values()].filter(r=>r[f]===p[0]&&r.active).slice(0,1)};}
  if(sql.startsWith('INSERT')){const fields=sql.match(/\(([^)]+)\) VALUES/)[1].split(',');const row={version:1};fields.forEach((f,i)=>row[f]=p[i]);
   if([...table.values()].some(r=>kind==='units'?r.location_id===row.location_id&&r.unit_key===row.unit_key:kind==='locations'?r.client_id===row.client_id&&r.name.toLowerCase()===row.name.toLowerCase():r.name.toLowerCase()===row.name.toLowerCase())){const e=Error('duplicate');e.code='23505';throw e;}
   table.set(row.id,row);return{rows:[row]};}
  if(sql.startsWith('UPDATE')){const fields=sql.match(/SET (.*),version=version/)[1].split(',').map(x=>x.split('=')[0]);const row={...table.get(p.at(-1))};fields.forEach((f,i)=>row[f]=p[i]);row.version++;table.set(row.id,row);return{rows:[row]};}
  throw Error(sql);
 };
 const users={admin:{name:'Andres',role:'admin',active:true},cleaner:{role:'cleaner',active:true},inactive:{role:'admin',active:false}};
 const app=express();app.use(express.json());app.use('/api',createDirectoryRouter({query,pool:()=>({connect:async()=>({query,release(){}})}),resolveUser:async code=>users[code]}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path='',method='GET',body,code='admin')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Care-Code':code},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
 try{
  assert.equal((await call('','GET',null,'')).status,401);assert.equal((await call('','GET',null,'inactive')).status,401);assert.equal((await call('','GET',null,'cleaner')).status,403);
  const customer={id:a,name:'Client A'};assert.equal((await call('/clients','POST',customer)).status,201);assert.equal((await call('/clients','POST',customer)).status,201);assert.equal(audit.length,1,'retry must not duplicate audit');
  assert.equal((await call('/clients','POST',{...customer,name:'Other'})).status,409);
  assert.equal((await call('/clients/'+a,'PUT',{name:'Client A',version:9})).status,409);
  const l1=randomUUID(),l2=randomUUID();for(const id of [l1,l2])assert.equal((await call('/locations','POST',{id,client_id:a,name:id})).status,201);
  for(const loc of [l1,l2])assert.equal((await call('/units','POST',{id:randomUUID(),name:'101',location_id:loc})).status,201);
  assert.equal(tables.units.size,2,'101 at two locations must be independent');
  assert.equal((await call('/units','POST',{id:u,name:'101',location_id:l1})).status,409,'duplicate in same location must fail');
  const first=[...tables.units.values()][0];assert.equal((await call('/units/'+first.id,'PUT',{...first,location_id:l2})).status,400,'must not move existing history');
  assert.equal((await call('/clients/'+a,'PUT',{name:'Client A',active:false,version:1})).status,400,'active locations block deactivation');
  assert.equal((await call('/locations/'+l1,'PUT',{name:l1,client_id:b,version:1})).status,400);
  const directory=await call();assert.equal(directory.body.units.length,2);assert.equal(directory.body.scope,'directory');assert(rollbacks>0);
  console.log('Client directory: roles, input, foreign-property review, idempotency, duplicate units, immutable ownership, concurrency and rollback passed.');
 }finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
