'use client';
import Link from 'next/link';
import {FormEvent,useEffect,useState} from 'react';
import {Mail,KeyRound,ShieldCheck} from 'lucide-react';
import {request,useRemote} from '../lib/remote';

type Mode='forgot'|'reset'|'verify';
export function AccountAccess({mode,refreshAuth}:{mode:Mode;refreshAuth:()=>void}){
 const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
 const[token,setToken]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const status=useRemote<{available:boolean}>(mode==='forgot'?'/auth/email/status':null);
 useEffect(()=>{
  if(mode!=='forgot'){
   const value=new URLSearchParams(window.location.hash.slice(1)).get('token')||'';
   setToken(/^[A-Za-z0-9_-]{43}$/.test(value)?value:'');
   window.history.replaceState(window.history.state,'',window.location.pathname);
  }
  setReady(true);
 },[mode]);
 async function submit(event:FormEvent){
  event.preventDefault();setError('');if(mode==='reset'&&password!==confirmation){setError('As senhas precisam ser iguais.');return}
  setBusy(true);
  try{
   const result=await request<{message:string}>(mode==='forgot'?'/auth/forgot-password':mode==='reset'?'/auth/reset-password':'/auth/verify-email','POST',mode==='forgot'?{email}:mode==='reset'?{token,password}:{token});
   setMessage(result.message);setPassword('');setConfirmation('');if(mode!=='forgot'){setToken('');refreshAuth()}
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const title={forgot:'Vamos recuperar seu acesso.',reset:'Uma nova senha para continuar.',verify:'Confirme seu e-mail.'}[mode];
 return <div className="access-page"><div className="auth-card"><span className="brand-mark">{mode==='verify'?<ShieldCheck size={27}/>:mode==='forgot'?<Mail size={27}/>:<KeyRound size={27}/>}</span><h1>{title}</h1><p>{mode==='forgot'?'Informe o e-mail da sua conta para solicitar um link de recuperação.':mode==='reset'?'Escolha uma senha com pelo menos 10 caracteres. As sessões anteriores serão encerradas.':'Confirme que você recebeu este link para concluir a verificação.'}</p>
 {!ready?<p role="status">Carregando…</p>:message?<div role="status" className="access-success"><p>{message}</p><Link className="button primary" href={mode==='verify'?'/perfil':'/entrar'}>{mode==='verify'?'Meu perfil':'Voltar para entrar'}</Link></div>:mode!=='forgot'&&!token?<div className="access-message"><p>Este link está incompleto. Abra novamente o link recebido por e-mail ou solicite outro.</p><Link className="text-link" href={mode==='reset'?'/recuperar-senha':'/perfil'}>Solicitar outro link</Link></div>:<form method="post" onSubmit={submit}>
 {mode==='forgot'&&<><label htmlFor="recovery-email">E-mail da conta</label><input id="recovery-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={e=>setEmail(e.target.value)}/>{status.loading?<p role="status">Verificando disponibilidade…</p>:status.error?<p role="alert">{status.error} <button type="button" className="text-link" onClick={status.reload}>Tentar novamente</button></p>:status.data?.available===false&&<p role="status">O envio de e-mails está indisponível no momento. Tente novamente mais tarde.</p>}</>}
 {mode==='reset'&&<><label htmlFor="new-password">Nova senha</label><input id="new-password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/><label htmlFor="confirm-password">Confirme a nova senha</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></>}
 <button className="button primary" disabled={busy||(mode==='forgot'&&!status.data?.available)}>{busy?'Aguarde…':mode==='forgot'?'Solicitar recuperação':mode==='reset'?'Salvar nova senha':'Confirmar meu e-mail'}</button>
 </form>}
 {error&&<p className="form-error" role="alert">{error}</p>}<Link href="/entrar" className="text-link access-back">Voltar para entrar</Link>
 </div></div>;
}

export function EmailVerification({verifiedAt}:{verifiedAt?:string|null}){
 const status=useRemote<{available:boolean}>(verifiedAt?null:'/auth/email/status');
 const[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 async function send(){setBusy(true);setError('');try{const result=await request<{message:string}>('/auth/request-verification','POST');setMessage(result.message)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="verification-panel"><ShieldCheck size={22}/><div><h3>{verifiedAt?'E-mail confirmado':'Confirme seu e-mail'}</h3><p>{verifiedAt?'Este endereço foi confirmado por você.':'Receba um link para confirmar o endereço associado à sua conta.'}</p>{!verifiedAt&&(status.loading?<p role="status">Verificando disponibilidade…</p>:status.error?<p role="alert">{status.error}</p>:!status.data?.available?<p>Confirmação por e-mail indisponível no momento.</p>:<button className="button secondary" disabled={busy} onClick={send}>{busy?'Solicitando…':'Enviar e-mail de confirmação'}</button>)}{message&&<p role="status">{message}</p>}{error&&<p role="alert" className="form-error">{error}</p>}</div></div>;
}
