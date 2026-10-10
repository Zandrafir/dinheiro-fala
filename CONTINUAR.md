# Contexto para continuar o projeto (leia primeiro)

Projeto: **Dinheiro Fala**, bot de WhatsApp que fala como o dinheiro do dono. Veja `README.md` (técnico) e `GUIA-PASSO-A-PASSO.md` (para leigos).

## Quem é o usuário
- **Não programa.** Quer que você tome as melhores decisões e explique em português simples, com cliques exatos. Brasil (pt-BR), Android, banco principal **Nubank** + **Carteira Google**.
- Escolhas já feitas: bot em `MODO_CHAT=dedicado` (chip secundário), Gemini para a "voz", envio das notificações por **MacroDroid** (Play Store).

## O que está pronto (51 testes passando)
Bot Node.js (Baileys, SQLite, Gemini `gemini-flash-latest`), parser com padrões reais do Nubank e Carteira Google, compras recusadas só avisam (não viram gasto), mesma compra do banco+Carteira conta uma vez, contas fixas com lembretes e baixa automática, resumos (dia 1 e 5º dia útil), orçamentos, modo aprender (`capturas` / `limpar capturas`), `scripts/instalar-servidor.sh` (Node, pm2, .env, QR, Tailscale Funnel).

## Estado atual / pendências
1. **Oracle Cloud**: o usuário criou a conta mas **não consegue entrar** no console. Precisa: entrar (Cloud Account Name, região), criar a VM Ubuntu 22.04 `VM.Standard.E2.1.Micro` (Always Free) com chave SSH, pegar o IP público.
2. Entrar por SSH, clonar o repositório (privado: precisa token fine-grained, Contents: Read-only) e rodar `bash scripts/instalar-servidor.sh`.
3. Configurar o **MacroDroid** (URL e token que o instalador imprime; `x-token`; corpo JSON em `GUIA-PASSO-A-PASSO.md`, Passo 6).
4. O usuário vai mandar exemplos de **Pix enviado/recebido, compra no crédito e boleto** do Nubank para ajustar `config/apps.js` (rodar `npm run testar-parser`).
5. O workflow `.github/workflows/android.yml` (APK do app Caçador) foi corrigido; conferir se a Actions ficou verde. O app foi instalado pelo usuário desligando o Play Protect (decisão dele); o APK é opcional.

## NÃO testado (verifique ao rodar de verdade)
Conexão real do Baileys/WhatsApp, filtro "só o dono" no modo dedicado (incl. LID), partes de rede do instalador (apt, Tailscale Funnel), MacroDroid de ponta a ponta.

## Segurança (importante)
- A chave do Gemini foi colada numa conversa antiga: **deve ser apagada e recriada** (aistudio.google.com/apikey). Nunca grave chaves/tokens no repositório. `.env`, `auth/`, `data/` ficam fora do git.
- Ações em contas do usuário (cartão, login, senha, Oracle, GitHub): peça para **ele** digitar/aprovar. Não digite dados de cartão nem senhas por ele.
- O bot só responde ao `MEU_NUMERO`; não dá recomendação de investimento.
