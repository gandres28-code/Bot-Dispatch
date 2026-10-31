(function(){'use strict';
let active=false;
window.CareExitChecklist={open(unit){
 if(active)return Promise.resolve(null);active=true;
 return new Promise(resolve=>{
 let data=window.CareExitChecklistData,checks=[];
 const dialog=document.createElement('dialog');dialog.className='exit-checklist';
 dialog.innerHTML='<form><header><h2>Antes de salir · <span></span></h2><label>Tipo de limpieza <select class="clean-type"><option value="regular">Regular · 15 puntos</option><option value="deep">Deep Clean · 84 puntos</option></select></label><p>Revisa cada punto. Corrige los pendientes antes de confirmar. En Deep Clean, usa No aplica solo si el elemento no existe y escribe el motivo. Coordina mantenimiento y sigue las etiquetas y manuales.</p></header><div class="exit-items"></div><footer><p role="status" aria-live="polite"></p><div><button type="button" class="exit-back">Volver a la unidad</button><button type="submit" class="exit-confirm" disabled>Confirmar y terminar</button></div></footer></form>';
 dialog.querySelector('h2 span').textContent=unit;
 const list=dialog.querySelector('.exit-items'),button=dialog.querySelector('.exit-confirm'),progress=dialog.querySelector('[role=status]');
 function complete(x){return x.input.checked || (x.na&&x.na.checked&&x.reason.value.trim().length>0);}
 function update(){const count=checks.filter(complete).length;progress.textContent=count+' de '+checks.length+' revisados';button.disabled=count!==checks.length;}
 function render(){list.replaceChildren();checks=[];let group='';
 data.items.forEach(item=>{
 if(item.group&&item.group!==group){group=item.group;const h=document.createElement('h3');h.textContent=group;list.append(h);}
 const row=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');input.type='checkbox';input.value=item.id;title.textContent=(item.number?item.number+'. ':'')+item.title;detail.textContent=item.detail;text.append(title,detail);label.append(input,text);row.append(label);const entry={input};
 if(item.number){const naLabel=document.createElement('label'),na=document.createElement('input'),reason=document.createElement('input');na.type='checkbox';naLabel.append(na,document.createTextNode('No aplica'));reason.type='text';reason.placeholder='Motivo de No aplica';reason.maxLength=300;reason.style.cssText='width:100%;height:40px;box-sizing:border-box';reason.setAttribute('aria-label','Motivo No aplica: '+item.title);na.onchange=()=>{if(na.checked)input.checked=false;update();};input.onchange=()=>{if(input.checked)na.checked=false;update();};row.append(naLabel,reason);Object.assign(entry,{na,reason});}
 list.append(row);checks.push(entry);});list.scrollTop=0;update();}
 dialog.querySelector('.clean-type').onchange=e=>{data=e.target.value==='deep'?window.CareDeepCleanChecklistData:window.CareExitChecklistData;render();};
 function finish(value){dialog.close();dialog.remove();active=false;resolve(value);}
 list.addEventListener('change',update);list.addEventListener('input',update);dialog.querySelector('.exit-back').onclick=()=>finish(null);
 dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
 dialog.querySelector('form').onsubmit=event=>{event.preventDefault();if(checks.every(complete))finish({version:data.version,checked:checks.filter(x=>x.input.checked).map(x=>x.input.value),notApplicable:checks.filter(x=>x.na&&x.na.checked).map(x=>({id:x.input.value,reason:x.reason.value.trim()})),reviewedAt:new Date().toISOString()});};
 document.body.append(dialog);render();dialog.showModal();
 });
}};
})();
