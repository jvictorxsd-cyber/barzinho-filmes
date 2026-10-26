# API HTTP

Prefixo `/api`. Respostas JSON. Autenticação por cookie HttpOnly `barzinho_session` na Web ou `Authorization: Bearer <sessão>` no mobile. Mutações com cookie exigem `Origin` igual a `WEB_ORIGIN`. Nunca registrar tokens. Erros usam status HTTP e campo `error`; validação pode incluir `issues`.

| Operação | Rota | Entrada principal |
| --- | --- | --- |
| Cadastro | POST /auth/register | email, password (10–128), username, displayName |
| Login | POST /auth/login | email, password |
| Conta atual | GET /auth/me | — |
| Disponibilidade de e-mail | GET /auth/email/status | — |
| Recuperar senha | POST /auth/forgot-password | email; resposta genérica 202 |
| Redefinir senha | POST /auth/reset-password | token, password |
| Solicitar confirmação | POST /auth/request-verification | sessão autenticada |
| Confirmar e-mail | POST /auth/verify-email | token |
| Logout | POST /auth/logout | — |
| Editar conta | PATCH /account | displayName, bio, privateProfile |
| Exportar dados | GET /account/export | — |
| Excluir conta | DELETE /account | password |
| Catálogo | GET /catalog/home | — |
| Busca | GET /catalog/search | q, type, year, genre, page |
| Título | GET /catalog/:type/:id | type movie ou tv, id TMDB |
| Temporada | GET /catalog/tv/:id/seasons/:season | — |
| Episódio | GET /catalog/tv/:id/seasons/:season/episodes/:episode | — |
| Pessoa | GET /catalog/person/:id | — |
| Biblioteca | GET ou PUT /library | PUT: titleId, status, favorite opcional |
| Assistir episódio | PUT /watch/episode | episodeId, watched |
| Marcar temporada | PUT /watch/season | titleId, seasonNumber, confirmed: true |
| Revogar sessões | POST /account/revoke-sessions | — |
| Progresso | GET /watch/episodes/:titleId | — |
| Diário de filme | POST /watch/movie | titleId, watchedAt opcional, idempotencyKey |
| Avaliar | PUT /ratings | targetId, targetType title/episode, score 0–10 passo 0,5 |
| Notas | GET /ratings | targetId |
| Comentários | GET ou POST /comments | POST: targetId, targetType, body, spoiler, parentId opcional |
| Editar/excluir comentário | PATCH ou DELETE /comments/:id | PATCH: body, spoiler |
| Revelar spoiler | GET /comments/:id/reveal | ação explícita do leitor |
| Curtir | PUT /comments/:id/like | liked |
| Denunciar | POST /comments/:id/report | reason |
| Votar | PUT /votes | episodeId, personId, character |
| Resultados | GET /votes/:episodeId | requer assistido; resultados após votar |
| Perfil próprio | GET /profile | — |
| Conquistas | GET /achievements | — |
| Pessoas públicas | GET /users | q |
| Pessoas seguidas | GET /follows | — |
| Seguir | PUT /follows/:userId | following |
| Feed | GET /feed | — |
| Notificações | GET /notifications | — |
| Ler notificação | PATCH /notifications/:id | — |
| Listas | GET ou POST /lists | POST: name, private |
| Detalhe de lista | GET /lists/:id | pública ou proprietário |
| Editar lista | PATCH /lists/:id | name, private |
| Excluir lista | DELETE /lists/:id | proprietário |
| Remover item | DELETE /lists/:id/items/:titleId | proprietário |
| Recomendações | GET /recommendations | usuário autenticado |
| Agenda pessoal | GET /calendar | from, to (YYYY-MM-DD), timeZone IANA |
| Item de lista | PUT /lists/:id/items | titleId |

Títulos precisam ter sido consultados/importados antes de receber interações. IDs locais incluem o tipo: `movie:123`, `tv:123`, `tv:123:1:2`. Repetir a mesma chave de diário repete a operação sem criar outra visualização; para uma revisita intencional use nova chave. Apenas o proprietário edita/exclui seus comentários e dados. E-mail nunca é retornado na busca pública.

As rotas são implementadas, mas a documentação OpenAPI gerada, painel administrativo, paginação uniforme e todas as telas sociais ainda precisam de trabalho.

`PUT /watch/season` só aceita séries com contagem de episódios da temporada conhecida e todos os episódios importados. Retorna `{ok, added, eligible, skipped}`; episódios futuros ou sem data são ignorados, e requisições repetidas não duplicam registros. `/users` inclui `following` relativo à sessão atual.

A agenda aceita janelas de até 93 dias e retorna `{items, undatedCount, timeZone, datePrecision: "day", source: "stored_catalog"}`. Não converte datas sem horário em instantes. Recomendações retornam `{items, mode, source}` com justificativa por título; `mode` diferencia personalização de descoberta inicial.

Contas retornam `emailVerifiedAt` (data ou null). Tokens de conta nunca são retornados pela API. Sem transporte configurado, solicitações de e-mail retornam 503. Veja [EMAIL.md](EMAIL.md) para expiração, consumo e operação.

`GET /images/:size/:file` serve imagens do domínio oficial TMDB com validação de nome, formato, tamanho e cache público limitado. A rota não aceita URLs arbitrárias nem encaminha credenciais de usuários.
