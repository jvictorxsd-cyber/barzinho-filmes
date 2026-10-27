import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDb} from './index.js';

const url=process.env.POSTGRES_TEST_URL;
if(!url) throw new Error('POSTGRES_TEST_URL deve apontar a um PostgreSQL exclusivo de testes.');

test('PostgreSQL preserves JSON objects and arrays using the same parameter contract as PGlite',async()=>{
 const db=await createDb({url});
 const fixture=[{id:'movie:99',title:'Teste de JSON',genres:['Drama']}];
 try{
  const [row]=await db.query<{kind:string;first:unknown}>('SELECT jsonb_typeof($1::jsonb) AS kind,($1::jsonb)->0 AS first',[JSON.stringify(fixture)]);
  assert.equal(row.kind,'array');assert.deepEqual(row.first,fixture[0]);
  const expanded=await db.query<{id:string}>('SELECT value->>\'id\' AS id FROM jsonb_array_elements($1::jsonb)',[JSON.stringify(fixture)]);
  assert.deepEqual(expanded,[{id:'movie:99'}]);
  const object={results:fixture};
  await db.transaction(async tx=>{
   const [result]=await tx.query<{data:unknown}>('SELECT $1::jsonb AS data',[JSON.stringify(object)]);
   assert.deepEqual(result.data,object);
  });
  const [json]=await db.query<{data:unknown}>('SELECT $1::json AS data',[JSON.stringify(object)]);
  assert.deepEqual(json.data,object);
 }finally{await db.close()}
});
