import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {DB} from '@barzinho/db';
import {z} from 'zod';
import {requireUser} from './auth.js';
import {problem} from './config.js';

const titleId=z.string().regex(/^(movie|tv):[1-9]\d*$/);
const episodeId=z.string().regex(/^tv:[1-9]\d*:\d+:\d+$/);
const achievementRules=[
  {code:'first-film',name:'Primeira Sessão',description:'Assista ao primeiro filme.',metric:'moviesWatched',goal:1,rarity:'comum'},
  {code:'ten-episodes',name:'Maratonista Iniciante',description:'Assista a 10 episódios.',metric:'episodesWatched',goal:10,rarity:'comum'},
  {code:'hundred-episodes',name:'Maratonista Experiente',description:'Assista a 100 episódios.',metric:'episodesWatched',goal:100,rarity:'rara'},
  {code:'thousand-episodes',name:'Lenda das Séries',description:'Assista a 1.000 episódios.',metric:'episodesWatched',goal:1000,rarity:'lendária'},
  {code:'fifty-films',name:'Cinéfilo',description:'Assista a 50 filmes diferentes.',metric:'moviesWatched',goal:50,rarity:'rara'},
  {code:'five-hundred-films',name:'Mestre do Cinema',description:'Assista a 500 filmes diferentes.',metric:'moviesWatched',goal:500,rarity:'lendária'},
  {code:'ten-reviews',name:'Crítico Iniciante',description:'Avalie 10 títulos ou episódios.',metric:'ratingsCount',goal:10,rarity:'comum'},
  {code:'hundred-reviews',name:'Crítico Renomado',description:'Avalie 100 títulos ou episódios.',metric:'ratingsCount',goal:100,rarity:'épica'},
] as const;

export async function statsFor(db:DB,userId:string) {
  const [row]=await db.query<Record<string,string|number|null>>(`SELECT
    (SELECT count(DISTINCT title_id) FROM diary WHERE user_id=$1) AS movies,
    (SELECT count(*) FROM episode_watches WHERE user_id=$1) AS episodes,
    (SELECT count(*) FROM ratings WHERE user_id=$1) AS ratings,
    (SELECT avg(score) FROM ratings WHERE user_id=$1) AS average,
    (SELECT COALESCE(sum(t.runtime),0) FROM diary d JOIN catalog_titles t ON t.id=d.title_id WHERE d.user_id=$1) +
    (SELECT COALESCE(sum(e.runtime),0) FROM episode_watches w JOIN catalog_episodes e ON e.id=w.episode_id WHERE w.user_id=$1) AS minutes,
    (SELECT count(*) FROM library l JOIN catalog_titles t ON t.id=l.title_id WHERE l.user_id=$1 AND t.media_type='tv' AND l.status='completed') AS series`,[userId]);
  return {moviesWatched:Number(row.movies),episodesWatched:Number(row.episodes),ratingsCount:Number(row.ratings),averageRating:Number(Number(row.average||0).toFixed(1)),hoursWatched:Number((Number(row.minutes)/60).toFixed(1)),seriesCompleted:Number(row.series)};
}
export async function updateAchievements(db:DB,userId:string) {
  const stats=await statsFor(db,userId);
  for(const rule of achievementRules) if(stats[rule.metric]>=rule.goal) {
    const inserted=await db.query('INSERT INTO earned_achievements(user_id,code) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING code',[userId,rule.code]);
    if(inserted.length)await db.query('INSERT INTO notifications(id,user_id,kind,message) VALUES($1,$2,$3,$4)',[randomUUID(),userId,'achievement',`Você conquistou a medalha ${rule.name}!`]);
  }
  return stats;
}
export async function achievementsFor(db:DB,userId:string) {
  const stats=await updateAchievements(db,userId);
  const earned=await db.query<{code:string;earned_at:string}>('SELECT code,earned_at FROM earned_achievements WHERE user_id=$1',[userId]);
  return achievementRules.map(rule=>({...rule,progress:Math.min(stats[rule.metric],rule.goal),earnedAt:earned.find(e=>e.code===rule.code)?.earned_at||null}));
}
export async function ensureTarget(db:DB,id:string,type:'title'|'episode') {
  (type==='title'?titleId:episodeId).parse(id);
  const rows=await db.query(`SELECT id FROM ${type==='title'?'catalog_titles':'catalog_episodes'} WHERE id=$1`,[id]);
  if(!rows.length)problem('Abra a página deste título ou episódio antes de interagir.',404);
}

export async function registerTracking(app:FastifyInstance,db:DB) {
  app.get('/api/library',async req=>{
    const user=requireUser(req);
    const items=await db.query(`SELECT t.id,t.external_id AS "externalId",t.runtime,t.genres,t.title,t.media_type AS "mediaType",t.poster_path AS "posterPath",t.backdrop_path AS "backdropPath",t.overview,t.release_date AS "releaseDate",l.status,l.favorite,l.updated_at AS "updatedAt",r.score AS "myRating",(SELECT count(*) FROM episode_watches w JOIN catalog_episodes e ON e.id=w.episode_id WHERE e.title_id=t.id AND w.user_id=$1) AS "watchedEpisodes" FROM library l JOIN catalog_titles t ON t.id=l.title_id LEFT JOIN ratings r ON r.target_id=t.id AND r.user_id=l.user_id WHERE l.user_id=$1 ORDER BY l.updated_at DESC`,[user.id]);
    return {items};
  });
  app.put('/api/library',async req=>{
    const user=requireUser(req);const input=z.object({titleId,status:z.enum(['watchlist','watching','completed','dropped']),favorite:z.boolean().optional()}).parse(req.body);
    await ensureTarget(db,input.titleId,'title');
    await db.query('INSERT INTO library(user_id,title_id,status,favorite) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,title_id) DO UPDATE SET status=EXCLUDED.status,favorite=COALESCE($5,library.favorite),updated_at=now()',[user.id,input.titleId,input.status,input.favorite??false,input.favorite??null]);
    return {ok:true};
  });
  app.delete('/api/library/:titleId',async req=>{
    const user=requireUser(req);const {titleId:id}=z.object({titleId}).parse(req.params);await db.query('DELETE FROM library WHERE user_id=$1 AND title_id=$2',[user.id,id]);return {ok:true};
  });
  app.put('/api/watch/episode',async req=>{
    const user=requireUser(req);const input=z.object({episodeId,watched:z.boolean()}).parse(req.body);await ensureTarget(db,input.episodeId,'episode');
    await db.transaction(async tx=>{
    await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
    if(input.watched) {
      const [episode]=await tx.query<{title_id:string;data:{airDate?:string}}>('SELECT title_id,data FROM catalog_episodes WHERE id=$1',[input.episodeId]);
      if(episode.data?.airDate && episode.data.airDate>new Date().toISOString().slice(0,10))problem('Este episódio ainda não estreou.');
      await tx.query('INSERT INTO episode_watches(user_id,episode_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[user.id,input.episodeId]);
      await tx.query("INSERT INTO library(user_id,title_id,status) VALUES($1,$2,'watching') ON CONFLICT(user_id,title_id) DO UPDATE SET updated_at=now()",[user.id,episode.title_id]);
    } else {
      await tx.query('DELETE FROM episode_watches WHERE user_id=$1 AND episode_id=$2',[user.id,input.episodeId]);
      await tx.query('DELETE FROM character_votes WHERE user_id=$1 AND episode_id=$2',[user.id,input.episodeId]);
      await tx.query('DELETE FROM ratings WHERE user_id=$1 AND target_id=$2',[user.id,input.episodeId]);
    }
    });
    await updateAchievements(db,user.id);return {ok:true,watched:input.watched};
  });
  app.put('/api/watch/season',async req=>{
    const user=requireUser(req);
    const input=z.object({titleId:titleId.refine(id=>id.startsWith('tv:')),seasonNumber:z.number().int().min(0),confirmed:z.literal(true)}).parse(req.body);
    await ensureTarget(db,input.titleId,'title');
    const result=await db.transaction(async tx=>{
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
      const [title]=await tx.query<{data:{seasons?:{seasonNumber:number;episodeCount:number}[]}}>('SELECT data FROM catalog_titles WHERE id=$1',[input.titleId]);
      const expected=title.data?.seasons?.find(s=>s.seasonNumber===input.seasonNumber)?.episodeCount;
      const episodes=await tx.query<{id:string;data:{airDate?:string}}>('SELECT id,data FROM catalog_episodes WHERE title_id=$1 AND season_number=$2 ORDER BY episode_number',[input.titleId,input.seasonNumber]);
      if(!expected||episodes.length!==expected)problem('Carregue todos os episódios da temporada antes de marcá-la.',409);
      const today=new Date().toISOString().slice(0,10);
      const eligible=episodes.filter(e=>e.data.airDate&&e.data.airDate<=today);
      if(!eligible.length)problem('Nenhum episódio com estreia confirmada está disponível para marcar.',409);
      let added=0;
      for(const episode of eligible) {
        const rows=await tx.query('INSERT INTO episode_watches(user_id,episode_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING episode_id',[user.id,episode.id]);
        added+=rows.length;
      }
      await tx.query("INSERT INTO library(user_id,title_id,status) VALUES($1,$2,'watching') ON CONFLICT(user_id,title_id) DO UPDATE SET updated_at=now()",[user.id,input.titleId]);
      return {added,eligible:eligible.length,skipped:episodes.length-eligible.length};
    });
    await updateAchievements(db,user.id);
    return {ok:true,...result};
  });
  app.get('/api/watch/episodes/:titleId',async req=>{
    const user=requireUser(req);const {titleId:id}=z.object({titleId}).parse(req.params);
    return {items:await db.query('SELECT w.episode_id AS "episodeId",w.watched_at AS "watchedAt" FROM episode_watches w JOIN catalog_episodes e ON w.episode_id=e.id WHERE w.user_id=$1 AND e.title_id=$2',[user.id,id])};
  });
  app.post('/api/watch/movie',async req=>{
    const user=requireUser(req);const input=z.object({titleId:titleId.refine(v=>v.startsWith('movie:')),watchedAt:z.iso.datetime({offset:true}).optional(),idempotencyKey:z.string().min(8).max(100)}).parse(req.body);await ensureTarget(db,input.titleId,'title');
    const watchedAt=input.watchedAt||new Date().toISOString();if(new Date(watchedAt)>new Date())problem('A data da sessão não pode estar no futuro.');
    const created=await db.transaction(async tx=>{
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
      const [existing]=await tx.query<{title_id:string;watched_at:string}>('SELECT title_id,watched_at FROM diary WHERE user_id=$1 AND idempotency_key=$2',[user.id,input.idempotencyKey]);
      if(existing) {
        if(existing.title_id!==input.titleId || (input.watchedAt && new Date(existing.watched_at).getTime()!==new Date(input.watchedAt).getTime()))problem('Esta chave já foi usada para outra sessão.',409);
        return false;
      }
      await tx.query('INSERT INTO diary(id,user_id,title_id,watched_at,idempotency_key) VALUES($1,$2,$3,$4,$5)',[randomUUID(),user.id,input.titleId,watchedAt,input.idempotencyKey]);
      await tx.query("INSERT INTO library(user_id,title_id,status) VALUES($1,$2,'completed') ON CONFLICT(user_id,title_id) DO UPDATE SET status='completed',updated_at=now()",[user.id,input.titleId]);
      return true;
    });
    await updateAchievements(db,user.id);return {ok:true,created};
  });
  app.put('/api/ratings',async req=>{
    const user=requireUser(req);const input=z.object({targetId:z.string(),targetType:z.enum(['title','episode']),score:z.number().min(0).max(10).multipleOf(0.5)}).parse(req.body);await ensureTarget(db,input.targetId,input.targetType);
    await db.transaction(async tx=>{
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
      if(input.targetType==='episode' && !(await tx.query('SELECT user_id FROM episode_watches WHERE user_id=$1 AND episode_id=$2',[user.id,input.targetId])).length)problem('Marque o episódio como assistido antes de avaliá-lo.',403);
      await tx.query('INSERT INTO ratings(user_id,target_id,target_type,score) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,target_id) DO UPDATE SET score=EXCLUDED.score,updated_at=now()',[user.id,input.targetId,input.targetType,input.score]);
    });
    await updateAchievements(db,user.id);return {ok:true};
  });
  app.get('/api/ratings',async req=>{
    const {targetId:id}=z.object({targetId:z.string().max(100)}).parse(req.query);
    const [summary]=await db.query('SELECT count(*)::int AS count,avg(score)::float AS average FROM ratings WHERE target_id=$1',[id]);
    const distribution=await db.query('SELECT score::float AS score,count(*)::int AS count FROM ratings WHERE target_id=$1 GROUP BY score ORDER BY score',[id]);
    const own=req.user?await db.query<{score:number}>('SELECT score::float FROM ratings WHERE target_id=$1 AND user_id=$2',[id,req.user.id]):[];
    return {...summary,distribution,myRating:own[0]?.score??null};
  });
  app.get('/api/profile',async req=>{
    const user=requireUser(req);const stats=await statsFor(db,user.id);const achievements=await achievementsFor(db,user.id);
    const activity=await db.query(`SELECT d.id,'movie' AS type,t.title,t.id AS "targetId",d.watched_at AS "createdAt" FROM diary d JOIN catalog_titles t ON t.id=d.title_id WHERE d.user_id=$1 UNION ALL SELECT e.id,'episode',t.title || ' · ' || e.title,e.id,w.watched_at FROM episode_watches w JOIN catalog_episodes e ON e.id=w.episode_id JOIN catalog_titles t ON t.id=e.title_id WHERE w.user_id=$1 ORDER BY "createdAt" DESC LIMIT 50`,[user.id]);
    return {user,stats,activity,achievements};
  });
  app.get('/api/achievements',async req=>({items:await achievementsFor(db,requireUser(req).id)}));
  app.get('/api/notifications',async req=>({items:await db.query('SELECT id,kind,message,read_at AS "readAt",created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[requireUser(req).id])}));
  app.patch('/api/notifications/:id',async req=>{const user=requireUser(req);const {id}=z.object({id:z.uuid()}).parse(req.params);await db.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id=$2',[user.id,id]);return {ok:true};});
}
