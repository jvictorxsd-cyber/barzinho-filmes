import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDb} from '@barzinho/db';
import {buildApp} from '../src/index.js';
import type {AccountMail,Mailer} from '../src/mail.js';
import {publicWebOrigin} from '../src/mail.js';
import {tokenHash} from '../src/passwords.js';

const password='Initial-password-123';
function capturedMailer(){
 const messages:AccountMail[]=[];
 const mailer:Mailer={available:true,async send(message){messages.push(message)}};
 return {messages,mailer};
}
const readToken=(message:AccountMail)=>new URLSearchParams(new URL(message.text.match(/https?:\/\/[^\s]+/)![0]).hash.slice(1)).get('token')!;
async function waitFor(check:()=>Promise<boolean>|boolean){for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10))}assert.fail('Background delivery did not finish')}
async function signup(app:Awaited<ReturnType<typeof buildApp>>,name:string){const r=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:name,displayName:name,email:`${name}@example.invalid`,password}});assert.equal(r.statusCode,201,r.body);return r.json()}

test('password recovery stores hashes, consumes tokens once, and revokes only the target account sessions',async()=>{
 const db=await createDb({dataDir:':memory:'});const {messages,mailer}=capturedMailer();const app=await buildApp({db,logger:false,mailer});
 try{
  const alice=await signup(app,'recovery_alice'),bob=await signup(app,'recovery_bob');
  const existing=await app.inject({method:'POST',url:'/api/auth/forgot-password',payload:{email:'recovery_alice@example.invalid'}});
  const unknown=await app.inject({method:'POST',url:'/api/auth/forgot-password',payload:{email:'unknown@example.invalid'}});
  assert.equal(existing.statusCode,202);assert.equal(unknown.statusCode,202);assert.deepEqual(existing.json(),unknown.json());
  await waitFor(()=>messages.length===1);const token=readToken(messages[0]);
  assert.equal(messages[0].to,'recovery_alice@example.invalid');
  const rows=await db.query<{token_hash:string}>('SELECT * FROM account_tokens');assert.equal(rows.length,1);assert.equal(rows[0].token_hash,tokenHash(token));assert.ok(!JSON.stringify(rows).includes(token));assert.ok(!existing.body.includes(token));
  assert.equal((await app.inject({method:'POST',url:'/api/auth/verify-email',payload:{token}})).statusCode,400);
  const attempts=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:'/api/auth/reset-password',payload:{token,password:'New-password-456'}})));
  assert.deepEqual(attempts.map(r=>r.statusCode).sort(),[200,400]);
  assert.equal((await app.inject({url:'/api/auth/me',headers:{authorization:`Bearer ${alice.token}`}})).statusCode,401);
  assert.equal((await app.inject({url:'/api/auth/me',headers:{authorization:`Bearer ${bob.token}`}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'recovery_alice@example.invalid',password}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'recovery_alice@example.invalid',password:'New-password-456'}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/reset-password',payload:{token,password:'Reuse-password-789'}})).statusCode,400);
  // A login racing a reset must either reject the old password or have its new session revoked.
  await db.query("UPDATE account_tokens SET created_at=now()-interval '2 minutes' WHERE user_id=$1",[alice.user.id]);
  await app.inject({method:'POST',url:'/api/auth/forgot-password',payload:{email:'recovery_alice@example.invalid'}});await waitFor(()=>messages.length===2);
  const raceToken=readToken(messages[1]);
  const [login,reset]=await Promise.all([
   app.inject({method:'POST',url:'/api/auth/login',payload:{email:'recovery_alice@example.invalid',password:'New-password-456'}}),
   app.inject({method:'POST',url:'/api/auth/reset-password',payload:{token:raceToken,password:'Final-password-789'}}),
  ]);
  assert.equal(reset.statusCode,200,reset.body);
  if(login.statusCode===200)assert.equal((await app.inject({url:'/api/auth/me',headers:{authorization:`Bearer ${login.json().token}`}})).statusCode,401);
  else assert.equal(login.statusCode,401);

 }finally{await app.close();await db.close()}
});

test('verification is explicit, purpose-bound and idempotent in its account state; expired reset fails',async()=>{
 const db=await createDb({dataDir:':memory:'});const {messages,mailer}=capturedMailer();const app=await buildApp({db,logger:false,mailer});
 try{
  const user=await signup(app,'verify_alice');const headers={authorization:`Bearer ${user.token}`};
  assert.equal(user.user.emailVerifiedAt,null);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/request-verification'})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/request-verification',headers})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/request-verification',headers})).statusCode,200);assert.equal(messages.length,1,'cooldown prevents duplicate deliveries');
  const token=readToken(messages[0]);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/reset-password',payload:{token,password:'Different-password-123'}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/verify-email',payload:{token}})).statusCode,200);
  assert.ok((await app.inject({url:'/api/auth/me',headers})).json().user.emailVerifiedAt);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/verify-email',payload:{token}})).statusCode,400);
  await app.inject({method:'POST',url:'/api/auth/forgot-password',payload:{email:'verify_alice@example.invalid'}});await waitFor(()=>messages.length===2);
  const resetToken=readToken(messages[1]);
  await db.query("UPDATE account_tokens SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE token_hash=$1",[tokenHash(resetToken)]);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/reset-password',payload:{token:resetToken,password:'Expired-password-123'}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'verify_alice@example.invalid',password}})).statusCode,200);
 }finally{await app.close();await db.close()}
});

test('missing mail configuration is explicit; provider failure does not expose addresses or leave usable tokens',async()=>{
 const db=await createDb({dataDir:':memory:'});const app=await buildApp({db,logger:false,mailer:{available:false,async send(){throw Error('must not be invoked')}}});
 try{
  assert.equal((await app.inject({url:'/api/auth/email/status'})).json().available,false);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/forgot-password',payload:{email:'unknown@example.invalid'}})).statusCode,503);
 }finally{await app.close()}
 const failed=await buildApp({db,logger:false,mailer:{available:true,async send(){throw Error('provider error with private context')}}});
 try{
  await signup(failed,'failed_mail');
  const response=await failed.inject({method:'POST',url:'/api/auth/forgot-password',payload:{email:'failed_mail@example.invalid'}});
  assert.equal(response.statusCode,202);assert.ok(!response.body.includes('provider'));assert.ok(!response.body.includes('failed_mail'));
  await failed.close();assert.equal((await db.query('SELECT * FROM account_tokens')).length,0);
 }finally{await db.close()}
});

test('mail links use only configured trusted origins',()=>{
 assert.equal(publicWebOrigin({PUBLIC_WEB_URL:'https://barzinho.example'}),'https://barzinho.example');
 assert.throws(()=>publicWebOrigin({NODE_ENV:'production',PUBLIC_WEB_URL:'http://barzinho.example'}));
 assert.throws(()=>publicWebOrigin({PUBLIC_WEB_URL:'https://user:pass@barzinho.example'}));
 assert.throws(()=>publicWebOrigin({PUBLIC_WEB_URL:'https://barzinho.example/redirect?next=bad'}));
});
