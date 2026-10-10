import { db, getConfig, setConfig } from './db.js';
import { agoraLocal, chaveMes, fmtBRL, normalizar } from './util.js';
import { CATEGORIAS } from './ia.js';

export { CATEGORIAS };

const ENTRADAS = new Set(['pix_recebido', 'transferencia_recebida', 'entrada_manual']);
export const ehEntrada = (tipo) => ENTRADAS.has(tipo);

// ---------------------------------------------------------------- categorias
const SINONIMOS = {
  mercado: ['mercado', 'supermercado', 'atacadao', 'atacarejo', 'hortifruti', 'feira', 'sacolao', 'assai', 'carrefour', 'pao de acucar'],
  'alimentação': ['padaria', 'restaurante', 'lanche', 'lanchonete', 'ifood', 'pizza', 'hamburguer', 'cafe', 'sorvete', 'acai', 'bar', 'comida', 'almoco', 'janta', 'rappi', 'mcdonalds', 'burger', 'alimentacao'],
  transporte: ['uber', '99', 'taxi', 'onibus', 'metro', 'combustivel', 'gasolina', 'posto', 'estacionamento', 'pedagio', 'transporte', 'bilhete', 'sem parar'],
  'saúde': ['farmacia', 'drogaria', 'drogasil', 'raia', 'medico', 'consulta', 'exame', 'dentista', 'hospital', 'plano de saude', 'saude', 'remedio'],
  lazer: ['cinema', 'show', 'viagem', 'hotel', 'jogo', 'game', 'steam', 'balada', 'ingresso', 'lazer', 'parque'],
  moradia: ['aluguel', 'condominio', 'iptu', 'reforma', 'moradia', 'casa'],
  contas: ['luz', 'agua', 'internet', 'gas', 'energia', 'telefone', 'celular', 'enel', 'sabesp', 'vivo', 'claro', 'tim', 'conta'],
  'educação': ['escola', 'faculdade', 'curso', 'livro', 'mensalidade', 'educacao', 'udemy'],
  compras: ['loja', 'roupa', 'sapato', 'tenis', 'amazon', 'shopee', 'mercado livre', 'magalu', 'shein', 'americanas', 'compras', 'eletronico'],
  assinaturas: ['netflix', 'spotify', 'disney', 'prime', 'hbo', 'max', 'youtube', 'deezer', 'icloud', 'assinatura', 'globoplay', 'apple'],
};

/** Normaliza o que o usuário digitou para uma categoria conhecida (ou texto livre em minúsculas). */
export function normalizarCategoria(txt) {
  const n = normalizar(txt);
  if (!n) return 'outros';
  const direta = CATEGORIAS.find((c) => normalizar(c) === n);
  if (direta) return direta;
  const local = categorizarLocal(txt);
  if (local.confianca >= 0.8) return local.categoria;
  return n;
}

/** Palavras-chave locais (sem gastar cota do Gemini). Confiança 0.85 se achar, 0 se não. */
export function categorizarLocal(texto) {
  const n = ` ${normalizar(texto)} `;
  for (const [cat, palavras] of Object.entries(SINONIMOS)) {
    if (palavras.some((w) => n.includes(` ${w} `) || (w.length > 4 && n.includes(w)))) {
      return { categoria: cat, confianca: 0.85 };
    }
  }
  return { categoria: 'outros', confianca: 0 };
}

// --------------------------------------------------------------- transações
export function registrar({ tipo, valor, contraparte = null, categoria = null, descricao = null,
  origemApp = null, status = 'ok', hash = null, dataIso = null }) {
  const data = dataIso || agoraLocal().iso;
  const r = db().prepare(`INSERT INTO transacoes
    (data, tipo, valor, contraparte, categoria, descricao, origem_app, status_categoria, hash_notificacao)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(data, tipo, valor, contraparte, categoria, descricao, origemApp, status, hash);
  return Number(r.lastInsertRowid);
}

export function obter(id) {
  return db().prepare('SELECT * FROM transacoes WHERE id = ?').get(id);
}

export function atualizar(id, campos) {
  const mapa = { categoria: 'categoria', descricao: 'descricao', status: 'status_categoria', contraparte: 'contraparte' };
  const sets = []; const vals = [];
  for (const [k, col] of Object.entries(mapa)) {
    if (campos[k] !== undefined) { sets.push(`${col} = ?`); vals.push(campos[k]); }
  }
  if (sets.length) db().prepare(`UPDATE transacoes SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

export function apagar(id) {
  db().prepare('DELETE FROM transacoes WHERE id = ?').run(id);
}

const ENTRADAS_SQL = `('pix_recebido','transferencia_recebida','entrada_manual')`;

export function totaisMes(ano, mes) {
  const m = chaveMes(ano, mes);
  const r = db().prepare(`SELECT
      COALESCE(SUM(CASE WHEN tipo IN ${ENTRADAS_SQL} THEN valor END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo NOT IN ${ENTRADAS_SQL} THEN valor END), 0) AS saidas
    FROM transacoes WHERE substr(data,1,7) = ?`).get(m);
  return { entradas: r.entradas, saidas: r.saidas };
}

export function porCategoria(ano, mes) {
  return db().prepare(`SELECT COALESCE(categoria,'outros') AS categoria, SUM(valor) AS total, COUNT(*) AS qtd
    FROM transacoes WHERE substr(data,1,7) = ? AND tipo NOT IN ${ENTRADAS_SQL}
    GROUP BY COALESCE(categoria,'outros') ORDER BY total DESC`).all(chaveMes(ano, mes));
}

export function gastoCategoriaMes(categoria, ano, mes) {
  return db().prepare(`SELECT COALESCE(SUM(valor),0) AS t FROM transacoes
    WHERE substr(data,1,7) = ? AND tipo NOT IN ${ENTRADAS_SQL} AND categoria = ?`).get(chaveMes(ano, mes), categoria).t;
}

export function ultimas(n = 10, soGastos = true) {
  const filtro = soGastos ? `WHERE tipo NOT IN ${ENTRADAS_SQL}` : '';
  return db().prepare(`SELECT * FROM transacoes ${filtro} ORDER BY data DESC, id DESC LIMIT ?`).all(n);
}

// ------------------------------------------------------------------- renda
export function getRenda() {
  const v = getConfig('renda_mensal');
  return v == null ? null : Number(v);
}
export function setRenda(centavos) { setConfig('renda_mensal', centavos); }

// ---------------------------------------------------------------- orçamento
export function definirOrcamento(categoria, limite) {
  db().prepare(`INSERT INTO orcamentos (categoria, limite) VALUES (?, ?)
    ON CONFLICT(categoria) DO UPDATE SET limite = excluded.limite, alerta80 = NULL, alerta100 = NULL`).run(categoria, limite);
}
export function removerOrcamento(categoria) {
  return db().prepare('DELETE FROM orcamentos WHERE categoria = ?').run(categoria).changes > 0;
}
export function listarOrcamentos(ano, mes) {
  return db().prepare('SELECT * FROM orcamentos ORDER BY categoria').all()
    .map((o) => ({ ...o, gasto: gastoCategoriaMes(o.categoria, ano, mes) }));
}

/**
 * Chame depois de registrar/recategorizar um gasto. Retorna texto de alerta (ou null).
 * Cada nível (80% e 100%) só avisa uma vez por mês.
 */
export function verificarOrcamento(categoria, ano, mes) {
  if (!categoria) return null;
  const o = db().prepare('SELECT * FROM orcamentos WHERE categoria = ?').get(categoria);
  if (!o) return null;
  const m = chaveMes(ano, mes);
  const gasto = gastoCategoriaMes(categoria, ano, mes);
  const pct = gasto / o.limite;
  if (pct >= 1 && o.alerta100 !== m) {
    db().prepare('UPDATE orcamentos SET alerta100 = ?, alerta80 = ? WHERE categoria = ?').run(m, m, categoria);
    return `🚨 Estourei o orçamento de *${categoria}*: já foram ${fmtBRL(gasto)} de ${fmtBRL(o.limite)}.`;
  }
  if (pct >= 0.8 && pct < 1 && o.alerta80 !== m) {
    db().prepare('UPDATE orcamentos SET alerta80 = ? WHERE categoria = ?').run(m, categoria);
    return `⚠️ Cuidado: já usei ${Math.round(pct * 100)}% do orçamento de *${categoria}* (${fmtBRL(gasto)} de ${fmtBRL(o.limite)}).`;
  }
  return null;
}
