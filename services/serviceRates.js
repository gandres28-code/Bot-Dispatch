'use strict';
const express=require('express'),S=require('./workSupport');
function cents(v,label='Importe',max=1000000){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max||Math.abs(v*100-Math.round(v*100))>0.00001)S.fail(label+': escribe dólares y centavos.');return Math.round(v*100);}
function roomType(value){const k=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,'');const numbered=k.match(/^([1-9]\d?)(?:BR|BD|BEDROOMS?|RECAMARAS?|CUARTOS?)$/);if(numbered)return numbered[1]+'BR';const aliases={M:'MOTEL',S:'STUDIO','1':'1BR','1BD':'1BR','1BEDROOM':'1BR','2':'2BR','2BD':'2BR','2BEDROOM':'2BR','3':'3BR','3BD':'3BR','3BEDROOM':'3BR',CASA:'HOUSE',HOME:'HOUSE'};return aliases[k]||k;}
async function quote(query,unitId,date,type){
 const unit=(await query('SELECT u.*,l.client_id FROM care_units u JOIN care_locations l ON l.id=u.location_id WHERE u.id=$1',[S.uuid(unitId)])).rows[0];if(!unit)S.fail('Unidad no encontrada.',404);
 const rate=(await query(`SELECT * FROM care_service_rates WHERE active AND location_id=$1 AND (unit_id=$2 OR unit_id IS NULL AND (room_type='' OR room_type=$5)) AND service_type=$3 AND effective_from<=$4::date AND (effective_to IS NULL OR effective_to>=$4::date) ORDER BY (unit_id IS NOT NULL) DESC,(room_type<>'') DESC,effective_from DESC,id LIMIT 1`,[unit.location_id,unit.id,type,S.day(date),roomType(unit.room_type)])).rows[0]||null;
 return rate?{id:rate.id,version:rate.version,salePrice:rate.sale_cents/100,cleanerPay:rate.cleaner_pay_cents/100,inspectorPay:rate.inspector_pay_cents/100,unitSpecific:!!rate.unit_id,roomType:rate.room_type,effectiveFrom:S.dateKey(rate.effective_from)}:null;
}
function createRatesRouter({query,pool,resolveUser,sourceMode="app"}){
 const router=express.Router();router.use(S.middleware(resolveUser));router.use((req,res,next)=>{if(sourceMode==='notion')return res.status(409).json({ok:false,error:'Las tarifas se consultan y actualizan en Notion. Los pagos confirmados se muestran en Mi trabajo y Nómina.'});next();});router.use((req,res,next)=>{if(!S.manager(req.workUser))return res.status(403).json({ok:false,error:'Solo administración puede gestionar tarifas.'});next();});
 router.get('/context',S.route(async(req,res)=>{
  const [locations,units]=await Promise.all([query('SELECT l.id,l.name,c.id AS client_id,c.name AS client_name FROM care_locations l JOIN care_clients c ON c.id=l.client_id WHERE l.active AND c.active ORDER BY c.name,l.name'),query('SELECT id,location_id,name,room_type FROM care_units WHERE active AND NOT review_required ORDER BY name')]);res.json({ok:true,locations:locations.rows,units:units.rows,roomTypes:[...new Set(['MOTEL','STUDIO','1BR','2BR','3BR','HOUSE',...units.rows.map(u=>roomType(u.room_type))].filter(Boolean))]});
 }));
 router.get('/',S.route(async(req,res)=>res.json({ok:true,rates:(await query(`SELECT r.*,l.name AS location_name,c.name AS client_name,u.name AS unit_name FROM care_service_rates r JOIN care_locations l ON l.id=r.location_id JOIN care_clients c ON c.id=l.client_id LEFT JOIN care_units u ON u.id=r.unit_id ORDER BY c.name,l.name,r.effective_from DESC`)).rows})));
 router.get('/quote',S.route(async(req,res)=>{if(!['regular','deep','touch_up'].includes(req.query.type))S.fail('Servicio inválido.');res.json({ok:true,rate:await quote(query,req.query.unitId,req.query.date,req.query.type)});}));
 for(const verb of ['post','put'])router[verb](verb==='post'?'/':'/:id',S.route(async(req,res)=>{
  const b=req.body,editing=verb==='put',id=S.uuid(editing?req.params.id:b.id),locationId=S.uuid(b.locationId),unitId=b.unitId?S.uuid(b.unitId):null,type=b.serviceType,from=S.day(b.effectiveFrom),to=b.effectiveTo?S.day(b.effectiveTo):null;
  if(!['regular','deep','touch_up'].includes(type)||to&&to<from)S.fail('Revisa el servicio y las fechas de vigencia.');
  if(b.active!==undefined&&typeof b.active!=='boolean')S.fail('Estado inválido.');
  const typeScope=unitId?'':roomType(S.text(b.roomType,80));
  const values={location_id:locationId,unit_id:unitId,room_type:typeScope,service_type:type,sale_cents:cents(b.salePrice,'Precio al cliente'),cleaner_pay_cents:cents(b.cleanerPay,'Pago al equipo',100000),inspector_pay_cents:cents(b.inspectorPay,'Pago de inspección',100000),effective_from:from,effective_to:to,active:b.active!==false};
  if(values.sale_cents<values.cleaner_pay_cents+values.inspector_pay_cents&&!S.text(b.note))S.fail('El precio es menor al pago del equipo. Confirma el motivo antes de guardar.');
  const rate=await S.transaction(pool(),async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['rate:'+locationId+':'+(unitId||typeScope||'all')+':'+type]);
   const old=(await c.query('SELECT * FROM care_service_rates WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(editing&&(!old||old.version!==b.version))S.fail('La tarifa cambió. Actualiza antes de guardar.',409);
   if(!editing&&old){if(Object.entries(values).every(([k,v])=>String(k.startsWith('effective_')&&old[k]?S.dateKey(old[k]):old[k]??'')===String(v??'')))return old;S.fail('Este intento ya corresponde a otra tarifa.',409);}
   if(editing&&(old.location_id!==locationId||old.unit_id!==unitId||old.service_type!==type||old.room_type!==typeScope))S.fail('Para otro servicio o propiedad, crea una tarifa nueva.');
   const location=(await c.query('SELECT l.active,c.active AS client_active FROM care_locations l JOIN care_clients c ON c.id=l.client_id WHERE l.id=$1',[locationId])).rows[0];if(!location?.active||!location.client_active)S.fail('Selecciona una propiedad activa.');
   if(unitId){const u=(await c.query('SELECT * FROM care_units WHERE id=$1 AND location_id=$2 AND active AND NOT review_required',[unitId,locationId])).rows[0];if(!u)S.fail('La unidad no pertenece a esta propiedad o necesita revisión.');}
   if(values.active&&(await c.query(`SELECT 1 FROM care_service_rates WHERE id<>$1 AND location_id=$2 AND unit_id IS NOT DISTINCT FROM $3::uuid AND service_type=$4 AND room_type=$7 AND active AND effective_from<=COALESCE($6::date,'infinity'::date) AND COALESCE(effective_to,'infinity'::date)>=$5::date LIMIT 1`,[id,locationId,unitId,type,from,to,typeScope])).rows.length)S.fail('Ya existe una tarifa para ese alcance y período. Ajusta las fechas o edita la existente.',409);
   if(editing&&!S.text(b.note))S.fail('Escribe el motivo del cambio.');
   const fields=Object.keys(values),params=Object.values(values),saved=editing
    ? await c.query(`UPDATE care_service_rates SET ${fields.map((f,i)=>`${f}=$${i+1}`).join(',')},version=version+1,updated_at=NOW() WHERE id=$${fields.length+1} RETURNING *`,[...params,id])
    : await c.query(`INSERT INTO care_service_rates(id,${fields.join(',')},created_by) VALUES($1,${fields.map((_,i)=>`$${i+2}`).join(',')},$${fields.length+2}) RETURNING *`,[id,...params,req.workUser.name]);
   await c.query('INSERT INTO care_directory_audit(actor,action,entity_id,detail) VALUES($1,$2,$3,$4::jsonb)',[req.workUser.name,editing?'rate_updated':'rate_created',id,JSON.stringify({note:S.text(b.note),before:old||null,after:saved.rows[0]})]);return saved.rows[0];
  });res.status(editing?200:201).json({ok:true,rate});
 }));return router;
}
module.exports={createRatesRouter,quote,cents,roomType};
