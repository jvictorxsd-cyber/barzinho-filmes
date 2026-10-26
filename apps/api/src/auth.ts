import {randomBytes, randomUUID} from 'node:crypto';
import {hashPassword,checkPassword,tokenHash} from './passwords.js';
import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import type {DB,QueryExecutor} from '@barzinho/db';
import {z} from 'zod';
import {config, problem} from './config.js';

type UserRow = {id:string;username:string;email:string;display_name:string;bio:string;private_profile:boolean;created_at:string;password_hash:string;email_verified_at:string|null};
export type User = {id:string;username:string;email:string;displayName:string;bio:string;privateProfile:boolean;createdAt:string;emailVerifiedAt:string|null};
declare module 'fastify' { interface FastifyRequest {user: User | null;} }
function present(row:UserRow):User {return {id:row.id,username:row.username,email:row.email,displayName:row.display_name,bio:row.bio,privateProfile:row.private_profile,createdAt:row.created_at,emailVerifiedAt:row.email_verified_at};}
export function requireUser(request:FastifyRequest):User { if(!request.user) problem('Entre na sua conta para continuar.',401); return request.user; }
const credentials=z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(10).max(128)});
export async function registerAuth(app:FastifyInstance,db:DB) {
  app.decorateRequest('user',null);
  app.addHook('preHandler',async request=>{
    const bearer=request.headers.authorization?.startsWith('Bearer ')?request.headers.authorization.slice(7):null;
    const token=bearer||request.cookies.barzinho_session;
    if (token && token.length <= 256) {
      const rows=await db.query<UserRow>('SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()',[tokenHash(token)]);
      if(rows[0])request.user=present(rows[0]);
    }
    if(!['GET','HEAD','OPTIONS'].includes(request.method)) {
      const origin=request.headers.origin;
      if(origin && origin !== config.origin) problem('Origem da solicitação não permitida.',403);
      if(!bearer && request.cookies.barzinho_session && !origin) problem('Origem obrigatória para sessões do navegador.',403);
    }
  });
  async function session(reply:FastifyReply,user:UserRow,executor:QueryExecutor=db) {
    const token=randomBytes(32).toString('base64url');
    await executor.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'30 days\')',[tokenHash(token),user.id]);
    reply.setCookie('barzinho_session',token,{httpOnly:true,secure:config.production,sameSite:'lax',path:'/',maxAge:30*86400});
    reply.header('Cache-Control','no-store');
    return {user:present(user),token};
  }
  app.post('/api/auth/register',{config:{rateLimit:{max:10,timeWindow:'1 hour'}}},async(req,reply)=>{
    const input=credentials.extend({username:z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).transform(v=>v.toLowerCase()),displayName:z.string().trim().min(1).max(80)}).parse(req.body);
    const existing=await db.query('SELECT id FROM users WHERE email=$1 OR username=$2',[input.email,input.username]);
    if(existing.length)problem('E-mail ou nome de usuário indisponível.',409);
    let users:UserRow[];
    try { users=await db.query<UserRow>('INSERT INTO users(id,username,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),input.username,input.email,input.displayName,await hashPassword(input.password)]); }
    catch(error) {if((error as {code?:string}).code==='23505')problem('E-mail ou nome de usuário indisponível.',409);throw error;}
    reply.code(201);return session(reply,users[0]);
  });
  app.post('/api/auth/login',{config:{rateLimit:{max:20,timeWindow:'15 minutes'}}},async(req,reply)=>{
    const input=credentials.parse(req.body);
    return db.transaction(async tx=>{
      const users=await tx.query<UserRow>('SELECT * FROM users WHERE email=$1 FOR UPDATE',[input.email]);
      if(!users[0]||!await checkPassword(input.password,users[0].password_hash))problem('E-mail ou senha inválidos.',401);
      return session(reply,users[0],tx);
    });
  });
  app.get('/api/auth/me',async req=>({user:requireUser(req)}));
  app.post('/api/auth/logout',async(req,reply)=>{
    const token=req.headers.authorization?.slice(7)||req.cookies.barzinho_session;
    if(token)await db.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(token)]);
    reply.clearCookie('barzinho_session',{path:'/'});return {ok:true};
  });
  app.patch('/api/account',async req=>{
    const user=requireUser(req);
    const input=z.object({displayName:z.string().trim().min(1).max(80),bio:z.string().max(500),privateProfile:z.boolean()}).parse(req.body);
    const rows=await db.query<UserRow>('UPDATE users SET display_name=$1,bio=$2,private_profile=$3 WHERE id=$4 RETURNING *',[input.displayName,input.bio,input.privateProfile,user.id]);
    return {user:present(rows[0])};
  });
  app.get('/api/account/export',async(req,reply)=>{
    const user=requireUser(req);const result:Record<string,unknown>={user};
    for(const table of ['library','episode_watches','diary','ratings','comments','character_votes','earned_achievements','custom_lists','comment_likes','notifications','moderation_reports']) result[table]=await db.query(`SELECT * FROM ${table} WHERE user_id=$1`,[user.id]);
    result.follows=await db.query('SELECT follower_id,following_id,created_at FROM follows WHERE follower_id=$1 OR following_id=$1',[user.id]);
    result.list_items=await db.query('SELECT i.* FROM list_items i JOIN custom_lists l ON l.id=i.list_id WHERE l.user_id=$1',[user.id]);
    reply.header('Content-Disposition','attachment; filename="barzinho-dados.json"');return result;
  });
  app.post('/api/account/revoke-sessions',async(req,reply)=>{const user=requireUser(req);await db.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);reply.clearCookie('barzinho_session',{path:'/'});return {ok:true};});
  app.delete('/api/account',async(req,reply)=>{
    const user=requireUser(req);const {password}=z.object({password:z.string().max(128)}).parse(req.body);
    const rows=await db.query<UserRow>('SELECT * FROM users WHERE id=$1',[user.id]);
    if(!await checkPassword(password,rows[0].password_hash))problem('Senha inválida.',401);
    await db.query('DELETE FROM users WHERE id=$1',[user.id]);reply.clearCookie('barzinho_session',{path:'/'});return {ok:true};
  });
}
