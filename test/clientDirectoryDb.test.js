'use strict';
// Run with CARE_PGLITE_MODULE set to an isolated installation of @electric-sql/pglite.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.CARE_PGLITE_MODULE||'@electric-sql/pglite');
const {backfillLegacy,DEFAULT_LOCATION}=require('../services/clientDirectory');
async function main(){const db=new PGlite();const pool={connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 try{
  const base=path.resolve(__dirname,'..');await db.exec(fs.readFileSync(path.join(base,'db/schema.sql'),'utf8'));
  await db.query(`INSERT INTO rooms(notion_id,work_date,room_number,normalized_room,raw_data) VALUES('notion-a','2026-10-30','101','101','{}'),('notion-b','2026-10-31','101','101','{}'),('notion-c','2026-10-31','Chateau 102','102','{}')`);
  const schema=fs.readFileSync(path.join(base,'db/migrations/014_client_directory.sql'),'utf8');await db.exec(schema);
  assert.equal((await backfillLegacy(pool)).linked,3);const initial=await db.query('SELECT * FROM care_units ORDER BY legacy_key');assert.equal(initial.rows.length,2);
  assert.equal(initial.rows[0].location_id,DEFAULT_LOCATION);assert.equal(initial.rows[1].location_id,null);assert.equal(initial.rows[1].review_required,true);
  const history=await db.query('SELECT DISTINCT care_unit_id FROM rooms WHERE normalized_room=$1',['101']);assert.equal(history.rows.length,1);
  await db.exec(schema);assert.equal((await backfillLegacy(pool)).linked,0);assert.equal((await db.query('SELECT * FROM rooms')).rows.length,3);
  const client=randomUUID(),loc=randomUUID();await db.query('INSERT INTO care_clients(id,name) VALUES($1,$2)',[client,'Second client']);await db.query('INSERT INTO care_locations(id,client_id,name) VALUES($1,$2,$3)',[loc,client,'Second location']);
  await db.query('INSERT INTO care_units(id,location_id,name,unit_key) VALUES($1,$2,$3,$4)',[randomUUID(),loc,'101','101']);
  assert.equal((await db.query("SELECT * FROM care_units WHERE unit_key='101'")).rows.length,2);
  await assert.rejects(db.query('INSERT INTO care_units(id,location_id,name,unit_key) VALUES($1,$2,$3,$4)',[randomUUID(),loc,'101','101']),e=>e.code==='23505');
  await assert.rejects(db.query('INSERT INTO care_units(id,location_id,name,unit_key) VALUES($1,$2,$3,$4)',[randomUUID(),randomUUID(),'103','103']),e=>e.code==='23503');
  const dbPath=require.resolve('../db'),previous=require.cache[dbPath];
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:(...args)=>db.query(...args),getPool:()=>pool}};
  try {
   delete require.cache[require.resolve('../services/roomSyncService')];
   const {syncRoomsFromNotion}=require('../services/roomSyncService');
   const page=(id,name,property)=>({id,properties:{'Room Number':{title:[{plain_text:name}]},Date:{date:{start:'2026-10-31'}},...(property?{Property:{select:{name:property}}}:{})}});
   const result=await syncRoomsFromNotion({notion:{},databaseId:'fake',date:'2026-10-31',queryDatabase:async()=>({results:[page('foreign-101','101','Rock Lane'),page('foreign-999','999','Rock Lane'),page('new-hotel','103')],has_more:false})});
   assert.equal(result.saved,1);assert.equal(result.errors.length,2);
   assert.equal((await db.query("SELECT notion_id FROM rooms WHERE work_date='2026-10-31' AND normalized_room='101'")).rows[0].notion_id,'notion-b');
   assert.equal((await db.query("SELECT * FROM rooms WHERE normalized_room='999'")).rows.length,0);
   assert((await db.query("SELECT care_unit_id FROM rooms WHERE notion_id='new-hotel'")).rows[0].care_unit_id);
  } finally {if(previous)require.cache[dbPath]=previous;else delete require.cache[dbPath];}
  console.log('PostgreSQL engine: full schema, repeatable migration/backfill, stable history IDs, Chateau review, cross-location 101, uniqueness, foreign keys and safe room-sync rejection passed.');
 }finally{await db.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
