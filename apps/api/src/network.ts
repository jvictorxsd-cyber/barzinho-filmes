import {EnvHttpProxyAgent} from 'undici';
let proxy:EnvHttpProxyAgent|undefined;
/** Honor the environment's authenticated egress proxy without changing TLS verification. */
export const proxyFetch:typeof fetch=(input,init)=>{
 const configured=process.env.HTTPS_PROXY||process.env.HTTP_PROXY||process.env.https_proxy||process.env.http_proxy;
 if(!configured)return fetch(input,init);
 proxy??=new EnvHttpProxyAgent();
 return fetch(input,{...init,dispatcher:proxy} as RequestInit);
};
