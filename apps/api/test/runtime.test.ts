import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('Vercel runtime can inject API requests and round-trip session cookies without require(ESM)',()=>{
  const result=spawnSync(process.execPath,['--no-experimental-require-module','-e',`
    const assert=require('node:assert/strict');
    const app=require('fastify')();
    async function run(){
      await app.register(require('@fastify/cookie'));
      app.post('/session',async(_req,reply)=>{
        reply.setCookie('session','test-only',{httpOnly:true,secure:true,sameSite:'lax',path:'/'});
        return {ok:true};
      });
      app.get('/me',async req=>({authenticated:req.cookies.session==='test-only'}));
      const created=await app.inject({method:'POST',url:'/session'});
      assert.equal(created.statusCode,200);
      assert.match(created.headers['set-cookie'],/HttpOnly/);
      const me=await app.inject({url:'/me',headers:{cookie:created.headers['set-cookie'].split(';')[0]}});
      assert.equal(me.json().authenticated,true);
      await app.close();
    }
    run().catch(error=>{console.error(error.message);process.exitCode=1;});
  `],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);
});
