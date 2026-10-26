# Escopo e validação

Este repositório inicia uma implementação incremental real. Não representa a conclusão de todas as sete fases do produto solicitado. A persistência de contas, sessões e interações pertence à API compartilhada, não ao armazenamento local do navegador. PGlite é destinado ao desenvolvimento de uma instância; PostgreSQL deve ser configurado para produção.

## Dependências externas

- Um token de leitura válido de TMDB, sob os termos de uso, é necessário para consultas externas reais. O código não importa um catálogo fictício quando ele está ausente.
- OAuth Google/Apple permanece pendente. Recuperação de senha e confirmação de e-mail foram implementadas; entrega externa depende de SMTP, remetente e URL pública configurados.
- Push nativo, armazenamento de avatar/capa, moderação administrativa completa, recomendações colaborativas, lançamento nas lojas e provisionamento de infraestrutura são etapas posteriores.
- O cliente Expo possui fontes e validação de tipos; execução em aparelhos físicos e assinatura para lojas precisam de Android SDK/Xcode e contas próprias.

## Pré-requisitos para uma publicação pública

Revisar `docs/ARCHITECTURE.md`, configurar PostgreSQL, credenciais e origem HTTPS, validar recuperação e confirmação com entrega externa real e implementar fila durável de envio, executar testes contra PostgreSQL e dispositivos reais e concluir revisão de segurança e privacidade. A existência de código e testes locais não comprova capacidade para milhares de usuários nem conformidade jurídica integral com LGPD.

## Validação desta entrega

- Verificação TypeScript: todos os cinco workspaces passaram.
- Vinte e dois testes de API/banco e três testes da lógica mobile passaram, incluindo cache TMDB com respostas controladas, persistência em disco, isolamento entre contas, idempotência, spoilers e votos.
- Build Next.js concluído.
- Exportação dos bundles Expo Android e iOS concluída. Não foram executados em dispositivos.
- Integração TMDB autenticada validada nesta instância: Home com quatro seções de 20 títulos, detalhes de filme/série e temporada com 10 episódios. Pôsteres reais foram renderizados no navegador pelo gateway de imagens.

## Funcionalidades ainda incompletas

Além das integrações citadas acima: painel administrativo e auditoria, personalização colaborativa, estatísticas avançadas/retrospectiva, todas as medalhas e artes exclusivas, notificações push, busca de episódios/personagens, paridade social mobile, controles granulares de privacidade por tipo de atividade. As novas funções de listas e calendário pessoal estão disponíveis na Web; a paridade mobile permanece pendente. A entrega não deve ser descrita como plataforma completa nem pronta para publicação pública.

Quatro testes Playwright passaram: cadastro, sessão após recarga, perfil, conquistas, navegação mobile sem overflow, exclusão da conta de teste, tema claro/escuro e filtro de séries. Chromium local foi utilizado; não substitui testes Safari, iOS ou Android reais.

## Incremento: acompanhamento e comunidade

A Web agora permite editar nome e biografia, tornar o perfil privado, encerrar todas as sessões e excluir a conta com senha e confirmação. Perfis privados saem da busca e do feed; comentários em conversas permanecem públicos, conforme explicado na interface. As notificações internas podem ser lidas pelo perfil.

Atividades inclui busca de pessoas e seguir/deixar de seguir. Comentários permitem editar, responder, curtir, denunciar e ordenar por recentes/mais curtidos, com paginação e revelação explícita de spoilers.

Marcação de temporada usa uma operação atômica, exige confirmação e metadados completos da temporada, ignora episódios futuros ou sem data confirmada e mantém unicidade por usuário/episódio. A resposta informa quantos registros foram acrescentados e ignorados. Não equivale a declarar uma série finalizada.

Os testes adicionais verificam chamadas concorrentes da marcação de temporada, catálogo parcialmente carregado, episódios não lançados, privacidade em busca/feed, curtidas sem duplicação, edição de terceiros bloqueada e revogação de sessões. O teste de navegador também verifica que alterações no perfil e privacidade persistem após recarregar.

## Incremento: listas e descoberta

Listas personalizadas têm criação, leitura, renomeação, privacidade, adição/remoção de títulos e exclusão. O título pode ser adicionado pela sua página ou pela biblioteca. Listas públicas podem ser compartilhadas pelo link; listas privadas e listas de perfis privados exigem o proprietário. Excluir uma lista não remove o histórico de visualizações nem a biblioteca.

Recomendações usam gêneros, notas e favoritos do próprio usuário. Não recomendam títulos já acompanhados, vistos ou avaliados. A seleção é limitada a até 500 títulos recentemente armazenados e exibe até 20 resultados; não há recomendação colaborativa nem promessa de cobertura de todo o catálogo. Sem histórico, o sistema oferece descoberta entre os títulos disponíveis, explicitamente identificada.

A agenda pessoal possui visualizações de lista, semana e mês, usa filmes/séries na biblioteca e reúne episódios importados com o próximo episódio informado no detalhe da série. Episódios assistidos são excluídos; identidades repetidas são deduplicadas. Datas sem horário são preservadas como datas, e lançamentos sem data são sinalizados separadamente. A fonte não garante estreia regional em streaming. A agenda usa dados consultados e não representa um sincronizador periódico em segundo plano.

Os testes adicionais cobrem privacidade de listas e perfis, alterações por terceiros bloqueadas, duplicações, isolamento das recomendações e datas do calendário. O fluxo de navegador inclui criar, renomear, compartilhar e excluir uma lista e alternar as visualizações da agenda.

## Incremento: segurança de contas

Recuperação de senha, confirmação de e-mail e telas correspondentes estão implementadas. A migração 002 acrescenta confirmação e tokens de uso único preservando as contas existentes. A redefinição encerra todas as sessões da conta e mantém as de outras pessoas. O consumo é transacional, com expiração, separação por finalidade e proteção contra reutilização.

O transporte SMTP usa TLS obrigatório. Sem configuração, a interface informa indisponibilidade. Credenciais e token não são expostos pelo frontend. Foram testados o fluxo com transporte isolado e uma troca SMTP real local via STARTTLS, incluindo rejeição de certificado não confiável; envio externo permanece não validado. Consulte [EMAIL.md](EMAIL.md) para configuração e limitações da fila em memória, confirmação opcional e operação em múltiplas instâncias.

A validação daquele incremento somou 21 testes de API/banco e 4 testes de navegador. Incluiu atualização de um banco anterior à migração de contas, concorrência entre login e troca de senha, disponibilidade do envio e remoção de tokens da URL.

## Modo local e catálogo conectado

A preferência atual é localhost. `npm run dev:local` / `npm run start:local` iniciam a caixa SMTP de desenvolvimento com TLS e leitor local. O ciclo completo de e-mail foi validado sem mensagens externas. As configurações de SMTP externo são opcionais para este fluxo e permanecem reservadas à futura publicação.

A API agora respeita o proxy de saída do ambiente nas consultas TMDB. As imagens da Web passam por um gateway restrito ao domínio oficial, com formatos e tamanhos validados, limite de 8 MiB por imagem e cache de até 32 MiB/64 entradas. Respostas não gráficas são rejeitadas. Isso mantém credenciais no servidor e permite carregar as artes oficiais no ambiente de nuvem. As atribuições TMDB/JustWatch foram preservadas.

## Incremento: acompanhamento mobile

O Expo recupera episódios assistidos, avaliação pessoal e favoritos ao abrir títulos e ao retornar ao primeiro plano. A leitura usa a API da conta; não presume que ausência de uma resposta significa ausência de progresso. Há recuperação explícita de erros e descarte de respostas atrasadas após trocar título ou conta. Favoritar mantém o status da biblioteca; a nota zero é preservada. A temporada pode ser marcada com confirmação, e episódios podem ser desmarcados. Sinopses de episódios não assistidos ficam ocultas.

O diário mobile permite reassistir ao filme no mesmo dia. Cada nova sessão exige confirmação; uma tentativa ainda não confirmada mantém identificador e data no SecureStore para reutilização após falhas, inclusive ao reiniciar. Não há fila offline nem sincronização em tempo real.

Validação deste incremento: TypeScript nos cinco workspaces, 25 testes (20 API, 2 banco, 3 lógica mobile) e bundles Android/iOS exportados. Os testes da API exercitam o controlador usado pelo aplicativo contra banco isolado. Os testes de navegador do incremento anterior não foram repetidos, pois a interface Web não mudou. A interface nativa ainda precisa ser exercitada em aparelhos ou emuladores; a exportação não comprova essa execução. Consulte o README mobile para o comando de exportação neste ambiente.

## Preparação de deploy

A configuração Vercel da Web usa `apps/web` como diretório do projeto. A API continua em um serviço Node separado com PostgreSQL. O build rejeita destino localhost na Vercel. Consulte [DEPLOY.md](DEPLOY.md) para as variáveis e a topologia. A suíte atual soma 28 testes: os 25 anteriores e 3 verificações da configuração de deploy. Configuração versionada e build local não comprovam uma publicação remota.


## API integrada para publicação na Vercel

O adaptador Next encaminha requisições à mesma API Fastify, preservando cookies, respostas binárias e validação. PostgreSQL/Supabase substitui o banco local na publicação. A migração 003 bloqueia acesso direto por papéis de navegador, preservando as tabelas e os usuários existentes. Os testes incluem leitura negada por RLS e configuração do modo integrado. Detalhes e variáveis em DEPLOY.md. SMTP e TMDB precisam de credenciais próprias na Vercel; a presença delas no ambiente de desenvolvimento não configura automaticamente o deployment.
