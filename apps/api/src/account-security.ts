import {randomBytes} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {DB} from '@barzinho/db';
import {z} from 'zod';
import {requireUser} from './auth.js';
import {problem} from './config.js';
import {hashPassword,tokenHash} from './passwords.js';
import type {Mailer} from './mail.js';

type Purpose='reset_password'|'verify_email';
const tokenSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const genericResponse={ok:true,message:'Solicitação recebida. Se esse e-mail estiver cadastrado, confira sua caixa de entrada e spam.'};

export async function registerAccountSecurity(app:FastifyInstance,db:DB,mailer:Mailer,webOrigin:string,background?:(task:Promise<void>)=>void){
 const pendingDeliveries=new Set<Promise<void>>();
 function requireMail(){if(!mailer.available)problem('O envio de e-mails está indisponível no momento. Tente novamente mais tarde.',503)}
 async function issue(userId:string,email:string,purpose:Purpose){
  const token=randomBytes(32).toString('base64url');const hash=tokenHash(token);
  const issued=await db.transaction(async tx=>{
   // Serialize issuance and consumption per account, including across API replicas.
   const users=await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);if(!users.length)return false;
   const recent=await tx.query("SELECT token_hash FROM account_tokens WHERE user_id=$1 AND purpose=$2 AND created_at>now()-interval '1 minute'",[userId,purpose]);
   if(recent.length)return false;
   await tx.query("DELETE FROM account_tokens WHERE user_id=$1 AND expires_at<now()-interval '1 day'",[userId]);
   await tx.query('UPDATE account_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL',[userId,purpose]);
   await tx.query("INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+($4::int * interval '1 minute'))",[hash,userId,purpose,purpose==='reset_password'?30:1440]);
   return true;
  });
  if(!issued)return;
  const isReset=purpose==='reset_password';
  // Fragments never travel in HTTP request URLs or referrers. The frontend removes the fragment after reading.
  const link=`${webOrigin}/${isReset?'redefinir-senha':'verificar-email'}#token=${encodeURIComponent(token)}`;
  try{
   await mailer.send({to:email,subject:isReset?'Redefina sua senha no Barzinho':'Confirme seu e-mail no Barzinho',text:`${isReset?'Recebemos uma solicitação para redefinir sua senha.':'Confirme este endereço de e-mail para sua conta no Barzinho.'}\n\n${link}\n\nEste link é de uso único e expira em ${isReset?'30 minutos':'24 horas'}. Se você não fez esta solicitação, ignore esta mensagem. Sua senha não será alterada sem a confirmação.`});
  }catch{
   await db.query('DELETE FROM account_tokens WHERE token_hash=$1 AND consumed_at IS NULL',[hash]);
   // Do not log provider errors: they may contain recipient addresses, SMTP credentials or message content.
   app.log.warn({event:'account_mail_delivery_failed',purpose},'Falha no envio de e-mail de conta.');
   problem('Não foi possível enviar o e-mail. Tente novamente mais tarde.',503);
  }
 }
 app.get('/api/auth/email/status',async()=>({available:mailer.available}));
 app.post('/api/auth/forgot-password',{config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async(req,reply)=>{
  const {email}=z.object({email:z.email().max(254).transform(value=>value.toLowerCase())}).parse(req.body);
  requireMail();
  if(pendingDeliveries.size>=50)problem('Serviço de e-mail ocupado. Tente novamente mais tarde.',503);
  const [user]=await db.query<{id:string;email:string}>('SELECT id,email FROM users WHERE email=$1',[email]);
  if(user){
   // Respond independently of SMTP latency, so delivery timing does not disclose account existence.
   const delivery=issue(user.id,user.email,'reset_password').catch(()=>{app.log.warn({event:'password_reset_delivery_failed'},'Solicitação de recuperação não entregue.');});
   pendingDeliveries.add(delivery);
   background?.(delivery);
   void delivery.finally(()=>pendingDeliveries.delete(delivery));
  }
  reply.code(202);return genericResponse;
 });
 app.post('/api/auth/reset-password',{config:{rateLimit:{max:10,timeWindow:'15 minutes'}}},async(req,reply)=>{
  const {token,password}=z.object({token:tokenSchema,password:z.string().min(10).max(128)}).parse(req.body);
  const hash=tokenHash(token);
  const [candidate]=await db.query<{user_id:string}>("SELECT user_id FROM account_tokens WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>now()",[hash]);
  if(!candidate)problem('Link inválido ou expirado. Solicite outro e-mail.',400);
  const passwordHash=await hashPassword(password);
  await db.transaction(async tx=>{
   await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[candidate.user_id]);
   const consumed=await tx.query("UPDATE account_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>now() RETURNING user_id",[hash]);
   if(!consumed.length)problem('Link inválido ou expirado. Solicite outro e-mail.',400);
   await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2',[passwordHash,candidate.user_id]);
   await tx.query('DELETE FROM sessions WHERE user_id=$1',[candidate.user_id]);
   await tx.query("UPDATE account_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose='reset_password' AND consumed_at IS NULL",[candidate.user_id]);
  });
  reply.clearCookie('barzinho_session',{path:'/'});
  return {ok:true,message:'Senha atualizada. Entre novamente em seus dispositivos.'};
 });
 app.post('/api/auth/request-verification',{config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async req=>{
  const user=requireUser(req);requireMail();
  if(user.emailVerifiedAt)return {ok:true,message:'Seu e-mail já está confirmado.'};
  await issue(user.id,user.email,'verify_email');
  return {ok:true,message:'Confira sua caixa de entrada e spam. Aguarde um minuto antes de solicitar outro envio.'};
 });
 app.post('/api/auth/verify-email',{config:{rateLimit:{max:10,timeWindow:'15 minutes'}}},async req=>{
  const {token}=z.object({token:tokenSchema}).parse(req.body);const hash=tokenHash(token);
  const [candidate]=await db.query<{user_id:string}>("SELECT user_id FROM account_tokens WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>now()",[hash]);
  if(!candidate)problem('Link inválido ou expirado. Solicite outro e-mail.',400);
  await db.transaction(async tx=>{
   await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[candidate.user_id]);
   const rows=await tx.query("UPDATE account_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>now() RETURNING user_id",[hash]);
   if(!rows.length)problem('Link inválido ou expirado. Solicite outro e-mail.',400);
   await tx.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1',[candidate.user_id]);
  });
  return {ok:true,message:'E-mail confirmado.'};
 });
 return async()=>{await Promise.allSettled([...pendingDeliveries])};
}
