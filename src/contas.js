// Contas fixas: cadastro, geração mensal, baixa (manual e automática) e lembretes.
import { db } from './db.js';
import * as tx from './transacoes.js';
import { agoraLocal, diasNoMes, parseValor, fmtBRL, normalizar, diffDias, dataIsoDe, fmtDataCurta } from './util.js';

export const TOLERANCIA_PCT = 0.10;        // diferença aceita p/ baixa automática "forte"
export const TOLERANCIA_MIN = 200;         // ou até R$ 2,00 de diferença
export const TOLERANCIA_INCERTA_PCT = 0.5; // acima disso nem perguntamos

/** Dia de vencimento real no mês (dia 31 em fevereiro => 28/29). */
export function vencimentoNoMes(ano, mes, dia) {
  return Math.min(dia, diasNoMes(ano, mes));
}

const dataVenc = (ano, mes, dia) => dataIsoDe(ano, mes, vencimentoNoMes(ano, mes, dia));

// ------------------------------------------------------------------ parsing
const VERBOS_NAO_CONTA = /^(gastei|paguei|comprei|recebi|saiu|entrou|ganhei|orcamento|renda|salario|editar|remover|apagar|quanto)\b/;
const RE_CONTA = /^(?:contas?\s+fixas?\s*:?\s*)?(?<nome>[^\d].*?)\s+(?:r\$\s*)?(?<valor>\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s+(?:todo\s+)?(?:dia|venc(?:imento)?\.?(?:\s+dia)?)\s+(?<dia>\d{1,2})\s*$/i;

/** "aluguel 1200 dia 5" -> { nome, valor(centavos), dia } | null */
export function parseLinhaConta(linha) {
  const l = String(linha).trim().replace(/^[-•*]\s*/, '');
  if (VERBOS_NAO_CONTA.test(normalizar(l))) return null;
  const m = RE_CONTA.exec(l);
  if (!m) return null;
  const valor = parseValor(m.groups.valor);
  const dia = Number(m.groups.dia);
  const nome = m.groups.nome.trim().replace(/[:\-–]+$/, '').trim();
  if (!valor || dia < 1 || dia > 31 || !nome) return null;
  return { nome, valor, dia };
}

/** Aceita várias linhas. Retorna { contas, erros } (erros = linhas não entendidas). */
export function parseCadastro(texto) {
  const contas = []; const erros = [];
  for (const bruta of String(texto).split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha) continue;
    if (/^contas?\s+fixas?\s*:?\s*$/i.test(linha)) continue; // cabeçalho
    const c = parseLinhaConta(linha);
    if (c) contas.push(c); else erros.push(linha);
  }
  return { contas, erros };
}

export function pareceCadastro(texto) {
  const t = String(texto).trim();
  if (/^contas?\s+fixas?\s*:/i.test(t)) return true;
  const linhas = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return linhas.length > 0 && linhas.every((l) => parseLinhaConta(l) || /^contas?\s+fixas?\s*:?\s*$/i.test(l))
    && linhas.some((l) => parseLinhaConta(l));
}

// --------------------------------------------------------------------- CRUD
export function cadastrarConta({ nome, valor, dia }, { ano, mes } = agoraLocal()) {
  const norm = normalizar(nome);
  const existente = db().prepare('SELECT * FROM contas_fixas WHERE nome_norm = ?').get(norm);
  let id; let acao;
  if (existente) {
    db().prepare('UPDATE contas_fixas SET nome = ?, valor = ?, dia_vencimento = ?, ativa = 1 WHERE id = ?').run(nome, valor, dia, existente.id);
    db().prepare(`UPDATE pagamentos_mes SET valor_previsto = ? WHERE conta_id = ? AND ano = ? AND mes = ? AND status != 'pago'`)
      .run(valor, existente.id, ano, mes);
    id = existente.id; acao = existente.ativa ? 'atualizada' : 'reativada';
  } else {
    id = Number(db().prepare('INSERT INTO contas_fixas (nome, nome_norm, valor, dia_vencimento) VALUES (?,?,?,?)')
      .run(nome, norm, valor, dia).lastInsertRowid);
    acao = 'criada';
  }
  gerarMes(ano, mes);
  return { id, acao, nome, valor, dia };
}

export function listarContas() {
  return db().prepare('SELECT * FROM contas_fixas WHERE ativa = 1 ORDER BY dia_vencimento, nome').all();
}

export function editarConta(id, { valor, dia }, { ano, mes } = agoraLocal()) {
  if (valor) {
    db().prepare('UPDATE contas_fixas SET valor = ? WHERE id = ?').run(valor, id);
    db().prepare(`UPDATE pagamentos_mes SET valor_previsto = ? WHERE conta_id = ? AND ano = ? AND mes = ? AND status != 'pago'`).run(valor, id, ano, mes);
  }
  if (dia) db().prepare('UPDATE contas_fixas SET dia_vencimento = ? WHERE id = ?').run(dia, id);
  db().prepare(`UPDATE pagamentos_mes SET status = 'pendente' WHERE conta_id = ? AND ano = ? AND mes = ? AND status = 'atrasado'`).run(id, ano, mes);
  atualizarAtrasadas();
}

export function removerConta(id, { ano, mes } = agoraLocal()) {
  db().prepare('UPDATE contas_fixas SET ativa = 0 WHERE id = ?').run(id);
  db().prepare(`DELETE FROM pagamentos_mes WHERE conta_id = ? AND status != 'pago' AND ano = ? AND mes = ?`).run(id, ano, mes);
}

/** Cria as linhas de pagamentos do mês para todas as contas ativas (idempotente). */
export function gerarMes(ano, mes) {
  return db().prepare(`INSERT OR IGNORE INTO pagamentos_mes (conta_id, ano, mes, valor_previsto)
    SELECT id, ?, ?, valor FROM contas_fixas WHERE ativa = 1`).run(ano, mes).changes;
}

// -------------------------------------------------------------- consulta mês
const SQL_MES = `SELECT p.*, c.nome, c.dia_vencimento
  FROM pagamentos_mes p JOIN contas_fixas c ON c.id = p.conta_id`;

/** Pagamentos do mês com vencimento real e status efetivo (pendente vira atrasado após o vencimento). */
export function pagamentosDoMes(ano, mes, hoje = agoraLocal().dataIso) {
  return db().prepare(`${SQL_MES} WHERE p.ano = ? AND p.mes = ? AND c.ativa = 1`).all(ano, mes)
    .map((p) => enriquecer(p, hoje))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.nome.localeCompare(b.nome));
}

function enriquecer(p, hoje) {
  const vencimento = dataVenc(p.ano, p.mes, p.dia_vencimento);
  const atrasada = p.status !== 'pago' && vencimento < hoje;
  return { ...p, vencimento, status_efetivo: p.status === 'pago' ? 'pago' : atrasada ? 'atrasado' : 'pendente' };
}

/** Todas as não pagas (mês atual + atrasadas dos últimos 3 meses). */
export function emAberto(hoje = agoraLocal()) {
  const limite = new Date(Date.UTC(hoje.ano, hoje.mes - 1 - 3, 1));
  const minimo = limite.getUTCFullYear() * 100 + (limite.getUTCMonth() + 1);
  return db().prepare(`${SQL_MES} WHERE p.status != 'pago' AND c.ativa = 1 AND (p.ano * 100 + p.mes) >= ? AND (p.ano * 100 + p.mes) <= ?`)
    .all(minimo, hoje.ano * 100 + hoje.mes)
    .map((p) => enriquecer(p, hoje.dataIso))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

export function atualizarAtrasadas(hoje = agoraLocal().dataIso) {
  const abertos = db().prepare(`${SQL_MES} WHERE p.status = 'pendente'`).all();
  const upd = db().prepare(`UPDATE pagamentos_mes SET status = 'atrasado' WHERE id = ?`);
  let n = 0;
  for (const p of abertos) {
    if (dataVenc(p.ano, p.mes, p.dia_vencimento) < hoje) { upd.run(p.id); n++; }
  }
  return n;
}

// ------------------------------------------------------------ similaridade
const RUIDO = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'conta', 'pagamento', 'pix', 'ltda', 'sa', 'me', 'epp', 'cia', 'servicos', 'com', 'br', 'brasil']);
const tokens = (s) => normalizar(s).split(' ').filter((t) => t.length > 1 && !RUIDO.has(t));

/** 0..1 — quão parecido é o nome da conta com a contraparte da transação. */
export function similaridade(nomeConta, contraparte) {
  const a = tokens(nomeConta); const b = tokens(contraparte);
  if (!a.length || !b.length) return 0;
  const casa = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)));
  const acertos = a.filter((x) => b.some((y) => casa(x, y))).length;
  return acertos / a.length;
}

/** Acha a conta ativa que melhor combina com o texto digitado ("luz", "internet"...). */
export function buscarConta(texto) {
  const contas = listarContas();
  const n = normalizar(texto);
  if (!n) return null;
  const exata = contas.find((c) => c.nome_norm === n);
  if (exata) return exata;
  const pontuadas = contas.map((c) => ({ c, s: Math.max(similaridade(c.nome, texto), similaridade(texto, c.nome)) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return pontuadas.length ? pontuadas[0].c : null;
}

/** Pagamento em aberto mais antigo de uma conta (mês atual ou atrasado anterior). */
export function pagamentoAbertoDaConta(contaId, hoje = agoraLocal()) {
  return emAberto(hoje).find((p) => p.conta_id === contaId) || null;
}

// -------------------------------------------------------------------- baixa
/**
 * Marca como paga. Se não vier transacaoId, registra um gasto "conta_fixa" para os totais
 * do mês refletirem o pagamento.
 */
export function marcarPaga(pagamentoId, { valor, dataIso, transacaoId } = {}) {
  const p = db().prepare(`${SQL_MES} WHERE p.id = ?`).get(pagamentoId);
  if (!p) return null;
  const pago = valor ?? p.valor_previsto;
  const data = dataIso || agoraLocal().iso;
  let txId = transacaoId ?? null;
  if (!txId) {
    txId = tx.registrar({ tipo: 'conta_fixa', valor: pago, contraparte: p.nome, categoria: 'contas', descricao: `Conta fixa: ${p.nome}`, dataIso: data });
  }
  db().prepare(`UPDATE pagamentos_mes SET status = 'pago', data_pagamento = ?, valor_pago = ?, transacao_id = ? WHERE id = ?`)
    .run(data.slice(0, 10), pago, txId, pagamentoId);
  return { ...p, valor_pago: pago, transacao_id: txId };
}

/** Desfaz a baixa. Apaga a transação só se foi criada pelo próprio "paguei". */
export function desfazerPaga(pagamentoId) {
  const p = db().prepare('SELECT * FROM pagamentos_mes WHERE id = ?').get(pagamentoId);
  if (!p || p.status !== 'pago') return false;
  if (p.transacao_id) {
    const t = tx.obter(p.transacao_id);
    if (t?.tipo === 'conta_fixa') tx.apagar(t.id);
  }
  db().prepare(`UPDATE pagamentos_mes SET status = 'pendente', data_pagamento = NULL, valor_pago = NULL, transacao_id = NULL WHERE id = ?`).run(pagamentoId);
  atualizarAtrasadas();
  return true;
}

/**
 * Tenta casar uma saída (Pix/boleto/cartão) com uma conta fixa em aberto.
 * Retorna { nivel: 'forte'|'incerto', pagamento } ou null.
 *  forte  = nome parecido E valor dentro da tolerância
 *  incerto = nome parecido com valor mais distante, OU valor praticamente idêntico sem nome parecido
 */
export function casarComConta({ contraparte, valor }, hoje = agoraLocal()) {
  let melhor = null;
  for (const p of emAberto(hoje)) {
    const sim = similaridade(p.nome, contraparte || '');
    const nomeOk = sim >= 0.5;
    const diff = Math.abs(valor - p.valor_previsto);
    const tol = Math.max(TOLERANCIA_MIN, p.valor_previsto * TOLERANCIA_PCT);
    let nivel = null;
    if (nomeOk && diff <= tol) nivel = 'forte';
    else if (nomeOk && diff <= p.valor_previsto * TOLERANCIA_INCERTA_PCT) nivel = 'incerto';
    else if (!nomeOk && diff <= 50) nivel = 'incerto';
    if (!nivel) continue;
    const score = (nivel === 'forte' ? 2 : 1) * 1e9 - diff;
    if (!melhor || score > melhor.score) melhor = { nivel, pagamento: p, score };
  }
  return melhor ? { nivel: melhor.nivel, pagamento: melhor.pagamento } : null;
}

// ------------------------------------------------------------------ texto
const ICONE = { pago: '✅', pendente: '🕒', atrasado: '🔴' };

export function linhaPagamento(p) {
  return `${ICONE[p.status_efetivo]} ${p.nome}: ${fmtBRL(p.valor_previsto)} (vence ${fmtDataCurta(p.vencimento)})`;
}

export function textoMinhasContas(hoje = agoraLocal()) {
  const contas = listarContas();
  if (!contas.length) {
    return 'Ainda não tenho nenhuma conta fixa anotada. Manda assim: *aluguel 1200 dia 5* (pode mandar várias linhas).';
  }
  const total = contas.reduce((s, c) => s + c.valor, 0);
  const linhas = contas.map((c) => `• ${c.nome}: ${fmtBRL(c.valor)} (todo dia ${c.dia_vencimento})`);
  return `*Minhas contas fixas*\n${linhas.join('\n')}\n\nTotal por mês: *${fmtBRL(total)}*`;
}

export function avisoLembrete(p, hoje) {
  const dias = diffDias(hoje, p.vencimento);
  if (dias > 1) return `🕒 ${p.nome} vence em ${dias} dias (${fmtDataCurta(p.vencimento)}): ${fmtBRL(p.valor_previsto)}`;
  if (dias === 1) return `⏰ ${p.nome} vence *amanhã*: ${fmtBRL(p.valor_previsto)}`;
  if (dias === 0) return `📌 ${p.nome} vence *hoje*: ${fmtBRL(p.valor_previsto)}`;
  return `🔴 ${p.nome} está *atrasada* há ${-dias} dia${dias === -1 ? '' : 's'} (venceu ${fmtDataCurta(p.vencimento)}): ${fmtBRL(p.valor_previsto)}`;
}

/**
 * Seleciona quais contas lembrar hoje: 3 dias antes, 1 dia antes, no dia, e atrasadas
 * (1º aviso no dia seguinte, depois a cada 2 dias). Paga nunca entra. Marca ultimo_aviso.
 */
export function lembretesDeHoje(hoje = agoraLocal()) {
  atualizarAtrasadas(hoje.dataIso);
  const escolhidos = [];
  for (const p of emAberto(hoje)) {
    if (p.ultimo_aviso === hoje.dataIso) continue;
    const dias = diffDias(hoje.dataIso, p.vencimento);
    let avisar = false;
    if ([3, 1, 0].includes(dias)) avisar = true;
    else if (dias < 0) {
      const desdeUltimo = p.ultimo_aviso ? diffDias(p.ultimo_aviso, hoje.dataIso) : Infinity;
      avisar = dias === -1 || desdeUltimo >= 2;
    }
    if (avisar) escolhidos.push(p);
  }
  const upd = db().prepare('UPDATE pagamentos_mes SET ultimo_aviso = ? WHERE id = ?');
  for (const p of escolhidos) upd.run(hoje.dataIso, p.id);
  return escolhidos;
}
