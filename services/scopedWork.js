'use strict';
const express=require('express'),{randomUUID}=require('node:crypto'),multer=require('multer'),https=require('node:https');
const S=require('./workSupport'),regular=require('../public/js/exit-checklist-data'),deep=require('../public/js/deep-clean-checklist-data');
const fulfiller=user=>S.manager(user)||String(user.role||'').toLowerCase().split(/\s*[/,;]\s*/).includes('runner');
const own=(job,user)=>S.manager(user)||job.cleaner_ids.includes(user.id)||job.inspector_id===user.id;
function checklist(value,type){const defs=type==='deep'?deep:regular,na=value?.notApplicable||[],checked=value?.checked;
 if(value?.version!==defs.version||!Array.isArray(checked)||!Array.isArray(na)||na.some(x=>!x||typeof x.id!=='string'||!S.text(x.reason,300))||(type!=='deep'&&na.length))S.fail('Completa el checklist asignado antes de terminar.');
 const all=[...checked,...na.map(x=>x.id)];if(all.length!==defs.items.length||new Set(all).size!==all.length||!defs.items.every(x=>all.includes(x.id)))S.fail('Completa todos los puntos del checklist.');
 return{version:defs.version,checked,notApplicable:na,items:defs.items,recordedAt:new Date().toISOString()};
}
function paymentRows(rows){return rows.filter(j=>j.status!=='cancelled').flatMap(j=>{
 const date=S.dateKey(j.work_date),base={date,workDate:date,unit:j.unit_name,unitId:j.unit_id,locationId:j.location_id,clientId:j.client_id,propertyName:`${j.client_name} / ${j.location_name}`,roomType:j.room_type,source:'care-work',payType:'unit',serviceId:j.id},payments=[];
 const complete=j.finished_at||['awaiting_inspection','inspecting','ready'].includes(j.status),ids=j.cleaner_ids,names=j.cleaner_names,n=ids.length,total=j.cleaner_pay_cents;
 if(complete&&total!=null)ids.forEach((id,i)=>payments.push({...base,id:`care-work:${j.id}:cleaner:${id}`,cleaner:names[i],employee:names[i],employeeId:id,roleWorked:'Cleaner',amount:(j.pay_split_mode==='full_each'?total:Math.floor(total/n)+(i<total%n?1:0))/100}));
 if((j.ready_at||j.status==='ready')&&j.inspector_id&&j.inspector_pay_cents!=null)payments.push({...base,id:`care-work:${j.id}:inspector:${j.inspector_id}`,cleaner:j.inspector_name,employee:j.inspector_name,employeeId:j.inspector_id,roleWorked:'Inspector',payType:'inspection',amount:j.inspector_pay_cents/100});
 if(j.pre_inspection&&j.inspector_id&&j.pre_inspection_pay_cents!=null)payments.push({...base,id:`care-work:${j.id}:pre:${j.inspector_id}`,cleaner:j.inspector_name,employee:j.inspector_name,employeeId:j.inspector_id,roleWorked:'Pre-inspection',payType:'inspection',amount:j.pre_inspection_pay_cents/100});return payments;
});}
const joins=`FROM care_work_jobs j JOIN care_units u ON u.id=j.unit_id JOIN care_locations l ON l.id=u.location_id JOIN care_clients c ON c.id=l.client_id`;
const selection=`j.*,u.name AS unit_name,u.room_type,l.id AS location_id,l.name AS location_name,l.address,l.instructions AS access_instructions,c.id AS client_id,c.name AS client_name`;
async function payroll(query,start,end){const r=await query(`SELECT ${selection} ${joins} WHERE j.work_date BETWEEN $1::date AND $2::date`,[start,end]);const records=paymentRows(r.rows);records.warnings=r.rows.filter(j=>j.status!=='cancelled'&&(((j.finished_at||['awaiting_inspection','inspecting','ready'].includes(j.status))&&j.cleaner_pay_cents==null)||((j.ready_at||j.status==='ready')&&j.inspector_id&&j.inspector_pay_cents==null)||(j.pre_inspection&&j.inspector_id&&j.pre_inspection_pay_cents==null)||j.needs_review)).map(j=>`${j.client_name} / ${j.location_name} / ${j.unit_name}: ${j.needs_review?'asignación pendiente de revisión.':'falta definir pago.'}`);return records;}
function createScopedRouter({query,pool,resolveUser,listEmployees,today,cloudinary,emit=()=>{},sourceMode='app',notionSource=null,onChanged=()=>{}}){
 const router=express.Router();router.use(S.middleware(resolveUser));
 const mustManage=req=>{if(!S.manager(req.workUser))S.fail('Solo administración.',403);};
 async function getJob(id,user,c={query}){const j=(await c.query(`SELECT ${selection} ${joins} WHERE j.id=$1`,[S.uuid(id)])).rows[0];if(!j||!own(j,user))S.fail('Servicio no encontrado.',404);return j;}
 const safe=(j,u)=>{const syncPending=Number(j.notion_state_version)>Number(j.notion_mirrored_version);if(S.manager(u))return{...j,syncPending};const {cleaner_pay_cents,inspector_pay_cents,pre_inspection_pay_cents,sale_cents,rate_snapshot,applied_rate_id,notion_snapshot,notion_mirror_error,...rest}=j;return{...rest,syncPending};};
 async function syncState(date,user){if(!notionSource)return null;const state=(await query('SELECT * FROM care_notion_sync WHERE work_date=$1',[date])).rows[0]||null;if(!state)return{pending:true};return S.manager(user)?state:{last_success_at:state.last_success_at,hasErrors:!!state.error_message||!!state.errors?.length};}
 async function refresh(date,force,user){if(!notionSource||(!S.manager(user)&&date!==today()))return;const state=(await query('SELECT * FROM care_notion_sync WHERE work_date=$1',[date])).rows[0];if(force||!state?.last_success_at)await notionSource.syncDate(date,{force}).catch(()=>{});else setImmediate(()=>notionSource.syncDate(date).catch(()=>{}));}
 const notionLink=id=>/^[a-f0-9]{32}$/i.test(String(id||'').replace(/-/g,''))?'https://www.notion.so/'+String(id).replace(/-/g,''):null;

 async function audit(c,req,action,id,detail){await c.query('INSERT INTO care_directory_audit(actor,action,entity_id,detail) VALUES($1,$2,$3,$4::jsonb)',[req.workUser.name,action,id,JSON.stringify(detail)]);}
 router.get('/bootstrap',S.route(async(req,res)=>{
  const user=req.workUser,manage=S.manager(user);let units=[],employees=[];
  if(manage){units=(await query('SELECT u.*,l.name AS location_name,l.client_id,c.name AS client_name FROM care_units u JOIN care_locations l ON l.id=u.location_id JOIN care_clients c ON c.id=l.client_id WHERE u.active AND l.active AND c.active AND NOT u.review_required ORDER BY c.name,l.name,u.name')).rows;employees=(await listEmployees()).filter(u=>u.active).map(u=>({id:u.id,name:u.name,role:u.role}));}
  res.json({ok:true,sourceMode,notionUrl:notionLink(notionSource?.databaseId),today:today(),user:{id:user.id,name:user.name,role:user.role,language:user.language},canManage:manage,canFulfill:fulfiller(user),units,employees,checklists:{regular,deep}});
 }));
 router.get('/jobs',S.route(async(req,res)=>{
  const date=S.day(req.query.date||today());await refresh(date,req.query.refresh==='1',req.workUser);const p=[date],condition=S.manager(req.workUser)?'':` AND (j.cleaner_ids ? $2 OR j.inspector_id=$2)`;if(condition)p.push(req.workUser.id);
  const rows=(await query(`SELECT ${selection},(SELECT COUNT(*)::int FROM care_work_reports r WHERE r.job_id=j.id AND r.status='open' AND r.kind='issue') AS open_issue_count ${joins} WHERE j.work_date=$1::date ${condition} ORDER BY c.name,l.name,u.name`,p)).rows;res.json({ok:true,jobs:rows.map(j=>safe(j,req.workUser)),source:await syncState(date,req.workUser)});
 }));
 router.post('/jobs',S.route(async(req,res)=>{
  mustManage(req);if(sourceMode==='notion')S.fail('Las asignaciones se preparan en Notion. Actualiza Mi trabajo para verlas.',409);const b=req.body,id=S.uuid(b.id),unitId=S.uuid(b.unitId),date=S.day(b.date),type=b.serviceType;
  if(!['regular','deep','touch_up'].includes(type))S.fail('Tipo de servicio inválido.');
  if(!Array.isArray(b.cleanerIds)||!b.cleanerIds.length||b.cleanerIds.length>10||new Set(b.cleanerIds).size!==b.cleanerIds.length)S.fail('Asigna entre 1 y 10 cleaners distintos.');
  const employees=(await listEmployees()).filter(e=>e.active),cleaners=b.cleanerIds.map(id=>employees.find(e=>e.id===id)),insp=b.inspectorId?employees.find(e=>e.id===b.inspectorId):null;
  if(cleaners.some(e=>!e||!(/cleaner/i.test(e.role)||S.manager(e))))S.fail('Selecciona cleaners activos.');
  if(!insp||!S.inspector(insp))S.fail('Asigna un inspector activo.');
  const pay=v=>{if(v===''||v==null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000||Math.abs(v*100-Math.round(v*100))>0.00001)S.fail('Pago inválido. Usa dólares y centavos.');return Math.round(v*100);};
  const values=[id,unitId,date,type,JSON.stringify(b.cleanerIds),JSON.stringify(cleaners.map(e=>e.name)),insp.id,insp.name,S.text(b.instructions),pay(b.cleanerPay),pay(b.inspectorPay),req.workUser.name];
  const job=await S.transaction(pool(),async c=>{
   const previous=(await c.query('SELECT * FROM care_work_jobs WHERE id=$1',[id])).rows[0];if(previous){if(previous.unit_id!==unitId||S.dateKey(previous.work_date)!==date||previous.service_type!==type||JSON.stringify(previous.cleaner_ids)!==JSON.stringify(b.cleanerIds)||previous.inspector_id!==insp.id||previous.cleaner_pay_cents!==(values[9]??(previous.rate_snapshot?Math.round(previous.rate_snapshot.cleanerPay*100):null))||previous.inspector_pay_cents!==(values[10]??(previous.rate_snapshot?Math.round(previous.rate_snapshot.inspectorPay*100):null))||b.salePrice!=null&&previous.sale_cents!==Math.round(b.salePrice*100)||previous.instructions!==values[8])S.fail('La solicitud ya corresponde a otro servicio.',409);return previous;}
   const unit=(await c.query('SELECT u.*,l.active AS location_active,c.active AS client_active FROM care_units u JOIN care_locations l ON l.id=u.location_id JOIN care_clients c ON c.id=l.client_id WHERE u.id=$1 FOR UPDATE OF u,l,c',[unitId])).rows[0];
   if(!unit?.active||!unit.location_active||!unit.client_active||unit.review_required)S.fail('Revisa la unidad y su localidad antes de asignarla.');
   // Legacy hotel jobs remain in their existing workflow and cannot be double-booked/paid.
   if(unit.legacy_key||unit.location_id==='00000000-0000-4000-8000-000000000002')S.fail('Esta unidad tiene historial en Rooms. Continúa su operación en el panel del hotel hasta migrar ese historial.');
   const rate=await require('./serviceRates').quote(c.query.bind(c),unitId,date,type);
   if(b.rateId&&(rate?.id!==b.rateId||rate?.version!==b.rateVersion))S.fail('La tarifa cambió. Actualiza el precio antes de guardar.',409);
   const sale=b.salePrice==null?rate?.salePrice??null:b.salePrice;
   if(b.cleanerPay==null&&rate)values[9]=Math.round(rate.cleanerPay*100);
   if(b.inspectorPay==null&&rate)values[10]=Math.round(rate.inspectorPay*100);
   const saleCents=sale==null?null:require('./serviceRates').cents(sale,'Precio al cliente');
   if(rate&&((saleCents!==Math.round(rate.salePrice*100))||(values[9]!==Math.round(rate.cleanerPay*100))||(values[10]!==Math.round(rate.inspectorPay*100)))&&!S.text(b.priceNote))S.fail('Escribe por qué estás ajustando los importes de la tarifa.');
   const r=(await c.query(`INSERT INTO care_work_jobs(id,unit_id,work_date,service_type,cleaner_ids,cleaner_names,inspector_id,inspector_name,instructions,cleaner_pay_cents,inspector_pay_cents,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12) RETURNING *`,values)).rows[0];
   const snapshot=rate?{...rate,priceNote:S.text(b.priceNote)}:null;
   const saved=(await c.query('UPDATE care_work_jobs SET sale_cents=$1,applied_rate_id=$2,rate_snapshot=$3::jsonb WHERE id=$4 RETURNING *',[saleCents,rate?.id||null,JSON.stringify(snapshot),id])).rows[0];
   await audit(c,req,'work_scheduled',id,{after:saved});return saved;
  });res.status(201).json({ok:true,job});emit('care-work:updated',{date});
 }));
 router.patch('/jobs/:id/pay',S.route(async(req,res)=>{
  mustManage(req);if(sourceMode==='notion')S.fail('Los importes se administran en Notion; los trabajos terminados conservan su historial.',409);const note=S.text(req.body.note);if(!note)S.fail('Escribe el motivo del ajuste.');
  const amount=v=>{if(v==null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000||Math.abs(v*100-Math.round(v*100))>0.00001)S.fail('Pago inválido.');return Math.round(v*100);};
  const cp=amount(req.body.cleanerPay),ip=amount(req.body.inspectorPay),job=await S.transaction(pool(),async c=>{
   await c.query('SELECT id FROM care_work_jobs WHERE id=$1 FOR UPDATE',[S.uuid(req.params.id)]);const old=await getJob(req.params.id,req.workUser,c);
   if(old.version!==req.body.version)S.fail('El servicio cambió. Actualiza.',409);
   if((await c.query("SELECT 1 FROM payroll_weeks WHERE status='closed' AND $1::date BETWEEN week_start AND week_end",[old.work_date])).rows.length)S.fail('Reabre la semana antes de cambiar el pago.',409);
   const row=(await c.query('UPDATE care_work_jobs SET cleaner_pay_cents=$1,inspector_pay_cents=$2,version=version+1,updated_at=NOW() WHERE id=$3 RETURNING *',[cp,ip,old.id])).rows[0];
   await audit(c,req,'work_pay_reviewed',old.id,{note,before:{cleaner:old.cleaner_pay_cents,inspector:old.inspector_pay_cents},after:{cleaner:cp,inspector:ip}});return row;
  });res.json({ok:true,job});
 }));
 router.get('/jobs/:id',S.route(async(req,res)=>{
  const job=await getJob(req.params.id,req.workUser),[events,reports,photos]=await Promise.all([
   query('SELECT request_id,action,actor,payload,created_at FROM care_work_events WHERE job_id=$1 ORDER BY created_at',[job.id]),
   query('SELECT * FROM care_work_reports WHERE job_id=$1 ORDER BY created_at',[job.id]),query('SELECT id,area,created_at FROM care_work_photos WHERE job_id=$1 ORDER BY created_at',[job.id])]);
  res.json({ok:true,job:safe(job,req.workUser),events:events.rows,reports:reports.rows,photos:photos.rows});
 }));
 router.post('/jobs/:id/action',S.route(async(req,res)=>{
  const jobId=S.uuid(req.params.id),request=S.uuid(req.body.requestId),action=req.body.action,user=req.workUser;
  if(!['START','DONE','INSPECTION_START','READY_GUEST','CANCEL','REWORK','PRE_INSPECTION_START','PRE_INSPECTION_COMPLETE'].includes(action))S.fail('Acción inválida.');
  const result=await S.transaction(pool(),async c=>{
   await c.query('SELECT id FROM care_work_jobs WHERE id=$1 FOR UPDATE',[jobId]);const job=await getJob(jobId,user,c);
   const previous=(await c.query('SELECT * FROM care_work_events WHERE request_id=$1',[request])).rows[0];
   if(previous){if(previous.job_id!==jobId||previous.actor_id!==user.id||previous.action!==action)S.fail('Identificador usado en otra acción.',409);return{job,duplicate:true};}
   if(job.needs_review)S.fail('La asignación necesita revisión en Notion antes de continuar.',409);
   if(sourceMode==='notion'&&action==='CANCEL')S.fail('La cancelación se administra en Notion.',409);
   if(S.dateKey(job.work_date)!==today()&&!['CANCEL','REWORK'].includes(action))S.fail('Este servicio pertenece a otro día. Revisa la fecha con administración.',409);
   if(!Number.isInteger(req.body.version)||req.body.version!==job.version)S.fail('El servicio cambió. Actualiza antes de continuar.',409);
   if(['START','DONE'].includes(action)&&!job.cleaner_ids.includes(user.id))S.fail('Solo el cleaner asignado puede completar esta acción.',403);
   if(['INSPECTION_START','READY_GUEST','REWORK','PRE_INSPECTION_START','PRE_INSPECTION_COMPLETE'].includes(action)&&(!S.inspector(user)||(!S.manager(user)&&job.inspector_id!==user.id)))S.fail('Solo el inspector asignado o administración.',403);
   if(action==='CANCEL'&&!S.manager(user))S.fail('Solo administración.',403);
   const transitions={START:['pending','cleaning','started_at'],DONE:['cleaning','awaiting_inspection','finished_at'],INSPECTION_START:['awaiting_inspection','inspecting','inspection_started_at'],READY_GUEST:['inspecting','ready','ready_at']};
   let next,payload={};if(action.startsWith('PRE_INSPECTION_')){
    if(['ready','cancelled'].includes(job.status)||!job.pre_inspection_required||!job.guest_out||job.pre_inspection)S.fail('La revisión inicial no está pendiente o falta confirmar Guest Out.',409);
    if(action==='PRE_INSPECTION_START'){if(job.pre_inspection_started_at)S.fail('La revisión inicial ya comenzó.',409);await c.query('UPDATE care_work_jobs SET pre_inspection_started_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$1',[job.id]);}
    else{if(!job.pre_inspection_started_at)S.fail('Primero comienza la revisión inicial.',409);await c.query('UPDATE care_work_jobs SET pre_inspection=TRUE,pre_inspection_completed_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$1',[job.id]);}
   }else if(transitions[action]){const [from,to,stamp]=transitions[action];if(job.status!==from)S.fail('El estado actual no permite esta acción.',409);next=to;
    if(action==='DONE')payload.checklist=checklist(req.body.checklist,job.service_type);
    if(action==='READY_GUEST'&&(await c.query("SELECT 1 FROM care_work_reports WHERE job_id=$1 AND kind='issue' AND status='open' LIMIT 1",[job.id])).rows.length)S.fail('Resuelve los problemas abiertos antes de entregar la unidad.',409);
    await c.query(`UPDATE care_work_jobs SET status=$1,${stamp}=NOW(),version=version+1,updated_at=NOW()${action==='DONE'?',checklist=$3::jsonb':''} WHERE id=$2`,action==='DONE'?[next,job.id,JSON.stringify(payload.checklist)]:[next,job.id]);
   }else{
    const note=S.text(req.body.note);if(!note)S.fail('Escribe el motivo.');payload.note=note;
    if(action==='CANCEL'){if(job.started_at||job.status==='cancelled')S.fail('Solo se cancela un servicio sin iniciar.',409);next='cancelled';await c.query("UPDATE care_work_jobs SET status='cancelled',version=version+1,updated_at=NOW() WHERE id=$1",[job.id]);}
    else{if(!['inspecting','awaiting_inspection'].includes(job.status))S.fail('Solo se devuelve una unidad pendiente de aprobación.',409);next='cleaning';await c.query("UPDATE care_work_jobs SET status='cleaning',finished_at=NULL,inspection_started_at=NULL,checklist=NULL,version=version+1,updated_at=NOW() WHERE id=$1",[job.id]);}
   }
   await c.query('INSERT INTO care_work_events(request_id,job_id,action,actor_id,actor,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[request,job.id,action,user.id,user.name,JSON.stringify(payload)]);
   if(job.notion_page_id)await c.query('UPDATE care_work_jobs SET notion_state_version=notion_state_version+1,notion_next_retry_at=NOW() WHERE id=$1',[job.id]);
   return{job:await getJob(job.id,user,c),duplicate:false};
  });res.json({ok:true,...result,job:safe(result.job,user)});emit('care-work:updated',{});setImmediate(()=>Promise.resolve(onChanged()).catch(()=>{}));
 }));
 router.post('/jobs/:id/reports',S.route(async(req,res)=>{
  const job=await getJob(req.params.id,req.workUser),id=S.uuid(req.body.id),kind=req.body.kind,note=S.text(req.body.note);if(!['issue','supplies'].includes(kind)||!note)S.fail('Selecciona el tipo y escribe el reporte.');
  const row=await S.transaction(pool(),async c=>{
   await c.query('SELECT id FROM care_work_jobs WHERE id=$1 FOR UPDATE',[job.id]);
   const existing=(await c.query('SELECT * FROM care_work_reports WHERE id=$1',[id])).rows[0];if(existing){if(existing.job_id!==job.id||existing.actor_id!==req.workUser.id||existing.kind!==kind||existing.note!==note)S.fail('Identificador de otro reporte.',409);return existing;}
   const current=await getJob(job.id,req.workUser,c);if(['ready','cancelled'].includes(current.status))S.fail('El servicio está cerrado. Solicita un servicio nuevo a administración.',409);
   const saved=(await c.query('INSERT INTO care_work_reports(id,job_id,kind,note,actor_id,actor) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,job.id,kind,note,req.workUser.id,req.workUser.name])).rows[0];
   await c.query('INSERT INTO care_work_events(request_id,job_id,action,actor_id,actor,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[id,job.id,kind==='issue'?'ISSUE':'SUPPLIES',req.workUser.id,req.workUser.name,JSON.stringify({note})]);return saved;
  });res.status(201).json({ok:true,report:row});setImmediate(()=>Promise.resolve(onChanged()).catch(()=>{}));
 }));
 router.get('/reports',S.route(async(req,res)=>{
  if(!fulfiller(req.workUser))S.fail('Solo operaciones o runner.',403);
  const rows=(await query(`SELECT r.*,l.id AS location_id,u.name AS unit_name,l.name AS location_name,l.address,c.name AS client_name FROM care_work_reports r JOIN care_work_jobs j ON j.id=r.job_id JOIN care_units u ON u.id=j.unit_id JOIN care_locations l ON l.id=u.location_id JOIN care_clients c ON c.id=l.client_id WHERE r.status='open' ${S.manager(req.workUser)?'':"AND r.kind='supplies'"} ORDER BY r.created_at`)).rows;
  res.json({ok:true,reports:rows});
 }));
 router.patch('/reports/:id',S.route(async(req,res)=>{
  if(!fulfiller(req.workUser))S.fail('Solo administración o runner.',403);const note=S.text(req.body.note);if(!note)S.fail('Escribe cómo se resolvió.');
  const row=await S.transaction(pool(),async c=>{
   const existing=(await c.query('SELECT * FROM care_work_reports WHERE id=$1',[S.uuid(req.params.id)])).rows[0];if(!existing)S.fail('Reporte no encontrado.',404);if(!S.manager(req.workUser)&&existing.kind!=='supplies')S.fail('Solo administración resuelve problemas.',403);
   await c.query('SELECT id FROM care_work_jobs WHERE id=$1 FOR UPDATE',[existing.job_id]);
   const r=(await c.query("UPDATE care_work_reports SET status='resolved',resolved_by=$1,resolved_at=NOW() WHERE id=$2 AND status='open' RETURNING *",[req.workUser.name,existing.id])).rows[0];
   if(r)await audit(c,req,'work_report_resolved',r.id,{note,jobId:r.job_id});return r||existing;
  });res.json({ok:true,report:row});
 }));
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1},fileFilter:(req,f,cb)=>cb(null,/^image\/(jpeg|png|webp)$/.test(f.mimetype))});
 router.post('/jobs/:id/photos',S.route(async(req,res)=>{
  const job=await getJob(req.params.id,req.workUser);if(!cloudinary?.config()?.cloud_name)S.fail('Las fotos requieren la configuración de imágenes.',503);
  await new Promise((resolve,reject)=>upload.single('photo')(req,res,e=>e?reject(e):resolve()));if(!req.file)S.fail('Selecciona una foto JPG, PNG o WebP de hasta 8 MB.');
  const id=S.uuid(req.body.id),area=S.text(req.body.area,100)||'General',existing=(await query('SELECT * FROM care_work_photos WHERE id=$1',[id])).rows[0];
  if(existing){if(existing.job_id!==job.id||existing.actor_id!==req.workUser.id)S.fail('Identificador de otra foto.',409);return res.json({ok:true,id});}
  const uploaded=await new Promise((resolve,reject)=>cloudinary.uploader.upload_stream({folder:'care/work',resource_type:'image',type:'authenticated',format:'jpg'},(e,r)=>e?reject(e):resolve(r)).end(req.file.buffer));
  try{await query('INSERT INTO care_work_photos(id,job_id,actor_id,public_id,area) VALUES($1,$2,$3,$4,$5)',[id,job.id,req.workUser.id,uploaded.public_id,area]);}catch(e){await cloudinary.uploader.destroy(uploaded.public_id,{type:'authenticated'}).catch(()=>{});throw e;}res.status(201).json({ok:true,id});
 }));
 router.get('/photos/:id/image',S.route(async(req,res)=>{
  const p=(await query('SELECT * FROM care_work_photos WHERE id=$1',[S.uuid(req.params.id)])).rows[0];if(!p)S.fail('Foto no encontrada.',404);await getJob(p.job_id,req.workUser);
  const url=cloudinary.url(p.public_id,{secure:true,type:'authenticated',sign_url:true});const bytes=await new Promise((resolve,reject)=>https.get(url,r=>{if(r.statusCode!==200){r.resume();return reject(Error('Image unavailable'));}const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>resolve(Buffer.concat(chunks)));r.on('error',reject);}).on('error',reject));res.type('image/jpeg').send(bytes);
 }));
 router.get('/payroll',S.route(async(req,res)=>{mustManage(req);const start=S.day(req.query.start),end=S.day(req.query.end);if(start>end||Date.parse(end)-Date.parse(start)>31*86400000)S.fail('Selecciona un período de hasta 31 días.');const records=await payroll(query,start,end);res.json({ok:true,records,warnings:records.warnings,total:records.reduce((s,r)=>s+Math.round(r.amount*100),0)/100});}));
 return router;
}
module.exports={createScopedRouter,payroll,paymentRows,checklist};
