import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDb} from '@barzinho/db';
import {buildApp} from '../src/index.js';

test('season marking is confirmed, idempotent, complete-cache gated and excludes unreleased episodes',async()=>{
 const db=await createDb({dataDir:':memory:'});const app=await buildApp({db,logger:false});
 try{
  await db.query('INSERT INTO catalog_titles(id,media_type,external_id,title,data) VALUES($1,$2,$3,$4,$5)',['tv:42','tv',42,'Test series',JSON.stringify({seasons:[{seasonNumber:1,episodeCount:4}]})]);
  for(let i=1;i<=3;i++)await db.query('INSERT INTO catalog_episodes(id,title_id,season_number,episode_number,title,data) VALUES($1,$2,1,$3,$4,$5)',[`tv:42:1:${i}`,'tv:42',i,`Test episode ${i}`,JSON.stringify({airDate:i===3?'2099-01-01':'2020-01-01'})]);
  const registration=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'season_test',displayName:'Season test',email:'season@example.invalid',password:'test-password-123'}});
  const headers={authorization:`Bearer ${registration.json().token}`};
  const payload={titleId:'tv:42',seasonNumber:1,confirmed:true};
  assert.equal((await app.inject({method:'PUT',url:'/api/watch/season',payload,headers})).statusCode,409);
  assert.equal((await db.query('SELECT * FROM episode_watches')).length,0);
  await db.query("INSERT INTO catalog_episodes(id,title_id,season_number,episode_number,title) VALUES('tv:42:1:4','tv:42',1,4,'Unknown release')");
  assert.equal((await app.inject({method:'PUT',url:'/api/watch/season',payload:{...payload,confirmed:false},headers})).statusCode,400);
  const results=await Promise.all([1,2].map(()=>app.inject({method:'PUT',url:'/api/watch/season',payload,headers})));
  for(const result of results){assert.equal(result.statusCode,200,result.body);assert.equal(result.json().skipped,2);assert.equal(result.json().eligible,2)}
  assert.equal(results.reduce((sum,r)=>sum+r.json().added,0),2);
  assert.equal((await db.query('SELECT * FROM episode_watches')).length,2);
  const profile=(await app.inject({url:'/api/profile',headers})).json();assert.equal(profile.stats.episodesWatched,2);
  assert.equal((await app.inject({method:'PUT',url:'/api/watch/season',payload})).statusCode,401);
 }finally{await app.close();await db.close()}
});

test('private profiles leave search and feeds, social mutations respect ownership, sessions revoke',async()=>{
 const db=await createDb({dataDir:':memory:'});const app=await buildApp({db,logger:false});
 try{
  async function signup(name:string){const r=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:name,displayName:name,email:`${name}@example.invalid`,password:'test-password-123'}});assert.equal(r.statusCode,201,r.body);return r.json()}
  const a=await signup('social_alice'),b=await signup('social_bob');const ah={authorization:`Bearer ${a.token}`},bh={authorization:`Bearer ${b.token}`};
  await db.query("INSERT INTO catalog_titles(id,media_type,external_id,title) VALUES('movie:43','movie',43,'Test film')");
  await app.inject({method:'POST',url:'/api/watch/movie',headers:ah,payload:{titleId:'movie:43',idempotencyKey:'social-test-watch'}});
  assert.equal((await app.inject({method:'PUT',url:`/api/follows/${a.user.id}`,headers:bh,payload:{following:true}})).statusCode,200);
  assert.equal((await app.inject({url:'/api/feed',headers:bh})).json().items.length,1);
  assert.equal((await app.inject({url:'/api/users?q=social_alice',headers:bh})).json().items[0].following,true);
  const comment=(await app.inject({method:'POST',url:'/api/comments',headers:ah,payload:{targetId:'movie:43',targetType:'title',body:'Test opinion',spoiler:true}})).json().comment;
  assert.equal((await app.inject({method:'PATCH',url:`/api/comments/${comment.id}`,headers:bh,payload:{body:'Forbidden edit',spoiler:false}})).statusCode,404);
  for(let i=0;i<2;i++)assert.equal((await app.inject({method:'PUT',url:`/api/comments/${comment.id}/like`,headers:bh,payload:{liked:true}})).statusCode,200);
  const list=(await app.inject({url:'/api/comments?targetId=movie:43&sort=popular',headers:bh})).json().items;assert.equal(list[0].likes,1);assert.equal(list[0].body,null);
  assert.equal((await app.inject({url:`/api/comments/${comment.id}/reveal`,headers:bh})).json().comment.body,'Test opinion');
  assert.equal((await app.inject({method:'POST',url:'/api/comments',headers:bh,payload:{targetId:'movie:43',targetType:'title',body:'Test response',parentId:comment.id}})).statusCode,200);
  const notifications=(await app.inject({url:'/api/notifications',headers:ah})).json().items;assert.ok(notifications.some((n:{kind:string})=>n.kind==='reply'));
  await app.inject({method:'PATCH',url:'/api/account',headers:ah,payload:{displayName:'Private Alice',bio:'Updated bio',privateProfile:true}});
  assert.equal((await app.inject({url:'/api/users?q=social_alice',headers:bh})).json().items.length,0);
  assert.equal((await app.inject({url:'/api/feed',headers:bh})).json().items.length,0);
  assert.equal((await app.inject({url:'/api/follows',headers:bh})).json().items[0].id,a.user.id);
  assert.equal((await app.inject({url:'/api/follows',headers:ah})).json().items.length,0);
  assert.equal((await app.inject({method:'PUT',url:`/api/follows/${a.user.id}`,headers:bh,payload:{following:false}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/account/revoke-sessions',headers:ah})).statusCode,200);
  assert.equal((await app.inject({url:'/api/auth/me',headers:ah})).statusCode,401);
  assert.equal((await app.inject({url:'/api/auth/me',headers:bh})).statusCode,200);
 }finally{await app.close();await db.close()}
});
