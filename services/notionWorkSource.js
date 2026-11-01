'use strict';
const {randomUUID}=require('node:crypto'),S=require('./workSupport'),V=require('./notionWorkValues');
const DEFAULT_CLIENT='00000000-0000-4000-8000-000000000001',DEFAULT_LOCATION='00000000-0000-4000-8000-000000000002';
const U=['Unidad','Unit'],L=['Localidad','Location','Property','Hotel','Resort'],C=['Cliente','Client','Customer'];
function createNotionWorkSource({notion,databaseId,rateDatabaseId='',logDatabaseId='',query,pool,listEmployees,legacyPay=()=>null,today,emit=()=>{}}){
 const pageCache=new Map(),schemaCache=new Map(),running=new Map();let mirroring=false,catalogAt=0,ratePages=[];
 async function page(id){id=V.pageId(id);const cached=pageCache.get(id);if(cached&&cached.until>Date.now())return cached.value;const p=await notion.pages.retrieve({page_id:id});if(p.archived||p.in_trash)S.fail('El catálogo relacionado está archivado en Notion.');pageCache.set(id,{value:p,until:Date.now()+15000});return p;}
 async function schema(id){const old=schemaCache.get(id);if(old&&old.until>Date.now())return old.props;const props=(await notion.databases.retrieve({database_id:id})).properties;schemaCache.set(id,{props,until:Date.now()+60000});return props;}
 async function all(id,filter){let cursor,rows=[];do{const r=await notion.databases.query({database_id:id,page_size:100,...(filter?{filter}:{}),...(cursor?{start_cursor:cursor}:{})});rows.push(...(r.results||[]));cursor=r.has_more?r.next_cursor:null;}while(cursor);return rows.filter(p=>!p.archived&&!p.in_trash);}
 async function one(props,names){const ids=V.relations(props,names);if(ids.length>1)S.fail('Selecciona solo una unidad, propiedad o cliente por servicio.');return ids[0]?page(ids[0]):null;}
 async function metadata(assignment){
  const p=assignment.properties||{},unitPage=await one(p,U),up=unitPage?.properties||{},locationPage=await one(up,L)||await one(p,L),lp=locationPage?.properties||{},clientPage=await one(lp,C)||await one(p,C),cp=clientPage?.properties||{};
  const unitName=unitPage?V.title(up):V.read(p,['Room Number','Unidad','Unit','Room','Name'])||V.title(p);
  if(!unitName)S.fail('Falta la unidad en Notion.');
  const locationName=locationPage?V.title(lp):V.read(up,L)||V.read(p,L),clientName=clientPage?V.title(cp):V.read(lp,C)||V.read(up,C)||V.read(p,C);
  if(unitPage&&!locationName)S.fail('Relaciona la unidad de Notion con una localidad.');
  const hotel=(!locationName||V.hotelName(locationName))&&(!clientName||V.hotelName(clientName))&&!/chateau/i.test(unitName);
  if(!hotel&&(!locationName||!clientName))S.fail('Falta cliente o localidad. Relaciona la unidad con su propiedad en Notion.');
  const type=V.read(up,['Room Type','Tipo','Type'])||V.read(p,['Room Type','Tipo','Type'])||unitName.match(/\(([^)]+)\)/)?.[1]||'';
  return{unitName,locationName:hotel?'Still Waters Resort':locationName,clientName:hotel?'Still Waters Resort':clientName,unitPage,locationPage,clientPage,up,lp,cp,hotel,type};
 }
 async function catalog(c,m){
  // Existing UUIDs are adopted by relation identity or an unclaimed matching name. Never move history between owners.
  async function find(table,id,by,params){const rows=(await c.query(`SELECT * FROM care_${table} WHERE ${id?'notion_page_id=$1 OR ':''}${by} ORDER BY ${id?'(notion_page_id=$1) DESC,':''}id LIMIT 1 FOR UPDATE`,id?[V.pageId(id),...params]:params)).rows;const row=rows[0];if(row&&id&&row.notion_page_id&&row.notion_page_id!==V.pageId(id))S.fail('Dos registros de Notion comparten nombre. Revisa el catálogo para no mezclar su historial.');return row;}
  const clientN=m.clientPage?V.pageId(m.clientPage.id):null;
  let client=m.hotel?(await c.query('SELECT * FROM care_clients WHERE id=$1 FOR UPDATE',[DEFAULT_CLIENT])).rows[0]:await find('clients',clientN,`lower(trim(name))=lower(trim($${clientN?2:1}))`,[m.clientName]);
  if(!client)client=(await c.query('INSERT INTO care_clients(id,name,billing_name,notion_page_id) VALUES($1,$2,$3,$4) RETURNING *',[randomUUID(),m.clientName,V.read(m.cp,['Billing Name','Nombre de facturación'])||m.clientName,clientN])).rows[0];
  else{await c.query('UPDATE care_clients SET name=$1,notion_page_id=COALESCE($2,notion_page_id),contact=CASE WHEN $3=\'\' THEN contact ELSE $3 END,email=CASE WHEN $4=\'\' THEN email ELSE $4 END,phone=CASE WHEN $5=\'\' THEN phone ELSE $5 END WHERE id=$6',[m.clientName,clientN,V.read(m.cp,['Contact','Contacto']),V.read(m.cp,['Email','Correo']),V.read(m.cp,['Phone','Teléfono']),client.id]);}
  const locN=m.locationPage?V.pageId(m.locationPage.id):null;
  let loc=m.hotel?(await c.query('SELECT * FROM care_locations WHERE id=$1 FOR UPDATE',[DEFAULT_LOCATION])).rows[0]:await find('locations',locN,`(client_id=$${locN?2:1} AND lower(trim(name))=lower(trim($${locN?3:2})))`,[client.id,m.locationName]);
  if(loc&&loc.client_id!==client.id)S.fail('La propiedad cambió de cliente. Revisa el historial antes de reasignarla.');
  const address=V.read(m.lp,['Address','Dirección'])||V.read(m.up,['Address','Dirección']),instructions=V.read(m.lp,['Access Instructions','Instructions','Instrucciones','Acceso']);
  if(!loc)loc=(await c.query('INSERT INTO care_locations(id,client_id,name,address,instructions,notion_page_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),client.id,m.locationName,address,instructions,locN])).rows[0];
  else await c.query('UPDATE care_locations SET name=$1,address=CASE WHEN $2=\'\' THEN address ELSE $2 END,instructions=CASE WHEN $3=\'\' THEN instructions ELSE $3 END,notion_page_id=COALESCE($4,notion_page_id) WHERE id=$5',[m.locationName,address,instructions,locN,loc.id]);
  const coord=(names,limit,fallback)=>{const f=V.field(m.lp,names);if(!f)return fallback;const n=f.number??f.formula?.number??null;if(n!==null&&(!Number.isFinite(n)||Math.abs(n)>limit))S.fail('Revisa las coordenadas de la propiedad en Notion.');return n;};
  const lat=coord(['Latitude','Latitud'],90,loc.latitude),lng=coord(['Longitude','Longitud'],180,loc.longitude),radius=V.number(m.lp,['Radius Meters','Radio metros'])??loc.radius_m,required=V.bool(m.lp,['Require Location','Exigir ubicación'],loc.geofence_required);
  if(!Number.isInteger(Number(radius))||radius<20||radius>2000||required&&(lat==null||lng==null))S.fail('Revisa coordenadas y radio de la propiedad en Notion.');
  await c.query('UPDATE care_locations SET latitude=$1,longitude=$2,radius_m=$3,geofence_required=$4 WHERE id=$5',[lat,lng,radius,required,loc.id]);
  const unitN=m.unitPage?V.pageId(m.unitPage.id):null,unitKey=m.hotel?require('./roomIdentity').normalizeRoomValue(m.unitName):m.unitName.normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
  let unit=await find('units',unitN,`(location_id=$${unitN?2:1} AND (unit_key=$${unitN?3:2}${m.hotel?` OR legacy_key=$${unitN?3:2}`:''}))`,[loc.id,unitKey]);
  if(unit&&unit.location_id!==loc.id)S.fail('La unidad cambió de localidad. Conserva su historial y crea una unidad nueva.');
  if(!unit)unit=(await c.query('INSERT INTO care_units(id,location_id,name,unit_key,room_type,building,notion_page_id,review_required) VALUES($1,$2,$3,$4,$5,$6,$7,FALSE) RETURNING *',[randomUUID(),loc.id,m.unitName,unitKey,m.type,V.read(m.up,['Building','Edificio'])||V.read(m.lp,['Building','Edificio']),unitN])).rows[0];
  else await c.query('UPDATE care_units SET name=$1,room_type=CASE WHEN $2=\'\' THEN room_type ELSE $2 END,notion_page_id=COALESCE($3,notion_page_id),review_required=FALSE WHERE id=$4',[m.unitName,m.type,unitN,unit.id]);
  if(!V.bool(m.up,['Active','Activo'],true)||!V.bool(m.lp,['Active','Activo'],true)||!V.bool(m.cp,['Active','Activo'],true))S.fail('La unidad, propiedad o cliente están inactivos en Notion.');
  return{client,loc,unit};
 }
 async function prices(assignment,m,date,type){
  const p=assignment.properties||{},direct=await one(p,['Tarifa','Rate']),candidates=[];
  if(direct)candidates.push(direct);
  else if(rateDatabaseId){if(catalogAt<Date.now()-15000){ratePages=await all(rateDatabaseId);catalogAt=Date.now();}candidates.push(...ratePages);}
  const matches=[];
  for(const r of candidates){const rp=r.properties||{},rType=V.service(V.read(rp,['Service Type','Servicio','Tipo de limpieza'])),from=V.date(rp,['Effective From','Desde','Vigente desde']),to=V.date(rp,['Effective To','Hasta']);
   if(!V.bool(rp,['Active','Activo'],true)||rType!==type||from&&from.slice(0,10)>date||to&&to.slice(0,10)<date)continue;
   const units=V.relations(rp,U),locs=V.relations(rp,L),unitType=V.read(rp,['Room Type','Tipo de unidad']);
   if(locs.length>1||units.length>1)S.fail('Una tarifa necesita una sola propiedad o unidad.');
   if(units.length&&(!m.unitPage||!units.includes(V.pageId(m.unitPage.id))))continue;if(locs.length&&(!m.locationPage||!locs.includes(V.pageId(m.locationPage.id))))continue;if(!units.length&&!locs.length){if(direct)S.fail('La tarifa necesita relacionarse con la propiedad o unidad.');continue;}if(unitType&&require('./serviceRates').roomType(unitType)!==require('./serviceRates').roomType(m.type))continue;
   matches.push({r,rank:units.length?3:unitType?2:1});
  }
  matches.sort((a,b)=>b.rank-a.rank);if(matches.length>1&&matches[0].rank===matches[1].rank)S.fail('Hay tarifas superpuestas en Notion para esta unidad y fecha.');
  if(direct&&!matches.length)S.fail('La tarifa relacionada no está vigente o no corresponde al servicio.');
  const rp=matches[0]?.r.properties||{},read=(names)=>V.amount(p,names)??V.amount(rp,names)??V.amount(m.up,names);
  let cleaner=read(['Cleaner Pay','Pago cleaners','Pago limpieza','Payroll Rate','Cleaning Rate','Rate','Amount']);
  if(cleaner==null&&m.hotel)cleaner=legacyPay({unit:m.unitName,roomType:m.type});
  return{cleaner,inspector:read(['Inspector Pay','Pago inspección'])??(m.hotel?0:null),pre:read(['Pre Inspection Pay','Pago preinspección']),sale:read(['Sale Price','Precio cliente','Precio de venta','Precio']),rateId:matches[0]?.r.id||null};
 }
 async function importPage(assignment,employees){
  const p=assignment.properties||{},id=V.pageId(assignment.id),date=S.day((V.date(p,['Date','Fecha','Work Date','Service Date'])||'').slice(0,10)),m=await metadata(assignment),type=V.service(V.read(p,['Service Type','Tipo de limpieza','Servicio']));
  const cleanerIds=V.employeeIds(p,['Assigned Cleaner','Cleaner','Cleaners','Limpiador','Limpiadores'],employees),inspectorIds=V.employeeIds(p,['Assigned Inspector','Inspector'],employees);
  if(cleanerIds.length>10||inspectorIds.length>1)S.fail('Usa hasta 10 cleaners y un inspector por servicio.');
  const cleaners=cleanerIds.map(id=>employees.find(e=>e.id===id)),inspector=employees.find(e=>e.id===inspectorIds[0]);
  if(cleaners.some(e=>!(/cleaner/i.test(e.role)||S.manager(e))))S.fail('La persona asignada a limpieza necesita el rol Cleaner.');
  if(inspector&&!S.inspector(inspector))S.fail('La persona asignada a inspección necesita ese rol.');
  const pay=await prices(assignment,m,date,type),initialStatus=V.status(V.read(p,['Cleaning Status','Status','Estado'])),preRequired=V.bool(p,['Pre Inspection Required','Requiere preinspección'],m.hotel),pre=V.bool(p,['Pre Inspection','Pre-Inspection','Preinspección']);
  const snapshot={binding:{unit:V.relations(p,U),location:V.relations(p,L),client:V.relations(p,C),unitText:V.read(p,['Room Number','Unidad','Unit','Room','Name'])||V.title(p),locationText:V.read(p,L),clientText:V.read(p,C)},date,type,cleanerIds,cleanerNames:cleaners.map(e=>e.name),inspectorId:inspector?.id||'',inspectorName:inspector?.name||'',instructions:V.read(p,['Instructions','Instrucciones','Notes','Notas']),pay,split:V.read(p,['Pay Split Mode','Reparto'])||(m.hotel?process.env.PAYROLL_SPLIT_MODE||'equal':'equal')};
  if(!['equal','full_each'].includes(snapshot.split))S.fail('El reparto necesita equal o full_each.');
  return S.transaction(pool(),async c=>{
   await c.query('SELECT pg_advisory_xact_lock(170017)');const {unit}=await catalog(c,m);
   let old=(await c.query('SELECT * FROM care_work_jobs WHERE (notion_page_id=$1 AND work_date=$3::date) OR (unit_id=$2 AND work_date=$3::date) ORDER BY (notion_page_id=$1) DESC LIMIT 1 FOR UPDATE',[id,unit.id,date])).rows[0];
   if(old?.notion_page_id&&old.notion_page_id!==id){const e=new Error('Dos páginas de Notion asignan la misma unidad y fecha. Revisa el duplicado.');e.status=409;e.jobId=old.id;throw e;}
   const closed=(await c.query("SELECT 1 FROM payroll_weeks WHERE status='closed' AND $1::date BETWEEN week_start AND week_end LIMIT 1",[date])).rows.length;
   if(closed&&!old?.notion_page_id)S.fail('La semana está cerrada. El historial conserva su cálculo anterior hasta revisar la migración.');
   const events=old?(await c.query('SELECT COUNT(*)::int AS count FROM care_work_events WHERE job_id=$1',[old.id])).rows[0].count:0;
   if(old&&(old.finished_at||['awaiting_inspection','inspecting','ready'].includes(old.status))&&(old.unit_id!==unit.id||S.dateKey(old.work_date)!==date||JSON.stringify(old.cleaner_ids)!==JSON.stringify(cleanerIds)||old.inspector_id!==snapshot.inspectorId||(old.cleaner_pay_cents!=null&&old.cleaner_pay_cents!==pay.cleaner)||(old.inspector_pay_cents!=null&&old.inspector_pay_cents!==pay.inspector)||(old.sale_cents!=null&&old.sale_cents!==pay.sale)||(old.pre_inspection_pay_cents!=null&&old.pre_inspection_pay_cents!==pay.pre)||old.pay_split_mode!==snapshot.split))S.fail('El trabajo ya terminó. Revisa el cambio de unidad, equipo o importes en Notion antes de alterar su historial.');
   if(old&&(old.started_at||events)&&(old.unit_id!==unit.id||S.dateKey(old.work_date)!==date||old.service_type!==type||!require('node:util').isDeepStrictEqual(old.cleaner_ids,cleanerIds)||old.inspector_id!==snapshot.inspectorId))S.fail('La unidad, fecha, tipo o equipo cambiaron después de iniciar. Revisa la asignación en Notion.');
   if(old&&!old.notion_page_id&&events&&JSON.stringify(old.cleaner_ids)!==JSON.stringify(cleanerIds))S.fail('Hay trabajo previo en la app con otro equipo. Revisa la vinculación de Notion.');
   if(closed&&old&&!require('node:util').isDeepStrictEqual(old.notion_snapshot,snapshot))S.fail('La semana está cerrada. Revisa los cambios de Notion antes de modificar su historial.');
   // Missing prices on an adopted local in-flight job preserve its original snapshot.
   if(old&&!old.notion_page_id&&(old.started_at||events)){if(pay.cleaner==null)pay.cleaner=old.cleaner_pay_cents;if(pay.inspector==null)pay.inspector=old.inspector_pay_cents;if(pay.sale==null)pay.sale=old.sale_cents;}
   const keep=old&&(old.started_at||events||old.notion_state_version>0),status=keep?old.status:initialStatus;
   const fields={unit_id:unit.id,work_date:date,service_type:type,cleaner_ids:JSON.stringify(cleanerIds),cleaner_names:JSON.stringify(snapshot.cleanerNames),inspector_id:snapshot.inspectorId,inspector_name:snapshot.inspectorName,instructions:snapshot.instructions,cleaner_pay_cents:pay.cleaner,inspector_pay_cents:pay.inspector,sale_cents:pay.sale,pre_inspection_pay_cents:pay.pre,pay_split_mode:snapshot.split,notion_page_id:id,notion_source_edited_at:assignment.last_edited_time||null,notion_snapshot:JSON.stringify(snapshot),arrival:V.bool(p,['Arrival','Llegada']),guest_out:V.bool(p,['Guest Out','Guest out','Guests Out']),pre_inspection_required:preRequired,status,needs_review:false,review_note:''};
   if(!keep){fields.started_at=V.date(p,['Started At','Cleaning Started At']);fields.finished_at=V.date(p,['Finished At','Cleaning Finished At']);fields.inspection_started_at=V.date(p,['Inspection Started At']);fields.ready_at=V.date(p,['Ready At']);fields.pre_inspection=pre;fields.pre_inspection_started_at=V.date(p,['Pre Inspection Started At']);fields.pre_inspection_completed_at=V.date(p,['Pre Inspection Completed At']);}
   if(status==='cancelled'&&(old?.started_at||events))S.fail('La cancelación afecta trabajo iniciado. Revisa la asignación en Notion.');
   const changed=!old||!require('node:util').isDeepStrictEqual(old.notion_snapshot,snapshot)||old.arrival!==fields.arrival||old.guest_out!==fields.guest_out||old.needs_review||(!keep&&(old.pre_inspection!==pre||old.pre_inspection_required!==preRequired))||!old.notion_page_id||(!keep&&old.status!==status),keys=Object.keys(fields),values=Object.values(fields),assign=keys.map((k,i)=>`${k}=$${i+1}${['cleaner_ids','cleaner_names','notion_snapshot'].includes(k)?'::jsonb':''}`).join(',');
   if(old){await c.query(`UPDATE care_work_jobs SET ${assign},version=version+${changed?1:0},updated_at=CASE WHEN $${values.length+2} THEN NOW() ELSE updated_at END WHERE id=$${values.length+1}`,[...values,old.id,changed]);}
   else{old=(await c.query(`INSERT INTO care_work_jobs(id,${keys.join(',')},created_by) VALUES($1,${keys.map((k,i)=>`$${i+2}${['cleaner_ids','cleaner_names','notion_snapshot'].includes(k)?'::jsonb':''}`).join(',')},'Notion') RETURNING *`,[randomUUID(),...values])).rows[0];}
   if(changed)await c.query('INSERT INTO care_directory_audit(actor,action,entity_id,detail) VALUES($1,$2,$3,$4::jsonb)',['Notion','assignment_imported',old.id,JSON.stringify({notionPageId:id,date,unitId:unit.id})]);
   return old.id;
  });
 }
 async function syncDate(date,{force=false}={}){
  S.day(date);if(running.has(date))return running.get(date);
  const task=(async()=>{
   const previous=(await query('SELECT * FROM care_notion_sync WHERE work_date=$1',[date])).rows[0];if(!force&&previous?.last_success_at&&Date.now()-new Date(previous.last_success_at)<10000)return previous;
   await query('INSERT INTO care_notion_sync(work_date) VALUES($1) ON CONFLICT(work_date) DO UPDATE SET last_attempt_at=NOW()',[date]);
   try{
    if(!databaseId)S.fail('Falta compartir o configurar Rooms / Asignaciones de Notion.');
    const defs=await schema(databaseId),dateKey=Object.keys(defs).find(k=>['date','fecha','work date','service date'].includes(V.norm(k))&&defs[k].type==='date');if(!dateKey)S.fail('Rooms / Asignaciones necesita Date o Fecha de tipo fecha.');
    const [pages,employees]=await Promise.all([all(databaseId,{property:dateKey,date:{equals:date}}),listEmployees()]);let imported=0;const errors=[];
    for(const p of pages){try{await importPage(p,employees);imported++;}catch(e){if(!e.status)console.error('NOTION IMPORT:',e.message);const note=e.status?e.message:'No se pudo vincular esta asignación. Revisa unidad, fecha y relaciones en Notion.';errors.push({pageId:p.id,unit:V.title(p.properties||{}),message:note});await query('UPDATE care_work_jobs SET needs_review=TRUE,review_note=$1 WHERE (notion_page_id=$2 OR id=$4::uuid) AND work_date=$3::date',[note,V.pageId(p.id),date,e.jobId||null]);}}
    const seen=pages.map(p=>V.pageId(p.id));
    await query(`UPDATE care_work_jobs SET needs_review=TRUE,review_note='La asignación no aparece en Notion para esta fecha. Revisa si fue movida o archivada.' WHERE work_date=$1::date AND notion_page_id IS NOT NULL AND status NOT IN ('ready','cancelled') AND NOT(notion_page_id=ANY($2::text[]))`,[date,seen]);
    await query("UPDATE care_notion_sync SET last_success_at=NOW(),source_count=$2,imported_count=$3,errors=$4::jsonb,error_message='' WHERE work_date=$1",[date,pages.length,imported,JSON.stringify(errors)]);emit('care-work:updated',{date});return{ok:true,count:imported,errors};
   }catch(e){const message=e.status?e.message:'No se pudo actualizar desde Notion. Se conserva la última información confirmada.';await query('UPDATE care_notion_sync SET error_message=$2 WHERE work_date=$1',[date,message]);throw new Error(message);}
  })();running.set(date,task);try{return await task;}finally{running.delete(date);}
 }
 return{syncDate,importPage,metadata,schema,all,page,today,query,pool,notion,databaseId,logDatabaseId,listEmployees};
}
module.exports={createNotionWorkSource};
