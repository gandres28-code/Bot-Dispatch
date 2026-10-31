'use strict';
const exitChecklistData=require('../public/js/exit-checklist-data');
const deepChecklistData=require('../public/js/deep-clean-checklist-data');
const CLEANER = new Set(['START','DONE','ISSUE','SUPPLIES','LOST_FOUND']);
const INSPECTOR = new Set(['INSPECTION_START','READY_GUEST','INSPECTION_REPORT','INSPECTION_SUPPLIES','PRE_INSPECTION_START','PRE_INSPECTION_COMPLETE','LOST_FOUND']);
function createActionHandler({engine,kind,today,afterCommit=()=>{}}) {
 return async(req,res)=>{
  try {
   const b=req.body||{},action=String(b.action||'').trim().toUpperCase(),unit=String(b.unit||'').trim(),name=String(b.name||'').trim();
   if(!(kind==='cleaner'?CLEANER:INSPECTOR).has(action)||!unit||!name) return res.status(400).json({success:false,retryable:false,message:'Revisa la acción, la unidad y el nombre.'});
   if(/REPORT|SUPPLIES|ISSUE|LOST_FOUND/.test(action)&&!String(b.note||'').trim())return res.status(400).json({success:false,retryable:false,message:'Debes escribir una nota.'});
   if(b.workDate && b.workDate!==today())return res.status(409).json({success:false,retryable:false,message:'Esta acción pertenece a un turno anterior. Revisa el pendiente con tu encargado.'});
   if(b.occurredAt && (!Number.isFinite(Date.parse(b.occurredAt)) || Date.parse(b.occurredAt)>Date.now()+300000))return res.status(400).json({success:false,retryable:false,message:'Revisa la fecha y hora del dispositivo antes de reenviar.'});
   let exitChecklist;
   if(kind==='cleaner'&&action==='DONE'){
    const c=b.exitChecklist,data=c?.version===deepChecklistData.version?deepChecklistData:exitChecklistData,ids=data.items.map(x=>x.id);
    const na=c?.notApplicable===undefined?[]:c.notApplicable;
    const checked=Array.isArray(c?.checked)?c.checked:[];
    const validNA=Array.isArray(na)&&na.every(x=>x&&typeof x.id==='string'&&typeof x.reason==='string'&&x.reason.trim().length>0&&x.reason.length<=300);
    const all=validNA?[...checked,...na.map(x=>x.id)]:[];
    if(!c||c.version!==data.version||!Array.isArray(c.checked)||!validNA||(data===exitChecklistData&&na.length)||all.length!==ids.length||new Set(all).size!==ids.length||!ids.every(id=>all.includes(id)))return res.status(400).json({success:false,retryable:false,message:'Completa los '+ids.length+' puntos del checklist antes de terminar la unidad.'});
    exitChecklist={version:data.version,checked,notApplicable:na.map(x=>({id:x.id,reason:x.reason.trim()})),items:data.items,recordedAt:new Date().toISOString()};
   }
   const input={exitChecklist,action,unit,name,note:b.note||'',photoUrl:b.photoUrl||'',eventId:b.eventId||'',requestId:b.requestId||'',workDate:today(),occurredAt:b.occurredAt};
   const result=kind==='cleaner'?await engine.handleCleanerAction({...input,cleaner:name}):await engine.handleInspectorAction({...input,inspector:name});
   // Only a committed transaction is acknowledged. No in-memory fallback or guessed success.
   res.json({success:true,ok:true,source:'postgres',postgresUpdated:true,notionSync:'queued',duplicate:Boolean(result?.duplicate),eventId:result?.eventId||'',status:result?.status||'',message:`Guardado en Care OS · ${unit}`});
   if(!result?.duplicate)setImmediate(()=>Promise.resolve().then(()=>afterCommit({action,unit,name})).catch(e=>console.error('ACTION FOLLOW-UP:',e.message)));
  }catch(error){
   const permanent=error.status||(/no existe en PostgreSQL|no soportada|obligatorios|fecha|turno|más reciente/.test(error.message)?409:0);
   console.error('OPERATIONAL ACTION:',error.message);
   res.status(permanent||503).json({success:false,retryable:!permanent,message:permanent?error.message:'No se confirmó el guardado. La acción puede reintentarse con el mismo identificador.'});
  }
 };
}
module.exports={createActionHandler};
