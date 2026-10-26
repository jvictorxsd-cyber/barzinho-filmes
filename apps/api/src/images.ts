import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {proxyFetch} from './network.js';

/** Fixed TMDB origin; never accepts arbitrary URLs or forwards account credentials. */
export async function registerImages(app:FastifyInstance,fetcher:typeof fetch=proxyFetch){
 const cache=new Map<string,{bytes:Buffer;type:string;at:number}>();let used=0;
 const maxImageBytes=8*1024*1024,maxCacheBytes=32*1024*1024,ttl=6*3600*1000;
 app.get('/api/images/:size/:file',{config:{rateLimit:{max:300,timeWindow:'1 minute'}}},async(req,reply)=>{
  const input=z.object({size:z.enum(['w92','w154','w185','w300','w342','w500','w780','w1280','original']),file:z.string().regex(/^[a-zA-Z0-9_-]{1,100}\.(jpg|jpeg|png|webp)$/i)}).safeParse(req.params);
  if(!input.success)return reply.code(400).send({error:'Imagem inválida.'});
  const key=`${input.data.size}/${input.data.file}`;
  const send=(item:{bytes:Buffer;type:string})=>reply.header('Cache-Control','public, max-age=21600').header('X-Content-Type-Options','nosniff').type(item.type).send(item.bytes);
  const cached=cache.get(key);
  if(cached&&Date.now()-cached.at<ttl)return send(cached);
  if(cached){cache.delete(key);used-=cached.bytes.length}
  try{
   const response=await fetcher(`https://image.tmdb.org/t/p/${key}`,{signal:AbortSignal.timeout(15000)});
   if(response.status===404){await response.body?.cancel();return reply.code(404).send({error:'Imagem não encontrada.'})}
   const type=response.headers.get('content-type')?.split(';')[0]||'';
   if(!response.ok||!['image/jpeg','image/png','image/webp'].includes(type)||Number(response.headers.get('content-length'))>maxImageBytes){await response.body?.cancel();return reply.code(502).send({error:'Imagem indisponível.'})}
   if(!response.body)return reply.code(502).send({error:'Imagem indisponível.'});
   const reader=response.body.getReader();const chunks:Buffer[]=[];let size=0;
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxImageBytes){await reader.cancel();return reply.code(502).send({error:'Imagem indisponível.'})}chunks.push(Buffer.from(part.value))}}finally{reader.releaseLock()}
   const bytes=Buffer.concat(chunks);if(!bytes.length)return reply.code(502).send({error:'Imagem indisponível.'});
   while(cache.size>=64||used+bytes.length>maxCacheBytes){const oldest=cache.keys().next().value;if(!oldest)break;used-=cache.get(oldest)!.bytes.length;cache.delete(oldest)}
   const item={bytes,type,at:Date.now()};cache.set(key,item);used+=bytes.length;
   return send(item);
  }catch{return reply.code(502).send({error:'Imagem indisponível.'})}
 });
}
