'use strict';
const express=require('express'),{randomUUID}=require('node:crypto');
const S=require('./workSupport');
function money(v){return Math.round(Number(v)*100);}
function splitClock(row){
 if(!row.clock_out)return[];const start=new Date(row.clock_in).getTime(),end=new Date(row.clock_out).getTime(),rate=row.pay_mode==='attendance'?0:Number(row.rate_cents);if(end<start)return[];
 const parts=[];let cursor=start,paid=0;
 while(cursor<end){const date=S.localDay(cursor);let boundary=end;
  if(S.localDay(end-1)!==date){let lo=cursor,hi=Math.min(end,cursor+36*3600000);while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(S.localDay(mid)===date)lo=mid;else hi=mid;}boundary=hi;}
  const cumulative=Math.round((boundary-start)*rate/3600000),cents=cumulative-paid;paid=cumulative;
  parts.push({id:`care-clock:${row.id}:${date}`,employeeId:row.employee_id,employee:row.employee,role:row.role,workDate:date,clockIn:new Date(cursor).toISOString(),clockOut:new Date(boundary).toISOString(),hours:(boundary-cursor)/3600000,hourlyRate:rate/100,total:cents/100,workLocation:row.work_location,locationId:row.location_id,clientId:row.client_id,propertyName:row.client_name?row.client_name+' / '+row.location_name:row.work_location,status:'Completed',source:'care-clock',needsReview:rate<=0});cursor=boundary;
 }return parts;
}
async function localClockPayroll(query,start,end){
 const r=await query(`SELECT s.*,l.client_id,c.name AS client_name,l.name AS location_name FROM care_clock_sessions s LEFT JOIN care_locations l ON l.id=s.location_id LEFT JOIN care_clients c ON c.id=l.client_id WHERE s.clock_in < (($2::date+1)::timestamp AT TIME ZONE 'America/Chicago') AND (s.clock_out IS NULL OR s.clock_out >= ($1::date::timestamp AT TIME ZONE 'America/Chicago'))`,[start,end]);
 const payable=r.rows.filter(x=>x.pay_mode!=='attendance');
 const records=payable.flatMap(splitClock).filter(x=>x.workDate>=start&&x.workDate<=end);
 records.warnings=payable.filter(x=>!x.clock_out).map(x=>`${x.employee}: falta Clock Out; sus horas abiertas no están incluidas.`);
 records.warnings.push(...records.filter(x=>x.needsReview).map(x=>`${x.employee}: falta Hourly Rate para ${x.workDate}.`));
 records.mirrorIds=r.rows.map(x=>x.notion_page_id).filter(Boolean);return records;
}
function legacyLocation(name){
 if(name==='Hotel')return{id:null,name:'Hotel',latitude:Number(process.env.HOTEL_LAT||36.638366),longitude:Number(process.env.HOTEL_LNG||-93.350305),radius_m:Number(process.env.HOTEL_RADIUS_FEET||300)/3.28084,geofence_required:true};
 if(!['Chateau','Office','Laundry','Other'].includes(name))S.fail('Selecciona un lugar de trabajo.');return{id:null,name,geofence_required:false};
}
function publicSession(r){if(!r)return null;return{id:r.id,employee:r.employee,clockIn:r.clock_in,clockOut:r.clock_out,locationId:r.location_id,workLocation:r.work_location,hourlyRate:r.rate_cents/100,payMode:r.pay_mode,needsRate:r.pay_mode!=='attendance'&&r.rate_cents<=0,version:r.version,mirrorPending:r.mirror_version<r.version,mirrorError:r.mirror_error?'La copia en Notion está pendiente. El registro de horas está guardado.':''};}
function createClockRouter({query,pool,resolveUser,legacyActive=async()=>null,listEmployees=async()=>[],now=()=>new Date()}){
 const router=express.Router();router.use(S.middleware(resolveUser));
 async function location(c,b){if(b.locationId){const l=(await c.query('SELECT l.*,c.name AS client_name FROM care_locations l JOIN care_clients c ON c.id=l.client_id WHERE l.id=$1 AND l.active AND c.active',[S.uuid(b.locationId)])).rows[0];if(!l)S.fail('Localidad no disponible.');return l;}const l=legacyLocation(b.workLocation);if(l.name==='Other'){l.name=S.text(b.locationNote,120);if(!l.name)S.fail('Escribe el lugar de trabajo.');}return l;}
 async function active(user){return(await query('SELECT * FROM care_clock_sessions WHERE employee_id=$1 AND clock_out IS NULL',[user.id])).rows[0]||null;}
 router.post('/manual',S.route(async(req,res)=>{
  if(!S.manager(req.workUser))S.fail('Solo administración.',403);const b=req.body,request=S.uuid(b.requestId),note=S.text(b.reason);if(!note)S.fail('Escribe el motivo de las horas.');
  const employees=(await listEmployees()).filter(e=>e.active&&e.name.trim().toLowerCase()===S.text(b.employee,160).toLowerCase());if(employees.length!==1)S.fail('Escribe el nombre exacto de un empleado activo y sin duplicados.');
  const user=employees[0],start=S.chicagoTime(b.date,b.clockIn),end=S.chicagoTime(b.date,b.clockOut),rate=Number(b.hourlyRate);if(end<=start||end>now()||!Number.isFinite(rate)||rate<=0||rate>100000||Math.abs(rate*100-Math.round(rate*100))>0.00001)S.fail('Revisa las horas de entrada/salida y la tarifa.');
  const row=await S.transaction(pool(),async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['care-clock:'+user.id]);
   const known=(await c.query('SELECT * FROM care_clock_sessions WHERE in_request=$1',[request])).rows[0];if(known){if(known.employee_id!==user.id||new Date(known.clock_in).getTime()!==start.getTime()||new Date(known.clock_out).getTime()!==end.getTime()||known.rate_cents!==Math.round(rate*100))S.fail('El intento ya corresponde a otras horas.',409);return known;}
   if((await c.query("SELECT 1 FROM payroll_weeks WHERE status='closed' AND $1::date BETWEEN week_start AND week_end",[b.date])).rows.length)S.fail('Reabre la semana antes de agregar horas.',409);
   if((await c.query('SELECT 1 FROM care_clock_sessions WHERE employee_id=$1 AND clock_in<$3 AND (clock_out IS NULL OR clock_out>$2)',[user.id,start.toISOString(),end.toISOString()])).rows.length)S.fail('Estas horas se cruzan con otro turno. Revisa el horario.',409);
   const r=(await c.query(`INSERT INTO care_clock_sessions(id,employee_id,employee,employee_code,role,work_location,clock_in,clock_out,rate_cents,in_gps,out_gps,in_request,out_request,rate_note) VALUES($1,$2,$3,$4,$5,'Manual',$6,$7,$8,$9::jsonb,$9::jsonb,$10,$11,$12) RETURNING *`,[randomUUID(),user.id,user.name,user.code||'',S.text(b.role,120)||user.role,start.toISOString(),end.toISOString(),Math.round(rate*100),JSON.stringify({manual:true,note,actor:req.workUser.name}),request,randomUUID(),note])).rows[0];
   await c.query("INSERT INTO care_directory_audit(actor,action,entity_id,detail) VALUES($1,'clock_manual_hours',$2,$3::jsonb)",[req.workUser.name,r.id,JSON.stringify({note,employeeId:user.id,start:start.toISOString(),end:end.toISOString()})]);return r;
  });res.json({ok:true,session:publicSession(row),hours:splitClock(row).reduce((s,r)=>s+r.hours,0),total:splitClock(row).reduce((s,r)=>s+r.total,0)});
 }));
 router.get('/status',S.route(async(req,res)=>{const r=await active(req.workUser);const old=r?null:await legacyActive(req.workUser);res.json({ok:true,user:{name:req.workUser.name,language:req.workUser.language},active:publicSession(r),legacyActive:old?{clockIn:old.clockIn,workLocation:old.workLocation}:null});}));
 router.get('/locations',S.route(async(req,res)=>res.json({ok:true,locations:(await query('SELECT l.id,l.name,l.address,l.geofence_required,c.name AS client_name FROM care_locations l JOIN care_clients c ON c.id=l.client_id WHERE l.active AND c.active ORDER BY c.name,l.name')).rows})));
 router.post('/in',S.route(async(req,res)=>{
  const request=S.uuid(req.body.requestId),user=req.workUser;
  // Retries can be acknowledged even after GPS expires, but only for their authenticated owner.
  const known=(await query('SELECT * FROM care_clock_sessions WHERE in_request=$1',[request])).rows[0];
  if(known){if(known.employee_id!==user.id)S.fail('Solicitud de otro empleado.',403);return res.json({ok:true,duplicate:true,session:publicSession(known)});}
  const point=S.gps(req.body,now().getTime());if(await legacyActive(user))S.fail('Tienes una entrada anterior abierta. Registra Clock Out antes de entrar.',409);
  const row=await S.transaction(pool(),async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['care-clock:'+user.id]);
   const retry=(await c.query('SELECT * FROM care_clock_sessions WHERE in_request=$1',[request])).rows[0];if(retry){if(retry.employee_id!==user.id)S.fail('Solicitud de otro empleado.',403);return retry;}
   if((await c.query('SELECT 1 FROM care_clock_sessions WHERE employee_id=$1 AND clock_out IS NULL',[user.id])).rows.length)S.fail('Ya tienes una entrada activa.',409);
   const loc=await location(c,req.body);if(loc.geofence_required&&!S.inside(point,loc))S.fail('La señal no confirma que estés dentro de la propiedad. Mejora la precisión y vuelve a intentar.',403);
   const rate=money(user.hourlyRate||0);if(!Number.isInteger(rate)||rate<0||rate>10000000)S.fail('Revisa Hourly Rate del empleado.');
   return(await c.query(`INSERT INTO care_clock_sessions(id,employee_id,employee,employee_code,role,location_id,work_location,clock_in,rate_cents,in_gps,in_request,pay_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) RETURNING *`,[randomUUID(),user.id,user.name,user.code||'',user.role||'',loc.id,loc.client_name?loc.client_name+' / '+loc.name:loc.name,now().toISOString(),rate,JSON.stringify(point),request,user.payMode==='attendance'?'attendance':'hourly'])).rows[0];
  });res.status(201).json({ok:true,session:publicSession(row)});
 }));
 router.post('/out',S.route(async(req,res)=>{
  const request=S.uuid(req.body.requestId),user=req.workUser;
  const known=(await query('SELECT * FROM care_clock_sessions WHERE out_request=$1',[request])).rows[0];if(known){if(known.employee_id!==user.id)S.fail('Solicitud de otro empleado.',403);return res.json({ok:true,duplicate:true,session:publicSession(known),hours:splitClock(known).reduce((a,r)=>a+r.hours,0),total:splitClock(known).reduce((a,r)=>a+r.total,0)});}
  const point=S.gps(req.body,now().getTime());const local=await active(user),legacy=local?null:await legacyActive(user);
  const row=await S.transaction(pool(),async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['care-clock:'+user.id]);
   const retry=(await c.query('SELECT * FROM care_clock_sessions WHERE out_request=$1',[request])).rows[0];if(retry){if(retry.employee_id!==user.id)S.fail('Solicitud de otro empleado.',403);return retry;}
   let session=(await c.query('SELECT * FROM care_clock_sessions WHERE employee_id=$1 AND clock_out IS NULL FOR UPDATE',[user.id])).rows[0];
   if(!session&&legacy){session=(await c.query(`INSERT INTO care_clock_sessions(id,employee_id,employee,employee_code,role,work_location,clock_in,rate_cents,in_gps,in_request,notion_page_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'{}',$9,$10) RETURNING *`,[randomUUID(),user.id,user.name,user.code||'',legacy.role||user.role,legacy.workLocation||'Unspecified',legacy.clockIn,money(legacy.hourlyRate||0),randomUUID(),legacy.id])).rows[0];}
   if(!session)S.fail('No tienes una entrada abierta.',409);
   if(new Date(session.clock_in)>now())S.fail('La hora de entrada es posterior a la salida. Solicita revisión.');
   const r=(await c.query('UPDATE care_clock_sessions SET clock_out=$1,out_gps=$2::jsonb,out_request=$3,version=version+1,updated_at=NOW(),mirror_next_at=NOW() WHERE id=$4 RETURNING *',[now().toISOString(),JSON.stringify(point),request,session.id])).rows[0];
   await c.query('DELETE FROM care_work_presence WHERE employee_id=$1',[user.id]);return r;
  });res.json({ok:true,session:publicSession(row),hours:splitClock(row).reduce((a,r)=>a+r.hours,0),total:splitClock(row).reduce((a,r)=>a+r.total,0)});
 }));
 router.get('/history',S.route(async(req,res)=>{
  const rows=(await query('SELECT * FROM care_clock_sessions WHERE employee_id=$1 ORDER BY clock_in DESC LIMIT 30',[req.workUser.id])).rows;res.json({ok:true,records:rows.map(r=>({...publicSession(r),hours:splitClock(r).reduce((a,x)=>a+x.hours,0),total:splitClock(r).reduce((a,x)=>a+x.total,0)}))});
 }));
 router.post('/presence',S.route(async(req,res)=>{
  if(req.body.sharing!==true)S.fail('Debes activar compartir ubicación.');const p=S.gps(req.body,now().getTime());
  const result=await S.transaction(pool(),async c=>{
   const session=(await c.query('SELECT * FROM care_clock_sessions WHERE employee_id=$1 AND clock_out IS NULL FOR UPDATE',[req.workUser.id])).rows[0];
   if(!session||now()-new Date(session.clock_in)>18*3600000)S.fail('La ubicación solo se comparte durante un turno activo de hasta 18 horas.',409);
   const locs=(await c.query('SELECT l.* FROM care_locations l JOIN care_clients c ON c.id=l.client_id WHERE l.active AND c.active AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL')).rows.filter(l=>S.inside(p,l));
   const detected=locs.length===1?locs[0]:null;
   await c.query(`INSERT INTO care_work_presence(employee_id,session_id,employee,lat,lng,accuracy,location_id,captured_at,sharing) VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE) ON CONFLICT(employee_id) DO UPDATE SET session_id=EXCLUDED.session_id,employee=EXCLUDED.employee,lat=EXCLUDED.lat,lng=EXCLUDED.lng,accuracy=EXCLUDED.accuracy,location_id=EXCLUDED.location_id,captured_at=EXCLUDED.captured_at,received_at=NOW(),sharing=TRUE WHERE care_work_presence.captured_at<=EXCLUDED.captured_at`,[req.workUser.id,session.id,req.workUser.name,p.lat,p.lng,p.accuracy,detected?.id||null,p.capturedAt]);
   return detected?.name||null;
  });res.json({ok:true,detectedLocation:result,unitDetected:false});
 }));
 router.delete('/presence',S.route(async(req,res)=>{await query('DELETE FROM care_work_presence WHERE employee_id=$1',[req.workUser.id]);res.json({ok:true});}));
 router.get('/review',S.route(async(req,res)=>{
  if(!S.manager(req.workUser))S.fail('Solo administración.',403);const date=S.day(req.query.date||S.localDay(now()));
  const r=await query(`SELECT * FROM care_clock_sessions WHERE (clock_in AT TIME ZONE 'America/Chicago')::date=$1::date OR clock_out IS NULL ORDER BY clock_in DESC LIMIT 200`,[date]);res.json({ok:true,sessions:r.rows.map(publicSession)});
 }));
 router.patch('/:id/close',S.route(async(req,res)=>{
  if(!S.manager(req.workUser))S.fail('Solo administración.',403);const note=S.text(req.body.note),out=new Date(req.body.clockOut);
  if(!note||!Number.isFinite(out.getTime())||out>now())S.fail('Escribe una salida válida y el motivo.');
  const row=await S.transaction(pool(),async c=>{
   const old=(await c.query('SELECT * FROM care_clock_sessions WHERE id=$1 FOR UPDATE',[S.uuid(req.params.id)])).rows[0];if(!old)S.fail('Turno no encontrado.',404);
   if(old.clock_out||old.version!==req.body.version)S.fail('El turno cambió o ya tiene salida. Actualiza.',409);if(out<new Date(old.clock_in))S.fail('La salida no puede ser anterior a la entrada.');
   if((await c.query(`SELECT 1 FROM payroll_weeks WHERE status='closed' AND week_start<=($2::timestamptz AT TIME ZONE 'America/Chicago')::date AND week_end>=($1::timestamptz AT TIME ZONE 'America/Chicago')::date`,[old.clock_in,out.toISOString()])).rows.length)S.fail('Reabre la semana antes de corregir el turno.',409);
   const r=(await c.query('UPDATE care_clock_sessions SET clock_out=$1,out_gps=$2::jsonb,out_request=$3,version=version+1,updated_at=NOW(),mirror_next_at=NOW() WHERE id=$4 RETURNING *',[out.toISOString(),JSON.stringify({manual:true,actor:req.workUser.name,note}),randomUUID(),old.id])).rows[0];
   await c.query('DELETE FROM care_work_presence WHERE employee_id=$1',[old.employee_id]);
   await c.query("INSERT INTO care_directory_audit(actor,action,entity_id,detail) VALUES($1,'clock_manual_out',$2,$3::jsonb)",[req.workUser.name,old.id,JSON.stringify({note,clockOut:out.toISOString()})]);return r;
  });res.json({ok:true,session:publicSession(row)});
 }));
 router.patch('/:id/rate',S.route(async(req,res)=>{
  if(!S.manager(req.workUser))S.fail('Solo administración.',403);const rate=Number(req.body.hourlyRate),note=S.text(req.body.note),mode=req.body.payMode;if(mode!==undefined&&!['hourly','attendance'].includes(mode))S.fail('Modalidad inválida.');if(!note||!Number.isFinite(rate)||rate<0||(rate===0&&mode!=='attendance')||rate>100000||Math.abs(rate*100-Math.round(rate*100))>0.00001)S.fail('Escribe una tarifa válida y el motivo.');
  const row=await S.transaction(pool(),async c=>{
   const old=(await c.query('SELECT * FROM care_clock_sessions WHERE id=$1 FOR UPDATE',[S.uuid(req.params.id)])).rows[0];if(!old)S.fail('Turno no encontrado.',404);if(old.version!==req.body.version)S.fail('El turno cambió. Actualiza.',409);
   if((await c.query(`SELECT 1 FROM payroll_weeks WHERE status='closed' AND week_start<=COALESCE(($2::timestamptz AT TIME ZONE 'America/Chicago')::date,CURRENT_DATE) AND week_end>=($1::timestamptz AT TIME ZONE 'America/Chicago')::date`,[old.clock_in,old.clock_out])).rows.length)S.fail('Reabre la semana de nómina antes de cambiar este turno.',409);
   const r=(await c.query('UPDATE care_clock_sessions SET rate_cents=$1,rate_note=$2,pay_mode=COALESCE($4,pay_mode),version=version+1,updated_at=NOW(),mirror_next_at=NOW() WHERE id=$3 RETURNING *',[Math.round(rate*100),note,old.id,mode||null])).rows[0];
   await c.query("INSERT INTO care_directory_audit(actor,action,entity_id,detail) VALUES($1,'clock_rate_reviewed',$2,$3::jsonb)",[req.workUser.name,old.id,JSON.stringify({note,oldRate:old.rate_cents,newRate:r.rate_cents,oldMode:old.pay_mode,newMode:r.pay_mode})]);return r;
  });res.json({ok:true,session:publicSession(row)});
 }));
 router.get('/team',S.route(async(req,res)=>{
  if(!S.manager(req.workUser))S.fail('Solo administración.',403);
  await query("DELETE FROM care_work_presence WHERE received_at<NOW()-INTERVAL '24 hours'");
  const r=await query(`SELECT p.employee,p.lat,p.lng,p.accuracy,p.captured_at,p.received_at,l.name AS location_name FROM care_work_presence p JOIN care_clock_sessions s ON s.id=p.session_id LEFT JOIN care_locations l ON l.id=p.location_id WHERE s.clock_out IS NULL AND p.sharing AND p.received_at>NOW()-INTERVAL '15 minutes' AND s.clock_in>NOW()-INTERVAL '18 hours' ORDER BY p.employee`);res.json({ok:true,positions:r.rows});
 }));
 return router;
}
module.exports={createClockRouter,splitClock,localClockPayroll,publicSession};
