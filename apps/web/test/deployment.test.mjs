import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function config(env) {
  return spawnSync(process.execPath,['--input-type=module','-e',"const {default:config}=await import('./next.config.mjs'); process.stdout.write(JSON.stringify(await config.rewrites()));"],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',env:{...process.env,VERCEL:'',API_INTERNAL_URL:'',...env},
  });
}
test('local development retains the API proxy',()=>{
  const result=config({});assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout)[0].destination,'http://127.0.0.1:4000/api/:path*');
});
test('Vercel build rejects missing, insecure or loopback API origins',()=>{
  for(const origin of ['', 'http://api.example.com', 'https://localhost:4000', 'https://127.0.0.1:4000', 'https://[::1]:4000']) {
    const result=config({VERCEL:'1',API_INTERNAL_URL:origin});
    assert.notEqual(result.status,0);assert.match(result.stderr,/API_INTERNAL_URL/);
  }
});
test('deployed requests preserve their API path and never embed credentials',()=>{
  const result=config({VERCEL:'1',API_INTERNAL_URL:'https://api.example.com/'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout)[0].destination,'https://api.example.com/api/:path*');
  for(const origin of ['https://user:password@api.example.com','https://api.example.com/api','https://api.example.com?token=example']) {
    assert.notEqual(config({VERCEL:'1',API_INTERNAL_URL:origin}).status,0);
  }
});
