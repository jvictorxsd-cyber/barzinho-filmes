# Barzinho — filmes, séries e boas conversas

Aplicação em desenvolvimento com Web Next.js, API Fastify, PostgreSQL/PGlite e cliente nativo Expo. Interface em português brasileiro e identidade cinematográfica escura. Consulte [arquitetura](docs/ARCHITECTURE.md), [API](docs/API.md), [publicação na Vercel](docs/DEPLOY.md) e [escopo e limites](docs/DELIVERY.md).

## Executar no ambiente de desenvolvimento

Requisitos: Node.js 22.13+ e npm. Na raiz:

```bash
npm ci
cp .env.example .env
npm run dev:local
```

A Web usa a porta 3000 e a API a porta 4000. O modo local inclui uma caixa SMTP de desenvolvimento na porta 1025 e seu leitor na porta 8025, restritos ao loopback. Ele não envia mensagens externas. `npm run dev` inicia somente Web/API; `npm run start:local` executa o build com a caixa local. Sem `DATABASE_URL`, a API cria um banco PostgreSQL embarcado PGlite persistente em `.data/barzinho`. Os dados sobrevivem ao reinício; não execute duas instâncias sobre o mesmo diretório. `.env` e `.data` são ignorados pelo Git.

Configure `TMDB_TOKEN` com um token de leitura válido obtido na sua conta TMDB. No ambiente de nuvem, use a área segura de configurações. Não envie tokens em mensagens, commits ou variáveis públicas do frontend. Sem o token, cadastro, login e áreas pessoais funcionam; o catálogo exibe indisponibilidade. Não há dados demonstrativos inseridos no banco da aplicação.

Para PostgreSQL externo, defina `DATABASE_URL`. Opcionalmente, o `compose.yaml` inicia um PostgreSQL local após definir `POSTGRES_PASSWORD`; configure a URL correspondente. As migrações são aplicadas pela API no início. O Compose requer Docker e não substitui backup ou infraestrutura de produção.

## Verificação

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Pare os serviços locais antes do build e dos testes de navegador: o Playwright inicia uma instância nova para evitar validar arquivos de versões diferentes.

Os testes de API/banco usam bancos PGlite isolados e dados de teste explícitos. Os testes de navegador exercitam a aplicação local, incluindo cadastro, persistência de sessão, privacidade e navegação. Veja o relatório final de implementação para os comandos efetivamente executados e limitações observadas.

## Mobile

```bash
npm run dev:mobile
```

Consulte [instruções do aplicativo](apps/mobile/README.md). `EXPO_PUBLIC_API_URL` deve apontar à API acessível pelo dispositivo; `localhost` em um celular aponta ao próprio celular. Tokens são armazenados no SecureStore nativo. Publicar para iOS/Android exige contas e ferramentas de assinatura próprias.

## Produção

A Web deve ser compilada com `npm run build`. Configure `NODE_ENV=production`, `DATABASE_URL`, `WEB_ORIGIN` com a origem HTTPS real e `API_INTERNAL_URL` com o endereço interno da API antes de executar `npm start`. A API recusa PGlite em produção. Recuperação de senha e confirmação de e-mail usam SMTP com TLS; consulte [configuração de e-mail](docs/EMAIL.md). Credenciais OAuth, SMTP, push e storage não estão pré-configurados. Esta entrega é incremental; consulte [pendências](docs/DELIVERY.md) antes de uma publicação pública.

## Fontes e licenças

Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB. Imagens e metadados permanecem sujeitos aos termos dos respectivos titulares. Dados de disponibilidade de streaming fornecidos via TMDB devem manter a atribuição a JustWatch. Não há scraping de IMDb nem promessa de cobertura integral. Os trailers são links oficiais do YouTube encontrados nos metadados.
