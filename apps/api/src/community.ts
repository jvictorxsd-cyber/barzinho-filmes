import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {DB} from '@barzinho/db';
import {z} from 'zod';
import {requireUser} from './auth.js';
import {problem} from './config.js';
import {ensureTarget} from './tracking.js';
import {getEpisodeCharacters} from './catalog.js';

const episodeId=z.string().regex(/^tv:[1-9]\d*:\d+:\d+$/);
export async function registerCommunity(app:FastifyInstance,db:DB) {
  app.get('/api/comments',async req=>{
    const {targetId,sort,offset}=z.object({targetId:z.string().max(100),sort:z.enum(['recent','popular']).default('recent'),offset:z.coerce.number().int().min(0).max(10000).default(0)}).parse(req.query);
    const rows=await db.query<{id:string;userId:string;username:string;displayName:string;body:string|null;spoiler:boolean;parentId:string|null;createdAt:string;likes:number;liked:boolean}>(`SELECT c.id,c.user_id AS "userId",u.username,u.display_name AS "displayName",c.body,c.spoiler,c.parent_id AS "parentId",c.created_at AS "createdAt",(SELECT count(*)::int FROM comment_likes l WHERE l.comment_id=c.id) AS likes,EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id=c.id AND l.user_id=$2) AS liked FROM comments c JOIN users u ON u.id=c.user_id WHERE c.target_id=$1 ORDER BY ${sort==='popular'?'likes DESC,':''}c.created_at DESC LIMIT 30 OFFSET $3`,[targetId,req.user?.id||'',offset]);
    // Spoiler text is omitted from list responses. Revealing requires a deliberate request.
    return {items:rows.map(c=>({...c,body:c.spoiler?null:c.body,hidden:c.spoiler})),nextOffset:rows.length===30?offset+30:null};
  });
  app.get('/api/comments/:id/reveal',async req=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params);
    const [comment]=await db.query('SELECT id,body FROM comments WHERE id=$1',[id]);if(!comment)problem('Comentário não encontrado.',404);return {comment};
  });
  app.post('/api/comments',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async req=>{
    const user=requireUser(req);const input=z.object({targetId:z.string(),targetType:z.enum(['title','episode']),body:z.string().trim().min(1).max(5000),spoiler:z.boolean().default(true),parentId:z.uuid().optional()}).parse(req.body);await ensureTarget(db,input.targetId,input.targetType);
    if(input.parentId && !(await db.query('SELECT id FROM comments WHERE id=$1 AND target_id=$2',[input.parentId,input.targetId])).length)problem('A resposta deve pertencer à mesma conversa.');
    const [comment]=await db.query('INSERT INTO comments(id,user_id,target_id,target_type,body,spoiler,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),user.id,input.targetId,input.targetType,input.body,input.spoiler,input.parentId||null]);
    if(input.parentId)await db.query("INSERT INTO notifications(id,user_id,kind,message) SELECT $1,user_id,'reply',$2 FROM comments WHERE id=$3 AND user_id<>$4",[randomUUID(),`${user.displayName} respondeu ao seu comentário.`,input.parentId,user.id]);
    return {comment};
  });
  app.patch('/api/comments/:id',async req=>{const user=requireUser(req);const {id}=z.object({id:z.uuid()}).parse(req.params);const input=z.object({body:z.string().trim().min(1).max(5000),spoiler:z.boolean()}).parse(req.body);const result=await db.query('UPDATE comments SET body=$1,spoiler=$2,updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING id',[input.body,input.spoiler,id,user.id]);if(!result.length)problem('Comentário não encontrado.',404);return {ok:true};});
  app.delete('/api/comments/:id',async req=>{const user=requireUser(req);const {id}=z.object({id:z.uuid()}).parse(req.params);const result=await db.query('DELETE FROM comments WHERE id=$1 AND user_id=$2 RETURNING id',[id,user.id]);if(!result.length)problem('Comentário não encontrado.',404);return {ok:true};});
  app.put('/api/comments/:id/like',async req=>{const user=requireUser(req);const {id}=z.object({id:z.uuid()}).parse(req.params);const {liked}=z.object({liked:z.boolean()}).parse(req.body);if(!(await db.query('SELECT id FROM comments WHERE id=$1',[id])).length)problem('Comentário não encontrado.',404);if(liked)await db.query('INSERT INTO comment_likes(user_id,comment_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[user.id,id]);else await db.query('DELETE FROM comment_likes WHERE user_id=$1 AND comment_id=$2',[user.id,id]);return {ok:true};});
  app.post('/api/comments/:id/report',async req=>{const user=requireUser(req);const {id}=z.object({id:z.uuid()}).parse(req.params);const {reason}=z.object({reason:z.string().trim().min(5).max(1000)}).parse(req.body);if(!(await db.query('SELECT id FROM comments WHERE id=$1',[id])).length)problem('Comentário não encontrado.',404);await db.query('INSERT INTO moderation_reports(id,user_id,comment_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,comment_id) DO UPDATE SET reason=EXCLUDED.reason',[randomUUID(),user.id,id,reason]);return {ok:true};});
  async function watched(userId:string,id:string) {if(!(await db.query('SELECT user_id FROM episode_watches WHERE user_id=$1 AND episode_id=$2',[userId,id])).length)problem('Marque o episódio como assistido para participar e revelar os resultados.',403);}
  app.put('/api/votes',async req=>{
    const user=requireUser(req);const input=z.object({episodeId,personId:z.number().int().positive(),character:z.string().min(1).max(300)}).parse(req.body);await watched(user.id,input.episodeId);
    const cast=await getEpisodeCharacters(db,input.episodeId);
    if(!cast.some(c=>c.personId===input.personId&&c.character===input.character))problem('Este personagem não está confirmado nos créditos deste episódio.');
    await db.query('INSERT INTO character_votes(user_id,episode_id,person_id,character) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,episode_id) DO UPDATE SET person_id=EXCLUDED.person_id,character=EXCLUDED.character',[user.id,input.episodeId,input.personId,input.character]);return {ok:true};
  });
  app.get('/api/votes/:episodeId',async req=>{
    const user=requireUser(req);const {episodeId:id}=z.object({episodeId}).parse(req.params);await watched(user.id,id);
    const rows=await db.query<{personId:number;character:string;votes:number}>('SELECT person_id AS "personId",character,count(*)::int AS votes FROM character_votes WHERE episode_id=$1 GROUP BY person_id,character ORDER BY votes DESC',[id]);
    const mine=await db.query('SELECT person_id AS "personId",character FROM character_votes WHERE episode_id=$1 AND user_id=$2',[id,user.id]);
    const total=rows.reduce((sum,row)=>sum+row.votes,0);
    return {results:mine.length?rows.map(row=>({...row,percentage:total?Math.round(row.votes/total*100):0})):[],total:mine.length?total:null,myVote:mine[0]||null};
  });
  app.get('/api/users',async req=>{
    const {q}=z.object({q:z.string().trim().min(2).max(60)}).parse(req.query);
    const escaped=q.replace(/[\\%_]/g,'\\$&');return {items:await db.query('SELECT u.id,u.username,u.display_name AS "displayName",u.bio,EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=u.id) AS following FROM users u WHERE u.private_profile=false AND (u.username ILIKE $1 OR u.display_name ILIKE $1) ORDER BY u.username LIMIT 20',[`%${escaped}%`,req.user?.id||''])};
  });
  app.get('/api/follows',async req=>{
    const user=requireUser(req);
    // Existing relationships remain manageable even if the followed profile becomes private.
    const items=await db.query('SELECT u.id,u.username,u.display_name AS "displayName",true AS following FROM follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=$1 ORDER BY u.username LIMIT 200',[user.id]);
    return {items};
  });
  app.put('/api/follows/:userId',async req=>{const user=requireUser(req);const {userId}=z.object({userId:z.uuid()}).parse(req.params);const {following}=z.object({following:z.boolean()}).parse(req.body);if(user.id===userId)problem('Você não pode seguir a própria conta.');if(following && !(await db.query('SELECT id FROM users WHERE id=$1 AND private_profile=false',[userId])).length)problem('Perfil público não encontrado.',404);if(following)await db.query('INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[user.id,userId]);else await db.query('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2',[user.id,userId]);return {ok:true};});
  app.get('/api/feed',async req=>{
    const user=requireUser(req);
    const items=await db.query(`SELECT d.id,'movie' AS type,u.username,u.display_name AS "displayName",t.title,t.id AS "targetId",d.watched_at AS "createdAt" FROM diary d JOIN users u ON u.id=d.user_id JOIN catalog_titles t ON t.id=d.title_id WHERE u.private_profile=false AND d.user_id IN(SELECT following_id FROM follows WHERE follower_id=$1) UNION ALL SELECT e.id,'episode',u.username,u.display_name,t.title||' · '||e.title,e.id,w.watched_at FROM episode_watches w JOIN users u ON u.id=w.user_id JOIN catalog_episodes e ON e.id=w.episode_id JOIN catalog_titles t ON t.id=e.title_id WHERE u.private_profile=false AND w.user_id IN(SELECT following_id FROM follows WHERE follower_id=$1) ORDER BY "createdAt" DESC LIMIT 50`,[user.id]);return {items};
  });
}
