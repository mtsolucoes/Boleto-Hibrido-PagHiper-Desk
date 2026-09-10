# Configuracao Sigma / Zoho Desk

## Fluxo correto quando subir uma nova versao

O ZIP gerado por `cmd /c zet pack` neste projeto atualiza o widget e o manifest, mas nao leva automaticamente as `.dre` para dentro do Sigma.

Por isso, quando subir um novo `dist/BoletoHibridoPagHiperDesk.zip`, faca nesta ordem:

1. Suba/atualize o ZIP da extensao.
2. Abra a extensao no Sigma.
3. Va em `Extension Details > Functions`.
4. Associe as functions existentes `gerarBoletoPagHiper`, `consultarBoletoPagHiper` e `cancelarBoletoPagHiper`.
5. Escolha a versao publicada correta de cada function.
6. Copie a REST API gerada em cada associacao.
7. Atualize no codigo apenas se o dominio, UUID ou versao mudarem.

Nao crie uma function nova a cada upload. Se o codigo Deluge mudar, crie uma nova versao da mesma function e associe essa versao na extensao.

Quando o Sigma gera uma REST API nova, normalmente mudam o dominio e/ou a versao. Isso exige que o dominio exista em `plugin-manifest.json > whiteListedDomains`, senao o Desk bloqueia com:

```text
No entry found in plugin-manifest whiteListedDomains for requested URL
```

## O que precisa existir no Sigma

1. Crie uma function DRE chamada `gerarBoletoPagHiper`.
   - Return Type: `String`
   - Nao use Return Type `Void`, senao o Sigma mostra `VOID function can not return any value`.
2. Cole o conteudo de `app/server/source/latest/gerarBoletoPagHiper.dre`.
3. Crie uma function DRE chamada `consultarBoletoPagHiper`.
   - Return Type: `String`
   - Nao use Return Type `Void`, senao o Sigma mostra `VOID function can not return any value`.
4. Cole o conteudo de `app/server/source/latest/consultarBoletoPagHiper.dre`.
5. Crie uma function DRE chamada `cancelarBoletoPagHiper`.
   - Return Type: `String`
   - Nao use Return Type `Void`, senao o Sigma mostra `VOID function can not return any value`.
6. Cole o conteudo de `app/server/source/latest/cancelarBoletoPagHiper.dre`.
7. Salve e publique as functions.
8. Na extensao do Sigma, va em `Extension Details > Functions > Associate Function`.
9. Associe `gerarBoletoPagHiper`, `consultarBoletoPagHiper` e `cancelarBoletoPagHiper`, sempre escolhendo uma versao publicada especifica.
10. Evite `${LATEST}` durante o desenvolvimento, porque o guia informa que o Rest API pode nao ficar utilizavel ate a extensao ser publicada.
11. Confirme que apareceu o link na coluna `Rest API`.

O widget monta a Execution URL com:

```text
sigma_app_uuid=<uuid da extensao>
sigma_function_uuid=5297c382-4918-4fbf-9279-92aeb2d166cf
sigma_function_version=7
integ_scope_id=<org id do Desk>
app_install_id={{sigmaInstallId}}
encapiKey={{enCapApiKey}}
```

Para cancelar boleto, o widget monta a Execution URL com:

```text
sigma_app_uuid=<uuid da extensao>
sigma_function_uuid=640ade47-2006-4e66-9800-1b80a5857205
sigma_function_version=2
integ_scope_id=<org id do Desk>
app_install_id={{sigmaInstallId}}
encapiKey={{enCapApiKey}}
```

Para consultar boleto, depois de associar a function no Sigma, copie a REST API e preencha no codigo:

```text
sigma_app_uuid=<uuid da extensao>
sigma_function_uuid=59846e17-1d27-41a1-b6d7-576f10b8b9de
sigma_function_version=1
integ_scope_id=<org id do Desk>
app_install_id={{sigmaInstallId}}
encapiKey={{enCapApiKey}}
```

O `sigma_app_uuid` e o dominio Sigma precisam ser da mesma extensao em que a function foi associada. Se a function estiver associada em outra extensao do Sigma, o Desk tende a retornar `Invalid Path`.

Para esta instalacao, o dominio da function associada informado no Rest API e:

```text
4180c9fa-bd12-48bd-b4bb-736116bc90ad.sigmaexecution.com
```

## Connection obrigatoria

A function usa esta connection para falar com o Zoho Desk:

```text
zohodesk_conn
```

Ela precisa estar no `plugin-manifest.json` e autorizada no Desk com escopos para:

```text
Desk.extensions.READ
Desk.tickets.ALL
Desk.contacts.ALL
Desk.accounts.ALL
Desk.fields.ALL
Desk.custommodule.ALL
```

## Como a function recebe dados

Pelo widget, a Sigma entrega o payload dentro de:

```text
data.get("payload")
```

Por isso a function nova primeiro tenta ler `payload`; se nao existir, ela usa `data` direto para permitir teste manual no Sigma.

## Como diagnosticar o erro Invalid Path

No widget, depois de clicar em emitir boleto, copie o bloco completo de `Diagnostico da emissao`.

Os blocos mais importantes sao:

```text
Inicio do fluxo de emissao
Buscando pagador no Desk
Payload enviado para gerarBoletoPagHiper
URL da function gerar boleto
Objeto enviado ao ZOHODESK.request
Erro bruto ao chamar Execution URL via ZOHODESK.request
Tentando fallback customfunction
```

Se o erro aparecer antes de `URL da function gerar boleto`, a quebra esta na chamada ao Desk para buscar contato/conta.

Se o erro aparecer depois de `URL da function gerar boleto`, a quebra esta na Execution URL/associacao da Sigma Function.

## Observacao sobre ZIP no Windows

Rodando `cmd /c zet pack` neste projeto no Windows, o ZIP gerado nao incluiu os arquivos `.dre` de `app/server/source/latest`.

Por isso, para esta etapa, trate os arquivos `.dre` como fonte para copiar/colar no Sigma:

```text
app/server/source/latest/gerarBoletoPagHiper.dre
app/server/source/latest/consultarBoletoPagHiper.dre
app/server/source/latest/cancelarBoletoPagHiper.dre
```

A associacao final da function precisa ser feita em `Extension Details > Functions > Associate Function`.
