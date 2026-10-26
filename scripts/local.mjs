import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));const directory=join(root,'.data/mail');
if(process.env.NODE_ENV==='production')throw new Error('O modo local é destinado ao desenvolvimento.');
await mkdir(directory,{recursive:true});
const cert=join(directory,'cert.pem'),key=join(directory,'key.pem');
try{execFileSync('openssl',['x509','-checkend','3600','-noout','-in',cert],{stdio:'ignore'})}
catch{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','30','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});}
const originalCA=process.env.NODE_EXTRA_CA_CERTS?await readFile(process.env.NODE_EXTRA_CA_CERTS):Buffer.alloc(0);
const bundle=join(directory,'trusted-ca.pem');await writeFile(bundle,Buffer.concat([originalCA,Buffer.from('\n'),await readFile(cert)]));
const mode=process.argv.includes('--built')?'start':'dev';
const child=spawn(process.execPath,[join(root,'node_modules/concurrently/dist/bin/concurrently.js'),'-k','-n','mail,api,web','npm run dev:mail -w @barzinho/api',`npm run ${mode} -w @barzinho/api`,`npm run ${mode} -w @barzinho/web`],{
 cwd:root,stdio:'inherit',env:{...process.env,NODE_EXTRA_CA_CERTS:bundle,SMTP_HOST:'127.0.0.1',SMTP_PORT:'1025',SMTP_FROM:'conta@barzinho.local',SMTP_USER:'',SMTP_PASSWORD:'',PUBLIC_WEB_URL:'http://localhost:3000',WEB_ORIGIN:'http://localhost:3000'},
});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??0));
