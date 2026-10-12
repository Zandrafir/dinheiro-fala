// Saldo da conta (só Nubank). Todo dia de manhã o bot pergunta o saldo; depois acompanha cada movimento:
//   saldo atual = último saldo informado + entradas − saídas feitas depois dele.
// Compra no CRÉDITO não entra aqui (só ocupa limite do cartão; a fatura paga sim, quando sair da conta).
// Se o saldo informado não bate com o que o bot esperava, ele pergunta o que aconteceu.
import { db, getConfig, setConfig } from './db.js';
import { enviar } from './saida.js';
import * as contas from './contas.js';
import * as ia from './ia.js';
import * as perguntas from './perguntas.js';
import { agora, agoraLocal, parseValor, fmtBRL, normalizar } from './util.js';

export const ESPERA_MS = 3600 * 1000;   // espera entre uma pergunta e a seguinte
export const MAX_PERGUNTAS = 2;
const HORA_INICIO = 8;
const HORA_FIM = 22;                     // depois disso não incomoda

const DEPOIS = /^(depois|mais tarde|agora nao|nao agora|depois eu falo|deixa pra depois|deixa para depois|depois eu mando)$/;

// ------------------------------------------------------- o que mexe no saldo
const ENTRADAS = new Set(['pix_recebido', 'transferencia_recebida', 'entrada_manual']);
const SAIDAS = new Set(['pix_enviado', 'transferencia_enviada', 'boleto', 'debito', 'gasto_manual', 'pagamento_fatura']);
const CONTAS_DO_SALDO = new Set(['', 'Nubank', 'Google Carteira']);   // Mercado Pago e outros bancos ficam de fora

/** Quanto este lançamento mexeu no saldo (+ entra, − sai, 0 não mexe). */
export function efeitoNoSaldo(t) {
  if (t.fora_saldo) return 0;                                  // ajuste de conferência: o saldo informado já o inclui
  if (!CONTAS_DO_SALDO.has(t.origem_app ?? '')) return 0;
  if (ENTRADAS.has(t.tipo)) return t.valor;
  if (SAIDAS.has(t.tipo)) return -t.valor;
  return 0;                                                    // compra_credito, compra_cartao (ainda sem saber se débito)
}

/** Saldo estimado agora, ou null se o dono nunca informou um saldo. */
export function saldoAtual() {
  const b = db().prepare('SELECT data, valor, criada_ms FROM saldos_diarios ORDER BY criada_ms DESC LIMIT 1').get();
  if (!b) return null;
  const desdeIso = agoraLocal(new Date(b.criada_ms)).iso;
  const movs = db().prepare('SELECT tipo, valor, origem_app, fora_saldo FROM transacoes WHERE data > ?').all(desdeIso);
  let entradas = 0; let saidas = 0;
  for (const t of movs) {
    const e = efeitoNoSaldo(t);
    if (e > 0) entradas += e; else if (e < 0) saidas -= e;
  }
  return { saldo: b.valor + entradas - saidas, base: b.valor, entradas, saidas, desdeIso, baseData: b.data };
}

export function saldoDoDia(hoje = agoraLocal()) {
  const r = db().prepare('SELECT valor FROM saldos_diarios WHERE data = ?').get(hoje.dataIso);
  return r ? r.valor : null;
}

export function linhaSaldo() {
  const s = saldoAtual();
  return s == null ? '' : `\nSaldo atual da conta: *${fmtBRL(s.saldo)}*`;
}

export async function textoSaldo() {
  const s = saldoAtual();
  if (!s) return 'Ainda não sei de onde partir 🙈 Me diz o saldo da conta com *saldo 1234,50* e eu passo a acompanhar cada centavo.';
  const detalhe = `_(Saldo informado: ${fmtBRL(s.base)} · entradas: +${fmtBRL(s.entradas)} · saídas: −${fmtBRL(s.saidas)}. Compras no crédito não entram nessa conta.)_`;
  const fallback = s.saldo >= 0 ? `Agora eu tenho *${fmtBRL(s.saldo)}* na conta 💰` : `Estamos no negativo: *${fmtBRL(s.saldo)}* 😬`;
  const m = s.saldo >= 0
    ? await ia.voz({
      situacao: 'O dono perguntou o saldo atual da conta (já com as entradas e saídas desde a manhã). Diga o valor "saldo" com leveza.',
      valores: { saldo: s.saldo }, obrigatorios: ['saldo'], fallback,
    })
    : fallback;
  return `${m}\n${detalhe}`;
}

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

// ----------------------------------------------------- conferência (diferença)
export function lerDiferenca() {
  try { return JSON.parse(getConfig('saldo_diferenca') || 'null'); } catch { return null; }
}

async function abrirDiferenca(esperado, informado, hoje) {
  const antiga = lerDiferenca();
  if (antiga?.perguntaId) perguntas.fechar(antiga.perguntaId, 'expirada');
  const msgId = await enviar(textoDiferenca(esperado, informado));
  const perguntaId = perguntas.criar({ tipo: 'saldo_diferenca', msgId });
  setConfig('saldo_diferenca', JSON.stringify({ perguntaId, diff: informado - esperado, esperado, informado, dia: hoje.dataIso }));
}

export function textoDiferenca(esperado, informado) {
  const diff = informado - esperado;
  const falta = diff < 0;
  const abertura = falta
    ? '🤔 As contas não bateram: parece que saiu dinheiro que eu não vi.'
    : '🤔 As contas não bateram: parece que entrou dinheiro que eu não vi.';
  return `${abertura}\nEu esperava *${fmtBRL(esperado)}*, mas você me disse *${fmtBRL(informado)}* (${falta ? 'faltam' : 'sobram'} *${fmtBRL(Math.abs(diff))}*).\nO que aconteceu? Responde o motivo (ex.: *pix pro João*) ou *pula*.`;
}

// ------------------------------------------------------------------ registro
async function registrarSaldo(valor, hoje, agoraMs) {
  const antes = saldoAtual();
  db().prepare(`INSERT INTO saldos_diarios (data, valor, criada_ms) VALUES (?,?,?)
    ON CONFLICT(data) DO UPDATE SET valor = excluded.valor, criada_ms = excluded.criada_ms`).run(hoje.dataIso, valor, agoraMs);
  const e = lerEstado(hoje);
  salvarEstado({ ...e, estado: 'ok' });

  let msg = `Anotado ✅ Saldo de hoje: *${fmtBRL(valor)}*.`;
  const pendentes = contas.emAberto(hoje).reduce((s, p) => s + p.valor_previsto, 0);
  if (pendentes > 0) msg += `\nContas ainda em aberto: *${fmtBRL(pendentes)}* → livre depois delas: *${fmtBRL(valor - pendentes)}*.`;

  if (antes && antes.saldo !== valor) {
    await enviar(msg);                                  // 1º a confirmação, depois a pergunta
    await abrirDiferenca(antes.saldo, valor, hoje);
    return null;
  }
  if (antes) msg += '\nBateu certinho com as minhas contas 🎯';
  return msg;
}

// ---------------------------------------------------------------- perguntas
const TEXTO_1 = '☀️ Bom dia! Hora de acertar as contas: qual é o *saldo* da conta agora?\nÉ só mandar o valor (ex.: *1234,50*).';
const TEXTO_2 = '⏰ Ei, sou eu de novo! Ainda estou sem o saldo de hoje. Quanto tem na conta? Manda o valor (ex.: *1234,50*).\nSe não puder agora, responde *depois* e eu paro de encher hoje. Quando quiser, é só mandar *saldo 1234,50*.';

async function perguntar(e, hoje, agoraMs) {
  const n = e.n + 1;
  const msgId = await enviar(n === 1 ? TEXTO_1 : TEXTO_2);
  salvarEstado({ dia: hoje.dataIso, estado: 'aguardando', n, ms: agoraMs, msgId });
}

/** 8h: primeira pergunta do dia (idempotente; também roda ao religar o bot). */
export async function jobPerguntaSaldo(hoje = agoraLocal(), agoraMs = agora().getTime()) {
  if (hoje.hora < HORA_INICIO || hoje.hora >= HORA_FIM) return false;
  const e = lerEstado(hoje);
  if (e.estado !== 'nenhum' || saldoDoDia(hoje) != null) return false;
  await perguntar(e, hoje, agoraMs);
  return true;
}

/** A cada poucos minutos: passou 1h sem resposta? Pergunta de novo; esgotadas as tentativas, desiste do dia. */
export async function jobReperguntaSaldo(hoje = agoraLocal(), agoraMs = agora().getTime()) {
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
export async function tratarSaldo(texto, hoje = agoraLocal(), agoraMs = agora().getTime()) {
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
