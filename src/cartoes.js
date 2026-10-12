// Cartões de crédito: limite informado pelo dono, uso calculado a partir das compras no crédito.
// uso atual = usado_base (informado) + compras no crédito depois disso − faturas pagas depois disso.
// Compra no crédito NÃO sai do saldo; só ocupa limite. Pagar a fatura sai do saldo e libera o limite.
import { db } from './db.js';
import { agoraLocal, chaveMes, fmtBRL, normalizar } from './util.js';

/** "nubank", "nu pay", "mercado pago", "mp" ... -> chave do cartão (ou null). */
export function chaveCartao(texto) {
  const n = normalizar(texto);
  if (/\bnu\s?bank\b|\bnubank\b|\bnu\s?pay\b|\bnupay\b|\broxinho\b|\bnu\b/.test(n)) return 'nubank';
  if (/mercado\s?pago|mercadopago|\bmp\b/.test(n)) return 'mercado pago';
  return null;
}

/** Nome do app que mandou a notificação -> cartão dono daquele crédito. */
export function cartaoDoApp(nomeApp) {
  if (nomeApp === 'Nubank') return 'nubank';
  if (nomeApp === 'Mercado Pago') return 'mercado pago';
  return null;
}

export function obter(chave) {
  return db().prepare('SELECT * FROM cartoes WHERE chave = ?').get(chave) ?? null;
}

export function listar() {
  return db().prepare('SELECT * FROM cartoes ORDER BY chave').all();
}

export function definirLimite(chave, centavos) {
  const nomes = { nubank: 'Nubank', 'mercado pago': 'Mercado Pago' };
  db().prepare(`INSERT INTO cartoes (chave, nome, limite) VALUES (?, ?, ?)
    ON CONFLICT(chave) DO UPDATE SET limite = excluded.limite, alerta80 = NULL, alerta100 = NULL`).run(chave, nomes[chave] ?? chave, centavos);
}

/** O dono informa quanto do limite já está usado agora; dali em diante o bot soma as compras novas. */
export function definirUsado(chave, centavos, agoraIso = agoraLocal().iso) {
  db().prepare('UPDATE cartoes SET usado_base = ?, base_iso = ?, alerta80 = NULL, alerta100 = NULL WHERE chave = ?').run(centavos, agoraIso, chave);
}

export function usadoAtual(chave) {
  const c = obter(chave);
  if (!c) return 0;
  const desde = c.base_iso ?? '0000';
  const soma = (tipo) => db().prepare('SELECT COALESCE(SUM(valor),0) AS t FROM transacoes WHERE tipo = ? AND cartao = ? AND data > ?').get(tipo, chave, desde).t;
  return Math.max(0, c.usado_base + soma('compra_credito') - soma('pagamento_fatura'));
}

export function resumo(chave) {
  const c = obter(chave);
  if (!c) return null;
  const usado = usadoAtual(chave);
  return {
    chave, nome: c.nome, limite: c.limite, usado, disponivel: c.limite - usado,
    pct: c.limite > 0 ? usado / c.limite : 0, informouUso: c.base_iso != null,
  };
}

/** Chame depois de uma compra no crédito. Cada nível (80% e 100%) só avisa uma vez por mês. */
export function verificarLimite(chave, hoje = agoraLocal()) {
  const r = resumo(chave);
  if (!r) return null;
  const m = chaveMes(hoje.ano, hoje.mes);
  const c = obter(chave);
  if (r.pct >= 1 && c.alerta100 !== m) {
    db().prepare('UPDATE cartoes SET alerta100 = ?, alerta80 = ? WHERE chave = ?').run(m, m, chave);
    return `🚨 Estourei o limite do *${r.nome}*: usei ${fmtBRL(r.usado)} de ${fmtBRL(r.limite)}. Sem mais crédito por aqui!`;
  }
  if (r.pct >= 0.8 && r.pct < 1 && c.alerta80 !== m) {
    db().prepare('UPDATE cartoes SET alerta80 = ? WHERE chave = ?').run(m, chave);
    return `⚠️ Cuidado: já usei ${Math.round(r.pct * 100)}% do limite do *${r.nome}* (${fmtBRL(r.usado)} de ${fmtBRL(r.limite)}). Restam ${fmtBRL(r.disponivel)}.`;
  }
  return null;
}

export function textoLimites() {
  const linhas = listar().map((c) => {
    const r = resumo(c.chave);
    const barra = '▰'.repeat(Math.min(10, Math.round(r.pct * 10))) + '▱'.repeat(Math.max(0, 10 - Math.round(r.pct * 10)));
    const aviso = r.informouUso ? '' : ' _(me diz quanto já usou: *usado ' + c.chave + ' 450*)_';
    return `💳 *${r.nome}*\n${barra} ${Math.round(r.pct * 100)}%\nUsado: ${fmtBRL(r.usado)} · Limite: ${fmtBRL(r.limite)} · Resta: *${fmtBRL(r.disponivel)}*${aviso}`;
  });
  return linhas.length ? `*Meus limites de crédito*\n\n${linhas.join('\n\n')}` : 'Ainda não tenho cartão nenhum cadastrado. Manda: *limite nubank 600*.';
}
