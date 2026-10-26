import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMovieDiary} from '../src/movie-diary.js';
import type {Request} from '../src/title-tracking.js';

test('lost movie responses survive restart without duplicate sessions; intentional rewatches get fresh IDs',async () => {
  const saved=new Map<string,string>();
  const storage={getItemAsync:async (key:string)=>saved.get(key) ?? null,setItemAsync:async (key:string,value:string)=>{saved.set(key,value);},deleteItemAsync:async (key:string)=>{saved.delete(key);}};
  const sessions=new Set<string>();let loseResponse=true;
  const attempts: {idempotencyKey:string;watchedAt:string}[]=[];
  const request: Request=async <T>(_path:string,init?:RequestInit)=> {
    const operation=JSON.parse(init!.body as string);
    attempts.push(operation);
    const {idempotencyKey}=operation;
    const created=!sessions.has(idempotencyKey);sessions.add(idempotencyKey);
    if(loseResponse) {loseResponse=false;throw new Error('Connection lost after commit');}
    return {created} as T;
  };
  const first=createMovieDiary(request,storage);
  const saving=first.record('alice','movie:1');
  assert.equal(await first.record('alice','movie:1'),null);
  await assert.rejects(saving,/Connection lost/);
  const restarted=createMovieDiary(request,storage);
  assert.deepEqual(await restarted.record('alice','movie:1'),{created:false});
  assert.equal(sessions.size,1);
  assert.deepEqual(attempts[0],attempts[1]);
  assert.ok(Number.isFinite(Date.parse(attempts[0].watchedAt)));
  assert.deepEqual(await restarted.record('alice','movie:1'),{created:true});
  assert.equal(sessions.size,2);
  assert.equal(saved.size,0);
});
