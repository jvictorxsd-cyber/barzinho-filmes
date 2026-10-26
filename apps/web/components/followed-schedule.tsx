'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,CalendarDays} from 'lucide-react';
import {useRemote} from '../lib/remote';
type Event={id:string;kind:'movie'|'episode';title:string;seriesTitle?:string;date:string;href:string;seasonNumber?:number;episodeNumber?:number};
const localDay=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const advance=(date:Date,days:number)=>new Date(date.getFullYear(),date.getMonth(),date.getDate()+days,12);
const formatDay=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR',{day:'numeric',month:'short'});
export function FollowedSchedule({user}:{user?:{id:string}}){
 const[mode,setMode]=useState<'list'|'week'|'month'>('list'),[anchor,setAnchor]=useState(()=>new Date()),[timeZone,setZone]=useState('America/Fortaleza');
 useEffect(()=>{setZone(Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Fortaleza')},[]);
 const start=mode==='month'?new Date(anchor.getFullYear(),anchor.getMonth(),1,12):mode==='week'?advance(anchor,-((anchor.getDay()+6)%7)):new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate(),12);
 const end=mode==='month'?new Date(anchor.getFullYear(),anchor.getMonth()+1,0,12):advance(start,mode==='week'?6:29);
 const r=useRemote<{items:Event[];undatedCount:number}>(user?`/calendar?${new URLSearchParams({from:localDay(start),to:localDay(end),timeZone})}`:null);
 function move(direction:number){setAnchor(mode==='month'?new Date(anchor.getFullYear(),anchor.getMonth()+direction,1,12):advance(anchor,direction*(mode==='week'?7:30)))}
 function entry(event:Event){return <Link key={event.id} href={event.href} className="schedule-event"><strong>{event.seriesTitle||event.title}</strong>{event.kind==='episode'&&<span>T{event.seasonNumber} · E{event.episodeNumber} — {event.title}</span>}<small>{event.kind==='episode'?'Episódio':'Lançamento informado'}</small></Link>}
 const days=Array.from({length:Math.round((Date.UTC(end.getFullYear(),end.getMonth(),end.getDate())-Date.UTC(start.getFullYear(),start.getMonth(),start.getDate()))/86400000)+1},(_,i)=>advance(start,i));
 return <section className="followed-schedule section"><div className="section-heading"><div><p className="eyebrow">AS HISTÓRIAS QUE VOCÊ ACOMPANHA</p><h2>Sua agenda</h2></div><CalendarDays size={23}/></div>
 {!user?<p><Link href="/entrar" className="text-link">Entre na sua conta</Link> para acompanhar datas dos filmes e séries da sua biblioteca.</p>:<><p>Datas dos títulos que você quer assistir ou está acompanhando. Horários e disponibilidade no Brasil precisam ser confirmados no serviço.</p><div className="calendar-toolbar"><div className="tabs">{([['list','Lista'],['week','Semana'],['month','Mês']] as const).map(([key,label])=><button key={key} className={mode===key?'active':''} aria-pressed={mode===key} onClick={()=>setMode(key)}>{label}</button>)}</div><div className="schedule-navigation"><button className="icon-button" aria-label="Período anterior da minha agenda" onClick={()=>move(-1)}><ChevronLeft size={18}/></button><span>{formatDay(localDay(start))} – {formatDay(localDay(end))} {end.getFullYear()}</span><button className="icon-button" aria-label="Próximo período da minha agenda" onClick={()=>move(1)}><ChevronRight size={18}/></button><button className="text-link" onClick={()=>setAnchor(new Date())}>Hoje</button></div></div>
 {r.loading?<p role="status">Carregando sua agenda…</p>:r.error?<p role="alert">{r.error} <button className="text-link" onClick={r.reload}>Tentar novamente</button></p>:r.data&&<>{mode==='list'?r.data.items.length?<div className="schedule-list">{r.data.items.map(event=><div key={event.id}><time dateTime={event.date}>{formatDay(event.date)}</time>{entry(event)}</div>)}</div>:<div className="empty compact"><CalendarDays/><h3>Nenhuma data informada neste período.</h3><p>Adicione títulos à biblioteca e abra suas páginas para consultar as informações disponíveis.</p><Link href="/biblioteca" className="text-link">Minha biblioteca</Link></div>:<div className={`schedule-grid ${mode}`}>
 {['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(d=><strong className="calendar-day-name" key={d}>{d}</strong>)}
 {mode==='month'&&Array.from({length:(start.getDay()+6)%7},(_,i)=><div key={`gap-${i}`} className="calendar-cell blank"/>)}
 {days.map(day=><div key={localDay(day)} className="calendar-cell"><time dateTime={localDay(day)}>{day.getDate()}</time>{r.data!.items.filter(event=>event.date===localDay(day)).map(entry)}</div>)}
 </div>}
 {r.data.undatedCount>0&&<p className="schedule-note">{r.data.undatedCount} lançamento(s) acompanhado(s) ainda sem data informada.</p>}<p className="schedule-note">Agenda baseada nas informações já consultadas no catálogo. As datas podem mudar; abra o título para consultar dados atualizados.</p></>}
 </>}
 </section>;
}
