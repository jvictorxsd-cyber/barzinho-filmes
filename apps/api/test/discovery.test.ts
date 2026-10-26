import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDb} from '@barzinho/db';
import {buildApp} from '../src/index.js';

async function setup(){
 const db=await createDb({dataDir:':memory:'});const app=await buildApp({db,logger:false});
 async function signup(name:string){const r=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:name,displayName:name,email:`${name}@example.invalid`,password:'test-password-123'}});assert.equal(r.statusCode,201,r.body);const data=r.json();return {id:data.user.id,headers:{authorization:`Bearer ${data.token}`}}}
 return {db,app,signup,close:async()=>{await app.close();await db.close()}};
}

test('lists enforce ownership, public/private visibility, uniqueness and deletion cascades',async()=>{
 const {db,app,signup,close}=await setup();
 try{
  const alice=await signup('list_alice'),bob=await signup('list_bob');
  await db.query("INSERT INTO catalog_titles(id,media_type,external_id,title) VALUES('movie:12','movie',12,'List test title')");
  const create=await app.inject({method:'POST',url:'/api/lists',headers:alice.headers,payload:{name:'Minha lista',private:true}});assert.equal(create.statusCode,201,create.body);const id=create.json().list.id;
  assert.equal((await app.inject({url:`/api/lists/${id}`})).statusCode,404);
  assert.equal((await app.inject({url:`/api/lists/${id}`,headers:bob.headers})).statusCode,404);
  for(let i=0;i<2;i++){const add=await app.inject({method:'PUT',url:`/api/lists/${id}/items`,headers:alice.headers,payload:{titleId:'movie:12'}});assert.equal(add.statusCode,200,add.body)}
  assert.equal((await app.inject({url:'/api/lists',headers:alice.headers})).json().items[0].itemCount,1);
  assert.equal((await app.inject({method:'PUT',url:`/api/lists/${id}/items`,headers:bob.headers,payload:{titleId:'movie:12'}})).statusCode,404);
  assert.equal((await app.inject({method:'PATCH',url:`/api/lists/${id}`,headers:bob.headers,payload:{name:'Stolen',private:false}})).statusCode,404);
  assert.equal((await app.inject({method:'PATCH',url:`/api/lists/${id}`,headers:alice.headers,payload:{name:'Noite de cinema',private:false}})).statusCode,200);
  const publicList=await app.inject({url:`/api/lists/${id}`});assert.equal(publicList.statusCode,200,publicList.body);assert.equal(publicList.json().items[0].id,'movie:12');assert.ok(!publicList.body.includes('@example.invalid'));
  await app.inject({method:'PATCH',url:'/api/account',headers:alice.headers,payload:{displayName:'Alice',bio:'',privateProfile:true}});
  assert.equal((await app.inject({url:`/api/lists/${id}`})).statusCode,404);
  assert.equal((await app.inject({url:`/api/lists/${id}`,headers:alice.headers})).statusCode,200);
  assert.equal((await app.inject({method:'DELETE',url:`/api/lists/${id}/items/movie:12`,headers:bob.headers})).statusCode,404);
  assert.equal((await app.inject({method:'DELETE',url:`/api/lists/${id}/items/movie:12`,headers:alice.headers})).statusCode,200);
  assert.equal((await app.inject({url:`/api/lists/${id}`,headers:alice.headers})).json().items.length,0);
  await app.inject({method:'PUT',url:`/api/lists/${id}/items`,headers:alice.headers,payload:{titleId:'movie:12'}});
  assert.equal((await app.inject({method:'DELETE',url:`/api/lists/${id}`,headers:bob.headers})).statusCode,404);
  assert.equal((await app.inject({method:'DELETE',url:`/api/lists/${id}`,headers:alice.headers})).statusCode,200);
  assert.equal((await db.query('SELECT * FROM list_items')).length,0);
  assert.equal((await db.query('SELECT * FROM catalog_titles')).length,1);
 }finally{await close()}
});

test('recommendations use only the current user signals and exclude tracked or rated titles',async()=>{
 const {db,app,signup,close}=await setup();
 try{
  const alice=await signup('rec_alice'),bob=await signup('rec_bob');
  for(const [id,genre] of [[1,'Drama'],[2,'Drama'],[3,'Comédia'],[4,'Comédia']] as const)await db.query('INSERT INTO catalog_titles(id,media_type,external_id,title,genres,data) VALUES($1,$2,$3,$4,$5,$6)',[`movie:${id}`,'movie',id,`Recommendation fixture ${id}`,JSON.stringify([genre]),JSON.stringify({voteAverage:7})]);
  await app.inject({method:'PUT',url:'/api/library',headers:alice.headers,payload:{titleId:'movie:1',status:'completed',favorite:true}});
  await app.inject({method:'PUT',url:'/api/library',headers:bob.headers,payload:{titleId:'movie:3',status:'completed',favorite:true}});
  const a=(await app.inject({url:'/api/recommendations',headers:alice.headers})).json();const b=(await app.inject({url:'/api/recommendations',headers:bob.headers})).json();
  assert.equal(a.items[0].id,'movie:2');assert.equal(b.items[0].id,'movie:4');assert.equal(a.mode,'personalized');assert.ok(a.items[0].reason.includes('Drama'));assert.ok(!a.items.some((t:{id:string})=>t.id==='movie:1'));
  await app.inject({method:'PUT',url:'/api/ratings',headers:alice.headers,payload:{targetId:'movie:2',targetType:'title',score:1}});
  const after=(await app.inject({url:'/api/recommendations',headers:alice.headers})).json();assert.ok(!after.items.some((t:{id:string})=>t.id==='movie:2'));
  const newcomer=await signup('rec_new');assert.equal((await app.inject({url:'/api/recommendations',headers:newcomer.headers})).json().mode,'discovery');
  assert.equal((await app.inject({url:'/api/recommendations'})).statusCode,401);
 }finally{await close()}
});

test('calendar preserves date-only values, excludes other users and watched episodes, and deduplicates next episode',async()=>{
 const {db,app,signup,close}=await setup();
 try{
  const a=await signup('calendar_alice'),b=await signup('calendar_bob');
  await db.query('INSERT INTO catalog_titles(id,media_type,external_id,title,data) VALUES($1,$2,$3,$4,$5)',['tv:31','tv',31,'Calendar fixture',JSON.stringify({nextEpisode:{id:'tv:31:1:1',title:'Next test',airDate:'2027-01-03',seasonNumber:1,episodeNumber:1}})]);
  for(const [number,airDate] of [[1,'2027-01-03'],[2,null],[3,'2027-02-01']] as const)await db.query('INSERT INTO catalog_episodes(id,title_id,season_number,episode_number,title,data) VALUES($1,$2,1,$3,$4,$5)',[`tv:31:1:${number}`,'tv:31',number,`Calendar episode ${number}`,JSON.stringify({airDate})]);
  await app.inject({method:'PUT',url:'/api/library',headers:a.headers,payload:{titleId:'tv:31',status:'watching'}});
  const url='/api/calendar?from=2027-01-01&to=2027-01-31&timeZone=Pacific%2FAuckland';
  const r=await app.inject({url,headers:a.headers});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().items.length,1);assert.equal(r.json().items[0].date,'2027-01-03');assert.equal(r.json().undatedCount,1);assert.equal(r.json().datePrecision,'day');
  assert.equal((await app.inject({url,headers:b.headers})).json().items.length,0);
  await db.query('INSERT INTO episode_watches(user_id,episode_id) VALUES($1,$2)',[a.id,'tv:31:1:1']);
  assert.equal((await app.inject({url,headers:a.headers})).json().items.length,0);
  assert.equal((await app.inject({url:'/api/calendar?from=2027-01-01&to=2027-12-31',headers:a.headers})).statusCode,400);
  assert.equal((await app.inject({url:'/api/calendar?from=2027-01-01&to=2027-01-02&timeZone=Invalid',headers:a.headers})).statusCode,400);
  assert.equal((await app.inject({url})).statusCode,401);
 }finally{await close()}
});
