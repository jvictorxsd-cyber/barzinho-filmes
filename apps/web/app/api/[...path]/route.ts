import {after} from 'next/server';
import {isIP} from 'node:net';
import {buildApp} from '../../../../api/src/index';
import type {FastifyInstance} from 'fastify';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
type ApiMethod='GET'|'HEAD'|'POST'|'PUT'|'PATCH'|'DELETE'|'OPTIONS';
let application:Promise<FastifyInstance>|undefined;
function getApp() {
  if(!application) {
    application=buildApp({background:task=>after(()=>task)}).then(async app=>{await app.ready();return app;});
    application.catch(()=>{application=undefined;});
  }
  return application;
}
async function handle(request:Request) {
  if(process.env.BARZINHO_API_MODE!=='embedded') return Response.json({error:'API não configurada.'},{status:503});
  const headers:Record<string,string>={};
  for(const [name,value] of request.headers) {
    if(!['host','content-length','connection','transfer-encoding'].includes(name)) headers[name]=value;
  }
  let payload:Buffer|undefined;
  if(request.body && !['GET','HEAD'].includes(request.method)) {
    const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    for(;;) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>64*1024) {await reader.cancel();return Response.json({error:'Solicitação muito grande.'},{status:413});}
      chunks.push(value);
    }
    if(size)payload=Buffer.concat(chunks);
  }
  const url=new URL(request.url);
  const forwarded=process.env.VERCEL ? (request.headers.get('x-vercel-forwarded-for')??request.headers.get('x-forwarded-for'))?.split(',')[0]?.trim() : undefined;
  try {
    const app=await getApp();
    const response=await app.inject({method:request.method as ApiMethod,url:url.pathname+url.search,headers,payload,remoteAddress:forwarded&&isIP(forwarded)?forwarded:'127.0.0.1'});
    const outgoing=new Headers();
    for(const [name,value] of Object.entries(response.headers)) {
      if(value===undefined || ['transfer-encoding','connection','content-length'].includes(name)) continue;
      for(const item of Array.isArray(value)?value:[value]) outgoing.append(name,String(item));
    }
    return new Response(request.method==='HEAD'||[204,304].includes(response.statusCode)?null:new Uint8Array(response.rawPayload),{status:response.statusCode,headers:outgoing});
  } catch(error) {
    console.error('API startup/request failed',error instanceof Error?error.message:'Unknown error');
    return Response.json({error:'Serviço temporariamente indisponível. Tente novamente em instantes.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
export {handle as GET,handle as HEAD,handle as POST,handle as PUT,handle as PATCH,handle as DELETE,handle as OPTIONS};
