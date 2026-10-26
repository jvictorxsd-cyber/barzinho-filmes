import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {SMTPServer} from 'smtp-server';
const execute=promisify(execFile);

test('SMTP delivers over verified STARTTLS and rejects an untrusted certificate',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'barzinho-smtp-'));
 let server:SMTPServer|undefined;
 try{
  const certPath=join(directory,'cert.pem'),keyPath=join(directory,'key.pem');
  await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1']);
  const received:{secure:boolean;text:string}[]=[];
  server=new SMTPServer({secure:false,key:await readFile(keyPath),cert:await readFile(certPath),authOptional:true,disabledCommands:['AUTH'],logger:false,
   onData(stream,session,callback){let text='';stream.on('data',chunk=>{text+=chunk.toString()});stream.on('end',()=>{received.push({secure:session.secure,text});callback()})}
  });
  server.on('error',()=>{});
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const address=server.server.address();assert.ok(address&&typeof address!=='string');
  const source=new URL('../src/mail.ts',import.meta.url).href;
  const script=`import {createMailer} from ${JSON.stringify(source)};const mailer=createMailer();try{await mailer.send({to:'receiver@example.invalid',subject:'SMTP integration test',text:'Isolated SMTP fixture'});}finally{mailer.close?.()}`;
  const environment={...process.env,SMTP_HOST:'127.0.0.1',SMTP_PORT:String(address.port),SMTP_FROM:'sender@example.invalid',SMTP_USER:'',SMTP_PASSWORD:'',NODE_EXTRA_CA_CERTS:certPath};
  await execute(process.execPath,['--import','tsx','--input-type=module','-e',script],{env:environment,timeout:20000});
  assert.equal(received.length,1);assert.equal(received[0].secure,true);assert.match(received[0].text,/Isolated SMTP fixture/);
  await assert.rejects(execute(process.execPath,['--import','tsx','--input-type=module','-e',script],{env:{...environment,NODE_EXTRA_CA_CERTS:''},timeout:20000}));
  assert.equal(received.length,1,'untrusted TLS must not deliver a second message');
 }finally{
  if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
  await rm(directory,{recursive:true,force:true});
 }
});
