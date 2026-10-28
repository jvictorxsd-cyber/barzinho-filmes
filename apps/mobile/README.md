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

## APK Android independente

O aplicativo aponta por padrão para `https://barzinho-filmes.vercel.app`, compartilha a conta e os dados do site e guarda o token de sessão no SecureStore. Não inclui chaves TMDB, Vercel ou credenciais pessoais. `EXPO_PUBLIC_API_URL` permite trocar a origem pública durante o build. A versão de distribuição exige HTTPS. O cliente nativo usa autenticação Bearer, sem depender dos cookies do navegador.

Identificador Android: `com.barzinhofilmes.app`. O APK inclui o bundle JavaScript e funciona sem Metro ou Expo Go. É necessário acesso à internet para catálogo e sincronização; não há edição offline. A identidade visual acompanha o site, com preto, grafite e amarelo.

Para compilar, instale Java 17 ou posterior, Android SDK 36, Build Tools 36.0.0, NDK 27.1.12297006 e CMake 3.22.1. Configure `ANDROID_HOME` e as variáveis privadas abaixo, sem colocá-las no código ou no histórico do shell:

- `BARZINHO_ANDROID_KEYSTORE`: caminho absoluto do keystore privado.
- `BARZINHO_ANDROID_STORE_PASSWORD`: senha do keystore.
- `BARZINHO_ANDROID_KEY_ALIAS`: alias da chave.
- `BARZINHO_ANDROID_KEY_PASSWORD`: senha da chave.

Execute na raiz `npm ci` e `npm run build:apk -w @barzinho/mobile`. O arquivo gerado é `apps/mobile/dist/barzinho-android.apk`. O script gera o projeto nativo com Expo e compila a variante release assinada. Por padrão, inclui arm64-v8a, armeabi-v7a e x86_64; `BARZINHO_ANDROID_ARCHITECTURES` permite limitar as arquiteturas. Os projetos nativos gerados, caches, binários e chaves não entram no Git.

O plugin `with-gradle-version.cjs` fixa Gradle 8.14.3 com SHA-256 oficial: o template Expo usa Gradle 9, mas o resolver Foojay 0.5 do React Native 0.83.2 referencia uma constante removida nessa versão. O plugin de assinatura recusa release sem as quatro variáveis, evitando publicar a chave de debug.

Preserve o keystore e suas senhas em armazenamento privado durável: atualizações instaláveis sobre a versão anterior precisam da mesma chave e de um `android.versionCode` maior. A cópia local inicial está em `.android-signing/`, ignorada pelo Git. O acesso GitHub disponível neste ambiente não permite gravar secrets de Actions; não existe backup automático remoto da assinatura.

Antes de distribuir, valide o APK com `apksigner verify --verbose --print-certs`, confira identificador/versão/permissões com `aapt dump badging` e registre seu SHA-256. Compile o APK novamente após qualquer alteração no código mobile. Não confunda validação de build e API com testes em aparelho físico.
