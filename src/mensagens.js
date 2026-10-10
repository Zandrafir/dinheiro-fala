// Roteador das mensagens que eu mando pelo WhatsApp: comandos, respostas às perguntas do bot
// e conversa livre (Gemini só interpreta; quem executa e calcula é o código).
import { db } from './db.js';
import * as tx from './transacoes.js';
import * as contas from './contas.js';
import * as perguntas from './perguntas.js';
import * as ia from './ia.js';
import { calcularSobra, resumoAtual, nomeMes } from './resumos.js';
import { avisoGasto, decidirCategoria } from './notificacoes.js';
import * as capturas from './capturas.js';
import { enviar } from './saida.js';
import { agoraLocal, parseValor, fmtBRL, fmtDataCurta, normalizar } from './util.js';

const VAL = String.raw`(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const PREP = String.raw`(?:(?:no|na|em|de|do|da|dos|das|com|pra|para|num|numa|n[oa]s?)\s+)?`;

const RE = {
  ajuda: /^(ajuda|help|menu|comandos|\?)$/i,
  resumo: /^resumo$/i,
  capturas: /^(?:capturas|exportar(?:\s+capturas)?|notifica[çc][õo]es\s+n[aã]o\s+entendidas)$/i,
  limparCapturas: /^(?:limpar|apagar)\s+capturas$/i,
  minhasContas: /^(minhas contas|contas fixas|contas|lista de contas|ver contas)$/i,
  paguei: /^paguei\s+(?!(?:r\$\s*)?\d)(.+)$/i,
  editar: new RegExp(String.raw`^editar\s+(?:conta\s+)?(.+?)(?:\s+${VAL})?(?:\s+dia\s+(\d{1,2}))?$`, 'i'),
  remover: /^(?:remover|apagar|excluir|deletar)\s+(?:a\s+)?(?:conta\s+)?(.+)$/i,
  renda: new RegExp(String.raw`^(?:minha\s+)?(?:renda|sal[aá]rio)(?:\s+(?:mensal|[eé]|de|=))*\s*(?:${VAL})?$`, 'i'),
  orcamentoLista: /^or[çc]amentos?$/i,
  orcamentoRemover: /^(?:remover|apagar|excluir)\s+or[çc]amento\s+(.+)$/i,
  orcamento: new RegExp(String.raw`^or[çc]amento\s+(.+?)\s+${VAL}$`, 'i'),
  gasto: new RegExp(String.raw`^(?:gastei|comprei|paguei|saiu|gasto)\s+${VAL}\s*(?:reais|conto|pila|pilas)?\s*${PREP}(.*)$`, 'i'),
  entrada: new RegExp(String.raw`^(?:recebi|entrou|ganhei)\s+${VAL}\s*(?:reais|conto|pila|pilas)?\s*${PREP}(.*)$`, 'i'),
  qGastei: /quanto\s+(?:eu\s+)?(?:j[aá]\s+)?(?:gastei|gastamos|saiu)/i,
  qSobra: /quanto\s+(?:ainda\s+)?(?:sobra|resta|falta|tenho|posso)|^(?:saldo|sobra)\??$/i,
  qCategoria: /(?:gastos?\s+)?por\s+categorias?|^categorias$/i,
  qUltimos: /[uú]ltimos?\s+(?:gastos?|lan[çc]amentos?|movimenta[çc][õo]es?)|^extrato$/i,
};

const SIM = /^(s|sim|isso|certo|ok|exato|aham|uhum|positivo|claro|correto|isso mesmo|sim senhor)$/;
const NAO = /^(n|nao|nope|negativo|errado|errou|nao e|nao foi|de jeito nenhum)$/;
const PULA = /^(pula|pular|ignora|ignorar|deixa|deixa pra la|esquece|nada)$/;

const ehSim = (t) => SIM.test(normalizar(t));
const ehNao = (t) => NAO.test(normalizar(t));

export const TEXTO_AJUDA = `*O que eu sei fazer* 💸
• *gastei 45 no mercado* / *recebi 300 do João*
• *quanto gastei?* · *quanto sobra?* · *gastos por categoria* · *últimos gastos*
• *aluguel 1200 dia 5* (conta fixa; pode mandar várias linhas)
• *minhas contas* · *editar luz 200 dia 12* · *remover luz*
• *paguei luz* (dou baixa na conta)
• *resumo* (contas + movimentação do mês)
• *capturas* (notificações que eu não entendi, pra você mandar ao Claude) · *limpar capturas*
• *renda 5000* (pra eu estimar o que sobra)
• *orçamento mercado 800* · *orçamentos* · *remover orçamento mercado*
Quando eu perguntar "foi pra quê?" sobre um Pix, é só responder (ou *pula*).`;

const NAO_ENTENDI = 'Hmm, não entendi essa 🤔 Manda *ajuda* que eu mostro o que sei fazer.';

// ------------------------------------------------------------------ helpers
async function resolverCategoria(resposta) {
  const n = normalizar(resposta);
  const canon = tx.CATEGORIAS.find((c) => normalizar(c) === n);
  if (canon) return canon;
  const loc = tx.categorizarLocal(resposta);
  if (loc.confianca >= 0.8) return loc.categoria;
  if (ia.disponivel()) {
    const g = await ia.categorizar(resposta);
    if (g && g.confianca >= 0.6) return g.categoria;
  }
  return n && n.split(' ').length <= 2 ? n : 'outros';
}

async function perguntar(texto, dados) {
  const msgId = await enviar(texto);
  perguntas.criar({ ...dados, msgId });
}

function comAlerta(msg, categoria, hoje) {
  const alerta = tx.verificarOrcamento(categoria, hoje.ano, hoje.mes);
  return alerta ? `${msg}\n\n${alerta}` : msg;
}

// ----------------------------------------------------------------- ações
async function registrarGasto({ valor, descricao, categoria = null }, hoje) {
  const desc = (descricao || '').trim();
  if (!desc && !categoria) {
    const id = tx.registrar({ tipo: 'gasto_manual', valor, status: 'pendente' });
    const texto = `Anotei ${fmtBRL(valor)} de gasto. Foi em quê? (ou *pula*)`;
    await perguntar(texto, { tipo: 'categoria', transacaoId: id });
    return null;
  }
  // gasto que parece uma conta fixa (ex.: "gastei 180 na luz") dá baixa sozinho
  const casou = contas.casarComConta({ contraparte: desc, valor }, hoje);
  if (casou?.nivel === 'forte') {
    const p = casou.pagamento;
    const id = tx.registrar({ tipo: 'gasto_manual', valor, contraparte: desc, categoria: 'contas', descricao: p.nome });
    contas.marcarPaga(p.id, { valor, dataIso: hoje.iso, transacaoId: id });
    return `Anotei ${fmtBRL(valor)} e já dei baixa na conta *${p.nome}* ✅`;
  }
  const cat = categoria || (await resolverCategoria(desc));
  tx.registrar({ tipo: 'gasto_manual', valor, contraparte: desc || null, categoria: cat, descricao: desc || null });
  return comAlerta(await avisoGasto({ valor, onde: desc, categoria: cat, hoje }), cat, hoje);
}

async function registrarEntrada({ valor, descricao }) {
  const de = (descricao || '').trim();
  tx.registrar({ tipo: 'entrada_manual', valor, contraparte: de || null, categoria: 'entrada', descricao: de || null });
  const fallback = `Entrou ${fmtBRL(valor)}${de ? ` de ${de}` : ''}! Gostei 🤑`;
  return ia.voz({
    situacao: 'O dono avisou que recebeu dinheiro. Comemore com humor.',
    valores: { valor }, obrigatorios: ['valor'], extras: { de_quem: de || '(não informado)' }, fallback,
  });
}

function textoGastosMes(hoje) {
  const { entradas, saidas } = tx.totaisMes(hoje.ano, hoje.mes);
  return ia.voz({
    situacao: `Resposta a "quanto gastei neste mês de ${nomeMes(hoje.mes)}?". Informe o total que saiu e, se for relevante, o que entrou.`,
    valores: { saidas, entradas }, obrigatorios: ['saidas'],
    fallback: `Em ${nomeMes(hoje.mes)} já saíram *${fmtBRL(saidas)}* de mim e entraram ${fmtBRL(entradas)}.`,
  });
}

function textoSobra(hoje) {
  const s = calcularSobra(hoje);
  if (s.sobra == null) {
    return 'Não sei de onde partir: me diz sua renda com *renda 5000* (ou registre entradas) que eu calculo o que sobra.';
  }
  const origem = s.baseTipo === 'renda' ? 'renda informada' : 'entradas do mês';
  const detalhe = `(${origem} ${fmtBRL(s.base)} − gastos ${fmtBRL(s.saidas)} − contas ainda abertas ${fmtBRL(s.pendentes)})`;
  const fallback = s.sobra >= 0
    ? `Sobram *${fmtBRL(s.sobra)}* pra gente chegar no fim do mês.\n${detalhe}`
    : `Tô no vermelho: faltam *${fmtBRL(-s.sobra)}* pra fechar o mês 😬\n${detalhe}`;
  return ia.voz({
    situacao: s.sobra >= 0 ? 'Quanto ainda sobra no mês (valor "valor").' : 'O mês está no vermelho: valor "valor" é quanto FALTA.',
    valores: { valor: Math.abs(s.sobra) }, obrigatorios: ['valor'], fallback,
  }).then((m) => (m === fallback ? m : `${m}\n${detalhe}`));
}

function textoPorCategoria(hoje) {
  const linhas = tx.porCategoria(hoje.ano, hoje.mes);
  if (!linhas.length) return `Ainda não gastei nada em ${nomeMes(hoje.mes)} 🙌`;
  const total = linhas.reduce((s, l) => s + l.total, 0);
  return `*Gastos de ${nomeMes(hoje.mes)} por categoria*\n${linhas.map((l) => `• ${l.categoria}: ${fmtBRL(l.total)} (${l.qtd})`).join('\n')}\n\nTotal: *${fmtBRL(total)}*`;
}

function textoUltimos() {
  const l = tx.ultimas(10);
  if (!l.length) return 'Ainda não tenho nenhum gasto registrado.';
  return `*Últimos gastos*\n${l.map((t) => `• ${fmtDataCurta(t.data.slice(0, 10))} — ${t.descricao || t.contraparte || t.tipo}: ${fmtBRL(t.valor)}${t.categoria ? ` (${t.categoria})` : ''}`).join('\n')}`;
}

function textoOrcamentos(hoje) {
  const l = tx.listarOrcamentos(hoje.ano, hoje.mes);
  if (!l.length) return 'Sem orçamentos ainda. Ex.: *orçamento mercado 800* e eu aviso aos 80% e aos 100%.';
  return `*Orçamentos de ${nomeMes(hoje.mes)}*\n${l.map((o) => `• ${o.categoria}: ${fmtBRL(o.gasto)} de ${fmtBRL(o.limite)} (${Math.round((o.gasto / o.limite) * 100)}%)`).join('\n')}`;
}

// ------------------------------------------------------------- contas fixas
async function cmdCadastro(texto, hoje) {
  const { contas: lista, erros } = contas.parseCadastro(texto);
  const feitas = lista.map((c) => contas.cadastrarConta(c, hoje));
  const linhas = feitas.map((f) => `• ${f.nome}: ${fmtBRL(f.valor)}, todo dia ${f.dia}${f.acao === 'atualizada' ? ' (atualizada)' : ''}`);
  let msg = feitas.length ? `Anotado ✅ ${feitas.length === 1 ? 'Conta fixa' : 'Contas fixas'}:\n${linhas.join('\n')}` : '';
  if (erros.length) msg += `${msg ? '\n\n' : ''}Não entendi: ${erros.map((e) => `"${e}"`).join(', ')}.\nUse o formato *nome valor dia N* (ex.: *luz 180 dia 10*).`;
  return msg;
}

function cmdPaguei(resto, hoje) {
  let r = resto.trim().replace(/^(?:a|o|as|os)\s+/i, '').replace(/^conta\s+(?:de\s+|da\s+|do\s+)?/i, '');
  const m = new RegExp(String.raw`^(.+?)(?:\s+${VAL})?$`, 'i').exec(r);
  const nome = m?.[1] ?? r; const valor = m?.[2] ? parseValor(m[2]) : null;
  const conta = contas.buscarConta(nome);
  if (!conta) {
    const todas = contas.listarContas().map((c) => c.nome).join(', ');
    return `Não achei conta chamada "${nome}". ${todas ? `Tenho: ${todas}.` : 'Ainda não tenho nenhuma conta fixa anotada.'}`;
  }
  const p = contas.pagamentoAbertoDaConta(conta.id, hoje);
  if (!p) return `A conta *${conta.nome}* já está paga neste mês 😉`;
  contas.marcarPaga(p.id, { valor: valor ?? undefined, dataIso: hoje.iso });
  const pago = valor ?? p.valor_previsto;
  return `Boa! *${conta.nome}* paga (${fmtBRL(pago)}) ✅ Não cobro mais ela este mês.`;
}

function cmdEditar(m, hoje) {
  const conta = contas.buscarConta(m[1]);
  if (!conta) return `Não achei a conta "${m[1]}". Manda *minhas contas* pra ver a lista.`;
  const valor = m[2] ? parseValor(m[2]) : null; const dia = m[3] ? Number(m[3]) : null;
  if (!valor && !dia) return 'Me diz o que mudar. Ex.: *editar luz 200*, *editar luz dia 12* ou *editar luz 200 dia 12*.';
  if (dia && (dia < 1 || dia > 31)) return 'Dia de vencimento tem que ser de 1 a 31.';
  contas.editarConta(conta.id, { valor, dia }, hoje);
  const novo = contas.listarContas().find((c) => c.id === conta.id);
  return `Atualizado ✅ *${novo.nome}*: ${fmtBRL(novo.valor)}, todo dia ${novo.dia_vencimento}.`;
}

function cmdRemover(nome, hoje) {
  const conta = contas.buscarConta(nome);
  if (!conta) return `Não achei a conta "${nome}". Manda *minhas contas* pra ver a lista.`;
  contas.removerConta(conta.id, hoje);
  return `Pronto, tirei *${conta.nome}* da lista. Não cobro mais 🗑️`;
}

// ------------------------------------------------------- respostas a perguntas
async function responderPergunta(q, texto, hoje) {
  const pula = PULA.test(normalizar(texto));
  const t = q.transacao_id ? tx.obter(q.transacao_id) : null;

  if (q.tipo === 'categoria' || q.tipo === 'origem') {
    if (!t) { perguntas.fechar(q.id, 'expirada'); return 'Essa transação sumiu daqui 🤷'; }
    if (pula) {
      tx.atualizar(t.id, { status: 'ignorada', categoria: t.categoria || (q.tipo === 'origem' ? 'entrada' : 'outros') });
      perguntas.fechar(q.id, 'pulada');
      return 'Beleza, deixei sem categoria 🤐';
    }
    if (q.tipo === 'origem') {
      tx.atualizar(t.id, { descricao: texto.trim(), contraparte: t.contraparte || texto.trim(), status: 'ok' });
      perguntas.fechar(q.id);
      return `Anotado: entrou ${fmtBRL(t.valor)} de ${texto.trim()} 🤑`;
    }
    const cat = await resolverCategoria(texto);
    tx.atualizar(t.id, { descricao: texto.trim(), categoria: cat, status: 'ok' });
    perguntas.fechar(q.id);
    const msg = `Anotado: ${fmtBRL(t.valor)} em *${cat}*${t.contraparte ? ` (${t.contraparte})` : ''} ✅`;
    return comAlerta(msg, cat, hoje);
  }

  if (q.tipo === 'baixa_incerta') {
    if (!t) { perguntas.fechar(q.id, 'expirada'); return 'Essa transação sumiu daqui 🤷'; }
    if (ehSim(texto)) {
      const alvo = pagamentoPorId(q.pagamento_id);
      if (alvo && alvo.status !== 'pago') contas.marcarPaga(alvo.id, { valor: t.valor, dataIso: t.data, transacaoId: t.id });
      tx.atualizar(t.id, { categoria: 'contas', descricao: alvo?.nome ?? null, status: 'ok' });
      perguntas.fechar(q.id);
      return `Fechou! *${alvo?.nome ?? 'A conta'}* marcada como paga ✅`;
    }
    if (ehNao(texto)) {
      perguntas.fechar(q.id);
      if (['compra_cartao', 'debito'].includes(t.tipo)) {
        const cat = await decidirCategoria(t.contraparte || '');
        if (cat.confianca >= 0.6) {
          tx.atualizar(t.id, { categoria: cat.categoria, status: 'ok' });
          return comAlerta(`Ok, então ficou como *${cat.categoria}* ✅`, cat.categoria, hoje);
        }
      }
      await perguntar(`Beleza, não é conta fixa. Então os ${fmtBRL(t.valor)}${t.contraparte ? ` (${t.contraparte})` : ''} foram pra quê? (ou *pula*)`, { tipo: 'categoria', transacaoId: t.id });
      return null;
    }
    return 'Responde só *sim* ou *não* pra eu saber se marco a conta como paga 🙂';
  }

  if (q.tipo === 'baixa_feita') {
    if (ehSim(texto)) { perguntas.fechar(q.id); return 'Show, conta fechada ✅'; }
    if (ehNao(texto)) {
      contas.desfazerPaga(q.pagamento_id);
      perguntas.fechar(q.id);
      if (t) {
        tx.atualizar(t.id, { categoria: null, descricao: null, status: 'pendente' });
        await perguntar(`Ops, desfiz a baixa. Então os ${fmtBRL(t.valor)}${t.contraparte ? ` pra ${t.contraparte}` : ''} foram pra quê? (ou *pula*)`, { tipo: 'categoria', transacaoId: t.id });
        return null;
      }
      return 'Desfeito, a conta voltou a ficar pendente.';
    }
    return 'Responde só *sim* ou *não* pra eu saber se a baixa tá certa 🙂';
  }
  return NAO_ENTENDI;
}

const pagamentoPorId = (id) => db().prepare('SELECT p.*, c.nome FROM pagamentos_mes p JOIN contas_fixas c ON c.id = p.conta_id WHERE p.id = ?').get(id);

// ------------------------------------------------------------ conversa livre
async function executarAcaoIA(a, hoje) {
  switch (a.acao) {
    case 'gasto': return registrarGasto({ valor: a.valor, descricao: a.descricao, categoria: a.categoria }, hoje);
    case 'entrada': return registrarEntrada({ valor: a.valor, descricao: a.descricao });
    case 'consulta_gastos_mes': return textoGastosMes(hoje);
    case 'consulta_sobra': return textoSobra(hoje);
    case 'consulta_por_categoria': return textoPorCategoria(hoje);
    case 'consulta_ultimos': return textoUltimos();
    case 'conta_paga': return a.nome ? cmdPaguei(a.nome, hoje) : NAO_ENTENDI;
    case 'resumo': return resumoAtual(hoje);
    case 'ajuda': return TEXTO_AJUDA;
    default: return NAO_ENTENDI;
  }
}

// -------------------------------------------------------- comandos fixos
/** Retorna string (resposta), null (já respondeu por conta própria) ou undefined (não é comando). */
async function tentarComando(t, hoje) {
  let m;
  if (RE.ajuda.test(t)) return TEXTO_AJUDA;
  if (RE.resumo.test(t)) return resumoAtual(hoje);
  if (RE.limparCapturas.test(t)) return `Apaguei ${capturas.limpar()} captura(s) 🗑️`;
  if (RE.capturas.test(t)) {
    if (!capturas.contar()) return 'Não tenho nenhuma notificação pendente de aprender. Tudo que chegou eu entendi 👌';
    return `Copie o texto abaixo e cole na conversa com o Claude para ele ajustar meus padrões (CPF e números longos já estão escondidos):\n\n${capturas.exportarJson()}\n\nDepois de enviar, mande *limpar capturas*.`;
  }
  if (RE.minhasContas.test(t)) return contas.textoMinhasContas(hoje);
  if (contas.pareceCadastro(t)) return cmdCadastro(t, hoje);
  if ((m = RE.orcamentoRemover.exec(t))) {
    const cat = tx.normalizarCategoria(m[1]);
    return tx.removerOrcamento(cat) ? `Orçamento de *${cat}* removido 🗑️` : `Não tinha orçamento de ${cat}.`;
  }
  if ((m = RE.paguei.exec(t))) return cmdPaguei(m[1], hoje);
  if (RE.orcamentoLista.test(t)) return textoOrcamentos(hoje);
  if ((m = RE.orcamento.exec(t))) {
    const cat = tx.normalizarCategoria(m[1]); const limite = parseValor(m[2]);
    if (!limite) return NAO_ENTENDI;
    tx.definirOrcamento(cat, limite);
    return `Combinado: orçamento de *${cat}* em ${fmtBRL(limite)} por mês. Aviso aos 80% e aos 100% 👀`;
  }
  if ((m = RE.renda.exec(t))) {
    if (!m[1]) {
      const r = tx.getRenda();
      return r == null ? 'Ainda não sei sua renda. Manda *renda 5000*.' : `Sua renda mensal anotada é ${fmtBRL(r)}. Pra mudar: *renda 5500*.`;
    }
    const v = parseValor(m[1]);
    if (!v) return NAO_ENTENDI;
    tx.setRenda(v);
    return `Renda mensal anotada: ${fmtBRL(v)} ✅ Agora consigo estimar o que sobra.`;
  }
  if ((m = RE.editar.exec(t))) return cmdEditar(m, hoje);
  if ((m = RE.remover.exec(t))) return cmdRemover(m[1], hoje);
  if ((m = RE.gasto.exec(t))) return registrarGasto({ valor: parseValor(m[1]), descricao: m[2] }, hoje);
  if ((m = RE.entrada.exec(t))) return registrarEntrada({ valor: parseValor(m[1]), descricao: m[2] });
  if (RE.qGastei.test(t)) return textoGastosMes(hoje);
  if (RE.qSobra.test(t)) return textoSobra(hoje);
  if (RE.qCategoria.test(t)) return textoPorCategoria(hoje);
  if (RE.qUltimos.test(t)) return textoUltimos();
  return undefined;
}

/**
 * Ponto de entrada. Retorna o texto de resposta (ou null se não há nada a enviar agora).
 * `citadoId` = id da mensagem do bot que eu respondi usando "responder" no WhatsApp.
 */
export async function tratarMensagem({ texto, citadoId = null }, { hoje = agoraLocal() } = {}) {
  const t = String(texto ?? '').trim();
  if (!t) return null;

  // 1) resposta citada a uma pergunta do bot vale mais que qualquer comando
  if (citadoId) {
    const q = perguntas.abertas().find((x) => x.msg_id === citadoId);
    if (q) return responderPergunta(q, t, hoje);
  }

  // 2) comandos conhecidos
  const cmd = await tentarComando(t, hoje);
  if (cmd !== undefined) return cmd;

  // 3) "pula/ignora/sim/não" ou texto livre => responde a pergunta mais adequada na fila
  const simNao = ehSim(t) || ehNao(t);
  const pendente = perguntas.escolher({ ehSimNao: simNao, citadoId: null }) ?? null;
  if (pendente) return responderPergunta(pendente, t, hoje);
  if (PULA.test(normalizar(t))) return 'Não tenho nenhuma pergunta pendente 🙂';

  // 4) conversa livre via Gemini
  if (ia.disponivel()) {
    const acao = await ia.interpretar(t);
    if (acao && acao.acao !== 'outro') return executarAcaoIA(acao, hoje);
  }
  return NAO_ENTENDI;
}

