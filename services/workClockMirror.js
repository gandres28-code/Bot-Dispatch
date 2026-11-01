'use strict';
// Durable hours are committed first. Notion is a retryable mirror, never a prerequisite for payroll.
const {splitClock}=require('./workClock');
function propText(p){return p?.select?.name||p?.status?.name||[...(p?.title||[]),...(p?.rich_text||[])].map(x=>x.plain_text||x.text?.content||'').join('');}
function createClockMirror({notion,databaseId,query,pool}){
 let schemaCache=null,running=false;
 async function schema(){if(!schemaCache||schemaCache.at<Date.now()-60000)schemaCache={at:Date.now(),props:(await notion.databases.retrieve({database_id:databaseId})).properties};return schemaCache.props;}
 async function legacyActive(user){
  if(!databaseId)return null;let cursor,found=[];
  do{const r=await notion.databases.query({database_id:databaseId,page_size:100,...(cursor?{start_cursor:cursor}:{})});
   found.push(...(r.results||[]).filter(p=>{const x=p.properties||{};return propText(x.Code)===String(user.code||'')&&x['Clock In']?.date?.start&&!x['Clock Out']?.date?.start&&!Object.values(x).some(v=>propText(v).includes('CARE-CLOCK:'));}));cursor=r.has_more?r.next_cursor:null;
  }while(cursor);
  // A previously adopted legacy entry may still be open in Notion until the mirror catches up.
  if(found.length){const ids=(await query('SELECT notion_page_id FROM care_clock_sessions WHERE notion_page_id=ANY($1::text[])',[found.map(p=>p.id)])).rows.map(x=>x.notion_page_id);found=found.filter(p=>!ids.includes(p.id));}
  if(found.length>1){const e=Error('Tienes varias entradas antiguas abiertas en Notion. Administración debe revisarlas.');e.status=409;throw e;}
  const p=found[0];if(!p)return null;return{id:p.id,clockIn:p.properties['Clock In'].date.start,hourlyRate:Number(p.properties['Hourly Rate']?.number||0),workLocation:propText(p.properties['Location Status'])||'Unspecified',role:propText(p.properties.Role)};
 }
 function value(type,v){if(type==='title'||type==='rich_text')return{[type]:v?[{text:{content:String(v).slice(0,1900)}}]:[]};if(type==='select')return{select:v?{name:String(v)}:null};if(type==='date')return{date:v?{start:new Date(v).toISOString()}:null};if(type==='number'){if(v!=null&&!Number.isFinite(Number(v)))return null;return{number:v==null?null:Number(v)};}if(type==='status')return{status:v?{name:String(v)}:null};return null;}
 async function flush(){
  if(running||!databaseId)return;running=true;let c;
  try{
   c=await pool().connect();await c.query('BEGIN');const lock=(await c.query('SELECT pg_try_advisory_xact_lock(150016) AS locked')).rows[0];if(!lock.locked){await c.query('COMMIT');return;}
   const rows=(await c.query('SELECT * FROM care_clock_sessions WHERE mirror_version<version AND mirror_next_at<=NOW() ORDER BY clock_in LIMIT 5')).rows;
   if(!rows.length){await c.query('COMMIT');return;}
   const defs=await schema(),title=Object.keys(defs).find(k=>defs[k].type==='title');
   if(!title||defs['Clock In']?.type!=='date'||defs['Clock Out']?.type!=='date')throw Error('Notion Time Clock necesita título, Clock In y Clock Out (Date).');
   for(const row of rows){try{
    const marker='CARE-CLOCK:'+row.id;let pageId=row.notion_page_id;
    if(!pageId){const r=await notion.databases.query({database_id:databaseId,page_size:2,filter:{property:title,title:{contains:marker}}});if(r.results?.length>1)throw Error('Hay copias duplicadas en Notion; requiere revisión.');pageId=r.results?.[0]?.id;}
    const parts=splitClock(row),hours=parts.reduce((a,p)=>a+p.hours,0),total=parts.reduce((a,p)=>a+p.total,0);
    const raw={[title]:`${row.employee} · ${marker}`,Employee:row.employee,Code:row.employee_code,Role:row.role,'Hourly Rate':row.rate_cents/100,'Clock In':row.clock_in,'Clock Out':row.clock_out,Hours:Math.round(hours*10000)/10000,Total:total,Status:row.clock_out?'Completed':'Working','Location Status':row.work_location,
     'Clock In Lat':row.in_gps?.lat,'Clock In Lng':row.in_gps?.lng,'Clock In Accuracy':row.in_gps?.accuracy,'Clock Out Lat':row.out_gps?.lat,'Clock Out Lng':row.out_gps?.lng,'Clock Out Accuracy':row.out_gps?.accuracy};
    raw[title]=`${row.employee} · ${marker}`;
    const properties={};for(const[k,v]of Object.entries(raw)){if(v===undefined||!defs[k])continue;const x=value(defs[k].type,v);if(x)properties[k]=x;}
    const saved=pageId?await notion.pages.update({page_id:pageId,properties}):await notion.pages.create({parent:{database_id:databaseId},properties});
    // Optimistic version: a newer Clock Out/rate adjustment remains pending for the next pass.
    await c.query('UPDATE care_clock_sessions SET notion_page_id=$1,mirror_version=$2,mirror_error=\'\',mirror_next_at=NOW() WHERE id=$3',[saved.id,row.version,row.id]);
   }catch(e){await c.query("UPDATE care_clock_sessions SET mirror_error=$1,mirror_next_at=NOW()+INTERVAL '60 seconds' WHERE id=$2",[String(e.message).slice(0,500),row.id]);}}
   await c.query('COMMIT');
  }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});console.error('CLOCK MIRROR:',e.message);}finally{c?.release();running=false;}
 }
 const start=()=>{const timer=setInterval(()=>flush(),20000);timer.unref();flush();return timer;};
 return{legacyActive,flush,start};
}
module.exports={createClockMirror};
