'use strict';
// Execute the shipped client against a minimal DOM and mocked API responses.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function screen(manage){
 const nodes=new Map(),node=()=>({hidden:true,value:'',textContent:'',innerHTML:'',disabled:false,open:false,addEventListener(){},before(){},querySelectorAll(){return[];}});
 for(const [,id]of fs.readFileSync(require.resolve('../public/work.html'),'utf8').matchAll(/id="([^"]+)"/g))nodes.set(id,node());
 const title=node(),notice=node();
 const rows=['pending','cleaning','awaiting_inspection','inspecting','ready'].map((status,i)=>({id:'job'+i,status,unit_name:'Unit '+i,client_name:'Still Waters',location_name:'Resort',location_id:'hotel',cleaner_names:['Ana'],inspector_name:'Jose',started_at:i?'2026-11-07T15:00:00Z':null,finished_at:i>1?'2026-11-07T16:00:00Z':null,inspection_started_at:i>2?'2026-11-07T16:20:00Z':null,ready_at:i>3?'2026-11-07T16:30:00Z':null}));
 const context={document:{hidden:false,documentElement:{},getElementById:id=>{return nodes.get(id)||null;},querySelector:s=>s.includes('title')?title:notice,querySelectorAll:()=>[],createElement:node},localStorage:{getItem:()=> 'test'},setInterval(){},setTimeout,clearTimeout,AbortController,FormData,URL,Date,console,fetch:async url=>{let body={};if(url.includes('bootstrap'))body={user:{id:'jose',name:'Jose',language:'es'},today:'2026-11-07',canManage:manage,canFulfill:manage,sourceMode:'notion'};else if(url.includes('/jobs'))body={jobs:rows,source:{last_success_at:'2026-11-07T18:00:00Z',source_count:5,imported_count:5,errors:[]}};else if(url.includes('/reports'))body={reports:[]};else if(url.includes('/team'))body={positions:[]};else if(url.includes('/review'))body={sessions:[]};return{ok:true,json:async()=>body};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/scoped-work.js'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((nodes.get('jobs').innerHTML.match(/<article /g)||[]).length,5);
 assert.equal(nodes.get('shiftSummary').hidden,!manage);
 if(manage){assert.equal(title.textContent,'Manager del turno');assert.ok(nodes.get('shiftSummary').innerHTML.includes('60 min'));assert.ok(nodes.get('shiftLinks').innerHTML.includes('/requests'));}
 nodes.get('todayFilters').onclick({target:{closest:()=>({dataset:{filter:'inspect'}})}});
 assert.equal((nodes.get('jobs').innerHTML.match(/<article /g)||[]).length,2);
 assert.equal(nodes.get('adminPanel').hidden,!manage);
}
(async()=>{await screen(true);await screen(false);console.log('Work UI: manager overview, elapsed times, orders link, inspection filter and inspector visibility passed.');})().catch(e=>{console.error(e);process.exitCode=1;});
