// WhatsApp via Baileys (QR Code). Só conversa com MEU_NUMERO; ignora o resto do mundo.
import fs from 'node:fs';
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
  jidNormalizedUser, normalizeMessageContent, generateMessageIDV2, Browsers,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import { setEnviador } from './saida.js';
import { log } from './log.js';

// --------------------------------------------------------- números e JIDs
export function soDigitos(jid) {
  return String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Normaliza celular BR para comparar com/sem o 9º dígito: 55 + DDD + 8 últimos dígitos. */
export function chaveNumero(num) {
  const d = String(num ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 13 || d.length === 12)) return `55${d.slice(2, 4)}${d.slice(-8)}`;
  return d;
}

export const mesmoNumero = (a, b) => !!a && !!b && chaveNumero(a) === chaveNumero(b);

const ehPN = (jid) => String(jid ?? '').endsWith('@s.whatsapp.net');
const ehLID = (jid) => String(jid ?? '').endsWith('@lid');

// ------------------------------------------------------------------ estado
let sock = null;
let conectado = false;
let tentativas = 0;
let inicioSeg = Math.floor(Date.now() / 1000);
let aoReceber = async () => null;
const enviadasPorMim = new Set();
const fila = [];            // mensagens aguardando a conexão abrir
let cadeia = Promise.resolve(); // processa uma mensagem por vez (evita corrida na fila de perguntas)

function lembrarEnviada(id) {
  enviadasPorMim.add(id);
  if (enviadasPorMim.size > 500) enviadasPorMim.delete(enviadasPorMim.values().next().value);
}

function jidDestino() {
  if (config.modoChat === 'self') return jidNormalizedUser(sock.user.id);
  return `${config.meuNumero}@s.whatsapp.net`;
}

/** Envia texto ao dono. Retorna o id da mensagem (para casar com respostas "citadas"). */
export async function enviarTexto(texto) {
  if (!sock || !conectado) {
    if (fila.length < 100) fila.push(texto);
    log.warn('WhatsApp desconectado; mensagem na fila.');
    return null;
  }
  const messageId = generateMessageIDV2(sock.user?.id);
  lembrarEnviada(messageId);
  await sock.sendMessage(jidDestino(), { text: texto }, { messageId });
  return messageId;
}

// ------------------------------------------------------ filtro de mensagens
async function remetenteEhDono(msg) {
  const { key } = msg;
  const chat = key.remoteJid || '';
  if (chat.endsWith('@g.us') || chat === 'status@broadcast' || chat.endsWith('@newsletter')) return false;

  if (config.modoChat === 'self') {
    if (!key.fromMe) return false;
    const meus = [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
    const candidatos = [chat, key.remoteJidAlt].filter(Boolean).map(jidNormalizedUser);
    return candidatos.some((c) => meus.includes(c));
  }

  // dedicado: mensagem recebida de MEU_NUMERO
  if (key.fromMe) return false;
  const candidatos = [chat, key.remoteJidAlt, key.participantAlt].filter(Boolean);
  if (candidatos.some((j) => ehPN(j) && mesmoNumero(soDigitos(j), config.meuNumero))) return true;
  const lid = candidatos.find(ehLID);
  if (lid) {
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(lid);
      if (pn && mesmoNumero(soDigitos(pn), config.meuNumero)) return true;
    } catch { /* sem mapeamento */ }
    log.debug('Mensagem ignorada: remetente não é o dono.');
  }
  return false;
}

function extrair(msg) {
  const c = normalizeMessageContent(msg.message);
  if (!c) return null;
  const texto = c.conversation || c.extendedTextMessage?.text || '';
  const citadoId = c.extendedTextMessage?.contextInfo?.stanzaId || null;
  return { texto, citadoId, ehTexto: !!texto };
}

async function tratarUpsert({ messages, type }) {
  if (type !== 'notify') return;
  for (const msg of messages) {
    try {
      if (!msg.message || !msg.key?.id) continue;
      if (enviadasPorMim.has(msg.key.id)) continue;                      // eco do próprio bot
      const ts = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0);
      if (ts && ts < inicioSeg - 120) continue;                          // histórico antigo
      if (!(await remetenteEhDono(msg))) continue;
      const c = extrair(msg);
      if (!c) continue;
      if (!c.ehTexto) { await enviarTexto('Só entendo texto por enquanto 🙈'); continue; }
      cadeia = cadeia.then(async () => {
        const resposta = await aoReceber({ texto: c.texto, citadoId: c.citadoId });
        if (resposta) await enviarTexto(resposta);
      }).catch((e) => log.erro('Erro ao tratar mensagem:', e.message));
    } catch (e) {
      log.erro('Erro no upsert:', e.message);
    }
  }
}

// ---------------------------------------------------------------- conexão
async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* usa a versão embutida */ }

  sock = makeWASocket({
    version, auth: state, logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Dinheiro Fala'), markOnlineOnConnect: false, syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', tratarUpsert);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      log.info('Escaneie o QR Code abaixo: WhatsApp > Aparelhos conectados > Conectar um aparelho');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      conectado = true; tentativas = 0; inicioSeg = Math.floor(Date.now() / 1000);
      const meu = soDigitos(sock.user?.id);
      log.info(`WhatsApp conectado (${config.modoChat}).`);
      if (config.modoChat === 'self' && !mesmoNumero(meu, config.meuNumero)) {
        log.warn(`MODO_CHAT=self mas o número conectado (${meu.slice(0, 4)}…) difere de MEU_NUMERO. Confira o .env.`);
      }
      while (fila.length) await enviarTexto(fila.shift()).catch((e) => log.erro(e.message));
    }
    if (connection === 'close') {
      conectado = false;
      const codigo = lastDisconnect?.error?.output?.statusCode;
      if (codigo === DisconnectReason.loggedOut) {
        log.warn('Sessão encerrada pelo celular. Apagando auth/ e gerando novo QR Code…');
        fs.rmSync(config.authDir, { recursive: true, force: true });
        setTimeout(() => conectar().catch((e) => log.erro(e.message)), 3000);
        return;
      }
      tentativas += 1;
      const espera = Math.min(30000, 1000 * 2 ** Math.min(tentativas, 5));
      log.warn(`Conexão caiu (código ${codigo ?? '?'}). Reconectando em ${Math.round(espera / 1000)}s…`);
      setTimeout(() => conectar().catch((e) => log.erro(e.message)), espera);
    }
  });
}

/** Liga o WhatsApp. `handler({texto, citadoId})` devolve o texto de resposta (ou null). */
export async function iniciarWhatsApp(handler) {
  aoReceber = handler;
  setEnviador(enviarTexto);
  await conectar();
}
