// Fila de perguntas que o bot fez e ainda espera resposta.
import { db } from './db.js';

export const VALIDADE_MS = 48 * 3600 * 1000;
const TIPOS_CONFIRMACAO = new Set(['baixa_incerta', 'baixa_feita']);
export const ehConfirmacao = (tipo) => TIPOS_CONFIRMACAO.has(tipo);

export function criar({ tipo, transacaoId = null, pagamentoId = null, msgId = null }, agoraMs = Date.now()) {
  return Number(db().prepare(`INSERT INTO perguntas_pendentes (tipo, transacao_id, pagamento_id, msg_id, criada_ms)
    VALUES (?,?,?,?,?)`).run(tipo, transacaoId, pagamentoId, msgId, agoraMs).lastInsertRowid);
}

export function abertas(agoraMs = Date.now()) {
  return db().prepare(`SELECT * FROM perguntas_pendentes WHERE status = 'aberta' AND criada_ms > ? ORDER BY criada_ms, id`)
    .all(agoraMs - VALIDADE_MS);
}

export function fechar(id, status = 'respondida') {
  db().prepare('UPDATE perguntas_pendentes SET status = ? WHERE id = ?').run(status, id);
}

/**
 * Qual pergunta esta mensagem responde?
 *  1) resposta "citada" (reply) a uma mensagem do bot => essa pergunta;
 *  2) "sim/não" => a confirmação aberta mais recente;
 *  3) texto livre => a pergunta de categoria/origem mais ANTIGA (fila FIFO).
 */
export function escolher({ ehSimNao, citadoId = null }, agoraMs = Date.now()) {
  const lista = abertas(agoraMs);
  if (!lista.length) return null;
  if (citadoId) {
    const c = lista.find((q) => q.msg_id === citadoId);
    if (c) return c;
  }
  if (ehSimNao) {
    const conf = lista.filter((q) => ehConfirmacao(q.tipo));
    if (conf.length) return conf[conf.length - 1];
  }
  return lista.find((q) => !ehConfirmacao(q.tipo)) || null;
}
