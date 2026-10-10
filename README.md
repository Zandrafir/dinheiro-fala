# 💸 Dinheiro Fala

Bot de WhatsApp que funciona como o seu assistente financeiro pessoal e **fala em primeira pessoa, como se fosse o seu dinheiro**:

> "Ei, saiu R$ 45,00 no mercado hoje. Ainda tenho R$ 320,00 pra gente chegar no fim do mês 😅"

Ele lê as notificações dos seus apps de banco (via Tasker/MacroDroid no Android), registra gastos e entradas, pergunta o que não souber, lembra das contas fixas e manda resumos automáticos. Tudo gratuito: Node.js, Baileys, SQLite, Gemini (plano grátis), pm2 e Cloudflare Tunnel/Tailscale.

**Princípios**
- **Os números nunca vêm do Gemini.** Tudo é calculado no código/SQL (em centavos, inteiros). O Gemini só escreve o texto, e a resposta dele é validada: se citar qualquer `R$` que não tenha sido fornecido, o bot descarta e usa um texto-padrão.
- Sem Gemini (sem chave ou fora do ar) o bot continua funcionando: regex + textos-padrão + comandos fixos. Só a conversa livre ("ontem rolou uma pizza de 28 reais") depende dele.
- O bot só conversa com **o seu número**. Ignora qualquer outra pessoa e grupos.
- Organiza e informa. **Não dá recomendação de investimento.**

---

## 1. Requisitos

- Node.js **20+** (`node -v`)
- Um celular Android com Tasker ou MacroDroid (para as notificações)
- Uma conta Google (chave do Gemini, grátis)
- Um lugar para deixar rodando 24h: PC, Raspberry Pi ou a VM grátis da Oracle Cloud

## 2. Chave do Gemini (grátis)

1. Acesse <https://aistudio.google.com/apikey> e entre com sua conta Google.
2. Clique em **Create API key** e copie a chave.
3. Ela vai no `.env` (`GEMINI_API_KEY`). O plano grátis tem limite de requisições por minuto/dia; o bot economiza chamadas (categoriza por palavras-chave antes de consultar o Gemini).

> Privacidade: o texto de uma notificação só é enviado ao Gemini quando o regex **não** consegue extrair os dados, e para categorizar nomes de estabelecimentos. Nunca peça nem guarde senhas, números de cartão ou dados bancários.

## 3. Rodando localmente

```bash
cd dinheiro-fala
npm install
cp .env.example .env      # edite o .env (veja abaixo)
npm test                  # 43 testes
npm run testar-parser     # confere o parser com exemplos/notificacoes.json
npm start
```

### `.env`

| Variável | O que é |
|---|---|
| `GEMINI_API_KEY` | chave do passo 2 (opcional, mas recomendado) |
| `GEMINI_MODEL` | modelo flash; padrão `gemini-flash-latest` |
| `WEBHOOK_TOKEN` | segredo que o celular manda no header `x-token`. Gere: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| `MEU_NUMERO` | seu número com DDI+DDD, só dígitos (`5511999998888`) |
| `MODO_CHAT` | `self` ou `dedicado` (veja abaixo) |
| `PORT` | porta do webhook (padrão 3000) |
| `TZ` | `America/Sao_Paulo` |

**`MODO_CHAT`**
- `self`: você escaneia o QR com o **seu** WhatsApp e conversa na conversa "Mensagens para você". Não precisa de outro chip.
- `dedicado`: o bot roda em **outro número** (chip/WhatsApp Business só do bot) e conversa com `MEU_NUMERO`. É a opção mais limpa: você recebe notificação de verdade no celular.

### Escaneando o QR Code

1. `npm start`. O terminal mostra um QR Code.
2. No WhatsApp do celular (o do bot, no modo `dedicado`): **Configurações → Aparelhos conectados → Conectar um aparelho** e aponte para o QR.
3. A sessão fica salva em `auth/` (fora do git). Se o celular desconectar o aparelho, o bot apaga `auth/` sozinho e mostra um QR novo.
4. Mande **`ajuda`** para o bot. Se ele responder, está tudo certo.

> ⚠️ O Baileys usa o protocolo não oficial do WhatsApp Web. Para uso pessoal (poucas mensagens, só com você mesmo) o risco é baixo, mas existe. Por isso o modo `dedicado` com um número secundário é o mais seguro para a sua conta principal.

## 4. O que o bot sabe fazer

| Você manda | O bot faz |
|---|---|
| `gastei 45 no mercado` | registra gasto, categoriza e responde na voz do dinheiro |
| `recebi 300 do João` | registra entrada |
| `quanto gastei esse mês?` · `quanto sobra?` · `gastos por categoria` · `últimos gastos` | consultas (números vêm do SQL) |
| `aluguel 1200 dia 5` · `conta fixa: luz 180 dia 10` | cadastra conta fixa (aceita várias linhas de uma vez) |
| `minhas contas` · `editar luz 200 dia 12` · `remover luz` | gerencia contas fixas |
| `paguei luz` · `paguei luz 195` | dá baixa manual |
| `resumo` | contas (pago / falta / atrasadas / próximos) + entradas e saídas do mês |
| `renda 5000` | informa a renda (usada em "quanto sobra" e no saldo estimado) |
| `orçamento mercado 800` · `orçamentos` · `remover orçamento mercado` | avisa aos 80% e aos 100% (uma vez por mês cada) |
| `capturas` · `limpar capturas` | devolve as notificações que o bot não entendeu (mascaradas) para você mandar ao Claude ajustar `config/apps.js` |
| `ajuda` | lista tudo |

**Quanto sobra** = renda (ou, sem renda, as entradas do mês) − gastos do mês − contas fixas ainda em aberto. A resposta sempre mostra a conta.

### Perguntas do bot

- **Pix/transferência/boleto enviado** → "Vi um Pix de R$ 45,00 pra MARIA. Foi pra quê?". Sua **próxima resposta livre** vira a descrição e a categoria. Responda `pula` (ou `ignora`) para encerrar sem categoria.
- Com várias perguntas abertas, vale a fila (a mais antiga primeiro). Para ser preciso, use **"Responder"** do WhatsApp na pergunta certa: a resposta vai exatamente para ela.
- Comandos conhecidos (`resumo`, `gastei…`, etc.) nunca são engolidos como resposta.
- Perguntas sem resposta por 48h expiram.
- **Compra no cartão / Carteira Google** → registra direto e categoriza sozinho; só pergunta se a confiança da categoria for baixa.
- **Pix recebido** → registra e avisa; só pergunta a origem se não estiver clara.

### Baixa automática de contas fixas

Quando um Pix/boleto/compra combina com uma conta fixa em aberto:
- **nome parecido + valor dentro da tolerância (10% ou R$ 2)** → o bot marca como paga e confirma: "Parece que a conta *luz* foi paga, marquei aqui. Certo?". Responda `não` para desfazer.
- **incerto** (valor idêntico mas nome diferente, ou nome parecido com valor bem diferente) → pergunta **antes** de marcar.

Dica: batize a conta com a palavra que aparece no extrato (`enel`, `sabesp`, `netflix`).

### Lembretes e resumos (fuso America/Sao_Paulo)

- **09:00**: lembretes de contas pendentes 3 dias antes, 1 dia antes e no dia. Depois do vencimento: aviso de "atrasada" no dia seguinte e a cada 2 dias. Conta paga nunca mais é cobrada. Vencimento dia 31 em mês curto cai no último dia do mês.
- **08:00 do dia 1**: resumo do mês (contas, total, saldo estimado se houver renda).
- **08:00 no 5º dia útil**: resumo com total / pago / falta / atrasadas / próximos vencimentos. O cron roda todo dia e checa se hoje é o 5º dia útil (seg–sex, sem feriados nacionais, via `date-holidays`).
- Se o servidor estiver desligado no horário, os jobs rodam assim que ele voltar (no mesmo dia), sem duplicar.

## 5. Ajustando o parser para os seus bancos

Cada banco escreve a notificação de um jeito. O arquivo **`config/apps.js`** guarda, por banco, o nome, o pacote Android e uma lista de padrões regex (os exemplos de partida são aproximados).

1. Copie 3 ou 4 notificações **reais** de cada app para `exemplos/notificacoes.json` (apague nomes sensíveis se quiser) e preencha o `esperado`.
2. Rode `npm run testar-parser` e veja o que foi extraído (`--ia` testa também o fallback Gemini).
3. Ajuste os padrões em `config/apps.js` até tudo ficar ✔.

Sintaxe de um padrão: `p('pix_enviado', 'você enviou {V} para {N}')`, onde `{V}` é o valor em R$ e `{N}` o destinatário/estabelecimento. Espaços viram `\s+`, acentos e maiúsculas são tolerados, e você pode usar regex normal. Tipos: `pix_enviado`, `pix_recebido`, `compra_cartao`, `debito`, `boleto`, `transferencia_enviada`, `transferencia_recebida`.

Ordem de decisão: padrões do banco → padrões genéricos → lista `IGNORAR` (promoções, fatura, segurança…) → Gemini (só se houver "R$" no texto) → na dúvida, **ignora**.

Os pacotes (Nubank `com.nu.production`, Itaú `com.itau`, etc.) estão na tabela de `config/apps.js`; confirme o seu em *Configurações → Apps → Info do app*.

## 6. Subindo num servidor 24h

> **Atalho:** num Ubuntu/Debian (ex.: Oracle Free Tier), `bash scripts/instalar-servidor.sh` faz tudo: instala Node e pm2, pergunta Gemini/número/modo, mostra o QR do WhatsApp, deixa 24h no pm2 e abre um endereço HTTPS público via Tailscale Funnel. As partes de rede (Tailscale/WhatsApp) não foram testadas fora do desenvolvimento. O passo a passo manual segue abaixo.

### Oracle Cloud Free Tier (grátis para sempre)

1. Crie a conta em <https://www.oracle.com/cloud/free/> e uma instância **Always Free** (Ubuntu 22.04; a VM Ampere A1 ARM ou a AMD Micro servem).
2. Conecte por SSH e instale o Node 20:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs build-essential python3 git
   ```
3. Copie o projeto (git ou `scp`), `npm install`, crie o `.env`.
4. Rode uma vez `npm start` para escanear o QR pelo terminal SSH, depois `Ctrl+C`.
5. **Não abra portas** na Oracle nem no roteador: o acesso externo vai pelo túnel (seção 7).

### PC ou Raspberry Pi
Mesmos passos (Raspberry Pi OS 64-bit com Node 20). Deixe ligado 24h.

### pm2 (mantém rodando e reinicia sozinho)

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.cjs      # ou: npm run pm2
pm2 logs dinheiro-fala
pm2 save
pm2 startup                         # rode o comando que ele imprimir (sobe no boot)
```

Atualizar: `git pull && npm install && pm2 restart dinheiro-fala`.
Backup: copie `data/dinheiro.db` e a pasta `auth/` (a sessão do WhatsApp).

## 7. Expondo o webhook com HTTPS (sem abrir portas)

O celular precisa alcançar `POST /notificacao`. Use **um** dos dois:

### Opção A: Cloudflare Tunnel (grátis; precisa de um domínio no Cloudflare)

```bash
# instale o cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
cloudflared tunnel login
cloudflared tunnel create dinheiro-fala
cloudflared tunnel route dns dinheiro-fala dinheiro.SEUDOMINIO.com
```

`~/.cloudflared/config.yml`:
```yaml
tunnel: dinheiro-fala
credentials-file: /home/SEUUSUARIO/.cloudflared/<ID-DO-TUNEL>.json
ingress:
  - hostname: dinheiro.SEUDOMINIO.com
    service: http://localhost:3000
  - service: http_status:404
```

```bash
sudo cloudflared service install     # roda no boot
```

URL no celular: `https://dinheiro.SEUDOMINIO.com/notificacao`.
Para testar sem domínio: `cloudflared tunnel --url http://localhost:3000` (gera uma URL temporária `trycloudflare.com`).

### Opção B: Tailscale (grátis; sem domínio)

Instale o Tailscale no servidor **e** no celular (mesma conta). Depois:
```bash
sudo tailscale serve --bg 3000      # HTTPS dentro da sua rede privada (https://NOME.tailnet.ts.net)
```
URL no celular: `https://NOME-DA-MAQUINA.SEU-TAILNET.ts.net/notificacao` (só dispositivos seus acessam). O celular precisa estar com o Tailscale ligado.

Teste rápido (de qualquer lugar):
```bash
curl -X POST https://SUA-URL/notificacao -H "x-token: SEU_TOKEN" -H "content-type: application/json" \
  -d '{"app":"com.nu.production","titulo":"Compra aprovada","texto":"Compra de R$ 12,00 APROVADA em PADARIA TESTE"}'
```
Token errado → `401`. Notificações repetidas (mesmo app+título+texto em 2 minutos) são descartadas.

## 8. Configuração no celular (Tasker / MacroDroid)

1. Instale o **Tasker** (pago, barato) ou o **MacroDroid** (grátis com limite de macros; costuma bastar).
2. Dê a permissão **Acesso às notificações** ao app (Configurações → Notificações → Acesso a notificações).
3. **MacroDroid**
   - Gatilho: *Notificação recebida* → selecione só os apps: seus bancos + Google Carteira.
   - Ação: *Requisição HTTP* → POST → URL `https://SEU-DOMINIO/notificacao`
   - Cabeçalho: `x-token: SEU_TOKEN`
   - Content-Type: `application/json`
   - Corpo: `{"app":"{notification_package}","titulo":"{notification_title}","texto":"{notification}","timestamp":"{system_time}"}`
4. **Tasker**: Perfil → Evento → UI → *Notificação* (filtre por app) e Tarefa com *Net → HTTP Request* (POST), mesmo JSON, com as variáveis `%anapp`, `%antitle`, `%antext`.
5. **Bateria**: Configurações → Apps → Tasker/MacroDroid → Bateria → **Sem restrições**. Em Xiaomi, Samsung, Motorola etc., ative também "Início automático" e "Bloquear no multitarefa", senão o Android mata o app.
6. Habilite **notificações com conteúdo visível** na tela de bloqueio dos apps de banco (se o app esconde o valor, o Tasker não consegue ler).
7. Faça um Pix de teste (ou o botão de teste do MacroDroid) e confira `pm2 logs`.

**Aspas no texto quebram o JSON.** Se uma notificação tiver `"` no texto, o JSON sai malformado e o webhook responde `400`. O webhook aceita também **formulário** (`application/x-www-form-urlencoded` com `app=…&titulo=…&texto=…`): use essa opção com as variáveis URL-encoded se isso acontecer (no Tasker, a ação *Variable Convert* tem a conversão *URL Encode*). O horário do `timestamp` é ignorado; o bot usa o relógio do servidor.

## 8b. App Android "Caçador de Notificações" (alternativa ao Tasker)

Em `android/` há um app simples que faz duas coisas: **guarda** as notificações dos seus bancos (para você me mandar os textos reais e eu ajustar o `config/apps.js`) e, se você quiser, **envia cada uma ao webhook** do bot, no lugar do Tasker/MacroDroid. Ele esconde CPF, CNPJ, e-mails e números longos nas capturas guardadas, e já usa o formato de formulário (não quebra com aspas no texto).

- **Limitação no Brasil:** o Google Play Protect bloqueia a instalação de APKs fora da Play Store que pedem leitura de notificações, então este app pode ser barrado (aconteceu no teste real). O caminho garantido é MacroDroid/Tasker pela Play Store (seção 8). O app serve para quem conseguir instalá-lo (por exemplo, via ADB pelo computador, não testado).
- **Instalar:** baixe `apk/Cacador-de-Notificacoes.apk` (ou da aba Releases). O APK é assinado com chave de debug (uso pessoal).
- **Gerar de novo:** o workflow `.github/workflows/android.yml` compila o APK no GitHub (aba Actions → "Gerar APK" → Run workflow) e publica em Releases. Localmente: `cd android && gradle assembleDebug` (precisa de JDK 17 e Android SDK).
- **Atenção:** no Android 13+, apps instalados por arquivo precisam de "Permitir configurações restritas" (três pontinhos na Info do app) antes de ativar o acesso às notificações. O app tem um botão que leva até lá.
- Passo a passo para leigos: veja `GUIA-PASSO-A-PASSO.md`.

## 9. Segurança e privacidade

- Webhook protegido por `x-token` (comparação em tempo constante; `401` se não bater). O servidor não inicia sem `WEBHOOK_TOKEN`.
- O texto das notificações **não vai para os logs** (só tipo, valor e status).
- `.env`, `auth/` e `data/` estão no `.gitignore`. Não suba `auth/`: quem tiver essa pasta controla seu WhatsApp.
- Conteúdo de notificações e nomes de estabelecimentos são tratados como dados não confiáveis nos prompts do Gemini (delimitados, saída JSON validada com lista fechada de ações/categorias).
- O bot não pede nem armazena senhas, números de cartão ou dados bancários.

## 10. Estrutura

```
dinheiro-fala/
  src/index.js          inicia tudo
  src/whatsapp.js       Baileys (QR, reconexão, filtro "só o dono")
  src/webhook.js        Express: POST /notificacao
  src/notificacoes.js   dedup → parser → registro → aviso/pergunta
  src/parser.js         regex + fallback Gemini
  src/ia.js             Gemini: extrair, categorizar, interpretar, "voz" (com validação de números)
  src/mensagens.js      comandos, respostas às perguntas, conversa livre
  src/perguntas.js      fila de perguntas pendentes
  src/db.js             SQLite (valores em centavos)
  src/transacoes.js     transações, categorias, orçamentos
  src/contas.js         contas fixas, lembretes, baixa automática
  src/resumos.js        resumos (dia 1, 5º dia útil, sob demanda)
  src/agenda.js         crons e 5º dia útil
  config/apps.js        bancos, pacotes e padrões regex  ← ajuste aqui
  exemplos/notificacoes.json
  scripts/testar-parser.js
  test/                 testes (node:test)
```

## 11. Problemas comuns

- **Bot não responde no modo `dedicado`**: confira `MEU_NUMERO` (DDI+DDD, só dígitos). O 9º dígito dos celulares BR é tolerado. Rode com `LOG_LEVEL=debug` para ver "remetente não é o dono".
- **Mensagem do modo `self` não chega**: o número conectado deve ser o `MEU_NUMERO` (o bot avisa no log se for diferente).
- **QR expira**: reinicie (`pm2 restart dinheiro-fala`) e escaneie de novo.
- **Notificação não registra**: rode `npm run testar-parser` com o texto real; provavelmente falta um padrão em `config/apps.js`. Se o texto não tem "R$" ou parece promoção, é ignorado de propósito.
- **`better-sqlite3` não instala**: `sudo apt-get install -y build-essential python3` e `npm install` de novo.

## 12. Ideia futura

**Open Finance** (por exemplo, Pluggy) puxa as transações direto dos bancos, sem depender de notificação. Comece com 1 ou 2 bancos e a Carteira Google, valide, e só depois adicione os outros.
