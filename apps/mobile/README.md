# Aplicativo Expo

Na raiz, execute `npm run dev:mobile`. Defina `EXPO_PUBLIC_API_URL` com um endereço da API alcançável pelo dispositivo. Em Android/iPhone físicos, localhost refere-se ao próprio aparelho. Em produção use HTTPS.

SDK Expo 55, React Native 0.83 e SecureStore. Login/cadastro, catálogo, busca, detalhes, biblioteca, registro de episódios, avaliações e perfil usam a API real compartilhada. A ausência de TMDB gera um estado de indisponibilidade.

Ao abrir um título, o aplicativo recupera a biblioteca, a nota pessoal e os episódios assistidos da conta. Voltar ao primeiro plano atualiza os dados; não há sincronização em tempo real nem edição offline. Falhas de sincronização bloqueiam alterações até a recuperação dos dados. Respostas atrasadas são descartadas ao trocar de título ou conta.

Episódios podem ser marcados e desmarcados; desfazer também remove a avaliação e o voto daquele episódio, conforme a regra da API. A marcação de temporada exige confirmação e ignora episódios futuros ou sem data confirmada. Favoritar preserva o status atual. A sinopse de episódios não assistidos fica oculta.

O diário aceita múltiplas sessões do mesmo filme no mesmo dia, com confirmação. A operação pendente e sua data ficam no SecureStore, separadas por conta e filme, até a confirmação do servidor. Repetir após uma falha ou reiniciar o aplicativo reutiliza a mesma operação, evitando duplicar a sessão. Isso não substitui uma fila offline.

`npm run test -w @barzinho/mobile` verifica concorrência, troca de conta/título e retomada do diário após falhas. O teste `apps/api/test/mobile-tracking.test.ts` usa o cliente compartilhado contra a API e um banco isolado para verificar persistência, temporadas, favoritos e isolamento.

`npm run export -w @barzinho/mobile` gera os bundles Android/iOS; não equivale a compilar binários nativos, testar em aparelhos ou publicar nas lojas. Assinatura e publicação precisam das contas Apple/Google, configuração de identificadores e revisão das lojas. Push, OAuth e paridade completa com a Web permanecem pendentes.

Neste ambiente de nuvem, o diretório padrão do Expo não é gravável. A exportação foi validada com cache temporário, sem alterar o diretório pessoal do sistema:

```sh
EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 __UNSAFE_EXPO_HOME_DIRECTORY=/tmp/barzinho-expo npm run export -w @barzinho/mobile
```
