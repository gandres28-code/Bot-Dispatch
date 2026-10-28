'use strict';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const labels = {pending:'Pendiente',inProgress:'En limpieza',awaitingInspection:'Para inspeccionar',inspection:'En inspección',ready:'Lista para huésped',in_progress:'En curso',done:'Terminado',new:'Nueva',accepted:'Aceptada',delivered:'Entregada',completed:'Completada',cancelled:'Cancelada',normal:'Normal',high:'Alta',urgent:'Urgente'};
let state = null, view = 'overview', busy = false, sequence = 0, taskRequestId = null;
const code = () => localStorage.getItem('employeeCode') || '';
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
$('date').value = today();
const pill = key => `<span class="pill ${escapeHTML(key)}">${escapeHTML(labels[key] || key || 'Sin estado')}</span>`;
const localTime = value => value ? new Date(value).toLocaleString('es-MX',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Sin límite';
const empty = text => `<div class="empty">${escapeHTML(text)}</div>`;
const buttonLink = (url,text) => `<a class="button" href="${url}">${text}</a>`;
async function api(path,options={}) {
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),20000);
  try {
    const response = await fetch('/api/control-center'+path,{...options,cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json','X-Care-Code':code(),...(options.headers||{})}});
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo completar la operación.');
    return data;
  } finally {clearTimeout(timer);}
}
function notice(text='') { $('message').textContent = text; }
async function load() {
  if (busy) return;
  if (!code()) { $('content').innerHTML=empty('Inicia sesión en Care OS para ver este centro.'); notice('No hay una sesión activa.'); $('identity').innerHTML='<a href="/launch">Iniciar sesión</a>'; return; }
  const current = ++sequence;
  $('refresh').disabled=true; $('content').setAttribute('aria-busy','true');
  try {
    const data=await api('/day?date='+encodeURIComponent($('date').value));
    if(current!==sequence)return;
    state=data; notice(); $('identity').textContent=`${data.user.name} · ${data.user.role} · Hora del resort: Chicago`;
    $('employees').innerHTML=data.employees.map(e=>`<option value="${escapeHTML(e.name)}">${escapeHTML(e.role)}</option>`).join('');
    $('updated').textContent='Datos actualizados: '+localTime(data.updatedAt); render();
  } catch(error) { notice(error.name==='AbortError'?'La conexión tardó demasiado. Actualiza para intentar nuevamente.':error.message); if(!state)$('content').innerHTML=empty('Sin datos disponibles. No se muestran cifras de ejemplo.'); }
  finally { $('refresh').disabled=false; $('content').setAttribute('aria-busy','false'); }
}
function show(next) {view=next; document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view)); $('title').textContent=document.querySelector(`[data-view="${view}"] span`)?.textContent || 'Centro de Control'; render();}
function overview() {
  const s=state.summary, shift=state.shift.settings || {};
  const alerts=[s.unassigned&&`${s.unassigned} unidades sin cleaner asignado`,s.arrivalsPending&&`${s.arrivalsPending} llegadas todavía sin READY`,s.unassignedOrders&&`${s.unassignedOrders} solicitudes sin una persona asignada`,s.overdueTasks&&`${s.overdueTasks} pendientes vencidos`,s.urgentOrders&&`${s.urgentOrders} solicitudes urgentes abiertas`].filter(Boolean);
  return `<section class="hero"><div><p class="eyebrow">RESPONSABILIDAD DEL TURNO</p><strong>${escapeHTML(shift.operations || 'Falta asignar encargado')}</strong><p>Suplente: ${escapeHTML(shift.backup || 'Sin asignar')} · Inspección: ${escapeHTML(shift.inspection || 'Sin asignar')}</p></div><button data-go="shift">Organizar el turno →</button></section>
    <div class="stats">${[[s.ready+'/'+s.total,'Unidades listas'],[s.awaitingInspection,'En cola de inspección'],[s.openOrders,'Solicitudes abiertas'],[s.openTasks,'Pendientes del turno']].map(([n,t])=>`<div class="stat"><span>${t}</span><strong>${n}</strong></div>`).join('')}</div>
    <div class="columns"><section class="panel"><div class="panel-head"><h2>Requiere atención</h2><span class="pill">${alerts.length} señales</span></div>${alerts.length?alerts.map(a=>`<div class="notice">${escapeHTML(a)}</div>`).join(''):'<div class="notice success">Sin alertas según los registros cargados.</div>'}<p class="muted">Las llegadas pendientes indican trabajo restante; no son una predicción de retraso. Las solicitudes incluyen órdenes abiertas de días anteriores.</p><div class="actions"><button data-go="rooms">Ver habitaciones</button>${buttonLink('/requests','Abrir Solicitudes')}</div></section>
    <section class="panel"><div class="panel-head"><h2>Próximos pendientes</h2><button data-new-task>＋</button></div>${taskRows(state.tasks.filter(t=>t.status!=='done').sort((a,b)=>(Date.parse(a.due_at)||Infinity)-(Date.parse(b.due_at)||Infinity)).slice(0,5))}</section></div>
    <section class="panel"><h2>Relevo del turno</h2><p>${escapeHTML(shift.handoff || 'Registra lo que el siguiente encargado necesita saber.')}</p><p class="muted">${state.shift.status==='reviewed'?'Relevo revisado':'Relevo pendiente de revisión'} · Revisar el relevo no libera habitaciones ni cierra nómina.</p></section>`;
}
function rooms(inspection=false) {
  return `<section class="panel"><div class="panel-head"><div><h2>${inspection?'Cola de inspección':'Habitaciones del turno'}</h2><p class="muted">DONE pasa a inspección. Solo READY indica autorización para el huésped.</p></div>${buttonLink(inspection?'/inspector':'/rooms-manager',inspection?'Abrir inspector':'Editar asignaciones')}</div><div class="filter"><input id="searchRooms" placeholder="Buscar unidad, edificio o persona" aria-label="Buscar habitaciones"><select id="roomFilter" aria-label="Estado"><option value="all">Todos los estados</option>${Object.entries(labels).filter(([k])=>['pending','inProgress','awaitingInspection','inspection','ready'].includes(k)).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><div id="roomResults"></div></section>`;
}
function renderRoomRows() {
  if(!state||!$('roomResults'))return;
  const q=$('searchRooms').value.toLowerCase(), filter=$('roomFilter').value;
  const rows=state.rooms.filter(r=>(view!=='inspections'||['awaitingInspection','inspection'].includes(r.statusGroup))&&(filter==='all'||r.statusGroup===filter)&&[r.unit,r.building,r.assignedCleaner,r.assignedInspector].join(' ').toLowerCase().includes(q));
  $('roomResults').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>Unidad</th><th>Edificio</th><th>Prioridad</th><th>Cleaner</th><th>Inspector</th><th>Estado</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHTML(r.unit)}</td><td>${escapeHTML(r.building)}</td><td>${r.urgent?pill('urgent'):r.arrival?'<span class="pill high">Llegada</span>':'—'}</td><td>${escapeHTML(r.assignedCleaner || r.assignedCleaners?.join(', ') || 'Sin asignar')}</td><td>${escapeHTML(r.assignedInspector || r.assignedInspectors?.join(', ') || 'Sin asignar')}</td><td>${pill(r.statusGroup)}</td></tr>`).join('')}</tbody></table></div>`:empty('No hay unidades en este filtro.');
}
function requests() {
  const orders=state.orders.filter(o=>!['completed','cancelled'].includes(o.status));
  return `<section class="hero"><div><p class="eyebrow">UNA SOLA BANDEJA</p><strong>Solicitudes de habitaciones</strong><p>Selecciona artículos, atiende problemas y sigue las entregas en un solo apartado.</p></div>${buttonLink('/requests','Abrir Solicitudes →')}</section><section class="panel"><h2>Delegación del encargado</h2><p class="muted">Aquí puedes asignar una persona concreta y registrar el ticket externo. Registrar un número no envía nada a HotSOS.</p>${orders.length?`<div class="table-wrap"><table><thead><tr><th>Orden / unidad</th><th>Estado</th><th>Responsable</th><th>Ticket HotSOS</th><th></th></tr></thead><tbody>${orders.map(o=>`<tr data-order="${o.id}"><td>#${o.id} · ${escapeHTML(o.room)}<p class="muted">${escapeHTML(o.category)} · ${escapeHTML(localTime(o.created_at))}</p></td><td>${pill(o.status)} ${pill(o.priority)}</td><td><input class="owner" list="employees" value="${escapeHTML(o.assigned_to)}" aria-label="Responsable de orden ${o.id}" maxlength="120"></td><td><input class="ticket" value="${escapeHTML(o.hotsos_ticket)}" aria-label="Ticket HotSOS de orden ${o.id}" maxlength="120"></td><td><button data-delegate="${o.id}">Guardar</button></td></tr>`).join('')}</tbody></table></div>`:empty('Sin solicitudes abiertas.')}</section>`;
}
function taskRows(tasks) {return tasks.length?tasks.map(t=>`<div class="listrow"><div><strong>${escapeHTML(t.title)}</strong><p>${escapeHTML(t.owner)}${t.work_date&&String(t.work_date).slice(0,10)!==state.date?' · Turno anterior':''}${t.room?' · '+escapeHTML(t.room):''}</p><p class="${t.status!=='done'&&t.due_at&&Date.parse(t.due_at)<Date.now()?'overdue':''}">${escapeHTML(localTime(t.due_at))}</p>${t.note?`<p>${escapeHTML(t.note)}</p>`:''}${pill(t.priority)}</div><div>${pill(t.status)}<p><button data-task="${t.id}" data-status="${t.status==='pending'?'in_progress':t.status==='in_progress'?'done':'pending'}">${t.status==='pending'?'Comenzar':t.status==='in_progress'?'Terminar':'Reabrir'}</button></p></div></div>`).join(''):empty('No hay pendientes registrados.');}
function tasks() {return `<section class="panel"><div class="panel-head"><div><h2>Pendientes con responsable</h2><p class="muted">Seguimiento del turno. Las entregas de artículos se gestionan en Solicitudes.</p></div><button class="primary" data-new-task>＋ Nuevo pendiente</button></div>${taskRows(state.tasks)}</section>`;}
function shift() {
  const settings=state.shift.settings||{};
  return `<section class="panel"><div class="panel-head"><h2>Responsables y relevo</h2>${pill(state.shift.status==='reviewed'?'Revisado':'Abierto')}</div><form id="shiftForm"><div class="formgrid">${[['operations','Encargado de operaciones'],['backup','Suplente del encargado'],['inspection','Inspector líder'],['supplies','Coordinador de suministros'],['admin','Administrativo']].map(([key,label])=>`<label>${label}<input name="${key}" list="employees" maxlength="120" value="${escapeHTML(settings[key])}" ${['operations','backup'].includes(key)?'required':''}></label>`).join('')}</div><label>Pendientes e instrucciones para el siguiente turno<textarea name="handoff" maxlength="3000">${escapeHTML(settings.handoff)}</textarea></label><p class="muted">Este registro identifica responsables; los permisos se administran en el expediente del empleado.</p><div class="actions"><button class="primary" name="action" value="open">Guardar turno</button><button name="action" value="reviewed">Guardar relevo revisado</button></div></form></section><section class="panel"><h2>Antes de revisar el relevo</h2><p>Unidades sin READY: <strong>${state.summary.total-state.summary.ready}</strong> · Solicitudes abiertas: <strong>${state.summary.openOrders}</strong> · Pendientes abiertos: <strong>${state.summary.openTasks}</strong></p><p class="muted">Se pueden dejar pendientes, siempre documentados para el siguiente responsable. Esto no equivale a finalizar el día ni autorizar pagos.</p></section>`;
}
function modules() {
  return `<p class="muted">Accesos a las funciones existentes. Nómina y pagos conservan sus controles actuales; esta entrega no ejecuta pagos bancarios.</p><div class="cards">${[['/employee-center','Personal','Expedientes y funciones del equipo.'],['/time-clock','Asistencia','Entradas, salidas y horas registradas.'],['/payroll','Nómina','Producción, tarifas, revisión y exportación.'],['/unit-catalog','Catálogo de unidades','Referencias y fotografías por unidad.'],['/rooms-manager','Asignaciones','Habitaciones y responsables.'],['/requests','Solicitudes','Artículos, problemas y seguimiento.']].map(([url,title,description])=>`<a class="module" href="${url}"><h3>${title}</h3><p>${description}</p><span>Abrir →</span></a>`).join('')}</div><section class="panel" style="margin-top:18px"><h2>Siguiente etapa</h2><p class="muted">Contratación, disponibilidad, inventario y conciliación de cheques requieren módulos adicionales. No se muestran como funciones activas.</p></section>`;
}
function history() {const names={task_created:'Pendiente creado',task_status:'Estado de pendiente',shift_saved:'Turno guardado',handoff_reviewed:'Relevo revisado',order_delegated:'Solicitud delegada'};return `<section class="panel"><h2>Últimos 100 cambios del turno</h2>${state.history.length?state.history.map(h=>`<div class="listrow"><div><strong>${escapeHTML(names[h.action]||h.action)}</strong><p>${escapeHTML(h.actor)} · ${escapeHTML(localTime(h.created_at))}</p><p>${escapeHTML(h.detail?.title || h.detail?.owner || h.detail?.status || h.detail?.settings?.operations || '')}</p></div></div>`).join(''):empty('Todavía no hay cambios registrados en este módulo.')}</section>`;}
function render() {
  if(!state)return;
  const renders={overview,rooms:()=>rooms(false),inspections:()=>rooms(true),requests,tasks,shift,modules,history};
  $('content').innerHTML=renders[view](); renderRoomRows();
}
async function mutate(path,method,body,button) {
  if(busy)return false; busy=true; if(button)button.disabled=true;
  try {await api(path,{method,body:JSON.stringify(body)}); notice('Guardado.'); return true;}
  catch(error){notice(error.name==='AbortError'?'No se confirmó el guardado. Actualiza antes de repetir la acción.':error.message);return false;}
  finally {busy=false;if(button)button.disabled=false;}
}
$('navigation').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)show(b.dataset.view);});
$('refresh').addEventListener('click',load); $('print').addEventListener('click',()=>window.print());
$('date').addEventListener('change',()=>{state=null;sequence++;$('content').innerHTML=empty('Cargando otro turno…');load();});
$('content').addEventListener('input',e=>{if(['searchRooms','roomFilter'].includes(e.target.id))renderRoomRows();});
$('content').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||!state)return;
  if(b.dataset.go)show(b.dataset.go);
  if(b.hasAttribute('data-new-task')){taskRequestId=(crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,'0')).join(''));$('taskForm').reset();$('taskError').textContent='';$('taskDialog').showModal();}
  if(b.dataset.task){const task=state.tasks.find(t=>String(t.id)===b.dataset.task);if(task&&await mutate('/tasks/'+task.id,'PATCH',{status:b.dataset.status,version:task.version},b))await load();}
  if(b.dataset.delegate){const order=state.orders.find(o=>String(o.id)===b.dataset.delegate),row=b.closest('tr');if(order&&await mutate('/orders/'+order.id+'/delegate','PATCH',{owner:row.querySelector('.owner').value,ticket:row.querySelector('.ticket').value,updatedAt:order.updated_at},b))await load();}
});
$('content').addEventListener('submit',async e=>{
  if(e.target.id!=='shiftForm')return;e.preventDefault();const settings=Object.fromEntries(new FormData(e.target));
  if(await mutate('/shift','PUT',{date:state.date,version:state.shift.version,settings,status:e.submitter?.value||'open'},e.submitter))await load();
});
$('cancelTask').addEventListener('click',()=>$('taskDialog').close());
$('taskForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!state)return;
  const body=Object.fromEntries(new FormData(e.target));if(body.dueAt)body.dueAt=new Date(body.dueAt).toISOString();
  if(await mutate('/tasks','POST',{...body,date:state.date,requestId:taskRequestId},e.submitter)){$('taskDialog').close();await load();}else $('taskError').textContent=$('message').textContent;
});
// Do not rerender editable forms on push. Tell the user when another device has changed the shared records.
if(typeof io==='function'){const socket=io();['care-control:updated','service-order:updated','service-order:created'].forEach(event=>socket.on(event,()=>{if(state)notice('Hay cambios en la operación. Pulsa Actualizar para verlos.');}));}
load();
