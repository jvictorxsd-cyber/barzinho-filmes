# Recuperação de senha e confirmação de e-mail

A API expõe os fluxos de recuperação e confirmação, e a Web oferece `/recuperar-senha`, `/redefinir-senha` e `/verificar-email`. O perfil mostra o estado de confirmação e permite solicitar o envio. A solicitação de confirmação é explícita; criar uma conta não envia automaticamente uma mensagem. O estado confirmado ainda não é obrigatório para todas as interações sociais.

## Configuração

Configure valores reais no gerenciador de segredos/variáveis do servidor:

| Variável | Uso |
| --- | --- |
| `SMTP_HOST` | Servidor SMTP autorizado |
| `SMTP_PORT` | 587 por padrão; 465 usa TLS implícito |
| `SMTP_FROM` | Endereço de remetente autorizado pelo provedor |
| `SMTP_USER` | Usuário de autenticação, quando necessário |
| `SMTP_PASSWORD` | Senha SMTP, injetada diretamente no processo |
| `PUBLIC_WEB_URL` | Origem HTTPS pública da Web, sem caminho, parâmetros ou fragmento |

TLS é obrigatório, com validação de certificado. O servidor deve permitir conexão SMTP ao host e à porta escolhidos. Tokens substituídos por um proxy HTTPS não servem como senha para uma conexão SMTP direta. A allowlist HTTP do ambiente, por si só, não comprova conectividade SMTP; valide essa conectividade após escolher o provedor. Nenhuma conexão a um provedor externo foi testada nesta entrega.

Sem `SMTP_HOST` e `SMTP_FROM`, o endpoint de disponibilidade retorna `available:false`, a recuperação exibe indisponibilidade e a API recusa solicitações de envio com HTTP 503. Não há impressão de tokens nos logs nem substituição por e-mails simulados em execução normal. SMTP_USER e SMTP_PASSWORD precisam ser fornecidos juntos. Em desenvolvimento, os links usam WEB_ORIGIN como alternativa; links de localhost não servem como entrega pública.

Após configurar, reinicie a API para recriar o transporte. Cadastre uma conta de teste controlada, solicite confirmação pelo perfil e valide o link. Depois solicite recuperação, altere a senha e confirme que as sessões anteriores foram encerradas. Não use destinatários de terceiros para testes sem autorização.

## Contratos de segurança

Tokens têm 256 bits de aleatoriedade e são armazenados exclusivamente como SHA-256. Recuperação expira em 30 minutos; confirmação, em 24 horas. Cada finalidade possui no máximo um token ativo por conta e um intervalo de um minuto entre emissões. Reenvio invalida o token anterior. O consumo ocorre em transação e invalida reutilizações e tentativas concorrentes.

Links usam fragmentos (`#token=...`), que não são enviados ao servidor em URLs ou referrers. A Web lê o token em memória, remove o fragmento e exige uma ação explícita para consumir o link; leitores automáticos de e-mail não o consomem com GET. Recarregar a página perde o token em memória: reabra o link original. Tokens não são guardados em localStorage.

Redefinir a senha encerra todas as sessões da conta afetada. O login também serializa acesso ao usuário para evitar que um login com a senha antiga crie uma sessão válida depois da troca. Contas de outras pessoas mantêm suas sessões.

A recuperação responde HTTP 202 com a mesma mensagem para endereços existentes e desconhecidos, sem aguardar a latência SMTP. Envio aceito pelo SMTP não comprova entrega na caixa do destinatário. Falhas de envio são registradas com eventos sanitizados, sem erro bruto do provedor, destinatário ou conteúdo. Tokens de um envio que falhou são removidos.

## Limitações operacionais

As entregas de recuperação pendentes ficam em memória, limitadas a 50 por processo, e são aguardadas no encerramento normal da API. Elas não são uma fila durável: uma interrupção abrupta pode exigir nova solicitação após o intervalo mínimo. Antes de operar em escala, implementar uma fila durável com conteúdo criptografado, tentativas e monitoramento de entrega. O rate limiting por IP ainda é local à instância, enquanto o intervalo por conta é persistente no banco.

## Validação

Testes de API usam um transporte injetado e caixas isoladas em memória para validar consumo, expiração, finalidade, revogação e falhas. Um teste separado usa SMTP local com STARTTLS, certificado confiado apenas pelo subprocesso de teste e rejeição do mesmo certificado sem essa confiança. Nenhuma verificação TLS é desativada. Esses testes não substituem validar credenciais, reputação do remetente, domínio e recebimento com o provedor escolhido.

## Desenvolvimento inteiramente em localhost

Conforme a preferência atual, use `npm run dev:local` para desenvolver ou `npm run build` seguido de `npm run start:local` para executar o build. O comando inicia Web na porta 3000, API na 4000, SMTP local na 1025 e uma caixa de leitura HTTP na 8025. A caixa de e-mail escuta somente em loopback e não encaminha mensagens para a internet.

Não é necessário contratar provedor nem preencher credenciais SMTP nesse modo. O script gera um certificado de desenvolvimento em `.data/mail`, acrescenta esse certificado à confiança do processo sem remover certificados existentes e exige STARTTLS entre API e caixa local. As chaves ficam fora do Git. A caixa conserva no máximo 50 mensagens em memória e as perde ao reiniciar. A interface identifica claramente que é uma caixa de desenvolvimento.

Para testar, crie sua conta local, solicite confirmação pelo perfil e abra a caixa na porta 8025 do seu computador. O link recebido abre a Web local. A recuperação segue o mesmo fluxo. Isso é envio SMTP real para um receptor local; não comprova recebimento por provedores externos. O script se recusa a executar com NODE_ENV=production.

Foi validado um ciclo completo local de cadastro, recebimento SMTP, confirmação, recuperação, alteração de senha, revogação de sessão e exclusão da conta de teste. Nenhum destinatário externo recebeu mensagens.
