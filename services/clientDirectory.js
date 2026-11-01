'use strict';
const express=require('express'),{randomUUID}=require('node:crypto');
const DEFAULT_LOCATION='00000000-0000-4000-8000-000000000002';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
function text(value,max=500){if(value!=null&&typeof value!=='string')fail('Texto inválido.');const s=(value||'').trim();if(s.length>max)fail(`El texto supera ${max} caracteres.`);return s;}
function key(value){return value.normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();}
function id(value){if(!UUID.test(value||''))fail('Identificador inválido.');return value;}
function canManage(user){return String(user?.role||'').toLowerCase().split(/\s*[/,;]\s*/).some(r=>['admin','manager','owner','company owner','general manager','corporate','operations'].includes(r));}
function input(kind,b){
 const name=text(b.name,160);if(!name)fail('Escribe un nombre.');const v={name};
 if(kind==='clients'){
  for(const f of ['billing_name','contact','email','phone','billing_address','notes'])v[f]=text(b[f],f==='notes'?2000:500);
  if(v.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))fail('Correo inválido.');
 }else if(kind==='locations'){
  v.client_id=id(b.client_id);v.address=text(b.address,500);v.instructions=text(b.instructions,2000);
  for(const field of ['latitude','longitude']) {const n=b[field]===''||b[field]==null?null:Number(b[field]);if(n!==null&&(!Number.isFinite(n)||Math.abs(n)>(field==='latitude'?90:180)))fail('Coordenadas inválidas.');v[field]=n;}
  v.radius_m=b.radius_m==null||b.radius_m===''?100:Number(b.radius_m);if(!Number.isInteger(v.radius_m)||v.radius_m<20||v.radius_m>2000)fail('Radio: entre 20 y 2000 metros.');
  if(b.geofence_required!==undefined&&typeof b.geofence_required!=='boolean')fail('Geocerca inválida.');v.geofence_required=b.geofence_required===true;
  if(v.geofence_required&&(v.latitude==null||v.longitude==null))fail('Configura coordenadas para activar la geocerca.');
 }else{
  v.location_id=id(b.location_id);v.unit_key=key(name);v.room_type=text(b.room_type,80);v.building=text(b.building,80);v.notes=text(b.notes,2000);
  for(const f of ['bedrooms','bathrooms']){const n=b[f]===''||b[f]==null?null:Number(b[f]);if(n!==null&&(!Number.isFinite(n)||n<0||n>100||(f==='bedrooms'?!Number.isInteger(n):!Number.isInteger(n*2))))fail('Recámaras y baños: entre 0 y 100; baños admite medios.');v[f]=n;}
 }
 if(b.active!==undefined&&typeof b.active!=='boolean')fail('Estado inválido.');v.active=b.active!==false;return v;
}
function propertyText(p){return p?.select?.name||p?.status?.name||p?.formula?.string||(p?.multi_select?.length?p.multi_select.map(x=>x.name).join(' / '):'')||[...(p?.rich_text||[]),...(p?.title||[])].map(x=>x.plain_text||x.text?.content||'').join('');}
function legacyLocation(rows){
 for(const row of rows){
  if(/chateau/i.test(row.room_number||''))return null;
  for(const [name,p]of Object.entries(row.raw_data?.properties||{})){
   if(!['property','hotel','location','resort','client','cliente','localidad'].includes(name.trim().toLowerCase()))continue;
   if(p?.relation?.length)return null;
   const value=propertyText(p).trim().toLowerCase();
   if(value&&!['hotel','still waters','still waters resort','stillwaters','stillwaters resort'].includes(value))return null;
  }
 }return DEFAULT_LOCATION;
}
async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
async function backfillLegacy(pool){return transaction(pool,async c=>{
 await c.query('SELECT pg_advisory_xact_lock(140014)');
 const rows=(await c.query('SELECT id,normalized_room,room_number,room_type,building,raw_data FROM rooms WHERE care_unit_id IS NULL ORDER BY work_date DESC,id DESC')).rows;
 const groups=new Map();for(const r of rows){if(!groups.has(r.normalized_room))groups.set(r.normalized_room,[]);groups.get(r.normalized_room).push(r);}
 for(const [legacy,items]of groups){
  const first=items[0],location=legacyLocation(items);let unit=(await c.query('SELECT * FROM care_units WHERE legacy_key=$1 FOR UPDATE',[legacy])).rows[0];
  if(!unit&&location){
   const candidate=(await c.query('SELECT * FROM care_units WHERE location_id=$1 AND unit_key=$2 FOR UPDATE',[location,key(legacy)])).rows[0];
   if(candidate){
    if(candidate.legacy_key&&candidate.legacy_key!==legacy)fail('Dos claves históricas comparten una unidad. Revisa el directorio.',409);
    unit=(await c.query('UPDATE care_units SET legacy_key=$1,version=version+1,updated_at=NOW() WHERE id=$2 RETURNING *',[legacy,candidate.id])).rows[0];
   }
  }
  if(!unit)unit=(await c.query(`INSERT INTO care_units(id,location_id,name,unit_key,room_type,building,legacy_key,review_required) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[randomUUID(),location,first.room_number,key(legacy),first.room_type||'',first.building||'',legacy,!location])).rows[0];
  else if(!location&&!unit.review_required)await c.query('UPDATE care_units SET review_required=TRUE,version=version+1,updated_at=NOW() WHERE id=$1',[unit.id]);
  await c.query('UPDATE rooms SET care_unit_id=$1 WHERE id=ANY($2::bigint[]) AND care_unit_id IS NULL',[unit.id,items.map(x=>x.id)]);
 }return {linked:rows.length};
});}
function createDirectoryRouter({pool,query,resolveUser}){
 const router=express.Router(),attempts=new Map();
 router.use(async(req,res,next)=>{
  res.set('Cache-Control','no-store');const now=Date.now();for(const [k,v]of attempts)if(v.until<now)attempts.delete(k);
  if((attempts.get(req.ip)?.count||0)>=20)return res.status(429).json({ok:false,error:'Demasiados intentos. Espera un minuto.'});
  try{
   const code=String(req.get('X-Care-Code')||'').trim(),user=code&&code.length<=120?await resolveUser(code):null;
   if(!user?.active){const a=attempts.get(req.ip)||{count:0,until:now+60000};a.count++;attempts.set(req.ip,a);return res.status(401).json({ok:false,error:'Inicia sesión con tu código activo.'});}
   if(!canManage(user))return res.status(403).json({ok:false,error:'Solo administración puede gestionar clientes y localidades.'});
   req.careUser=user;next();
  }catch{res.status(503).json({ok:false,error:'No se pudo verificar el acceso.'});}
 });
 const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){if(!e.status)console.error('DIRECTORY:',e.message);const conflict=['23505','23503','23514'].includes(e.code);res.status(e.status||(conflict?409:503)).json({ok:false,error:e.status?e.message:conflict?'Registro duplicado o relación inválida. Revisa los datos.':'No se pudo completar la operación. Actualiza y vuelve a intentar.'});}};
 router.get('/',route(async(req,res)=>{
  const [clients,locations,units]=await Promise.all(['clients','locations','units'].map(k=>query(`SELECT * FROM care_${k} ORDER BY name,id`)));
  res.json({ok:true,clients:clients.rows,locations:locations.rows,units:units.rows,scope:'directory',defaultLocationId:DEFAULT_LOCATION});
 }));
 router.post('/review-legacy',route(async(req,res)=>res.json({ok:true,...await backfillLegacy(pool())})));
 for(const kind of ['clients','locations','units']){
  async function save(req,res){
   const editing=!!req.params.id,entityId=editing?id(req.params.id):id(req.body.id),v=input(kind,req.body);
   if(editing&&(!Number.isInteger(req.body.version)||req.body.version<1))fail('Actualiza el registro antes de guardarlo.');
   const record=await transaction(pool(),async c=>{
    const old=(await c.query(`SELECT * FROM care_${kind} WHERE id=$1 FOR UPDATE`,[entityId])).rows[0];
    if(editing&&!old)fail('Registro no encontrado.',404);
    if(!editing&&old){if(Object.keys(v).every(k=>String(old[k]??'')===String(v[k]??'')))return old;fail('Esta solicitud ya se guardó con otros datos.',409);}
    if(editing&&old.version!==req.body.version)fail('Otra persona modificó este registro. Actualiza antes de guardar.',409);
    if(kind==='locations'){
     const parent=(await c.query('SELECT * FROM care_clients WHERE id=$1 FOR UPDATE',[v.client_id])).rows[0];
     if(!parent?.active&&v.active)fail('Selecciona un cliente activo.');
     if(old&&old.client_id!==v.client_id)fail('La localidad conserva su cliente para proteger el historial. Crea otra localidad.');
    }
    if(kind==='units'){
     const parent=(await c.query('SELECT l.*,c.active AS client_active FROM care_locations l JOIN care_clients c ON c.id=l.client_id WHERE l.id=$1 FOR UPDATE OF l,c',[v.location_id])).rows[0];
     if((!parent?.active||!parent?.client_active)&&v.active)fail('Selecciona una localidad y un cliente activos.');
     if(old&&old.location_id&&old.location_id!==v.location_id&&!old.review_required)fail('La unidad conserva su localidad para proteger el historial.');
     if(old?.legacy_key&&old.name!==v.name)fail('El nombre de una unidad sincronizada se cambia desde Notion.');
     v.review_required=false;
    }
    if(!v.active){const child=kind==='clients'?'locations':kind==='locations'?'units':null;if(child){const field=kind==='clients'?'client_id':'location_id';if((await c.query(`SELECT 1 FROM care_${child} WHERE ${field}=$1 AND active LIMIT 1`,[entityId])).rows.length)fail('Desactiva primero los registros dependientes.');}}
    const fields=Object.keys(v),values=Object.values(v);let result;
    if(editing)result=await c.query(`UPDATE care_${kind} SET ${fields.map((f,i)=>`${f}=$${i+1}`).join(',')},version=version+1,updated_at=NOW() WHERE id=$${fields.length+1} RETURNING *`,[...values,entityId]);
    else result=await c.query(`INSERT INTO care_${kind}(id,${fields.join(',')}) VALUES($1,${fields.map((_,i)=>`$${i+2}`).join(',')}) RETURNING *`,[entityId,...values]);
    const row=result.rows[0];await c.query('INSERT INTO care_directory_audit(actor,action,entity_id,detail) VALUES($1,$2,$3,$4::jsonb)',[req.careUser.name,`${kind}_${editing?'updated':'created'}`,entityId,JSON.stringify({before:old||null,after:row})]);return row;
   });res.status(editing?200:201).json({ok:true,record});
  }
  router.post('/'+kind,route(save));router.put('/'+kind+'/:id',route(save));
 }return router;
}
module.exports={createDirectoryRouter,backfillLegacy,input,legacyLocation,key,canManage,DEFAULT_LOCATION};
