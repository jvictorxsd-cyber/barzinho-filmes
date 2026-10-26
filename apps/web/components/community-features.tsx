'use client';
import {FormEvent, useEffect, useState} from 'react';
import {EmailVerification} from './account-access';
import {useRouter} from 'next/navigation';
import {Heart, MessageCircle, Eye, UserPlus, Settings, Bell} from 'lucide-react';

type Member={id:string;displayName:string;bio?:string;privateProfile?:boolean;emailVerifiedAt?:string|null};
type Props={user?:Member;notify:(message:string)=>void};
async function api<T=any>(path:string,method='GET',data?:unknown):Promise<T>{
  const response=await fetch(`/api${path}`,{method,credentials:'include',...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
  const result=await response.json();
  if(!response.ok)throw new Error(typeof result.error==='string'?result.error:'Não foi possível concluir. Tente novamente.');
  return result;
}
function useRemote<T>(path:string|null){
  const[data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setData(null);setError('');if(!path){setLoading(false);return;}setLoading(true);api<T>(path).then(value=>{if(active)setData(value)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[path,revision]);
  return {data,error,loading,reload:()=>setRevision(n=>n+1)};
}

export function AccountSettings({user,notify,onUpdate}:Props&{onUpdate:()=>void}){
  const router=useRouter();
  const[name,setName]=useState(user?.displayName||''),[bio,setBio]=useState(user?.bio||''),[privateProfile,setPrivate]=useState(user?.privateProfile||false);
  const[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const notifications=useRemote<{items:{id:string;message:string;readAt:string|null}[]}>(user?'/notifications':null);
  useEffect(()=>{setName(user?.displayName||'');setBio(user?.bio||'');setPrivate(user?.privateProfile||false)},[user]);
  if(!user)return null;
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{await api('/account','PATCH',{displayName:name,bio,privateProfile});onUpdate();notify('Perfil e privacidade atualizados.')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function revoke(){if(!window.confirm('Encerrar todas as sessões, inclusive a atual?'))return;setBusy(true);try{await api('/account/revoke-sessions','POST');onUpdate();router.push('/entrar')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function remove(event:FormEvent){event.preventDefault();if(!window.confirm('Excluir permanentemente sua conta e seus registros? Esta ação não pode ser desfeita.'))return;setBusy(true);setError('');try{await api('/account','DELETE',{password});setPassword('');onUpdate();router.push('/');notify('Sua conta e seus registros foram excluídos.')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <section className="section settings-area"><EmailVerification verifiedAt={user.emailVerifiedAt}/>
    <details className="settings-panel"><summary><Settings size={18}/> Perfil, privacidade e sessões</summary>
      <form onSubmit={save} className="settings-form">
        <label>Nome de exibição<input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
        <div className="biography-field"><label htmlFor="profile-biography">Biografia</label><textarea id="profile-biography" maxLength={500} value={bio} onChange={e=>setBio(e.target.value)} rows={3}/></div>
        <label className="checkbox"><input type="checkbox" checked={privateProfile} onChange={e=>setPrivate(e.target.checked)}/>Perfil privado</label>
        <p className="muted">Um perfil privado fica fora da busca de pessoas e seu histórico não aparece no feed de seguidores. Comentários publicados nas conversas continuam visíveis.</p>
        <button className="button primary" disabled={busy}>Salvar perfil</button>
      </form>
      <button className="button secondary" disabled={busy} onClick={revoke}>Encerrar todas as sessões</button>
      <details className="delete-account"><summary>Excluir minha conta</summary><p>A exclusão remove seus dados, progresso, comentários e sessões. Exporte seus dados antes, se desejar guardar uma cópia.</p>
        <form onSubmit={remove} className="settings-form"><label>Confirme sua senha<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="button danger" disabled={busy}>Excluir conta permanentemente</button></form>
      </details>
      {error&&<p role="alert" className="form-error">{error}</p>}
    </details>
    <details className="settings-panel"><summary><Bell size={18}/> Notificações {notifications.data?`(${notifications.data.items.filter(n=>!n.readAt).length} não lidas)`:''}</summary>
      {notifications.loading?<p role="status">Carregando notificações…</p>:notifications.error?<p role="alert">{notifications.error} <button className="text-link" onClick={notifications.reload}>Tentar novamente</button></p>:notifications.data?.items.length?notifications.data.items.map(n=><div className="notification" key={n.id}><p>{n.message}</p>{!n.readAt?<button className="text-link" onClick={async()=>{try{await api(`/notifications/${n.id}`,'PATCH');notifications.reload()}catch(e){notify((e as Error).message)}}}>Marcar como lida</button>:<small>Lida</small>}</div>):<p>Nenhuma notificação por enquanto.</p>}
    </details>
  </section>;
}

export function PeopleFinder({user,notify,onFollow}:Props&{onFollow:()=>void}){
  const[input,setInput]=useState(''),[query,setQuery]=useState(''),[busy,setBusy]=useState(false);
  const result=useRemote<{items:(Member&{username:string;following:boolean})[]}>(user?(query.length>=2?`/users?q=${encodeURIComponent(query)}`:'/follows'):null);
  if(!user)return null;
  async function follow(id:string,following:boolean){setBusy(true);try{await api(`/follows/${id}`,'PUT',{following});result.reload();onFollow();notify(following?'Você está seguindo esta pessoa.':'Você deixou de seguir esta pessoa.')}catch(e){notify((e as Error).message)}finally{setBusy(false)}}
  return <section className="people-finder"><h2>Encontre sua companhia de sessão</h2><form className="people-search" onSubmit={e=>{e.preventDefault();setQuery(input.trim());result.reload()}}><label className="sr-only" htmlFor="people-search">Buscar pessoas</label><input id="people-search" value={input} minLength={2} maxLength={60} required onChange={e=>setInput(e.target.value)} placeholder="Nome ou nome de usuário"/><button className="button secondary">Buscar pessoas</button></form>
    <div className="people-mode"><span>{query?'Resultados da busca':'Pessoas que você segue'}</span>{query&&<button className="text-link" onClick={()=>{setQuery('');setInput('')}}>Ver quem sigo</button>}</div>
    {result.loading&&<p role="status">Buscando pessoas…</p>}{result.error&&<p role="alert" className="form-error">{result.error}</p>}
    {result.data?.items.filter(p=>p.id!==user.id).map(p=><article className="person-result" key={p.id}><span className="avatar">{p.displayName[0]}</span><div><strong>{p.displayName}</strong><p>@{p.username}</p>{p.bio&&<p>{p.bio}</p>}</div><button className="button secondary" disabled={busy} onClick={()=>follow(p.id,!p.following)}><UserPlus size={16}/>{p.following?'Deixar de seguir':'Seguir'}</button></article>)}
    {result.data&&!result.data.items.some(p=>p.id!==user.id)&&<p>{query?'Nenhum perfil público encontrado para esta busca.':'Você ainda não segue ninguém. Busque um perfil para começar.'}</p>}
  </section>;
}

type Comment={id:string;userId:string;displayName:string;body:string|null;spoiler:boolean;parentId:string|null;createdAt:string;likes:number;liked:boolean};
export function Discussion({targetId,targetType,user,notify}:Props&{targetId:string;targetType:string}){
  const[sort,setSort]=useState('recent'),[offset,setOffset]=useState(0);
  const comments=useRemote<{items:Comment[];nextOffset:number|null}>(`/comments?targetId=${encodeURIComponent(targetId)}&sort=${sort}&offset=${offset}`);
  const[body,setBody]=useState(''),[spoiler,setSpoiler]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const[reply,setReply]=useState<Comment|null>(null),[edit,setEdit]=useState<Comment|null>(null),[report,setReport]=useState<Comment|null>(null),[reason,setReason]=useState('');
  const[revealed,setRevealed]=useState<Record<string,string>>({});
  useEffect(()=>{setRevealed({})},[comments.data]);
  async function action(operation:()=>Promise<void>){setBusy(true);setError('');try{await operation()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  function reset(){setBody('');setSpoiler(true);setReply(null);setEdit(null)}
  async function submit(event:FormEvent){event.preventDefault();await action(async()=>{
    if(edit)await api(`/comments/${edit.id}`,'PATCH',{body,spoiler});
    else await api('/comments','POST',{targetId,targetType,body,spoiler,...(reply?{parentId:reply.id}:{})});
    reset();setOffset(0);comments.reload();notify(edit?'Comentário atualizado.':'Comentário publicado.');
  })}
  async function reveal(c:Comment){await action(async()=>{const data=await api<{comment:{body:string}}>(`/comments/${c.id}/reveal`);setRevealed(old=>({...old,[c.id]:data.comment.body}))})}
  async function beginEdit(c:Comment){await action(async()=>{const text=c.body??(await api<{comment:{body:string}}>(`/comments/${c.id}/reveal`)).comment.body;setEdit(c);setReply(null);setBody(text);setSpoiler(c.spoiler);document.getElementById(`write-${targetId}`)?.focus()})}
  return <section className="section discussion"><div className="section-heading"><div><p className="eyebrow">IMPRESSÕES & OUTROS OLHARES</p><h2>A conversa continua</h2></div><label>Ordenar <select aria-label="Ordenar comentários" value={sort} onChange={e=>{setSort(e.target.value);setOffset(0)}}><option value="recent">Recentes</option><option value="popular">Mais curtidos</option></select></label></div>
    {user?<form className="comment-form" onSubmit={submit}>
      {(reply||edit)&&<div className="reply-context"><span>{edit?'Editando seu comentário':`Respondendo a ${reply?.displayName}`}</span><button type="button" className="text-link" onClick={reset}>Cancelar</button></div>}
      <label htmlFor={`write-${targetId}`} className="sr-only">Escreva seu comentário</label><textarea id={`write-${targetId}`} required maxLength={5000} value={body} onChange={e=>setBody(e.target.value)} placeholder="O que ficou com você depois dessa história?"/>
      <div><label className="checkbox"><input type="checkbox" checked={spoiler} onChange={e=>setSpoiler(e.target.checked)}/>Contém spoilers</label><button className="button primary" disabled={busy||!body.trim()}>{edit?'Salvar comentário':reply?'Publicar resposta':'Publicar comentário'}</button></div>
    </form>:<p><a className="text-link" href="/entrar">Entre na sua conta</a> para participar da conversa.</p>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    {report&&<form className="report-form" onSubmit={async e=>{e.preventDefault();await action(async()=>{await api(`/comments/${report.id}/report`,'POST',{reason});setReport(null);setReason('');notify('Denúncia registrada para análise.')})}}><label>Motivo da denúncia<textarea required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="button secondary" disabled={busy}>Enviar denúncia</button><button type="button" className="text-link" onClick={()=>setReport(null)}>Cancelar</button></form>}
    {comments.loading?<p role="status">Carregando conversa…</p>:comments.error?<p role="alert">{comments.error} <button className="text-link" onClick={comments.reload}>Tentar novamente</button></p>:comments.data?.items.length?<div className="comments">{comments.data.items.map(c=><article className="comment" key={c.id} id={`comment-${c.id}`}>
      <div className="comment-heading"><span className="avatar small">{c.displayName[0]}</span><strong>{c.displayName}</strong><small>{new Date(c.createdAt).toLocaleDateString('pt-BR')}</small></div>
      {c.parentId&&<p className="reply-label">Em resposta a outro comentário nesta conversa</p>}
      {c.spoiler&&revealed[c.id]===undefined?<button disabled={busy} className="spoiler-cover" onClick={()=>reveal(c)}><Eye size={18}/> Este comentário contém spoilers. Revelar</button>:<p className="comment-body">{revealed[c.id]??c.body}</p>}
      <div className="comment-actions"><button disabled={busy||!user} aria-pressed={c.liked} className="text-link" onClick={()=>action(async()=>{await api(`/comments/${c.id}/like`,'PUT',{liked:!c.liked});comments.reload()})}><Heart size={15} fill={c.liked?'currentColor':'none'}/>{c.likes} curtidas</button>
        {user&&<><button disabled={busy} className="text-link" onClick={()=>{reset();setReply(c);document.getElementById(`write-${targetId}`)?.focus()}}><MessageCircle size={15}/>Responder</button>{user.id===c.userId?<><button disabled={busy} className="text-link" onClick={()=>beginEdit(c)}>Editar</button><button disabled={busy} className="text-link" onClick={()=>{if(window.confirm('Excluir este comentário e suas respostas?'))void action(async()=>{await api(`/comments/${c.id}`,'DELETE');comments.reload();reset()})}}>Excluir</button></>:<button className="text-link" onClick={()=>{setReport(c);setReason('')}}>Denunciar</button>}</>}
      </div></article>)}</div>:<p className="discussion-empty">A primeira palavra pode ser sua. Compartilhe sua opinião e sinalize spoilers.</p>}
    {(offset>0||comments.data?.nextOffset!==null&&comments.data?.nextOffset!==undefined)&&<div className="pagination"><button className="button secondary" disabled={!offset||busy} onClick={()=>setOffset(Math.max(0,offset-30))}>Comentários anteriores</button><button className="button secondary" disabled={comments.data?.nextOffset==null||busy} onClick={()=>setOffset(comments.data!.nextOffset!)}>Próximos comentários</button></div>}
  </section>;
}
