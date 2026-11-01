'use strict';
const V=require('./notionWorkValues');
function createNotionWorkMirror(source){
 const {notion,query,pool,databaseId,logDatabaseId}=source;let running=false;
 const names={pending:'Pending',cleaning:'In Progress',awaiting_inspection:'Cleaned - Awaiting Inspection',inspecting:'Inspection Started',ready:'Ready for Guest',cancelled:'Cancelled'};
 function key(defs,aliases){return Object.keys(defs).find(k=>aliases.some(a=>V.norm(k)===V.norm(a)));}
 function value(def,v){if(!def)return null;const type=def.type;if(type==='title'||type==='rich_text')return{[type]:v==null?[]:[{text:{content:String(v).slice(0,1950)}}]};if(type==='date')return{date:v?{start:/^\d{4}-\d{2}-\d{2}$/.test(String(v))?String(v):new Date(v).toISOString()}:null};if(type==='checkbox')return{checkbox:!!v};if(type==='number')return{number:v==null?null:Number(v)};if(type==='select')return{select:v?{name:String(v)}:null};return null;}
 function assign(out,defs,aliases,v){const name=key(defs,aliases);if(name){const x=value(defs[name],v);if(x)out[name]=x;}}
 function status(out,defs,j){const name=key(defs,['Cleaning Status','Status','Estado']);if(!name)throw Error('Falta Cleaning Status editable en Notion.');const def=defs[name];
  if(def.type==='status'){const option=def.status.options.find(x=>{try{return V.status(x.name)===j.status;}catch{return false;}});if(!option){if(j.status==='pending')return;throw Error('Falta configurar el estado '+names[j.status]+' en Notion.');}out[name]={status:{name:option.name}};}
  else{const x=value(def,names[j.status]);if(!x)throw Error('Cleaning Status no es editable en Notion.');out[name]=x;}
 }
 async function flush(){if(running)return;running=true;let c;
  try{c=await pool().connect();await c.query('BEGIN');const lock=(await c.query('SELECT pg_try_advisory_xact_lock(170018) AS locked')).rows[0];if(!lock.locked){await c.query('COMMIT');return;}
   const jobs=(await c.query('SELECT * FROM care_work_jobs WHERE notion_page_id IS NOT NULL AND NOT needs_review AND notion_state_version>notion_mirrored_version AND notion_next_retry_at<=NOW() ORDER BY updated_at LIMIT 5')).rows;
   for(const job of jobs){try{
    const remote=await notion.pages.retrieve({page_id:job.notion_page_id});if(remote.archived||remote.in_trash)throw Error('La asignación fue archivada en Notion; revisa el turno.');
    const p=remote.properties||{},bind={unit:V.relations(p,['Unidad','Unit']),location:V.relations(p,['Localidad','Location','Property','Hotel','Resort']),client:V.relations(p,['Cliente','Client','Customer']),unitText:V.read(p,['Room Number','Unidad','Unit','Room','Name'])||V.title(p),locationText:V.read(p,['Localidad','Location','Property','Hotel','Resort']),clientText:V.read(p,['Cliente','Client','Customer'])};
    if(!require('node:util').isDeepStrictEqual(bind,job.notion_snapshot?.binding)||(V.date(p,['Date','Fecha','Work Date','Service Date'])||'').slice(0,10)!==String(job.work_date instanceof Date?job.work_date.toISOString().slice(0,10):job.work_date))throw Error('La unidad o fecha cambió en Notion. Revisa la asignación antes de sincronizar.');
    const employees=await source.listEmployees();if(!require('node:util').isDeepStrictEqual(V.employeeIds(p,['Assigned Cleaner','Cleaner','Cleaners','Limpiador','Limpiadores'],employees),job.notion_snapshot?.cleanerIds)||String(V.employeeIds(p,['Assigned Inspector','Inspector'],employees)[0]||'')!==String(job.notion_snapshot?.inspectorId||''))throw Error('El equipo cambió en Notion. Revisa la asignación antes de sincronizar.');
    const defs=await source.schema(databaseId),properties={};status(properties,defs,job);
    for(const[aliases,v]of [[['Started At','Cleaning Started At'],job.started_at],[['Finished At','Cleaning Finished At'],job.finished_at],[['Inspection Started At'],job.inspection_started_at],[['Ready At'],job.ready_at],[['Pre Inspection','Pre-Inspection','Preinspección'],job.pre_inspection],[['Pre Inspection Started'],!!job.pre_inspection_started_at],[['Pre Inspection Started At'],job.pre_inspection_started_at],[['Pre Inspection Completed At'],job.pre_inspection_completed_at]])assign(properties,defs,aliases,v);
    if(job.checklist)assign(properties,defs,['Checklist Summary','Resumen checklist'],`${job.checklist.version}: ${job.checklist.checked.length} revisados; ${job.checklist.notApplicable?.length||0} no aplican. Guardado ${job.checklist.recordedAt}.`);
    await notion.pages.update({page_id:job.notion_page_id,properties});
    await c.query("UPDATE care_work_jobs SET notion_mirrored_version=$1,notion_mirror_error='',notion_next_retry_at=NOW() WHERE id=$2",[job.notion_state_version,job.id]);
   }catch(e){await c.query("UPDATE care_work_jobs SET notion_mirror_error=$1,notion_next_retry_at=NOW()+INTERVAL '30 seconds' WHERE id=$2",[String(e.message).slice(0,600),job.id]);}}
   if(logDatabaseId){const events=(await c.query(`SELECT e.*,j.notion_page_id,j.work_date,u.name AS unit_name,l.name AS location_name,c.name AS client_name FROM care_work_events e JOIN care_work_jobs j ON j.id=e.job_id JOIN care_units u ON u.id=j.unit_id JOIN care_locations l ON l.id=u.location_id JOIN care_clients c ON c.id=l.client_id WHERE j.notion_page_id IS NOT NULL AND e.notion_log_id IS NULL AND e.notion_log_next_at<=NOW() ORDER BY e.created_at LIMIT 10`)).rows;
    if(events.length){const defs=await source.schema(logDatabaseId),titleKey=Object.keys(defs).find(k=>defs[k].type==='title');if(!titleKey)throw Error('Daily Logs necesita una propiedad de título.');
     for(const event of events){try{
      const marker='CARE-WORK:'+event.request_id,found=await notion.databases.query({database_id:logDatabaseId,page_size:2,filter:{property:titleKey,title:{contains:marker}}});if(found.results?.length>1)throw Error('El evento aparece duplicado en Daily Logs. Revisa las copias.');
      let saved=found.results?.[0];if(!saved){const props={};assign(props,defs,[titleKey],`${event.unit_name} - ${event.action} - ${marker}`);assign(props,defs,['Date','Fecha'],String(event.work_date instanceof Date?event.work_date.toISOString().slice(0,10):event.work_date));assign(props,defs,['Time','Hora'],new Date(event.created_at).toISOString());assign(props,defs,['Unit','Unidad','Room'],`${event.client_name} / ${event.location_name} / ${event.unit_name}`);assign(props,defs,['Action','Acción'],event.action);assign(props,defs,['Cleaner','Employee','Empleado'],event.actor);assign(props,defs,['Inspector'],/INSPECTION|READY|REWORK/.test(event.action)?event.actor:'');assign(props,defs,['Note','Nota','Message'],event.payload?.note||'');assign(props,defs,['Service ID','ID servicio'],event.job_id);assign(props,defs,[titleKey],`${event.client_name} / ${event.location_name} / ${event.unit_name} - ${event.action} - ${marker}`);saved=await notion.pages.create({parent:{database_id:logDatabaseId},properties:props});}
      await c.query("UPDATE care_work_events SET notion_log_id=$1,notion_log_error='' WHERE request_id=$2",[saved.id,event.request_id]);
     }catch(e){await c.query("UPDATE care_work_events SET notion_log_error=$1,notion_log_next_at=NOW()+INTERVAL '60 seconds' WHERE request_id=$2",[String(e.message).slice(0,600),event.request_id]);}}
    }
   }
   await c.query('COMMIT');
  }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});console.error('NOTION WORK MIRROR:',e.message);}finally{c?.release();running=false;}
 }
 return{flush,start(){const timer=setInterval(flush,10000);timer.unref();flush();return timer;}};
}
module.exports={createNotionWorkMirror};
