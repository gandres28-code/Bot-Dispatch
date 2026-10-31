'use strict';
const assert=require('node:assert/strict');
const data=require('../public/js/exit-checklist-data');
const {createActionHandler}=require('../services/operationalActions');
const response=()=>({code:200,status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
(async()=>{
 let calls=0,saved;const handler=createActionHandler({kind:'cleaner',today:()=> '2026-10-30',engine:{async handleCleanerAction(input){calls++;saved=input;return {eventId:'done-test'};}}});
 const base={action:'DONE',unit:'101A',name:'Cleaner'};
 for(const exitChecklist of [undefined,{version:data.version,checked:[]},{version:'old',checked:data.items.map(x=>x.id)},{version:data.version,checked:Array(15).fill(data.items[0].id)}]){
 const res=response();await handler({body:{...base,exitChecklist}},res);assert.equal(res.code,400);assert.equal(calls,0,'incomplete review cannot change status or pay');}
 const res=response();await handler({body:{...base,exitChecklist:{version:data.version,checked:data.items.map(x=>x.id),recordedAt:'forged'}}},res);
 assert.equal(res.body.postgresUpdated,true);assert.equal(calls,1);assert.equal(saved.exitChecklist.items.length,15);assert.notEqual(saved.exitChecklist.recordedAt,'forged');assert.equal(saved.unit,'101A');assert.equal(saved.cleaner,'Cleaner');
 const start=response();await handler({body:{...base,action:'START'}},start);assert.equal(start.body.success,true,'starting does not require an exit checklist');
 console.log('Exit checklist: missing, incomplete, old and duplicate selections rejected; full review preserved with server timestamp; START unaffected.');
})().catch(e=>{console.error(e);process.exit(1);});
