# Arquitetura do Barzinho

Monorepositório npm com três aplicações: Web Next.js, API Fastify e mobile Expo. O pacote compartilhado concentra contratos TypeScript e cliente HTTP. A API concentra regras de negócio, autenticação, autorização e chamadas externas. O navegador usa `/api` no mesmo domínio por proxy do Next; o aplicativo usa a mesma API com sessão Bearer armazenada no SecureStore.

## Persistência e consistência

PostgreSQL é o destino de produção; PGlite executa PostgreSQL localmente para desenvolvimento, com persistência em `.data/`. Nunca servir múltiplos processos sobre o mesmo diretório PGlite. `DATABASE_URL` seleciona o servidor PostgreSQL. Migrações versionadas mantêm o modelo consistente. Chaves estrangeiras, restrições de unicidade e validação de domínio protegem avaliações, progresso, sessões e votos. Um usuário pode avaliar cada alvo uma vez; o diário permite revisitas intencionais sem duplicar requisições repetidas.

Títulos usam identidade `movie:<TMDB id>` ou `tv:<TMDB id>`. Episódios usam `tv:<id>:<temporada>:<episódio>`. IMDb é um identificador externo, não uma promessa de acesso a seu catálogo completo. Dados pessoais pertencem ao usuário autenticado; IDs enviados pelo cliente não substituem a identidade da sessão.

## Integrações

TMDB fornece catálogo em pt-BR, imagens, elenco, temporadas e episódios. Trailers são links oficiais do YouTube presentes nos metadados. Disponibilidade regional usa dados de provedores TMDB, com atribuição à origem. Ausência de dados é apresentada explicitamente. Tokens existem somente no backend. Cache reduz chamadas e permite reapresentar dados obtidos previamente, respeitando termos do provedor.

OAuth Google/Apple, entrega de e-mails, push, armazenamento de arquivos e publicação nas lojas exigem provedores e credenciais próprios. Não há substituição por credenciais fictícias ou indicadores de sucesso simulados.

## Design system

Português brasileiro; escuro como padrão; fundos carvão, superfícies elevadas e destaque âmbar. Tipografia com hierarquia editorial, cartões com imagens oficiais e estados vazios expressivos. Menu lateral em desktop e navegação inferior em celulares. Formulários com rótulos, foco visível, feedback de carregamento e erro. Tema claro preserva contraste e identidade.

## Caminho para escala

Antes de disponibilizar publicamente: PostgreSQL gerenciado, backup e recuperação testados, TLS no ingress, segredos gerenciados, observabilidade externa, rate limiting compartilhado entre instâncias e fila para importações/notificações. Cache em memória não é compartilhado entre réplicas; Redis pode substituir esse mecanismo quando necessário. O estágio atual deve ser medido e validado antes de afirmar suporte a milhares de usuários simultâneos.
