import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {registerImages} from '../src/images.js';
test('image gateway validates fixed destinations, caches safe images and rejects non-images and oversized responses',async()=>{
 const app=Fastify();let calls=0;const urls:string[]=[];
 const fetcher:typeof fetch=async input=>{calls++;const url=String(input);urls.push(url);
  if(url.endsWith('/html.jpg'))return new Response('<html>error</html>',{headers:{'content-type':'text/html'}});
  if(url.endsWith('/missing.jpg'))return new Response(null,{status:404});
  if(url.endsWith('/huge.jpg'))return new Response('too big',{headers:{'content-type':'image/jpeg','content-length':String(9*1024*1024)}});
  return new Response(new Uint8Array([255,216,255,217]),{headers:{'content-type':'image/jpeg'}});
 };
 await registerImages(app,fetcher);
 try{
  for(let i=0;i<2;i++){const r=await app.inject('/api/images/w342/poster.jpg');assert.equal(r.statusCode,200);assert.equal(r.headers['content-type'],'image/jpeg');assert.match(String(r.headers['cache-control']),/public/);assert.equal(r.rawPayload.length,4)}
  assert.equal(calls,1);
  assert.equal((await app.inject('/api/images/bad/poster.jpg')).statusCode,400);
  assert.equal((await app.inject('/api/images/w342/unsafe.svg')).statusCode,400);
  assert.equal((await app.inject('/api/images/w342/html.jpg')).statusCode,502);
  assert.equal((await app.inject('/api/images/w342/huge.jpg')).statusCode,502);
  assert.equal((await app.inject('/api/images/w342/missing.jpg')).statusCode,404);
  assert.ok(urls.every(url=>url.startsWith('https://image.tmdb.org/t/p/w342/')));
 }finally{await app.close()}
});
