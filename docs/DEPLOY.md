# Publicação da Web na Vercel

A Web pode executar a API Fastify dentro de uma função Node da Vercel, com PostgreSQL externo, ou encaminhar chamadas a um serviço Node separado. A Vercel não executa os comandos `dev:local`/`start:local` nem acessa os serviços localhost deste ambiente. Não use PGlite em disco temporário para contas de produção.

## API integrada na Vercel

No projeto com Root Directory `apps/web`, configure `BARZINHO_API_MODE=embedded`, `WEB_ORIGIN` e `PUBLIC_WEB_URL` com a origem HTTPS de produção. A integração Supabase fornece `POSTGRES_URL`, aceita pelo banco como alternativa a `DATABASE_URL`. O cliente usa até três conexões por instância e consultas sem prepared statements para compatibilidade com poolers. A API reutiliza a instância Fastify aquecida; não abre uma porta HTTP separada.

O projeto `barzinho-filmes` está conectado a um banco Supabase exclusivo no plano gratuito. A migração 003 habilita RLS e revoga acesso direto de papéis públicos às tabelas; autenticação e permissões continuam na API Barzinho. Nenhuma conta ou banco de outro projeto é reutilizado.

Configure `TMDB_TOKEN` como segredo de Production na Vercel para carregar o catálogo. Tokens de proxy do ambiente Codex não podem ser copiados como credenciais reais. SMTP externo permanece opcional: sem ele a recuperação e a confirmação informam indisponibilidade. Tarefas de e-mail em segundo plano são registradas no ciclo `after()` da Vercel, mas ainda não substituem uma fila durável.

O limite de corpo da API é 64 KiB. Imagens oficiais são binárias e preservadas pelo adaptador. As migrações SQL são incluídas no pacote da função. Rate limiting e cache em memória são por instância; esta publicação não comprova capacidade para milhares de usuários.

### Compatibilidade do runtime

O runtime Node da Vercel pode desabilitar `require(ESM)`. `light-my-request` 6.8 usa `require()` para carregar `cookie` 2 (ESM), causando erro 503 em todas as rotas da API mesmo após um build bem-sucedido. O monorepositório fixa `light-my-request` 6.6.0, que usa a interface CommonJS de cookies. Fastify está declarado também na raiz para que o override seja aplicado à árvore compartilhada dos workspaces. Preserve o lockfile e execute `npm ci`.

`apps/api/test/runtime.test.ts` inicia um processo com `--no-experimental-require-module` e verifica criação e leitura do cookie de sessão pelo mesmo mecanismo de requisições usado pelo adaptador. Após o deploy, valide `/api/health`, catálogo e login no domínio público; o estado READY da Vercel só confirma a publicação do build.

## API em serviço separado (alternativa)

No provedor escolhido para o serviço Node, use o repositório completo, instale com `npm ci` e inicie com `npm run start -w @barzinho/api`. Use Node 22.13 ou superior. Configure:

- `NODE_ENV=production`.
- `DATABASE_URL` de um PostgreSQL persistente, com TLS conforme o provedor.
- `WEB_ORIGIN` com a origem HTTPS exata da Web, sem barra final.
- `PUBLIC_WEB_URL` com essa mesma origem para os links de conta.
- `TMDB_TOKEN` somente no servidor da API.
- `PORT` fornecida pelo provedor, ou `API_PORT` explícita.

As migrações são aplicadas no início, com bloqueio transacional. Não reutilize um banco de outro produto. Configure backup antes de armazenar dados reais. Valide `/api/health` com banco conectado antes de publicar a Web.

SMTP externo é opcional para iniciar, mas necessário para confirmação e recuperação de conta na publicação. Sem configuração, essas telas informam indisponibilidade. A caixa SMTP de localhost é apenas para desenvolvimento. Consulte [EMAIL.md](EMAIL.md) sobre variáveis e limites da fila de envio.

## Projeto Vercel

1. Importe `jvictorxsd-cyber/barzinho-filmes` e escolha a branch `main`.
2. Configure **Root Directory** como `apps/web` e mantenha habilitada a inclusão de arquivos fora dessa pasta, pois o lockfile e os workspaces ficam na raiz.
3. O arquivo `apps/web/vercel.json` define Next.js, instalação das dependências do monorepositório e saída `.next`.
4. Use o modo integrado descrito acima ou, para uma API separada, cadastre `API_INTERNAL_URL` em Production com sua origem HTTPS, por exemplo `https://api.seu-dominio.com`, sem `/api`. Não é uma variável `NEXT_PUBLIC_*`.
5. Publique e valide cadastro, login, catálogo, gravação e leitura do progresso após recarregar. Ajuste `WEB_ORIGIN` na API para o domínio final da Vercel.

O build exige modo integrado explícito ou API HTTPS separada para evitar publicar uma interface apontando a localhost. A URL é resolvida durante o build; alterações exigem novo deploy. As chamadas do navegador permanecem em `/api` na mesma origem da Web e são encaminhadas pelo Next.

Previews devem usar um ambiente de API/banco separado e a origem correspondente. Não aponte indiscriminadamente previews ao banco de produção. O controle de origem da API exige correspondência com `WEB_ORIGIN`.

## Automação neste ambiente

O deploy por CLI/API exige autenticação Vercel válida e acesso ao projeto/time. Cadastre `VERCEL_TOKEN` na área segura do ambiente e forneça o projeto/time; nunca adicione o token ao Git. Identificadores de projeto podem ser armazenados nas variáveis `VERCEL_PROJECT_ID` e `VERCEL_ORG_ID`. Arquivos `.vercel` estão ignorados.

Ter a configuração versionada não significa que houve uma publicação. A conclusão depende de uma URL de deployment confirmada e das verificações remotas.
