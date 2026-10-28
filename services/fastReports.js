'use strict';
const {randomUUID}=require('node:crypto');
function createFastReportHandler({pool,uploadPhoto,emit=()=>{},today,normalizeUnit=value=>value.toUpperCase().replace(/[^A-Z0-9]/g,'')}){
 return async(req,res)=>{let client;try{
  const b=req.body||{},unit=String(b.unit||'').trim(),employee=String(b.employee||b.name||'').trim(),message=String(b.message||b.note||'').trim();
  if(!unit||!employee||!message)return res.status(400).json({ok:false,success:false,retryable:false,message:'Escribe la unidad, tu nombre y el mensaje.'});
  const requestId=String(b.requestId||randomUUID());if(!/^[A-Za-z0-9_-]{8,120}$/.test(requestId))return res.status(400).json({ok:false,retryable:false,message:'Solicitud inválida.'});
  if(b.workDate&&b.workDate!==today())return res.status(409).json({ok:false,retryable:false,message:'Revisa este mensaje del turno anterior con tu encargado.'});
  const reportId='RPT-'+requestId,key='report:'+requestId;
  const photoUrls=[];const files=req.files||[];
  // Upload independent photos concurrently in small batches. AI and Notion are never on the response path.
  for(let i=0;i<files.length;i+=3)photoUrls.push(...await Promise.all(files.slice(i,i+3).map(file=>uploadPhoto(file,unit))));
  client=await pool().connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='1500ms'");await client.query("SET LOCAL statement_timeout='5000ms'");
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
  const existing=await client.query('SELECT payload FROM sync_queue WHERE dedupe_key=$1',[key]);
  if(existing.rows[0]){await client.query('COMMIT');return res.json({ok:true,success:true,duplicate:true,reportId,photosCount:existing.rows[0].payload.photoUrls?.length||0,message:'Mensaje guardado en Care OS'});}
  const payload={reportId,unit,employee,role:String(b.role||'Cleaner'),action:String(b.action||'GENERAL_REPORT'),message,photoUrls,sourcePanel:String(b.sourcePanel||b.role||'Cleaner'),workDate:today()};
  await client.query(`INSERT INTO sync_queue(job_type,destination,dedupe_key,payload,status,priority) VALUES ('notion-report-create','notion',$1,$2::jsonb,'pending',60)`,[key,JSON.stringify(payload)]);
  await client.query(`INSERT INTO operations_logs(external_event_id,work_date,event_time,unit,normalized_room,action,employee,role_worked,note,photo_url,category,priority,source) VALUES ($1,$2::date,NOW(),$3,$4,$5,$6,$7,$8,$9,'General Message','Normal','care-report') ON CONFLICT(external_event_id) WHERE external_event_id IS NOT NULL AND external_event_id<>'' DO NOTHING`,[key,today(),unit,normalizeUnit(unit),payload.action,employee,payload.role,message,photoUrls[0]||'']);
  await client.query('COMMIT');client.release();client=null;
  res.json({ok:true,success:true,reportId,photosCount:photoUrls.length,photoUrls,message:'Mensaje guardado en Care OS',externalSync:'queued'});
  emit({type:'report',unit,employee,reportId});
 }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});console.error('FAST REPORT:',error.message);if(!res.headersSent)res.status(503).json({ok:false,success:false,retryable:true,message:'No se confirmó el mensaje. Reintenta con el mismo identificador.'});}finally{client?.release();}}
}
module.exports={createFastReportHandler};
