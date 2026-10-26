'use client';
import {useEffect,useState} from 'react';
export async function request<T=any>(path:string,method='GET',data?:unknown):Promise<T>{
 const response=await fetch(`/api${path}`,{method,credentials:'include',...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
 const result=await response.json();if(!response.ok)throw new Error(typeof result.error==='string'?result.error:'Não foi possível carregar. Tente novamente.');return result;
}
export function useRemote<T=any>(path:string|null){
 const[data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(!!path),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;setData(null);setError('');if(!path){setLoading(false);return}setLoading(true);request<T>(path).then(value=>{if(active)setData(value)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[path,revision]);
 return {data,error,loading,reload:()=>setRevision(n=>n+1)};
}
