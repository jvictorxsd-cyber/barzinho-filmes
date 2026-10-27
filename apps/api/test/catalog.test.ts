import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createDb, type DB } from '@barzinho/db';
import { createTmdbClient, CatalogError, normalizeTitle, registerCatalog, getEpisodeCharacters } from '../src/catalog.js';

let db: DB;
const initialToken = process.env.TMDB_TOKEN;
const initialKey = process.env.TMDB_API_KEY;
before(async () => { db = await createDb({ dataDir: ':memory:' }); });
after(async () => {
  await db.close();
  if (initialToken === undefined) delete process.env.TMDB_TOKEN; else process.env.TMDB_TOKEN = initialToken;
  if (initialKey === undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY = initialKey;
});

test('missing credentials fail explicitly without manufacturing a catalog', async () => {
  delete process.env.TMDB_TOKEN;
  delete process.env.TMDB_API_KEY;
  let requests = 0;
  const client = createTmdbClient(db, (async () => { requests++; throw new Error('unexpected'); }) as typeof fetch);
  await assert.rejects(client('/movie/998877'), (err: unknown) => err instanceof CatalogError && err.code === 'CATALOG_NOT_CONFIGURED');
  assert.equal(requests, 0);
});

test('real cache stores source response and deduplicates concurrent fetches without credentials in keys', async () => {
  process.env.TMDB_TOKEN = 'test-server-secret';
  let requests = 0;
  const client = createTmdbClient(db, (async (url, options) => {
    requests++;
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-server-secret');
    assert.ok(String(url).startsWith('https://api.themoviedb.org/3/movie/440011?'));
    return new Response(JSON.stringify({ id: 440011, title: 'Test fixture', runtime: 122 }), { status: 200 });
  }) as typeof fetch);
  const results = await Promise.all([client('/movie/440011'), client('/movie/440011')]);
  assert.equal(requests, 1);
  assert.equal(results[0].data.title, 'Test fixture');
  await client('/movie/440011');
  assert.equal(requests, 1);
  const rows = await db.query<{ cache_key: string }>('SELECT cache_key FROM catalog_cache');
  assert.ok(rows.every(r => !r.cache_key.includes('test-server-secret')));
});

test('bounded stale cache survives upstream outage and marks its provenance', async () => {
  await db.query("UPDATE catalog_cache SET updated_at=NOW()-interval '12 hours' WHERE cache_key=$1", ['/movie/440011?language=pt-BR']);
  const client = createTmdbClient(db, (async () => new Response('upstream error', { status: 502 })) as typeof fetch);
  const result = await client('/movie/440011');
  assert.equal(result.stale, true);
  assert.equal(result.data.id, 440011);
  await db.query("UPDATE catalog_cache SET updated_at=NOW()-interval '8 days' WHERE cache_key=$1", ['/movie/440011?language=pt-BR']);
  await assert.rejects(client('/movie/440011'), (err: unknown) => err instanceof CatalogError && err.code === 'CATALOG_UNAVAILABLE');
});

test('malformed scalar cache entries are replaced by genuine source objects',async()=>{
 process.env.TMDB_TOKEN='test-server-secret';
 const key='/movie/774411?language=pt-BR';
 await db.query('INSERT INTO catalog_cache(cache_key,data) VALUES($1,$2::jsonb)',[key,JSON.stringify(JSON.stringify({id:774411,title:'Old malformed cache'}))]);
 let requests=0;
 const client=createTmdbClient(db,(async()=>{requests++;return new Response(JSON.stringify({id:774411,title:'Source fixture'}),{status:200});}) as typeof fetch);
 assert.equal((await client('/movie/774411')).data.title,'Source fixture');
 assert.equal((await client('/movie/774411')).data.title,'Source fixture');
 assert.equal(requests,1);
 const [row]=await db.query<{kind:string}>('SELECT jsonb_typeof(data) AS kind FROM catalog_cache WHERE cache_key=$1',[key]);
 assert.equal(row.kind,'object');
});

test('an upstream removal is respected instead of serving a stale removed title', async () => {
  await db.query("UPDATE catalog_cache SET updated_at=NOW()-interval '12 hours' WHERE cache_key=$1", ['/movie/440011?language=pt-BR']);
  const client = createTmdbClient(db, (async () => new Response('{}', { status: 404 })) as typeof fetch);
  await assert.rejects(client('/movie/440011'), (err: unknown) => err instanceof CatalogError && err.statusCode === 404);
});

test('normalization keeps stable movie/series identities and missing data absent', () => {
  const movie = normalizeTitle({ id: 44, title: 'Fixture', original_title: 'Fixture Original' }, 'movie');
  const tv = normalizeTitle({ id: 44, name: 'Fixture', first_air_date: '2025-01-10' }, 'tv');
  assert.equal(movie.id, 'movie:44');
  assert.equal(tv.id, 'tv:44');
  assert.equal(movie.posterPath, null);
  assert.equal(movie.voteAverage, null);
  assert.deepEqual(movie.genres, []);
});

test('catalog parameters are validated before external calls', async () => {
  const app = Fastify();
  await registerCatalog(app, db);
  const response = await app.inject({ method: 'GET', url: '/api/catalog/movie/invalid' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'INVALID_PARAMETER');
  const search = await app.inject({ method: 'GET', url: '/api/catalog/search?type=unsupported' });
  assert.equal(search.statusCode, 400);
  await app.close();
});

test('character voting reads only explicit episode participation', async () => {
  await db.query("INSERT INTO catalog_titles(id,media_type,external_id,title,data) VALUES ('tv:991','tv',991,'Test series',$1::jsonb)", [JSON.stringify({ cast: [{ personId: 1, name: 'General cast member', character: 'Unknown episode participation' }] })]);
  await db.query("INSERT INTO catalog_episodes(id,title_id,season_number,episode_number,title,data) VALUES ('tv:991:1:1','tv:991',1,1,'Episode fixture',$1::jsonb)", [JSON.stringify({ cast: [{ personId: 2, name: 'Episode guest', character: 'Confirmed role', profilePath: null }] })]);
  const characters = await getEpisodeCharacters(db, 'tv:991:1:1');
  assert.equal(characters.length, 1);
  assert.equal(characters[0].personId, 2);
  assert.equal(characters.some(c => c.personId === 1), false);
});
