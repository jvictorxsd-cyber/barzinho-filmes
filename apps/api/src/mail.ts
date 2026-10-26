import nodemailer from 'nodemailer';
import {z} from 'zod';
export type AccountMail={to:string;subject:string;text:string};
export interface Mailer {available:boolean;send(message:AccountMail):Promise<void>;close?():void}

/** Credentials remain server-side. SMTP always uses verified TLS, including STARTTLS on port 587. */
export function createMailer(env:NodeJS.ProcessEnv=process.env):Mailer{
 if(!env.SMTP_HOST||!env.SMTP_FROM)return {available:false,async send(){throw new Error('MAIL_NOT_CONFIGURED')}};
 const host=z.string().regex(/^[a-zA-Z0-9.-]+$/).parse(env.SMTP_HOST);
 const from=z.email().parse(env.SMTP_FROM);
 const port=z.coerce.number().int().min(1).max(65535).parse(env.SMTP_PORT||587);
 if(Boolean(env.SMTP_USER)!==Boolean(env.SMTP_PASSWORD))throw new Error('SMTP_USER e SMTP_PASSWORD devem ser configurados juntos.');
 const transport=nodemailer.createTransport({
  host,port,secure:port===465,requireTLS:true,
  auth:env.SMTP_USER?{user:env.SMTP_USER,pass:env.SMTP_PASSWORD}:undefined,
  tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},
  connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
  logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true,
 });
 return {available:true,async send(message){
  const sent=await transport.sendMail({from,to:message.to,subject:message.subject,text:message.text});
  if(!sent.accepted?.length)throw new Error('MAIL_DELIVERY_FAILED');
 },close:()=>transport.close()};
}

export function publicWebOrigin(env:NodeJS.ProcessEnv=process.env){
 const url=new URL(env.PUBLIC_WEB_URL||env.WEB_ORIGIN||'http://localhost:3000');
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(env.NODE_ENV!=='production'&&local&&url.protocol==='http:'))){
  throw new Error('PUBLIC_WEB_URL deve conter somente uma origem HTTPS (HTTP local apenas em desenvolvimento).');
 }
 return url.origin;
}
