# Contexto para continuar o projeto (leia primeiro)

Projeto: **Money Talk**, bot de WhatsApp que fala como o dinheiro do dono. Veja `README.md` (técnico) e `GUIA-PASSO-A-PASSO.md` (para leigos).

## Quem é o usuário
- **Não programa.** Quer que você tome as melhores decisões e explique em português simples, com cliques exatos. Brasil (pt-BR), Android, banco principal **Nubank** + **Carteira Google**.
- Escolhas já feitas: bot em `MODO_CHAT=dedicado` (chip secundário), Gemini para a "voz", envio das notificações por **MacroDroid** (Play Store).

## O que está pronto (58 testes passando)
Bot Node.js (Baileys, SQLite, Gemini `gemini-flash-latest`), parser com padrões reais do Nubank e Carteira Google, compras recusadas só avisam (não viram gasto), mesma compra do banco+Carteira conta uma vez, contas fixas com lembretes e baixa automática, resumos (dia 1 e 5º dia útil), orçamentos, modo aprender (`capturas` / `limpar capturas`), `scripts/instalar-servidor.sh` (Node, pm2, .env, QR, Tailscale Funnel).

## Estado atual (atualizado em 12/10/2026)
- **Nome do projeto: Money Talk** (antes "Dinheiro Fala"). Identificadores técnicos continuam `dinheiro-fala` (repo, pm2, pasta, URL, pacote do app Caçador); renomear isso mudaria a URL do MacroDroid.
- **Servidor no ar** (Oracle Cloud Free, Ubuntu 22.04, Node 22, pm2 com autostart). WhatsApp do chip secundário pareado em modo `dedicado`; só responde ao `MEU_NUMERO` (testado com outro celular).
- **Webhook público** via Tailscale Funnel; MacroDroid no celular do dono já envia (testado ponta a ponta: Nubank -> MacroDroid -> servidor -> WhatsApp). Corpo JSON: `{"app":"{notification_package}","titulo":"{notification_title}","texto":"{notification}"}` (sem acento em "titulo").
- **Saldo da manhã** (`src/saldo.js`): 8h pergunta o saldo, repergunta após 1h com opção "depois", desiste na 2ª sem resposta; comando `saldo 1234,50` vale a qualquer hora.
- Parser com padrões reais de Nubank, Carteira Google e Mercado Pago (compra no cartão, Pix recebido, NuPay); cashback/lembretes de boleto são ignorados.
- Emulador Android (AVD `Pixel_7_Play`, Android 35 com Google Play) criado no PC do dono para tirar dúvidas de tela; não rode login em bancos nele.

## Pendências
1. Nubank **não manda notificação de Pix enviado** no celular do dono (investigar configuração de notificações do app/Android); Pix enviado pode ser registrado à mão ("gastei 20 pix João").
2. Ajustar padrões com exemplos reais de **compra no crédito** do Nubank e, no mês que vem, **boleto**.
3. Pix entre contas do próprio dono aparece como entrada no outro banco (perguntar origem / "pula").
4. O workflow `.github/workflows/android.yml` (APK do Caçador) foi corrigido; conferir se a Actions ficou verde. O APK é opcional.

## NÃO testado (verifique ao rodar de verdade)
Conexão real do Baileys/WhatsApp, filtro "só o dono" no modo dedicado (incl. LID), partes de rede do instalador (apt, Tailscale Funnel), MacroDroid de ponta a ponta.

## Segurança (importante)
- A chave do Gemini foi colada numa conversa antiga: **deve ser apagada e recriada** (aistudio.google.com/apikey). Nunca grave chaves/tokens no repositório. `.env`, `auth/`, `data/` ficam fora do git.
- Ações em contas do usuário (cartão, login, senha, Oracle, GitHub): peça para **ele** digitar/aprovar. Não digite dados de cartão nem senhas por ele.
- O bot só responde ao `MEU_NUMERO`; não dá recomendação de investimento.
