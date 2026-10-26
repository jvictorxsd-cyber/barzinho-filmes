import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {existsSync} from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {ZodError} from 'zod';
import {createDb,type DB} from '@barzinho/db';
import {registerAuth} from './auth.js';
import {registerTracking} from './tracking.js';
import {registerDiscovery} from './discovery.js';
import {registerCommunity} from './community.js';
import {registerCatalog} from './catalog.js';
import {registerAccountSecurity} from './account-security.js';
import {createMailer,publicWebOrigin,type Mailer} from './mail.js';
import {registerImages} from './images.js';
import {config} from './config.js';

export async function buildApp(options:{db?:DB;logger?:boolean;mailer?:Mailer;background?:(task:Promise<void>)=>void}={}) {
  const db=options.db||await createDb();
  const app=Fastify({logger:options.logger??true,bodyLimit:64*1024,trustProxy:false});
  await app.register(cookie);
  await app.register(cors,{origin:config.origin,credentials:true,methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS']});
  await app.register(rateLimit,{max:150,timeWindow:'1 minute'});
  app.addHook('onSend',async(_req,reply)=>{reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','strict-origin-when-cross-origin');if(!reply.hasHeader('Cache-Control'))reply.header('Cache-Control','no-store');});
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ZodError)return reply.code(400).send({error:'Dados inválidos.',issues:error.issues.map(i=>({path:i.path,message:i.message}))});
    const status=(error as {statusCode?:number}).statusCode||500;
    if(status>=500)request.log.error(error);
    return reply.code(status).send({error:status>=500?'Não foi possível concluir a solicitação. Tente novamente.':(error as Error).message});
  });
  await registerAuth(app,db);
  const mailer=options.mailer||createMailer();
  const drainMail=await registerAccountSecurity(app,db,mailer,publicWebOrigin(),options.background);
  await registerCatalog(app,db);
  await registerImages(app);
  await registerTracking(app,db);
  await registerCommunity(app,db);
  await registerDiscovery(app,db);
  app.get('/api/health',async()=>{await db.query('SELECT 1');return {status:'ok',database:'connected',catalogConfigured:Boolean(process.env.TMDB_TOKEN||process.env.TMDB_API_KEY)};});
  app.addHook('onClose',async()=>{await drainMail();if(!options.mailer)mailer.close?.();if(!options.db)await db.close()});
  return app;
}
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main) {
  const envPath=resolve(dirname(fileURLToPath(import.meta.url)),'../../../.env');
  if(existsSync(envPath))process.loadEnvFile(envPath);
  // Config values are evaluated on startup, after optional local .env loading.
  config.origin=process.env.WEB_ORIGIN||config.origin;
  config.port=Number(process.env.API_PORT||process.env.PORT||config.port);
  config.production=process.env.NODE_ENV==='production';
  if(config.production&&!process.env.WEB_ORIGIN)throw new Error('WEB_ORIGIN é obrigatório em produção.');
  const app=await buildApp();
  await app.listen({port:config.port,host:config.host});
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await app.close();process.exit(0);});
}
