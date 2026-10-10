// Extração de dados de notificações: regex primeiro, Gemini só como plano B.
import { appPorPacote, PADROES_GENERICOS, IGNORAR, RECUSADAS } from '../config/apps.js';
import { parseValor } from './util.js';
import * as ia from './ia.js';
import { log } from './log.js';

export const TIPOS = [
  'pix_enviado', 'pix_recebido', 'compra_cartao', 'debito', 'boleto',
  'transferencia_enviada', 'transferencia_recebida',
];

export function normalizarTexto(s) {
  return String(s ?? '').replace(/[\u00a0\u200b\u202f]/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

/** Tira "às 14:32", "via Pix" etc. do fim do nome e pontuação sobrando. */
export function limparContraparte(c) {
  if (!c) return null;
  let s = normalizarTexto(c)
    .replace(/\s+(?:via pix|[àa]s \d|em \d|no dia \d|com sucesso).*$/i, '')
    .replace(/[\s.:;,\-–]+$/g, '')
    .replace(/^[\s:\-–]+/g, '');
  if (s.length > 80) s = s.slice(0, 80);
  return s || null;
}

/** Tenta todos os padrões (do app, depois genéricos). Retorna {tipo, valor, contraparte, via:'regex'} ou null. */
export function extrairPorRegex(pacote, titulo, texto) {
  const app = appPorPacote(pacote);
  const alvo = normalizarTexto(`${titulo ?? ''}\n${texto ?? ''}`);
  const lista = [...(app?.padroes || []), ...PADROES_GENERICOS];
  for (const pad of lista) {
    const m = pad.regex.exec(alvo);
    if (!m?.groups?.valor) continue;
    const valor = parseValor(m.groups.valor);
    if (!valor) continue;
    return {
      tipo: pad.tipo, valor,
      contraparte: limparContraparte(m.groups.contraparte),
      confianca: 0.9, via: 'regex',
    };
  }
  return null;
}

/** Valor e local de uma compra recusada (só para avisar; nunca vira gasto). */
export function extrairRecusada(titulo, texto) {
  const alvo = normalizarTexto(`${titulo ?? ''}\n${texto ?? ''}`);
  const v = /R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)/.exec(alvo);
  const valor = v ? parseValor(v[1]) : null;
  let contraparte = limparContraparte(/\bem\s+([^\n]+?)(?:\s+n[aã]o\b|\.|\n|$)/i.exec(alvo)?.[1]);
  const t = normalizarTexto(titulo);
  if (!contraparte && t && t.length <= 40 && !/\d|recusad|negad|n[aã]o/i.test(t)) contraparte = limparContraparte(t);
  return { valor, contraparte };
}

export function ehIgnoravel(titulo, texto) {
  const alvo = `${titulo ?? ''}\n${texto ?? ''}`;
  return IGNORAR.some((r) => r.test(alvo));
}

/**
 * Pipeline completo. Retorna:
 *  { ignorar: true, motivo }  ou  { tipo, valor, contraparte, confianca, via, app }
 * Ordem: recusadas/estornos -> regex -> lista de ignorar -> Gemini -> (na dúvida) ignorar.
 */
export async function interpretarNotificacao({ app: pacote, titulo, texto }, { usarIA = true } = {}) {
  const info = appPorPacote(pacote);
  if (!info) return { ignorar: true, motivo: 'app_desconhecido' };

  if (RECUSADAS.some((rx) => rx.test(`${titulo ?? ''}\n${texto ?? ''}`))) {
    return { ignorar: true, motivo: 'recusada', ...extrairRecusada(titulo, texto) };
  }

  const r = extrairPorRegex(pacote, titulo, texto);
  if (r) return { ...r, app: info.nome };

  if (ehIgnoravel(titulo, texto)) return { ignorar: true, motivo: 'nao_financeira' };

  const alvo = `${titulo ?? ''} ${texto ?? ''}`;
  if (!/R\$\s*\d/.test(alvo)) return { ignorar: true, motivo: 'sem_valor' };

  if (usarIA && ia.disponivel()) {
    const g = await ia.extrairNotificacao({ app: info.nome, titulo, texto });
    if (g && g.tipo !== 'ignorar' && g.valor && g.confianca >= 0.6) {
      log.debug('Gemini extraiu', g.tipo, g.valor);
      return { ...g, via: 'ia', app: info.nome };
    }
    return { ignorar: true, motivo: 'ia_ignorou' };
  }
  return { ignorar: true, motivo: 'regex_falhou' };
}
