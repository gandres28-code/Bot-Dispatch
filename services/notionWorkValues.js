'use strict';
const S=require('./workSupport');
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
const pageId=v=>String(v||'').replace(/-/g,'').toLowerCase();
function field(p,names){const keys=Object.keys(p||{});for(const name of names){const key=keys.find(k=>norm(k)===norm(name));if(key)return p[key];}return null;}
function text(p){if(!p)return'';if(p.formula){if(p.formula.string!=null)return p.formula.string;if(p.formula.number!=null)return String(p.formula.number);}if(p.rollup){if(p.rollup.number!=null)return String(p.rollup.number);if(p.rollup.array)return p.rollup.array.map(text).filter(Boolean).join(' / ');}if(p.title||p.rich_text)return(p.title||p.rich_text).map(x=>x.plain_text??x.text?.content??'').join('').trim();if(p.select||p.status)return(p.select||p.status).name||'';if(p.multi_select)return p.multi_select.map(x=>x.name).join(' / ');if(p.people)return p.people.map(x=>x.name||'').join(' / ');if(p.number!=null)return String(p.number);if(p.email)return p.email;if(p.phone_number)return p.phone_number;return'';}
const read=(props,names)=>text(field(props,names));
function number(props,names){const p=field(props,names);if(!p)return null;const v=p.number??p.formula?.number??p.rollup?.number;if(v==null)return null;if(!Number.isFinite(v)||v<0)S.fail('Revisa el importe en Notion.');return v;}
function amount(props,names){const v=number(props,names);if(v==null)return null;if(v>1000000||Math.abs(v*100-Math.round(v*100))>0.00001)S.fail('Los importes en Notion necesitan dólares y centavos.');return Math.round(v*100);}
const bool=(p,names,fallback=false)=>{const x=field(p,names);return typeof x?.checkbox==='boolean'?x.checkbox:fallback;};
const date=(p,names)=>{const x=field(p,names);return x?.date?.start||x?.formula?.date?.start||null;};
const title=p=>text(Object.values(p||{}).find(x=>x.type==='title'||x.title));
function relations(props,names){const p=field(props,names);if(p?.has_more)S.fail('La relación de Notion está incompleta; reduce la selección o revisa su configuración.');return(p?.relation||[]).map(x=>pageId(x.id));}
function service(v){const t=norm(v).replace(/[-_]/g,' ');if(!t||['regular','departure','departure regular','limpieza regular','normal'].includes(t))return'regular';if(['deep','deep clean','limpieza profunda'].includes(t))return'deep';if(['touch up','touch ups','retoque','retoques'].includes(t))return'touch_up';S.fail('Tipo de limpieza no reconocido en Notion: '+v);}
function status(v){const s=norm(v);if(!s||['pending','not started','sin iniciar','pendiente','assigned','asignada','central'].includes(s))return'pending';if(/cancel/.test(s))return'cancelled';if(/ready|lista para huesped|completad|completed|^complete$/.test(s))return'ready';if(/inspection started|en inspeccion|inspecting/.test(s))return'inspecting';if(/cleaned|awaiting|terminad|para inspeccionar/.test(s))return'awaiting_inspection';if(/progress|started|cleaning|limpiando|en limpieza/.test(s))return'cleaning';S.fail('Estado de limpieza no reconocido en Notion: '+v);}
function employeeIds(props,names,employees){const p=field(props,names);if(!p)return[];const rel=relations(props,names),active=employees.filter(e=>e.active);
 if(rel.length)return rel.map(id=>{const e=active.find(x=>pageId(x.id)===id);if(!e)S.fail('Una persona asignada en Notion no está activa en Employees.');return e.id;});
 const raw=text(p);if(!raw)return[];const exact=active.filter(e=>norm(e.name)===norm(raw));if(exact.length===1)return[exact[0].id];
 const namesList=raw.split(/\s+(?:and|y)\s+|\s*[&|,;\n/]\s*/i).map(x=>x.trim()).filter(Boolean),ids=[];
 for(const name of namesList){const matches=active.filter(e=>norm(e.name)===norm(name));if(matches.length!==1)S.fail('Revisa el empleado «'+name+'» en Notion: usa un nombre único o relación con Employees.');ids.push(matches[0].id);}
 return[...new Set(ids)];
}
const hotelName=v=>['hotel','still waters','still waters resort','stillwaters','stillwaters resort'].includes(norm(v));
function defaultHotel(page){const p=page.properties||{};if(relations(p,['Unidad','Unit']).length||relations(p,['Localidad','Location','Property','Hotel']).length)return false;const location=read(p,['Localidad','Location','Property','Hotel','Resort']);const client=read(p,['Cliente','Client','Customer']);return(!location||hotelName(location))&&(!client||hotelName(client))&&!/chateau/i.test(title(p));}
function excludeManagedNotion(records,jobs){const key=(id,date)=>pageId(id)+'|'+S.dateKey(date),managed=new Set(jobs.map(j=>key(j.notion_page_id,j.work_date)));return records.filter(r=>!r.sourcePageId||!managed.has(key(r.sourcePageId,r.workDate||r.date)));}
module.exports={excludeManagedNotion,norm,pageId,field,text,read,number,amount,bool,date,title,relations,service,status,employeeIds,hotelName,defaultHotel};
