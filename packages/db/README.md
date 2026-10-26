# Persistência

`createDb()` usa PostgreSQL quando `DATABASE_URL` está definida. Sem essa variável,
o desenvolvimento usa PostgreSQL embarcado via PGlite, com arquivos em
`.data/barzinho` na raiz do repositório. `DATA_DIR` permite escolher outro diretório.
A aplicação recusa iniciar em `NODE_ENV=production` sem `DATABASE_URL`.

PGlite é uma opção local para uma única instância da API. Vários processos não
devem abrir o mesmo diretório. Em produção, use PostgreSQL gerenciado, TLS,
credenciais com privilégio mínimo e backups com recuperação testada. A configuração
TLS deve ser fornecida na URL de conexão conforme as instruções do provedor.

As migrações SQL são versionadas em `migrations/`, registradas em
`schema_migrations` e executadas dentro de transação. No PostgreSQL, uma trava
consultiva serializa migrações durante a inicialização de múltiplas instâncias.
Novas mudanças de esquema devem ser novas migrações; não edite uma migração já
aplicada em um ambiente persistente.

O adaptador oferece `query(sql, parâmetros)` e `transaction(async tx => ...)`.
Use `transaction` para operações com múltiplas escritas: `BEGIN` e `COMMIT`
executados por chamadas independentes de `query` não reservam a mesma conexão.

## Integridade

- Títulos: identidade externa única por tipo e ID TMDB; episódios únicos por
  série, temporada e número.
- Sessões: somente hash do token é persistido; sessões são removidas com a conta.
- Histórico: episódio único por usuário; diário de filmes permite revisitas,
  protegido por chave de idempotência por usuário.
- Avaliações: uma nota por usuário/alvo, entre 0 e 10 em passos de 0,5.
  Avaliações de episódios exigem o episódio assistido por chave estrangeira.
- Votos: um voto por usuário/episódio; exigem registro de episódio assistido.
  Desmarcar o episódio remove a avaliação e o voto por cascata.
- Comentários: alvo existente; respostas só podem pertencer ao mesmo alvo.
- Listas, seguidores, curtidas e medalhas: restrições de unicidade impedem
  duplicações. Seguir a própria conta é rejeitado no banco.

Autorizações, visibilidade do perfil, requisitos das medalhas e a participação
do personagem no episódio são verificados pela API. O banco não substitui essas
validações.

Execute `npm test -w @barzinho/db` para verificar persistência entre instâncias,
reexecução das migrações, restrições do histórico/votos/notas e rollback atômico.
Os testes usam um diretório temporário isolado e ignoram `DATABASE_URL` quando
esse diretório é explicitamente passado a `createDb`.
