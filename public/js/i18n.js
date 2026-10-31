(function(){'use strict';
 const core=window.CareI18nCore,records=new WeakMap(),attrRecords=new WeakMap();
 const skip='script,style,textarea,code,pre,[data-i18n-ignore],[translate="no"],.history-note,.notes,.room-title,.room,.unit,.employee-name,.person-name';
 const protectedIds=new Set(['heroCleanerName','heroInspectorName','runnerName','osUserName','userName','employeeName']);
 const identity=()=>{try{return localStorage.getItem('employeeCode')||'';}catch{return '';}};
 const key=code=>'care:language:'+encodeURIComponent(code);
 function cached(){try{return localStorage.getItem(key(identity()))==='en'?'en':'es';}catch{return 'es';}}
 let language=cached(),request=null,requestedCode='',lastRefresh=0;
 const t=value=>core.translate(value,language);
 function ignored(el){return !el||el.closest(skip)||protectedIds.has(el.id);}
 function textNode(node){if(ignored(node.parentElement))return;const text=node.nodeValue;if(!text?.trim())return;let record=records.get(node);if(!record||text!==record.output)record={source:text,output:text};const output=t(record.source);record.output=output;records.set(node,record);if(output!==text)node.nodeValue=output;}
 function attributes(el){if(ignored(el)&&!(el.tagName==='TEXTAREA'&&!el.closest('[data-i18n-ignore],[translate="no"]')))return;let record=attrRecords.get(el);if(!record){record={};attrRecords.set(el,record);}for(const attr of ['title','placeholder','aria-label','alt']){const value=el.getAttribute(attr);if(value===null)continue;let r=record[attr];if(!r||r.output!==value)r={source:value,output:value};r.output=t(r.source);record[attr]=r;if(r.output!==value)el.setAttribute(attr,r.output);}}
 function walk(root){if(!root)return;if(root.nodeType===3){textNode(root);return;}if(root.nodeType!==1&&root.nodeType!==9)return;
  if(root.nodeType===1&&ignored(root)){if(root.tagName==='TEXTAREA')attributes(root);return;}
  if(root.nodeType===1){if(root.tagName==='OPTION'&&!root.hasAttribute('value'))root.setAttribute('value',root.value);attributes(root);}
  for(const el of root.querySelectorAll?.('[title],[placeholder],[aria-label],[alt],option:not([value])')||[]){if(el.tagName==='OPTION'&&!el.hasAttribute('value'))el.setAttribute('value',el.value);attributes(el);}
  const tree=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(tree.nextNode())textNode(tree.currentNode);
 }
 function syncWorker(){if(!navigator.serviceWorker)return;const message={type:'care-language',language};navigator.serviceWorker.controller?.postMessage(message);navigator.serviceWorker.getRegistration?.().then(reg=>reg?.active?.postMessage(message)).catch(()=>{});}
 function setLanguage(value,{persist=true}={}){if(!['es','en'].includes(value))return;const changed=language!==value;language=value;
  if(persist&&identity()){try{localStorage.setItem(key(identity()),value);}catch{}}
  document.documentElement.lang=value;walk(document.documentElement);syncWorker();
  if(changed)window.dispatchEvent(new CustomEvent('care:language-changed',{detail:{language,locale:value==='en'?'en-US':'es-US'}}));
 }
 async function refresh(force=false){const code=identity();if(!code)return setLanguage('es',{persist:false});if(request&&requestedCode===code)return request;if(!force&&Date.now()-lastRefresh<60000&&requestedCode===code)return;
  requestedCode=code;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
  const pending=(async()=>{try{const r=await fetch('/api/employee-preferences',{cache:'no-store',headers:{'X-Care-Code':code},signal:controller.signal});const d=await r.json();if(r.ok&&d.ok&&identity()===code){setLanguage(d.language);lastRefresh=Date.now();}}catch{}finally{clearTimeout(timeout);if(request===pending)request=null;}})();request=pending;return pending;
 }
 window.CareI18n={t,get language(){return language;},get locale(){return language==='en'?'en-US':'es-US';},setLanguage,refresh,translate:walk,product:name=>core.product(name,language)};
 // Translate browser dialogs too; text entered by users remains unchanged.
 for(const name of ['alert','confirm','prompt']){const original=window[name];if(original)window[name]=function(message,...args){return original.call(window,t(message),...args);};}
 function start(){setLanguage(cached(),{persist:false});
  const observer=new MutationObserver(mutations=>{const roots=new Set();for(const m of mutations){if(m.type==='characterData')roots.add(m.target);else if(m.type==='attributes')roots.add(m.target);else for(const node of m.addedNodes)roots.add(node);}for(const root of roots)walk(root);});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label','alt']});
  refresh();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('online',()=>refresh(true));
  window.addEventListener('storage',event=>{if(event.key==='employeeCode'){lastRefresh=0;setLanguage(cached(),{persist:false});refresh(true);}else if(event.key===key(identity()))setLanguage(cached(),{persist:false});});
  window.addEventListener('os-ready',()=>refresh());
  setInterval(()=>{if(!document.hidden)refresh();},60000);
 }
 document.documentElement.lang=language;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
