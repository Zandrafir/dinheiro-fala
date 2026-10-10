#!/usr/bin/env bash
# Instala e liga o Dinheiro Fala num servidor Ubuntu/Debian (ex.: Oracle Cloud Free Tier).
# Uso:  bash scripts/instalar-servidor.sh          (instalação completa, interativa)
#       bash scripts/instalar-servidor.sh --so-env (só cria o arquivo .env)
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
SO_ENV=0; [[ "${1:-}" == "--so-env" ]] && SO_ENV=1

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ .env
criar_env() {
  if [[ -f .env ]]; then
    warn ".env já existe; vou manter. (Apague o arquivo se quiser refazer.)"
    return
  fi
  say "Configuração (responda e tecle Enter)"

  local chave numero modo token
  read -rsp "Chave do Gemini (cole aqui, não aparece na tela; Enter para pular): " chave; echo
  while true; do
    read -rp "Seu número do WhatsApp com 55+DDD, só números (ex.: 5511999998888): " numero
    numero="${numero//[^0-9]/}"
    [[ ${#numero} -ge 12 && ${#numero} -le 13 && "$numero" == 55* ]] && break
    warn "Número inválido. Precisa começar com 55 e ter 12 ou 13 dígitos."
  done
  echo "Modo do bot:"
  echo "  1) dedicado = o bot usa um chip/número separado e conversa com o seu número (recomendado)"
  echo "  2) self     = o bot usa o seu próprio WhatsApp (conversa 'Mensagens para você')"
  while true; do
    read -rp "Escolha 1 ou 2 [1]: " modo; modo="${modo:-1}"
    [[ "$modo" == "1" || "$modo" == "2" ]] && break
  done
  [[ "$modo" == "1" ]] && modo="dedicado" || modo="self"
  token="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

  umask 077
  cat > .env <<ENV
GEMINI_API_KEY=${chave}
GEMINI_MODEL=gemini-flash-latest
WEBHOOK_TOKEN=${token}
MEU_NUMERO=${numero}
MODO_CHAT=${modo}
PORT=3000
TZ=America/Sao_Paulo
ENV
  chmod 600 .env
  echo "Arquivo .env criado (só você consegue ler)."
}

if [[ $SO_ENV -eq 1 ]]; then criar_env; exit 0; fi

[[ "$(id -u)" -eq 0 ]] && die "Não rode como root. Use o usuário normal (ex.: ubuntu); o script usa sudo quando precisa."
command -v sudo >/dev/null || die "sudo não encontrado."

# --------------------------------------------------------------- pacotes
say "1/6  Instalando Node.js 20, pm2 e ferramentas"
sudo apt-get update -y
sudo apt-get install -y curl git build-essential python3 ca-certificates
NODE_MAIOR="$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || true)"
if [[ -z "${NODE_MAIOR:-}" || "$NODE_MAIOR" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
command -v pm2 >/dev/null || sudo npm install -g pm2
node -v

say "2/6  Configuração"
criar_env

say "3/6  Instalando dependências do bot"
npm install --omit=dev
npm test >/dev/null 2>&1 && echo "Testes: OK" || warn "Alguns testes falharam (pode seguir, mas me avise)."

# ------------------------------------------------- login no WhatsApp (QR)
say "4/6  Conectando ao WhatsApp"
if [[ -d auth && -n "$(ls -A auth 2>/dev/null)" ]]; then
  echo "Já existe uma sessão do WhatsApp salva em auth/. Pulando o QR Code."
else
  cat <<MSG
Vai aparecer um QR Code abaixo. No celular que tem o WhatsApp do BOT:
  WhatsApp > Configurações > Aparelhos conectados > Conectar um aparelho
e aponte a câmera para o QR. Aguarde a mensagem "WhatsApp conectado".
MSG
  set +e
  timeout 600 node src/index.js 2>&1 | while IFS= read -r linha; do
    echo "$linha"
    if [[ "$linha" == *"WhatsApp conectado"* ]]; then sleep 6; pkill -f "node src/index.js" || true; break; fi
  done
  set -e
  [[ -d auth && -n "$(ls -A auth 2>/dev/null)" ]] || die "Não consegui conectar ao WhatsApp (QR expirou?). Rode o script de novo."
fi

# --------------------------------------------------------------- pm2 24h
say "5/6  Deixando o bot ligado 24h (pm2)"
pm2 delete dinheiro-fala >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save
STARTUP_CMD="$(pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null | grep -E '^sudo ' || true)"
[[ -n "$STARTUP_CMD" ]] && eval "$STARTUP_CMD" && pm2 save

# ------------------------------------------- endereço público (Tailscale)
say "6/6  Endereço público seguro para o celular (Tailscale Funnel, grátis)"
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
if ! sudo tailscale status >/dev/null 2>&1; then
  warn "Abra o link que vai aparecer, entre/crie sua conta Tailscale (grátis) e autorize esta máquina."
  sudo tailscale up
fi
FUNNEL_OUT="$(sudo tailscale funnel --bg 3000 2>&1 || true)"
echo "$FUNNEL_OUT"
URL="$(echo "$FUNNEL_OUT" | grep -oE 'https://[^ ]+\.ts\.net[^ ]*' | head -1 || true)"
[[ -z "$URL" ]] && URL="$(sudo tailscale funnel status 2>&1 | grep -oE 'https://[^ ]+\.ts\.net' | head -1 || true)"
if [[ -z "$URL" ]]; then
  warn "O Tailscale não liberou o Funnel ainda. Se apareceu um link acima, abra e clique em habilitar; depois rode:"
  warn "    sudo tailscale funnel --bg 3000"
fi

TOKEN="$(grep '^WEBHOOK_TOKEN=' .env | cut -d= -f2-)"
say "PRONTO! Dados para colocar no MacroDroid/Tasker no celular:"
echo "  Endereço (URL): ${URL:-<veja a mensagem acima>}/notificacao"
echo "  Cabeçalho:      x-token: ${TOKEN}"
echo
echo "Teste: no WhatsApp, mande 'ajuda' para o bot."
echo "Ver logs: pm2 logs dinheiro-fala   |   Reiniciar: pm2 restart dinheiro-fala"
