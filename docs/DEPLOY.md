# Publicação da Web na Vercel

A arquitetura atual usa Next.js na Vercel e a API Fastify como serviço Node persistente separado, com PostgreSQL. A Vercel não executa os comandos `dev:local`/`start:local` nem acessa os serviços localhost deste ambiente. Não use PGlite em disco temporário para contas de produção.

## API

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
4. Em Production, cadastre `API_INTERNAL_URL` com a origem HTTPS da API hospedada, por exemplo `https://api.seu-dominio.com`, sem `/api`. Não é uma variável `NEXT_PUBLIC_*`.
5. Publique e valide cadastro, login, catálogo, gravação e leitura do progresso após recarregar. Ajuste `WEB_ORIGIN` na API para o domínio final da Vercel.

O build rejeita a ausência da API pública na Vercel para evitar publicar uma interface apontando a localhost. A URL é resolvida durante o build; alterações exigem novo deploy. As chamadas do navegador permanecem em `/api` na mesma origem da Web e são encaminhadas pelo Next.

Previews devem usar um ambiente de API/banco separado e a origem correspondente. Não aponte indiscriminadamente previews ao banco de produção. O controle de origem da API exige correspondência com `WEB_ORIGIN`.

## Automação neste ambiente

O deploy por CLI/API exige autenticação Vercel válida e acesso ao projeto/time. Cadastre `VERCEL_TOKEN` na área segura do ambiente e forneça o projeto/time; nunca adicione o token ao Git. Identificadores de projeto podem ser armazenados nas variáveis `VERCEL_PROJECT_ID` e `VERCEL_ORG_ID`. Arquivos `.vercel` estão ignorados.

Ter a configuração versionada não significa que houve uma publicação. A conclusão depende de uma URL de deployment confirmada e das verificações remotas.
