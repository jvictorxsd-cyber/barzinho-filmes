import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {DB,QueryExecutor} from '@barzinho/db';
import {z} from 'zod';
import {requireUser} from './auth.js';
import {problem} from './config.js';
import {ensureTarget} from './tracking.js';

type TitleRow={id:string;external_id:number;media_type:string;title:string;poster_path:string|null;backdrop_path:string|null;overview:string;release_date:string|null;runtime:number|null;genres:string[];data:Record<string,any>;updated_at:string};
const titleView=(t:TitleRow)=>({id:t.id,externalId:t.external_id,mediaType:t.media_type,title:t.title,posterPath:t.poster_path,backdropPath:t.backdrop_path,overview:t.overview,releaseDate:t.release_date,runtime:t.runtime,genres:t.genres,voteAverage:typeof t.data?.voteAverage==='number'?t.data.voteAverage:null});
const listId=z.object({id:z.uuid()});
const itemId=z.string().regex(/^(movie|tv):[1-9]\d*$/);
async function ownList(tx:QueryExecutor,id:string,userId:string){
  const rows=await tx.query('SELECT id FROM custom_lists WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);
  if(!rows.length)problem('Lista não encontrada.',404);
}

export async function registerDiscovery(app:FastifyInstance,db:DB){
  app.get('/api/lists',async req=>{
    const user=requireUser(req);
    return {items:await db.query('SELECT l.id,l.name,l.private,l.created_at AS "createdAt",(SELECT count(*)::int FROM list_items i WHERE i.list_id=l.id) AS "itemCount" FROM custom_lists l WHERE l.user_id=$1 ORDER BY l.created_at DESC',[user.id])};
  });
  app.post('/api/lists',async(req,reply)=>{
    const user=requireUser(req);const input=z.object({name:z.string().trim().min(1).max(100),private:z.boolean().default(true)}).parse(req.body);
    const [list]=await db.query('INSERT INTO custom_lists(id,user_id,name,private) VALUES($1,$2,$3,$4) RETURNING id,name,private,user_id AS "ownerId"',[randomUUID(),user.id,input.name,input.private]);
    reply.code(201);return {list};
  });
  app.get('/api/lists/:id',async req=>{
    const {id}=listId.parse(req.params);
    const [list]=await db.query<{id:string;ownerId:string;name:string;private:boolean;ownerName:string}>(`SELECT l.id,l.user_id AS "ownerId",l.name,l.private,u.display_name AS "ownerName" FROM custom_lists l JOIN users u ON u.id=l.user_id WHERE l.id=$1 AND (l.user_id=$2 OR (l.private=false AND u.private_profile=false))`,[id,req.user?.id||'']);
    if(!list)problem('Lista não encontrada ou privada.',404);
    const items=await db.query<TitleRow>('SELECT t.* FROM list_items i JOIN catalog_titles t ON t.id=i.title_id WHERE i.list_id=$1 ORDER BY i.created_at DESC,t.id',[id]);
    return {list,items:items.map(titleView)};
  });
  app.patch('/api/lists/:id',async req=>{
    const user=requireUser(req);const {id}=listId.parse(req.params);const input=z.object({name:z.string().trim().min(1).max(100),private:z.boolean()}).parse(req.body);
    const rows=await db.query('UPDATE custom_lists SET name=$1,private=$2 WHERE id=$3 AND user_id=$4 RETURNING id',[input.name,input.private,id,user.id]);
    if(!rows.length)problem('Lista não encontrada.',404);return {ok:true};
  });
  app.delete('/api/lists/:id',async req=>{
    const user=requireUser(req);const {id}=listId.parse(req.params);
    const rows=await db.query('DELETE FROM custom_lists WHERE id=$1 AND user_id=$2 RETURNING id',[id,user.id]);
    if(!rows.length)problem('Lista não encontrada.',404);return {ok:true};
  });
  app.put('/api/lists/:id/items',async req=>{
    const user=requireUser(req);const {id}=listId.parse(req.params);const {titleId}=z.object({titleId:itemId}).parse(req.body);
    await ensureTarget(db,titleId,'title');
    await db.transaction(async tx=>{await ownList(tx,id,user.id);await tx.query('INSERT INTO list_items(list_id,title_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,titleId])});
    return {ok:true};
  });
  app.delete('/api/lists/:id/items/:titleId',async req=>{
    const user=requireUser(req);const {id,titleId}=listId.extend({titleId:itemId}).parse(req.params);
    await db.transaction(async tx=>{await ownList(tx,id,user.id);await tx.query('DELETE FROM list_items WHERE list_id=$1 AND title_id=$2',[id,titleId])});
    return {ok:true};
  });

  app.get('/api/recommendations',async req=>{
    const user=requireUser(req);
    const history=await db.query<{genres:string[];score:number|null;favorite:boolean}>(`SELECT t.genres,r.score::float AS score,COALESCE(l.favorite,false) AS favorite FROM catalog_titles t LEFT JOIN library l ON l.title_id=t.id AND l.user_id=$1 LEFT JOIN ratings r ON r.target_id=t.id AND r.user_id=$1 WHERE l.user_id IS NOT NULL OR r.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM diary d WHERE d.title_id=t.id AND d.user_id=$1) OR EXISTS(SELECT 1 FROM episode_watches w JOIN catalog_episodes e ON e.id=w.episode_id WHERE e.title_id=t.id AND w.user_id=$1)`,[user.id]);
    const weights=new Map<string,number>();
    for(const h of history){const weight=(h.favorite?3:0)+(h.score===null?1:(h.score-5)/2);for(const genre of h.genres||[])weights.set(genre,(weights.get(genre)||0)+weight)}
    const candidates=await db.query<TitleRow>(`SELECT t.* FROM catalog_titles t WHERE NOT EXISTS(SELECT 1 FROM library l WHERE l.user_id=$1 AND l.title_id=t.id) AND NOT EXISTS(SELECT 1 FROM diary d WHERE d.user_id=$1 AND d.title_id=t.id) AND NOT EXISTS(SELECT 1 FROM ratings r WHERE r.user_id=$1 AND r.target_id=t.id) AND NOT EXISTS(SELECT 1 FROM episode_watches w JOIN catalog_episodes e ON e.id=w.episode_id WHERE w.user_id=$1 AND e.title_id=t.id) ORDER BY t.updated_at DESC,t.id LIMIT 500`,[user.id]);
    const hasPreferences=[...weights.values()].some(weight=>weight>0);
    const ranked=candidates.map(t=>{
      const matches=(t.genres||[]).filter(g=>(weights.get(g)||0)>0).sort((a,b)=>(weights.get(b)||0)-(weights.get(a)||0));
      const affinity=(t.genres||[]).reduce((sum,g)=>sum+(weights.get(g)||0),0);
      const externalScore=typeof t.data?.voteAverage==='number'?t.data.voteAverage:0;
      return {...titleView(t),rank:affinity*3+externalScore/10,reason:matches.length?`Pelo seu interesse em ${matches.slice(0,2).join(' e ')}.`:'Uma descoberta entre os títulos disponíveis.'};
    }).sort((a,b)=>b.rank-a.rank||a.id.localeCompare(b.id)).slice(0,20).map(({rank,...item})=>item);
    return {items:ranked,mode:hasPreferences?'personalized':'discovery',source:'stored_catalog'};
  });

  app.get('/api/calendar',async req=>{
    const user=requireUser(req);
    const input=z.object({from:z.iso.date(),to:z.iso.date(),timeZone:z.string().max(80).default('America/Fortaleza')}).parse(req.query);
    const days=(Date.parse(input.to)-Date.parse(input.from))/86400000;
    if(days<0||days>93)problem('Escolha um período de até 93 dias.');
    try{new Intl.DateTimeFormat('pt-BR',{timeZone:input.timeZone})}catch{problem('Fuso horário inválido.')}
    const titles=await db.query<TitleRow>("SELECT t.* FROM library l JOIN catalog_titles t ON t.id=l.title_id WHERE l.user_id=$1 AND l.status IN ('watching','watchlist')",[user.id]);
    const episodes=await db.query<{id:string;title_id:string;title:string;season_number:number;episode_number:number;data:Record<string,any>}>(`SELECT e.* FROM catalog_episodes e JOIN library l ON l.title_id=e.title_id WHERE l.user_id=$1 AND l.status IN ('watching','watchlist') AND NOT EXISTS(SELECT 1 FROM episode_watches w WHERE w.user_id=$1 AND w.episode_id=e.id)`,[user.id]);
    const watched=new Set((await db.query<{episode_id:string}>('SELECT episode_id FROM episode_watches WHERE user_id=$1',[user.id])).map(w=>w.episode_id));
    const events=new Map<string,Record<string,any>>();
    function append(event:Record<string,any>){if(!events.has(event.id)||(!events.get(event.id)?.date&&event.date))events.set(event.id,event)}
    for(const t of titles){
      if(t.media_type==='movie')append({id:t.id,kind:'movie',title:t.title,date:t.release_date,titleId:t.id,href:`/titulo/movie/${t.external_id}`,updatedAt:t.updated_at});
      const next=t.data?.nextEpisode;
      if(next&&next.id&&!watched.has(next.id))append({id:next.id,kind:'episode',title:next.title,seriesTitle:t.title,date:next.airDate,titleId:t.id,seasonNumber:next.seasonNumber,episodeNumber:next.episodeNumber,href:`/episodio/${t.external_id}/${next.seasonNumber}/${next.episodeNumber}`,updatedAt:t.updated_at});
    }
    for(const e of episodes){const t=titles.find(t=>t.id===e.title_id);if(!t)continue;append({id:e.id,kind:'episode',title:e.title,seriesTitle:t.title,date:e.data?.airDate,titleId:t.id,seasonNumber:e.season_number,episodeNumber:e.episode_number,href:`/episodio/${t.external_id}/${e.season_number}/${e.episode_number}`,updatedAt:t.updated_at})}
    return {items:[...events.values()].filter(e=>e.date&&e.date>=input.from&&e.date<=input.to).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)),undatedCount:[...events.values()].filter(e=>!e.date).length,timeZone:input.timeZone,datePrecision:'day',source:'stored_catalog'};
  });
}
