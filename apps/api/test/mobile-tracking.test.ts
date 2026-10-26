import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDb} from '@barzinho/db';
import {createApiClient,ApiError} from '@barzinho/shared';
import {createTitleTracking} from '../../mobile/src/title-tracking.js';
import {buildApp} from '../src/index.js';

test('mobile restores server progress across sessions, preserves favorite status, and isolates accounts',async () => {
  const db=await createDb({dataDir:':memory:'});
  const app=await buildApp({db,logger:false});
  try {
    await db.query("INSERT INTO catalog_titles(id,media_type,external_id,title,data) VALUES('tv:42','tv',42,'Test series',$1)",[JSON.stringify({seasons:[{seasonNumber:1,episodeCount:2}]})]);
    for(let i=1;i<=2;i++) await db.query('INSERT INTO catalog_episodes(id,title_id,season_number,episode_number,title,data) VALUES($1,$2,1,$3,$4,$5)',[`tv:42:1:${i}`,'tv:42',i,`Test episode ${i}`,JSON.stringify({airDate:'2020-01-01'})]);
    async function client(name:string) {
      const account=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:name,displayName:name,email:`${name}@example.invalid`,password:'test-password-123'}});
      assert.equal(account.statusCode,201,account.body);
      const {token,user}=account.json();
      const api=createApiClient({baseUrl:'http://api.test',getToken:()=>token,fetcher:async (url,init) => {
        const response=await app.inject({url:new URL(String(url)).pathname+new URL(String(url)).search,method:(init?.method ?? 'GET') as 'GET'|'PUT',headers:Object.fromEntries(new Headers(init?.headers)),payload:init?.body as string|undefined});
        return new Response(response.body,{status:response.statusCode,headers:{'content-type':'application/json'}});
      }});
      return {api,user};
    }
    const alice=await client('mobile_alice'),bob=await client('mobile_bob');
    const first=createTitleTracking(alice.api);
    await first.open('tv:42',alice.user.id);
    assert.equal(await first.watch('tv:42:1:1'),true);
    assert.equal(await first.rate(0),true);
    assert.equal(await first.toggleFavorite(),true);
    assert.equal(first.getSnapshot().entry?.status,'watching');
    first.close();
    const reopened=createTitleTracking(alice.api);
    await reopened.open('tv:42',alice.user.id);
    assert.deepEqual(reopened.getSnapshot().watched,['tv:42:1:1']);
    assert.equal(reopened.getSnapshot().myRating,0);
    assert.equal(reopened.getSnapshot().entry?.favorite,true);
    await alice.api('/api/ratings',{method:'PUT',body:JSON.stringify({targetId:'tv:42:1:1',targetType:'episode',score:8})});
    assert.equal(await reopened.watch('tv:42:1:1'),true);
    assert.deepEqual(reopened.getSnapshot().watched,[]);
    assert.equal((await alice.api<{myRating:number|null}>('/api/ratings?targetId=tv:42:1:1')).myRating,null);
    assert.equal(await reopened.markSeason(1),true);
    assert.equal(reopened.getSnapshot().watched.length,2);
    await reopened.markSeason(1);
    assert.equal((await alice.api<{stats:{episodesWatched:number}}>('/api/profile')).stats.episodesWatched,2);
    assert.equal(await reopened.toggleFavorite(),true);
    assert.equal(reopened.getSnapshot().entry?.status,'watching');
    assert.equal(reopened.getSnapshot().entry?.favorite,false);
    const other=createTitleTracking(bob.api);await other.open('tv:42',bob.user.id);
    assert.equal(other.getSnapshot().entry,null);assert.equal(other.getSnapshot().myRating,null);assert.deepEqual(other.getSnapshot().watched,[]);
    // A second client writes; foreground refresh recovers that change.
    await alice.api('/api/ratings',{method:'PUT',body:JSON.stringify({targetId:'tv:42',targetType:'title',score:9.5})});
    await reopened.refresh();assert.equal(reopened.getSnapshot().myRating,9.5);
    await assert.rejects(alice.api('/api/ratings',{method:'PUT',body:JSON.stringify({targetId:'tv:42:1:9',targetType:'episode',score:9})}),error=>error instanceof ApiError && error.status===404 && error.message.includes('Abra a página'));
  } finally {await app.close();await db.close();}
});
