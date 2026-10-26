/** Local development inbox. It never relays mail to external recipients. */
import {SMTPServer} from 'smtp-server';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {simpleParser} from 'mailparser';

if(process.env.NODE_ENV==='production')throw new Error('A caixa local não pode ser executada em produção.');
const mailDir=fileURLToPath(new URL('../../../.data/mail/',import.meta.url));
const messages:{id:number;to:string;subject:string;text:string;receivedAt:string}[]=[];
let sequence=0;
const smtp=new SMTPServer({secure:false,key:await readFile(`${mailDir}key.pem`),cert:await readFile(`${mailDir}cert.pem`),authOptional:true,disabledCommands:['AUTH'],logger:false,size:65536,
 onMailFrom(_address,session,callback){if(!session.secure)return callback(new Error('STARTTLS é obrigatório.'));callback()},
 onData(stream,session,callback){const chunks:Buffer[]=[];let bytes=0;stream.on('data',chunk=>{bytes+=chunk.length;if(bytes<=65536)chunks.push(chunk)});stream.on('end',async()=>{
  if(bytes>65536)return callback(new Error('Mensagem grande demais.'));
  try{const parsed=await simpleParser(Buffer.concat(chunks));messages.unshift({id:++sequence,to:session.envelope.rcptTo.map(r=>r.address).join(', '),subject:parsed.subject||'',text:parsed.text||'',receivedAt:new Date().toISOString()});messages.splice(50);callback()}catch{callback(new Error('Mensagem inválida.'))}
 })}
});
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const http=createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
 // Do not expose the loopback inbox to hostile sites through DNS rebinding.
 if(!['127.0.0.1:8025','localhost:8025'].includes(req.headers.host||'')){res.writeHead(403);res.end();return}
 if(req.method!=='GET'){res.writeHead(405);res.end();return}
 if(req.url==='/messages'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:messages}));return}
 if(req.url!=='/'){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Barzinho — caixa local</title><style>body{font:16px system-ui;background:#111216;color:#eee;max-width:850px;margin:40px auto;padding:20px}h1,a{color:#e9b36e}article{padding:24px;border:1px solid #34363e;border-radius:12px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px system-ui}small{color:#aaa}</style><h1>Caixa de e-mail local</h1><p>Somente desenvolvimento. Nenhuma mensagem desta caixa é enviada para a internet.</p><p><a href="/">Atualizar mensagens</a></p>${messages.length?messages.map(m=>`<article><h2>${escape(m.subject)}</h2><small>Para: ${escape(m.to)} · ${escape(m.receivedAt)}</small><pre>${escape(m.text)}</pre>${(m.text.match(/http:\/\/localhost:3000\/(?:verificar-email|redefinir-senha)#token=[A-Za-z0-9_-]{43}/g)||[]).map(link=>`<p><a href="${escape(link)}" rel="noreferrer">Abrir link de confirmação ou recuperação</a></p>`).join('')}</article>`).join(''):'<p>Nenhuma mensagem recebida. Solicite um e-mail pelo perfil ou pela recuperação de senha.</p>'}</html>`);
});
await new Promise<void>((resolve,reject)=>{smtp.once('error',reject);smtp.listen(1025,'127.0.0.1',resolve)});
await new Promise<void>((resolve,reject)=>{http.once('error',reject);http.listen(8025,'127.0.0.1',resolve)});
console.log('Caixa local iniciada: SMTP 1025 com STARTTLS; leitor HTTP 8025, ambos restritos ao loopback.');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{http.close();smtp.close(()=>process.exit(0))});
