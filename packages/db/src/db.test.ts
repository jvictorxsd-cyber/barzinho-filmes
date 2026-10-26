import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDb } from './index.js';

test('migrations, persistence, uniqueness, watch prerequisites, and atomic rollback', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'barzinho-db-'));
  let db = await createDb({ dataDir });
  try {
    await db.query("INSERT INTO users(id, username, email, display_name, password_hash) VALUES ('u1', 'testuser', 'test@example.test', 'Teste', 'test-only')");
    await db.query("INSERT INTO catalog_titles(id, media_type, external_id, title) VALUES ('tv:1', 'tv', 1, 'Fixture only')");
    await db.query("INSERT INTO catalog_episodes(id,title_id,season_number,episode_number,title) VALUES ('tv:1:1:1','tv:1',1,1,'Fixture only')");

    await assert.rejects(db.query("INSERT INTO character_votes(user_id,episode_id,person_id) VALUES ('u1','tv:1:1:1',1)"), /foreign key/i);
    await assert.rejects(db.query("INSERT INTO ratings(user_id,target_id,target_type,score) VALUES ('u1','tv:1:1:1','episode',8.5)"), /foreign key/i);
    await db.query("INSERT INTO episode_watches(user_id,episode_id) VALUES ('u1','tv:1:1:1')");
    await assert.rejects(db.query("INSERT INTO episode_watches(user_id,episode_id) VALUES ('u1','tv:1:1:1')"), /duplicate key/i);
    await db.query("INSERT INTO character_votes(user_id,episode_id,person_id) VALUES ('u1','tv:1:1:1',1)");
    await db.query("INSERT INTO ratings(user_id,target_id,target_type,score) VALUES ('u1','tv:1:1:1','episode',8.5)");
    await db.query("DELETE FROM episode_watches WHERE user_id='u1' AND episode_id='tv:1:1:1'");
    assert.equal((await db.query('SELECT * FROM character_votes')).length, 0);
    assert.equal((await db.query('SELECT * FROM ratings')).length, 0);

    await assert.rejects(db.query("INSERT INTO ratings(user_id,target_id,target_type,score) VALUES ('u1','tv:1','title',7.25)"), /check constraint/i);
    await assert.rejects(db.transaction(async tx => {
      await tx.query("UPDATE users SET bio='Should roll back' WHERE id='u1'");
      throw new Error('deliberate rollback');
    }), /deliberate rollback/);
    assert.equal((await db.query<{ bio: string }>("SELECT bio FROM users WHERE id='u1'"))[0]?.bio, '');

    await db.close();
    db = await createDb({ dataDir });
    assert.equal((await db.query('SELECT * FROM users')).length, 1, 'data survives a fresh database instance');
    assert.deepEqual((await db.query<{name:string}>('SELECT name FROM schema_migrations ORDER BY name')).map(row=>row.name), ['001_initial.sql','002_account_tokens.sql'], 'each migration is applied once');
    assert.equal((await db.query<{email_verified_at:string|null}>("SELECT email_verified_at FROM users WHERE id='u1'"))[0].email_verified_at,null);
  } finally {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('account security migration upgrades an existing database without changing users or their passwords',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const {readFile}=await import('node:fs/promises');
 const directory=await mkdtemp(join(tmpdir(),'barzinho-upgrade-'));
 let upgraded:Awaited<ReturnType<typeof createDb>>|undefined;
 try{
  const legacy=new PGlite(directory);await legacy.waitReady;
  try{
   await legacy.exec(await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));
   await legacy.exec("CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now()); INSERT INTO schema_migrations(name) VALUES('001_initial.sql')");
   await legacy.query("INSERT INTO users(id,username,email,display_name,password_hash) VALUES('legacy','legacy_user','legacy@example.invalid','Legacy user','preserve-this-test-hash')");
  }finally{await legacy.close()}
  upgraded=await createDb({dataDir:directory});
  const [user]=await upgraded.query<{password_hash:string;email_verified_at:string|null}>("SELECT password_hash,email_verified_at FROM users WHERE id='legacy'");
  assert.equal(user.password_hash,'preserve-this-test-hash');assert.equal(user.email_verified_at,null);
  assert.equal((await upgraded.query('SELECT * FROM account_tokens')).length,0);
 }finally{if(upgraded)await upgraded.close();await rm(directory,{recursive:true,force:true})}
});
