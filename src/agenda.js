// Agendamentos. Os crons rodam no fuso America/Sao_Paulo; os jobs são idempotentes por dia
// (guardam a última execução em `config`), então também rodam "de recuperação" ao ligar o bot.
import cron from 'node-cron';
import Holidays from 'date-holidays';
import * as contas from './contas.js';
import * as resumos from './resumos.js';
import { enviar } from './saida.js';
import { db, getConfig, setConfig } from './db.js';
import { config } from './config.js';
import { log } from './log.js';
import * as ia from './ia.js';
import { agoraLocal, chaveMes } from './util.js';

const feriados = new Holidays('BR');

/** Dia 'útil' = segunda a sexta que não seja feriado nacional (type "public"). */
export function ehDiaUtil(ano, mes, dia) {
  const dow = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const meioDia = new Date(Date.UTC(ano, mes - 1, dia, 15)); // 12:00 em Brasília
  const h = feriados.isHoliday(meioDia);
  return !(h && h.some((x) => x.type === 'public'));
}

/** Retorna o dia do mês (número) do n-ésimo dia útil. */
export function enesimoDiaUtil(ano, mes, n = 5) {
  let cont = 0;
  for (let d = 1; d <= 31; d++) {
    if (new Date(Date.UTC(ano, mes - 1, d)).getUTCMonth() !== mes - 1) break;
    if (ehDiaUtil(ano, mes, d)) { cont++; if (cont === n) return d; }
  }
  return null;
}

export const ehQuintoDiaUtil = (hoje = agoraLocal()) => enesimoDiaUtil(hoje.ano, hoje.mes, 5) === hoje.dia;

// ------------------------------------------------------------------- jobs
export async function jobResumoDia1(hoje = agoraLocal()) {
  if (hoje.dia !== 1) return false;
  const chave = chaveMes(hoje.ano, hoje.mes);
  if (getConfig('resumo_dia1') === chave) return false;
  setConfig('resumo_dia1', chave);
  contas.gerarMes(hoje.ano, hoje.mes);
  await enviar(await resumos.resumoInicioMes(hoje));
  return true;
}

export async function jobResumo5DU(hoje = agoraLocal()) {
  if (!ehQuintoDiaUtil(hoje)) return false;
  const chave = chaveMes(hoje.ano, hoje.mes);
  if (getConfig('resumo_5du') === chave) return false;
  setConfig('resumo_5du', chave);
  await enviar(await resumos.resumoQuintoDiaUtil(hoje));
  return true;
}

export async function jobLembretes(hoje = agoraLocal()) {
  if (getConfig('lembretes_dia') === hoje.dataIso) return 0;
  setConfig('lembretes_dia', hoje.dataIso);
  contas.gerarMes(hoje.ano, hoje.mes);
  const lista = contas.lembretesDeHoje(hoje);
  if (!lista.length) return 0;
  const linhas = lista.map((p) => contas.avisoLembrete(p, hoje.dataIso)).join('\n');
  const temAtraso = lista.some((p) => p.status_efetivo === 'atrasado');
  const fecho = await ia.comentario({
    situacao: 'Lembrete diário de contas a vencer ou atrasadas.',
    extras: { tem_conta_atrasada: temAtraso, quantidade: lista.length },
    fallback: temAtraso ? 'Bora resolver essas atrasadas, eu agradeço 🙏' : 'Se já pagou, é só avisar: *paguei luz* 😉',
  });
  await enviar(`🔔 *Lembrete de contas*\n${linhas}\n\n${fecho}`);
  return lista.length;
}

export function jobLimpeza(agoraMs = Date.now()) {
  const r = db().prepare(`UPDATE perguntas_pendentes SET status = 'expirada' WHERE status = 'aberta' AND criada_ms < ?`)
    .run(agoraMs - 48 * 3600 * 1000);
  db().prepare('DELETE FROM notificacoes_vistas WHERE visto_ms < ?').run(agoraMs - 24 * 3600 * 1000);
  return r.changes;
}

async function seguro(nome, fn) {
  try { await fn(); } catch (e) { log.erro(`Job ${nome} falhou:`, e.message); }
}

/** Recuperação ao ligar: se o bot ficou fora do ar na hora do cron, roda quando voltar (no mesmo dia). */
export async function recuperar(hoje = agoraLocal()) {
  contas.gerarMes(hoje.ano, hoje.mes);
  contas.atualizarAtrasadas(hoje.dataIso);
  if (hoje.hora >= 8) { await seguro('resumo-dia1', () => jobResumoDia1(hoje)); await seguro('resumo-5du', () => jobResumo5DU(hoje)); }
  if (hoje.hora >= 9) await seguro('lembretes', () => jobLembretes(hoje));
}

export function iniciarAgenda() {
  const opts = { timezone: config.tz };
  cron.schedule('0 8 * * *', () => seguro('resumo-dia1', () => jobResumoDia1()), opts);
  cron.schedule('0 8 * * *', () => seguro('resumo-5du', () => jobResumo5DU()), opts);
  cron.schedule('0 9 * * *', () => seguro('lembretes', () => jobLembretes()), opts);
  cron.schedule('5 0 * * *', () => seguro('virada', () => { const h = agoraLocal(); contas.gerarMes(h.ano, h.mes); contas.atualizarAtrasadas(h.dataIso); }), opts);
  cron.schedule('30 3 * * *', () => seguro('limpeza', () => jobLimpeza()), opts);
  log.info(`Agenda ligada (${config.tz}): 00:05 virada, 08:00 resumos, 09:00 lembretes.`);
}
