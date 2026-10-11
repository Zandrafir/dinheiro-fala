// Saldo da manhã: o bot pergunta o saldo da conta, espera 1h e pergunta de novo (oferecendo "depois").
// Sem resposta na 2ª tentativa, fica quieto no resto do dia; o saldo pode ser mandado a qualquer hora.
// Estado do dia em `config.saldo_estado` (JSON) e valores em `saldos_diarios` (centavos, pode ser negativo).
import { db, getConfig, setConfig } from './db.js';
import { enviar } from './saida.js';
import * as contas from './contas.js';
import { agoraLocal, parseValor, fmtBRL, normalizar } from './util.js';

export const ESPERA_MS = 3600 * 1000;   // espera entre uma pergunta e a seguinte
export const MAX_PERGUNTAS = 2;
const HORA_INICIO = 8;
const HORA_FIM = 22;                     // depois disso não incomoda

const DEPOIS = /^(depois|mais tarde|agora nao|nao agora|depois eu falo|deixa pra depois|deixa para depois|depois eu mando)$/;

// ------------------------------------------------------------------ estado
function estadoVazio(dia) { return { dia, estado: 'nenhum', n: 0, ms: 0, msgId: null }; }

export function lerEstado(hoje = agoraLocal()) {
  try {
    const e = JSON.parse(getConfig('saldo_estado') || 'null');
    if (e && e.dia === hoje.dataIso) return e;
  } catch { /* estado corrompido: recomeça */ }
  return estadoVazio(hoje.dataIso);
}

function salvarEstado(e) { setConfig('saldo_estado', JSON.stringify(e)); }

// ------------------------------------------------------------------ saldos
function garantirTabela() {
  db().exec(`CREATE TABLE IF NOT EXISTS saldos_diarios (
    data TEXT PRIMARY KEY,
    valor INTEGER NOT NULL,
    criada_ms INTEGER NOT NULL
  )`);
}

export function saldoDoDia(hoje = agoraLocal()) {
  garantirTabela();
  const r = db().prepare('SELECT valor FROM saldos_diarios WHERE data = ?').get(hoje.dataIso);
  return r ? r.valor : null;
}

export function linhaSaldo(hoje = agoraLocal()) {
  const v = saldoDoDia(hoje);
  return v == null ? '' : `\nSaldo que você me passou hoje: *${fmtBRL(v)}*`;
}

function registrarSaldo(valor, hoje, agoraMs) {
  garantirTabela();
  db().prepare(`INSERT INTO saldos_diarios (data, valor, criada_ms) VALUES (?,?,?)
    ON CONFLICT(data) DO UPDATE SET valor = excluded.valor, criada_ms = excluded.criada_ms`).run(hoje.dataIso, valor, agoraMs);
  const e = lerEstado(hoje);
  salvarEstado({ ...e, estado: 'ok' });

  let msg = `Anotado ✅ Saldo de hoje: *${fmtBRL(valor)}*.`;
  const pendentes = contas.emAberto(hoje).reduce((s, p) => s + p.valor_previsto, 0);
  if (pendentes > 0) msg += `\nContas ainda em aberto: *${fmtBRL(pendentes)}* → livre depois delas: *${fmtBRL(valor - pendentes)}*.`;
  return msg;
}

// ---------------------------------------------------------------- perguntas
const TEXTO_1 = '☀️ Bom dia! Pra eu começar o dia certinho: qual o *saldo* da sua conta agora?\nÉ só mandar o valor (ex.: *1234,50*).';
const TEXTO_2 = '⏰ Ainda não me passou o saldo de hoje. Quanto tem na conta? Manda o valor (ex.: *1234,50*).\nSe não puder agora, responde *depois* e eu paro de perguntar hoje. Quando quiser, é só mandar *saldo 1234,50*.';

async function perguntar(e, hoje, agoraMs) {
  const n = e.n + 1;
  const msgId = await enviar(n === 1 ? TEXTO_1 : TEXTO_2);
  salvarEstado({ dia: hoje.dataIso, estado: 'aguardando', n, ms: agoraMs, msgId });
}

/** 8h: primeira pergunta do dia (idempotente; também roda ao religar o bot). */
export async function jobPerguntaSaldo(hoje = agoraLocal(), agoraMs = Date.now()) {
  if (hoje.hora < HORA_INICIO || hoje.hora >= HORA_FIM) return false;
  const e = lerEstado(hoje);
  if (e.estado !== 'nenhum' || saldoDoDia(hoje) != null) return false;
  await perguntar(e, hoje, agoraMs);
  return true;
}

/** A cada poucos minutos: passou 1h sem resposta? Pergunta de novo; esgotadas as tentativas, desiste do dia. */
export async function jobReperguntaSaldo(hoje = agoraLocal(), agoraMs = Date.now()) {
  const e = lerEstado(hoje);
  if (e.estado !== 'aguardando' || agoraMs - e.ms < ESPERA_MS) return false;
  if (e.n >= MAX_PERGUNTAS || hoje.hora >= HORA_FIM) {
    salvarEstado({ ...e, estado: 'adiada' });
    return false;
  }
  await perguntar(e, hoje, agoraMs);
  return true;
}

// ---------------------------------------------------------------- respostas
const VAL = String.raw`(-)?\s*(?:r\$\s*)?(\d[\d.,]*)`;
const RE_COMANDO = new RegExp(String.raw`^saldo\s*(?:de\s+hoje|atual|inicial|agora)?\s*(?:=|:|[eé])?\s*${VAL}$`, 'i');
const RE_SO_VALOR = new RegExp(String.raw`^${VAL}$`, 'i');

function lerValor(m) {
  const v = parseValor(m[2]);
  return v == null ? null : (m[1] ? -v : v);
}

/**
 * Trata respostas sobre o saldo. Retorna texto (resposta) ou undefined se a mensagem não é sobre saldo.
 *  - "saldo 1234,50" vale sempre;
 *  - só o valor ("1234,50") ou "depois" valem enquanto o bot espera (ou já desistiu) a resposta do dia.
 */
export function tratarSaldo(texto, hoje = agoraLocal(), agoraMs = Date.now()) {
  const t = String(texto ?? '').trim();
  let m = RE_COMANDO.exec(t);
  if (m) {
    const v = lerValor(m);
    return v == null ? undefined : registrarSaldo(v, hoje, agoraMs);
  }
  const e = lerEstado(hoje);
  const esperando = e.estado === 'aguardando' || e.estado === 'adiada';
  if (!esperando) return undefined;
  if (e.estado === 'aguardando' && DEPOIS.test(normalizar(t))) {
    salvarEstado({ ...e, estado: 'adiada' });
    return 'Fechado, não pergunto mais hoje 😉 Quando quiser, manda *saldo 1234,50*.';
  }
  if ((m = RE_SO_VALOR.exec(t))) {
    const v = lerValor(m);
    if (v != null) return registrarSaldo(v, hoje, agoraMs);
  }
  return undefined;
}
