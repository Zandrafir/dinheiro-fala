// Pipeline de uma notificação do Android: dedup -> parser -> registro -> aviso/pergunta.
import crypto from 'node:crypto';
import { db } from './db.js';
import { interpretarNotificacao } from './parser.js';
import * as tx from './transacoes.js';
import * as contas from './contas.js';
import * as perguntas from './perguntas.js';
import * as ia from './ia.js';
import { calcularSobra } from './resumos.js';
import * as cartoes from './cartoes.js';
import { saldoAtual } from './saldo.js';
import * as capturas from './capturas.js';
import { getConfig, setConfig } from './db.js';
import { enviar } from './saida.js';
import { log } from './log.js';
import { agoraLocal, agora, fmtBRL, sorteia } from './util.js';

export const JANELA_DEDUP_MS = 2 * 60 * 1000;
const ROTULO = {
  pix_enviado: 'Pix', transferencia_enviada: 'transferência', boleto: 'pagamento de boleto',
  pix_recebido: 'Pix', transferencia_recebida: 'transferência', compra_cartao: 'compra', compra_credito: 'compra no crédito', debito: 'compra no débito',
};

export function hashNotificacao({ app, titulo, texto }) {
  return crypto.createHash('sha256').update(`${app}\u0001${titulo}\u0001${texto}`).digest('hex');
}

/**
 * Deduplicação: mesma (app + título + texto) dentro de 2 minutos = repetição do Android.
 * Guardamos o horário da 1ª ocorrência; depois da janela, a mesma notificação conta de novo
 * (ex.: dois Pix idênticos em momentos diferentes).
 */
export function jaVista(hash, agoraMs = Date.now()) {
  const r = db().prepare('SELECT visto_ms FROM notificacoes_vistas WHERE hash = ?').get(hash);
  if (r && agoraMs - r.visto_ms < JANELA_DEDUP_MS) return true;
  db().prepare(`INSERT INTO notificacoes_vistas (hash, visto_ms) VALUES (?, ?)
    ON CONFLICT(hash) DO UPDATE SET visto_ms = excluded.visto_ms`).run(hash, agoraMs);
  return false;
}

function limpar(v, max = 2000) {
  return String(v ?? '').slice(0, max);
}

export async function decidirCategoria(texto) {
  const local = tx.categorizarLocal(texto);
  if (local.confianca >= 0.8) return local;
  const g = ia.disponivel() ? await ia.categorizar(texto) : null;
  return g || { categoria: 'outros', confianca: 0 };
}

/**
 * A mesma compra costuma gerar DUAS notificações: a do banco e a da Carteira Google.
 * Se já existe compra de mesmo valor, de OUTRO app, nos últimos 10 min e com nome parecido,
 * é a mesma compra. (Dois apps iguais seguidos não entram aqui: esses são tratados pelo hash de 2 min.)
 */
function compraJaRegistrada(r) {
  if (!['compra_cartao', 'compra_credito', 'debito'].includes(r.tipo)) return null;
  const desde = agoraLocal(new Date(agora().getTime() - 10 * 60 * 1000)).iso;
  const candidatas = db().prepare(`SELECT * FROM transacoes WHERE valor = ? AND tipo IN ('compra_cartao','compra_credito','debito')
    AND COALESCE(origem_app,'') != ? AND data >= ? ORDER BY id DESC`).all(r.valor, r.app, desde);
  return candidatas.find((t) => !r.contraparte || !t.contraparte
    || contas.similaridade(t.contraparte, r.contraparte) >= 0.5
    || contas.similaridade(r.contraparte, t.contraparte) >= 0.5) || null;
}

async function perguntar(texto, dadosPergunta) {
  const msgId = await enviar(texto);
  perguntas.criar({ ...dadosPergunta, msgId });
}

export async function processarNotificacao(body, { agoraMs = Date.now() } = {}) {
  const n = { app: limpar(body?.app, 200), titulo: limpar(body?.titulo), texto: limpar(body?.texto) };
  if (!n.app || (!n.titulo && !n.texto)) return { status: 'invalida' };

  const hash = hashNotificacao(n);
  if (jaVista(hash, agoraMs)) {
    log.debug('Notificação duplicada descartada.');
    return { status: 'duplicada' };
  }

  const r = await interpretarNotificacao(n);
  if (r.ignorar) {
    log.info(`Notificação ignorada (${r.motivo}).`);   // sem o texto, por privacidade
    if (r.motivo === 'recusada') return avisarRecusa(r, agoraMs);
    if (['app_desconhecido', 'regex_falhou'].includes(r.motivo) && /R\$\s*\d/.test(`${n.titulo} ${n.texto}`)) {
      capturas.salvar({ app: n.app, titulo: n.titulo, texto: n.texto, motivo: r.motivo }, agoraMs);
    }
    return { status: 'ignorada', motivo: r.motivo };
  }
  // o regex não pegou, mas o Gemini entendeu: registra e guarda p/ aprendermos o padrão
  if (r.via === 'ia') capturas.salvar({ app: n.app, titulo: n.titulo, texto: n.texto, motivo: 'so_ia' }, agoraMs);
  log.info(`Notificação: ${r.tipo} ${fmtBRL(r.valor)} via ${r.via} (${r.app})`);

  let dataIso = null;
  const repetida = compraJaRegistrada(r);
  if (repetida && repetida.tipo === 'compra_cartao' && r.tipo !== 'compra_cartao') {
    // Chegou o aviso do banco dizendo se foi débito ou crédito: ele substitui o rascunho (sem tipo) da Carteira.
    log.info(`Compra da ${repetida.origem_app} confirmada como ${r.tipo} pelo ${r.app}.`);
    if ((repetida.contraparte || '').length > (r.contraparte || '').length) r.contraparte = repetida.contraparte;
    dataIso = repetida.data;
    db().prepare(`UPDATE perguntas_pendentes SET status = 'expirada' WHERE tipo = 'forma' AND transacao_id = ? AND status = 'aberta'`).run(repetida.id);
    tx.apagar(repetida.id);
  } else if (repetida) {
    if (r.contraparte && r.contraparte.length > (repetida.contraparte || '').length) tx.atualizar(repetida.id, { contraparte: r.contraparte });
    log.info(`Compra já registrada por outro app (${repetida.origem_app}); descartada.`);
    return { status: 'duplicada_entre_apps', id: repetida.id };
  }

  return tratarInterpretada(r, { hash, agoraMs, dataIso });
}

/** Registra uma notificação já entendida (também usada quando o dono responde "débito" ou "crédito"). */
export async function tratarInterpretada(r, { hash = null, agoraMs = agora().getTime(), dataIso = null } = {}) {
  const hoje = agoraLocal(new Date(agoraMs));
  const cartao = r.tipo === 'compra_credito' ? (r.cartao ?? cartoes.cartaoDoApp(r.app)) : null;
  const base = { tipo: r.tipo, valor: r.valor, contraparte: r.contraparte, origemApp: r.app, hash, dataIso, cartao };

  // ------------------------------------------------------------- entradas
  if (tx.ehEntrada(r.tipo)) {
    const semOrigem = !r.contraparte;
    const id = tx.registrar({ ...base, categoria: 'entrada', status: semOrigem ? 'pendente' : 'ok' });
    if (semOrigem) {
      const texto = `Entrou ${fmtBRL(r.valor)} aqui, mas não vi de quem. De onde veio?`;
      await perguntar(texto, { tipo: 'origem', transacaoId: id });
      return { status: 'registrada', id, mensagem: texto, pergunta: 'origem' };
    }
    const fallback = sorteia([
      `Entrou ${fmtBRL(r.valor)} de ${r.contraparte}! Bem-vindo, dinheirinho 🤑`,
      `Chegaram ${fmtBRL(r.valor)} de ${r.contraparte}! Pode entrar, a casa é sua 🏠💰`,
      `Ding! ${fmtBRL(r.valor)} de ${r.contraparte} no pedaço 🤑`,
    ]);
    const msg = await ia.voz({
      situacao: 'Acabou de entrar dinheiro (Pix/transferência recebida). Comemore com humor.',
      valores: { valor: r.valor }, obrigatorios: ['valor'], extras: { de_quem: r.contraparte }, fallback,
    });
    await enviar(msg);
    return { status: 'registrada', id, mensagem: msg };
  }

  // ------------------------- compra que pode ser débito ou crédito (ainda não sei): fica de rascunho
  if (r.tipo === 'compra_cartao' && ['Google Carteira', 'Nubank'].includes(r.app)) {
    const id = tx.registrar({ ...base, status: 'pendente' });
    return { status: 'registrada', id, aguardando: 'forma' };
  }

  // --------------------------------------------- saídas: baixa de conta fixa
  const casou = contas.casarComConta({ contraparte: r.contraparte, valor: r.valor }, hoje);

  if (casou?.nivel === 'forte') {
    const p = casou.pagamento;
    const id = tx.registrar({ ...base, categoria: 'contas', descricao: p.nome, status: 'ok' });
    contas.marcarPaga(p.id, { valor: r.valor, dataIso: hoje.iso, transacaoId: id });
    const texto = `Parece que a conta *${p.nome}* foi paga (${fmtBRL(r.valor)}), marquei aqui. Certo? (responde *sim* ou *não*)`;
    await perguntar(texto, { tipo: 'baixa_feita', transacaoId: id, pagamentoId: p.id });
    return { status: 'registrada', id, baixa: 'automatica', mensagem: texto };
  }

  if (casou?.nivel === 'incerto') {
    const p = casou.pagamento;
    const id = tx.registrar({ ...base, status: 'pendente' });
    const quem = r.contraparte ? ` pra ${r.contraparte}` : '';
    const texto = `Vi ${['compra_cartao', 'compra_credito', 'debito'].includes(r.tipo) ? 'uma compra' : `um ${ROTULO[r.tipo]}`} de ${fmtBRL(r.valor)}${quem}. Isso é a conta *${p.nome}* (${fmtBRL(p.valor_previsto)})? (*sim* ou *não*)`;
    await perguntar(texto, { tipo: 'baixa_incerta', transacaoId: id, pagamentoId: p.id });
    return { status: 'registrada', id, baixa: 'incerta', mensagem: texto };
  }

  // ----------------------------------------------- saídas: Pix/boleto => pergunta
  if (['pix_enviado', 'transferencia_enviada', 'boleto'].includes(r.tipo)) {
    const id = tx.registrar({ ...base, status: 'pendente' });
    const quem = r.contraparte ? ` pra ${r.contraparte}` : '';
    const texto = `Vi ${r.tipo === 'boleto' ? 'um pagamento de boleto' : `um ${ROTULO[r.tipo]}`} de ${fmtBRL(r.valor)}${quem}. Foi pra quê? (ou *pula*)`;
    await perguntar(texto, { tipo: 'categoria', transacaoId: id });
    return { status: 'registrada', id, pergunta: 'categoria', mensagem: texto };
  }

  // ------------------------------------- saídas: cartão/débito => categoriza sozinho
  const cat = await decidirCategoria(r.contraparte || '');
  if (!r.contraparte || cat.confianca < 0.6) {
    const id = tx.registrar({ ...base, status: 'pendente' });
    const onde = r.contraparte ? ` em ${r.contraparte}` : '';
    const texto = `Gastei ${fmtBRL(r.valor)}${onde}, mas não sei em que categoria encaixar. Que categoria é? (ou *pula*)`;
    await perguntar(texto, { tipo: 'categoria', transacaoId: id });
    return { status: 'registrada', id, pergunta: 'categoria', mensagem: texto };
  }

  const id = tx.registrar({ ...base, categoria: cat.categoria, status: 'ok' });
  const credito = r.tipo === 'compra_credito';
  const msg = credito
    ? await avisoCredito({ valor: r.valor, onde: r.contraparte, categoria: cat.categoria, cartaoChave: cartao })
    : await avisoGasto({ valor: r.valor, onde: r.contraparte, categoria: cat.categoria, hoje });
  const alertas = [tx.verificarOrcamento(cat.categoria, hoje.ano, hoje.mes), credito && cartao ? cartoes.verificarLimite(cartao, hoje) : null].filter(Boolean);
  await enviar(alertas.length ? `${msg}\n\n${alertas.join('\n\n')}` : msg);
  return { status: 'registrada', id, categoria: cat.categoria, mensagem: msg, alerta: alertas[0] ?? null };
}

/** Compra recusada: não registra gasto, só avisa (uma vez, mesmo que banco e Carteira avisem). */
async function avisarRecusa(r, agoraMs) {
  if (!r.valor) return { status: 'ignorada', motivo: 'recusada' };
  const chave = `${r.valor}`;
  const [v, ms] = String(getConfig('ultima_recusa', '0|0')).split('|');
  if (v === chave && agoraMs - Number(ms) < 10 * 60 * 1000) return { status: 'ignorada', motivo: 'recusada' };
  setConfig('ultima_recusa', `${chave}|${agoraMs}`);
  const onde = r.contraparte ? ` em ${r.contraparte}` : '';
  const fallback = `Tentaram passar ${fmtBRL(r.valor)}${onde}, mas o cartão recusou (provavelmente sem limite ou saldo) 😬 Não anotei como gasto.`;
  const msg = await ia.voz({
    situacao: 'Uma compra no cartão foi RECUSADA (provavelmente por falta de limite/saldo). Avise com humor que NÃO foi registrada como gasto.',
    valores: { valor: r.valor }, obrigatorios: ['valor'], extras: { estabelecimento: r.contraparte || '(não informado)' }, fallback,
  });
  await enviar(msg);
  return { status: 'ignorada', motivo: 'recusada', aviso: msg };
}

/** Mensagem "saiu X em Y" na voz do dinheiro (usada também para gastos digitados). */
export async function avisoGasto({ valor, onde, categoria, hoje = agoraLocal() }) {
  const s = calcularSobra(hoje);
  const sa = saldoAtual();
  const valores = { valor };
  if (sa && sa.saldo >= 0) valores.saldo = sa.saldo;
  else if (!sa && s.sobra != null && s.sobra > 0) valores.sobra = s.sobra;
  const sufixo = sa ? ` Saldo agora: *${fmtBRL(sa.saldo)}*.` : valores.sobra ? ` Ainda tenho ${fmtBRL(s.sobra)} pra gente chegar no fim do mês.` : '';
  const lugar = onde ? ` em ${onde}` : '';
  const fallback = sorteia([
    `Saiu ${fmtBRL(valor)}${lugar} (${categoria}). Anotado! 💸${sufixo}`,
    `Lá se foram ${fmtBRL(valor)}${lugar} (${categoria}). Já anotei 💸${sufixo}`,
    `Tchau, ${fmtBRL(valor)}${lugar}! (${categoria}) Foi bom enquanto durou 👋${sufixo}`,
  ]);
  return ia.voz({
    situacao: 'Acabou de sair dinheiro da conta numa compra. Avise com humor sincero; se houver "saldo", diga quanto sobrou na conta agora; se houver "sobra", diga quanto resta pro fim do mês.',
    valores, obrigatorios: ['valor'], extras: { estabelecimento: onde || '(não informado)', categoria }, fallback,
  });
}

/** Compra no crédito: não sai do saldo, só ocupa limite do cartão. */
export async function avisoCredito({ valor, onde, categoria, cartaoChave }) {
  const r = cartaoChave ? cartoes.resumo(cartaoChave) : null;
  const quem = r ? `no crédito do *${r.nome}*` : 'no crédito';
  const dica = r && !r.informouUso ? `\n_(Me diz quanto você já tinha usado: *usado ${r.chave} 450*)_` : '';
  if (!r) return `Passei ${fmtBRL(valor)} ${quem}${onde ? ` (${onde}, ${categoria})` : ''} 💳 Isso não mexe no saldo.`;
  const onde2 = onde ? ` (${onde}, ${categoria})` : '';
  const fallback = sorteia([
    `Passei ${fmtBRL(valor)} ${quem}${onde2} 💳 Não mexe no saldo, mas já usei ${fmtBRL(r.usado)} de ${fmtBRL(r.limite)}: restam *${fmtBRL(r.disponivel)}*.`,
    `Passei o cartão: ${fmtBRL(valor)} ${quem}${onde2} 💳 O saldo respira aliviado, mas o limite já está em ${fmtBRL(r.usado)} de ${fmtBRL(r.limite)} (restam *${fmtBRL(r.disponivel)}*).`,
  ]);
  const m = await ia.voz({
    situacao: 'Acabou de sair uma compra no CRÉDITO (não sai do saldo da conta; só ocupa o limite do cartão). Avise com humor e diga quanto resta de limite ("disponivel").',
    valores: { valor, usado: r.usado, limite: r.limite, disponivel: r.disponivel }, obrigatorios: ['valor', 'disponivel'],
    extras: { estabelecimento: onde || '(não informado)', categoria, cartao: r.nome }, fallback,
  });
  return `${m}${dica}`;
}

/** Compras da Carteira/Nubank sem saber se foram débito ou crédito: depois de 3 min sem o aviso do banco, pergunta. */
export async function jobFormaPendente(agoraMs = agora().getTime()) {
  const limite = agoraLocal(new Date(agoraMs - 3 * 60 * 1000)).iso;
  const linhas = db().prepare(`SELECT * FROM transacoes WHERE tipo = 'compra_cartao' AND origem_app IN ('Google Carteira','Nubank') AND data <= ?`).all(limite);
  let n = 0;
  for (const t of linhas) {
    const jaPerguntei = db().prepare(`SELECT 1 FROM perguntas_pendentes WHERE tipo = 'forma' AND transacao_id = ?`).get(t.id);
    if (jaPerguntei) continue;
    const onde = t.contraparte ? ` em ${t.contraparte}` : '';
    await perguntar(`Vi uma compra de ${fmtBRL(t.valor)}${onde}, mas não sei se foi no *débito* ou no *crédito* 🤔 Qual foi? (responde *débito* ou *crédito*)`, { tipo: 'forma', transacaoId: t.id });
    n += 1;
  }
  return n;
}

