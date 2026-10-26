# Integrações de catálogo

O backend consulta a API oficial v3 do TMDB em português brasileiro e prioriza disponibilidade no Brasil. Configure `TMDB_TOKEN` (token de leitura da API) no servidor; `TMDB_API_KEY` também é aceito. Nenhuma credencial é enviada aos clientes. Sem credencial, os endpoints respondem `503 CATALOG_NOT_CONFIGURED`, preservando dados já armazenados e exibindo um estado de indisponibilidade no cliente.

O registro de credenciais depende da conta e dos termos do TMDB. A licença e atribuição devem ser revistas antes de uso comercial. TMDB não equivale à cobertura integral do IMDb. Identificadores IMDb vêm dos identificadores externos do TMDB; não há scraping nem importação de notas do IMDb. Imagens usam caminhos fornecidos pela API, com base oficial `https://image.tmdb.org/t/p/`. O frontend precisa exibir a atribuição TMDB e a marca aprovada conforme seus termos antes do lançamento público.

Trailers são links YouTube informados pelo TMDB, filtrados por `official=true`, `site=YouTube` e `type=Trailer`. Disponibilidade de streaming utiliza `watch/providers` com região `BR`, mostra atribuição ao JustWatch e o link devolvido pela API. A ausência de dados aparece como ausência; nenhuma participação de elenco de episódio é inferida do elenco geral da série.

Respostas externas são armazenadas em `catalog_cache` por seis horas. Em indisponibilidade, uma resposta previamente obtida pode ser reaproveitada por até sete dias e será marcada `source.stale=true`. O cache é atualizado por demanda; não há worker periódico instalado nesta etapa. Cache é persistente em PostgreSQL/PGlite e deve ser ajustado conforme termos de retenção da API. Consulta concorrente da mesma chave é deduplicada por processo. Os limites externos ainda exigem observabilidade e um cache/limite distribuído antes de múltiplas réplicas.

`catalog_titles` e `catalog_episodes` guardam identidades estáveis como `movie:550` e `tv:1399:1:1`, garantindo que importações repetidas não criem títulos duplicados. Lista de temporadas e episódios é persistida conforme consultada. Notas externas são identificadas como TMDB, nunca apresentadas como avaliações próprias da comunidade.

Pesquisa oferece busca textual oficial TMDB e descoberta de títulos. Filtros de gênero, ano, nota mínima, país, idioma e provedor são usados no modo descoberta sem texto. Busca global de usuários, personagens, episódios e listas e tolerância explícita a erros de digitação são trabalho posterior; não são simuladas.
