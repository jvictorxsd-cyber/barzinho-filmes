/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
const apiUrl = new URL(apiOrigin);
if (apiUrl.username || apiUrl.password || apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash) {
  throw new Error('API_INTERNAL_URL deve conter apenas a origem da API, sem credenciais, caminho ou parâmetros.');
}
if (!['http:', 'https:'].includes(apiUrl.protocol)) {
  throw new Error('API_INTERNAL_URL deve usar HTTP ou HTTPS.');
}
if (process.env.VERCEL && process.env.BARZINHO_API_MODE !== 'embedded' && (!process.env.API_INTERNAL_URL || apiUrl.protocol !== 'https:' || /^(localhost|127\.|0\.|\[::1\])/.test(apiUrl.hostname) || apiUrl.hostname.endsWith('.localhost'))) {
  throw new Error('Configure API_INTERNAL_URL com a origem HTTPS da API hospedada antes de publicar na Vercel. A API local não é acessível pela Vercel.');
}
const config = { poweredByHeader: false, transpilePackages:['@barzinho/db'], serverExternalPackages:['fastify','@fastify/cookie','@fastify/cors','@fastify/rate-limit','postgres','@electric-sql/pglite','nodemailer','undici'], outputFileTracingIncludes:{'/api/*':['../../packages/db/migrations/*.sql']}, webpack(config){config.resolve.extensionAlias={'.js':['.ts','.tsx','.js'],'.mjs':['.mts','.mjs']};return config;}, async rewrites() { if(process.env.BARZINHO_API_MODE === 'embedded') return []; return {beforeFiles:[{source:'/api/:path*',destination:`${apiUrl.origin}/api/:path*`}]}; }, async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'X-Frame-Options',value:'DENY'}]}];} };
export default config;
