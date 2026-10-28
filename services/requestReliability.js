'use strict';
const {randomUUID}=require('node:crypto');
const ACTIVE=['new','accepted','in_progress','delivered'];
const NEXT={new:'accepted',accepted:'in_progress',in_progress:'delivered',delivered:'completed'};
function error(message,status=400){const e=new Error(message);e.status=status;throw e;}
function input(body){
 const room=String(body.room||'').trim().toUpperCase().slice(0,80),requestedBy=String(body.requestedBy||'').trim().slice(0,120);
 const items=Array.isArray(body.items)?body.items.map(i=>({name:String(i.name||'').trim().slice(0,200),quantity:Number(i.quantity)})):[];
 if(!room||!items.length||items.length>100||items.some(i=>!i.name||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>100))error('Selecciona una unidad y cantidades enteras entre 1 y 100.');
 const requestId=String(body.requestId||randomUUID());if(!/^[A-Za-z0-9_-]{8,120}$/.test(requestId))error('Identificador de solicitud inválido.');
 const scheduled=body.scheduledFor?new Date(body.scheduledFor):null;if(scheduled&&Number.isNaN(scheduled.getTime()))error('Fecha de entrega inválida.');
 return {room,requestedBy,items,requestId,category:String(body.category||'Other').slice(0,80),priority:['normal','high','urgent'].includes(body.priority)?body.priority:'normal',assignedTo:String(body.assignedTo||'Runner').trim().slice(0,120),notes:String(body.notes||'').slice(0,4000),scheduledFor:scheduled?.toISOString()||null};
}
function createRequestHandlers({pool,emit=()=>{},onCreated=()=>{}}){
 async function transaction(fn){let client;try{client=await pool().connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout = '1500ms'");await client.query("SET LOCAL statement_timeout = '5000ms'");const result=await fn(client);await client.query('COMMIT');return result;}catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client?.release();}}
 function respondError(res,e){console.error('REQUEST WRITE:',e.message);res.status(e.status||503).json({ok:false,retryable:!e.status,error:e.status?e.message:'No se confirmó la solicitud. Reintenta con el mismo identificador.'});}
 return {
  create:async(req,res)=>{try{
   const v=input(req.body||{});
   const result=await transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[v.requestId]);
    const existing=(await client.query('SELECT * FROM service_orders WHERE request_id=$1',[v.requestId])).rows[0];
    if(existing){if(existing.room!==v.room||existing.requested_by!==v.requestedBy||JSON.stringify(existing.items)!==JSON.stringify(v.items))error('El identificador ya corresponde a otra solicitud.',409);return {order:existing,duplicate:true};}
    const created=await client.query(`INSERT INTO service_orders (room,category,items,priority,assigned_to,requested_by,notes,scheduled_for,request_id) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) RETURNING *`,[v.room,v.category,JSON.stringify(v.items),v.priority,v.assignedTo,v.requestedBy,v.notes,v.scheduledFor,v.requestId]);
    const order=created.rows[0];await client.query("INSERT INTO service_order_events(order_id,event_type,actor,note) VALUES ($1,'created',$2,$3)",[order.id,v.requestedBy,v.notes]);return {order,duplicate:false};
   });
   res.status(result.duplicate?200:201).json({ok:true,...result});
   if(!result.duplicate){emit('service-order:created',result.order);setImmediate(()=>Promise.resolve().then(()=>onCreated(result.order)).catch(e=>console.error('REQUEST FOLLOW-UP:',e.message)));}
  }catch(e){respondError(res,e);}},
  status:async(req,res)=>{try{
   const id=String(req.params.id),status=String(req.body.status||''),actor=String(req.body.actor||'').trim().slice(0,120),note=String(req.body.note||'').slice(0,2000);
   if(!/^\d+$/.test(id)||!['accepted','in_progress','delivered','completed','cancelled'].includes(status))error('Orden o estado inválido.');
   const result=await transaction(async client=>{
    const order=(await client.query('SELECT * FROM service_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!order)error('Orden no encontrada.',404);
    if(order.status===status)return {order,duplicate:true};
    if(!(NEXT[order.status]===status||(status==='cancelled'&&ACTIVE.includes(order.status))))error('La orden cambió. Actualiza antes de continuar.',409);
    const stamp={accepted:'accepted_at',in_progress:'started_at',delivered:'delivered_at',completed:'completed_at'}[status];
    const updated=await client.query(`UPDATE service_orders SET status=$1,updated_at=NOW()${stamp?`, ${stamp}=COALESCE(${stamp},NOW())`:''},assigned_to=CASE WHEN $1='accepted' AND assigned_to IN ('','Runner','Unassigned') AND $3<>'' THEN $3 ELSE assigned_to END WHERE id=$2 RETURNING *`,[status,id,actor]);
    await client.query('INSERT INTO service_order_events(order_id,event_type,actor,note) VALUES ($1,$2,$3,$4)',[id,status,actor,note]);return {order:updated.rows[0],duplicate:false};
   });res.json({ok:true,...result});if(!result.duplicate)emit('service-order:updated',result.order);
  }catch(e){respondError(res,e);}}
 };
}
module.exports={createRequestHandlers,input};
