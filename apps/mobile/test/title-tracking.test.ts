import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTitleTracking, type Request} from '../src/title-tracking.js';

const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => {resolve=done;});
  return {promise,resolve};
};

test('late responses cannot restore another title or signed-out account',async () => {
  const pending: ReturnType<typeof deferred>[] = [];
  const request: Request = async <T>() => {const item=deferred();pending.push(item);return await item.promise as T;};
  const tracking=createTitleTracking(request);
  const old=tracking.open('tv:1','alice');
  const newer=tracking.open('movie:2','bob');
  pending[3].resolve({items:[]});pending[4].resolve({myRating:0});
  await newer;
  pending[0].resolve({items:[{id:'tv:1',status:'watching',favorite:true}]});
  pending[1].resolve({myRating:10});pending[2].resolve({items:[{episodeId:'tv:1:1:1'}]});
  await old;
  assert.equal(tracking.getSnapshot().titleId,'movie:2');
  assert.equal(tracking.getSnapshot().myRating,0);
  assert.deepEqual(tracking.getSnapshot().watched,[]);
  const refresh=tracking.refresh();tracking.close();
  pending[5].resolve({items:[{id:'movie:2',status:'completed',favorite:true}]});pending[6].resolve({myRating:7});
  await refresh;
  assert.equal(tracking.getSnapshot().userId,null);
  assert.equal(tracking.getSnapshot().entry,null);
});

test('writes wait for hydration, reject duplicate taps, and reconcile ambiguous failures',async () => {
  let fail=false;let mutations=0;
  const write=deferred();
  const request: Request=async <T>(path:string,init?:RequestInit) => {
    if(init?.method) {mutations++;return await write.promise as T;}
    if(fail) throw new Error('Conexão interrompida');
    return (path==='/api/library'?{items:[]}:{myRating:null}) as T;
  };
  const tracking=createTitleTracking(request);
  assert.equal(await tracking.rate(9),false);
  await tracking.open('movie:2','alice');
  const saving=tracking.rate(9);
  assert.equal(await tracking.rate(9),false);
  fail=true;write.resolve({ok:true});
  assert.equal(await saving,false);
  assert.equal(tracking.getSnapshot().ready,false);
  assert.match(tracking.getSnapshot().error,/Conexão/);
  assert.equal(await tracking.toggleFavorite(),false);
  assert.equal(mutations,1);
  fail=false;await tracking.refresh();
  assert.equal(tracking.getSnapshot().ready,true);
});
