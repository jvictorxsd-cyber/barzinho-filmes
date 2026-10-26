import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDb} from '@barzinho/db';
import {buildApp} from '../src/index.js';

test('real API flow: accounts, isolation, idempotency, ratings, spoiler privacy and voting',async()=>{
  const db=await createDb({dataDir:':memory:'});
  const app=await buildApp({db,logger:false});
  try {
    await db.query("INSERT INTO catalog_titles(id,media_type,external_id,title) VALUES('movie:1','movie',1,'Fixture film'),('movie:2','movie',2,'Second fixture'),('tv:1','tv',1,'Fixture series')");
    await db.query('INSERT INTO catalog_episodes(id,title_id,season_number,episode_number,title,data) VALUES($1,$2,1,1,$3,$4)', ['tv:1:1:1','tv:1','Fixture episode',JSON.stringify({id:'tv:1:1:1',cast:[{personId:1,name:'Test actor',character:'Test character',profilePath:null}]})]);
    async function register(username:string) {const res=await app.inject({method:'POST',url:'/api/auth/register',payload:{email:`${username}@example.com`,password:'test password 123',username,displayName:username}});assert.equal(res.statusCode,201,res.body);return res.json() as {token:string;user:{id:string}};}
    const alice=await register('alice');const bob=await register('bob');
    const auth={authorization:`Bearer ${alice.token}`};const other={authorization:`Bearer ${bob.token}`};
    assert.equal((await app.inject({method:'GET',url:'/api/library'})).statusCode,401);
    let res=await app.inject({method:'PUT',url:'/api/library',headers:auth,payload:{titleId:'movie:1',status:'watchlist'}});assert.equal(res.statusCode,200,res.body);
    assert.equal((await app.inject({url:'/api/library',headers:auth})).json().items.length,1);
    assert.equal((await app.inject({url:'/api/library',headers:other})).json().items.length,0);
    const watch={titleId:'movie:1',idempotencyKey:'session-key-0001'};
    for(let i=0;i<2;i++){res=await app.inject({method:'POST',url:'/api/watch/movie',headers:auth,payload:watch});assert.equal(res.statusCode,200,res.body);}
    res=await app.inject({method:'POST',url:'/api/watch/movie',headers:auth,payload:{...watch,titleId:'movie:2'}});assert.equal(res.statusCode,409,res.body);
    const profile=(await app.inject({url:'/api/profile',headers:auth})).json();assert.equal(profile.stats.moviesWatched,1);assert.equal(profile.activity.length,1);assert.equal(profile.achievements.filter((a:{earnedAt:string})=>a.earnedAt).length,1);
    const score={targetId:'tv:1:1:1',targetType:'episode',score:8.5};
    res=await app.inject({method:'PUT',url:'/api/ratings',headers:auth,payload:score});assert.equal(res.statusCode,403,res.body);
    for(let i=0;i<2;i++){res=await app.inject({method:'PUT',url:'/api/watch/episode',headers:auth,payload:{episodeId:'tv:1:1:1',watched:true}});assert.equal(res.statusCode,200,res.body);}
    res=await app.inject({method:'PUT',url:'/api/ratings',headers:auth,payload:score});assert.equal(res.statusCode,200,res.body);
    res=await app.inject({method:'PUT',url:'/api/ratings',headers:auth,payload:{...score,score:8.3}});assert.equal(res.statusCode,400);
    res=await app.inject({method:'PUT',url:'/api/votes',headers:auth,payload:{episodeId:'tv:1:1:1',personId:999,character:'Not in episode'}});assert.equal(res.statusCode,400,res.body);
    for(let i=0;i<2;i++){res=await app.inject({method:'PUT',url:'/api/votes',headers:auth,payload:{episodeId:'tv:1:1:1',personId:1,character:'Test character'}});assert.equal(res.statusCode,200,res.body);}
    assert.equal((await app.inject({url:'/api/votes/tv:1:1:1',headers:auth})).json().total,1);
    res=await app.inject({method:'POST',url:'/api/comments',headers:auth,payload:{targetId:'tv:1:1:1',targetType:'episode',body:'Secret ending',spoiler:true}});assert.equal(res.statusCode,200,res.body);const commentId=res.json().comment.id;
    const comments=(await app.inject({url:'/api/comments?targetId=tv:1:1:1'})).json();assert.equal(comments.items[0].body,null);assert.equal(comments.items[0].hidden,true);
    res=await app.inject({method:'DELETE',url:`/api/comments/${commentId}`,headers:other});assert.equal(res.statusCode,404);
    res=await app.inject({method:'PUT',url:'/api/watch/episode',headers:auth,payload:{episodeId:'tv:1:1:1',watched:false}});assert.equal(res.statusCode,200,res.body);
    assert.equal((await db.query('SELECT * FROM character_votes')).length,0);assert.equal((await db.query("SELECT * FROM ratings WHERE target_type='episode'")).length,0);
    res=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin:'https://evil.example'},payload:{email:'alice@example.com',password:'test password 123'}});assert.equal(res.statusCode,403);
    res=await app.inject({url:'/api/account/export',headers:auth});assert.equal(res.statusCode,200,res.body);assert.ok(res.json().list_items);assert.ok(!res.body.includes('password_hash'));
    res=await app.inject({method:'DELETE',url:'/api/account',headers:auth,payload:{password:'test password 123'}});assert.equal(res.statusCode,200,res.body);
    assert.equal((await app.inject({url:'/api/auth/me',headers:auth})).statusCode,401);
    assert.equal((await app.inject({url:'/api/auth/me',headers:other})).statusCode,200);
  } finally {await app.close();await db.close();}
});
