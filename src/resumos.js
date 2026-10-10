// Resumos: todos os números vêm de SQL/JS; o Gemini só escreve o comentário final.
import * as contas from './contas.js';
import * as tx from './transacoes.js';
import * as ia from './ia.js';
import { agoraLocal, fmtBRL, fmtDataCurta, diffDias } from './util.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeMes = (mes) => MESES[mes - 1];

const soma = (lista, f) => lista.reduce((s, x) => s + f(x), 0);

/** Quanto ainda sobra no mês. base = renda informada, ou entradas registradas se não houver renda. */
export function calcularSobra(hoje = agoraLocal()) {
  const renda = tx.getRenda();
  const { entradas, saidas } = tx.totaisMes(hoje.ano, hoje.mes);
  const base = renda ?? (entradas > 0 ? entradas : null);
  const pendentes = soma(contas.emAberto(hoje), (p) => p.valor_previsto);
  return {
    base, baseTipo: renda != null ? 'renda' : base != null ? 'entradas' : null,
    entradas, saidas, pendentes,
    sobra: base != null ? base - saidas - pendentes : null,
  };
}

export async function resumoInicioMes(hoje = agoraLocal()) {
  contas.gerarMes(hoje.ano, hoje.mes);
  const lista = contas.pagamentosDoMes(hoje.ano, hoje.mes, hoje.dataIso);
  const cab = `📅 *Resumo de ${nomeMes(hoje.mes)}/${hoje.ano}*`;
  if (!lista.length) {
    return `${cab}\n\nNão tenho nenhuma conta fixa anotada ainda. Manda assim: *aluguel 1200 dia 5*.`;
  }
  const total = soma(lista, (p) => p.valor_previsto);
  const renda = tx.getRenda();
  const linhas = lista.map((p) => `• ${fmtDataCurta(p.vencimento)} — ${p.nome}: ${fmtBRL(p.valor_previsto)}`);
  let msg = `${cab}\n\n*Contas do mês*\n${linhas.join('\n')}\n\nTotal a pagar: *${fmtBRL(total)}*`;
  if (renda != null) msg += `\nSaldo estimado depois das contas: *${fmtBRL(renda - total)}* (renda ${fmtBRL(renda)})`;
  else msg += `\n(Me diz sua renda com *renda 5000* que eu estimo o saldo.)`;
  const apertado = renda != null && renda - total < renda * 0.2;
  msg += `\n\n${await ia.comentario({
    situacao: 'Início do mês: apresentando as contas a pagar.',
    extras: { quantidade_de_contas: lista.length, situacao_do_saldo: renda == null ? 'renda não informada' : apertado ? 'saldo apertado' : 'saldo confortável' },
    fallback: apertado ? 'O mês começou apertado, mas a gente dá um jeito 😅' : 'Mês novo, contas anotadas. Bora cuidar da gente 💪',
  })}`;
  return msg;
}

function blocoContas(hoje) {
  const doMes = contas.pagamentosDoMes(hoje.ano, hoje.mes, hoje.dataIso);
  const aberto = contas.emAberto(hoje);
  const atrasadas = aberto.filter((p) => p.status_efetivo === 'atrasado');
  const proximos = aberto.filter((p) => p.status_efetivo === 'pendente').slice(0, 5);
  const totalMes = soma(doMes, (p) => (p.status === 'pago' ? p.valor_pago ?? p.valor_previsto : p.valor_previsto));
  const pago = soma(doMes.filter((p) => p.status === 'pago'), (p) => p.valor_pago ?? p.valor_previsto);
  const falta = soma(aberto.filter((p) => p.ano === hoje.ano && p.mes === hoje.mes), (p) => p.valor_previsto);
  return { doMes, atrasadas, proximos, totalMes, pago, falta };
}

function textoBloco(b, hoje) {
  let t = `Total a pagar no mês: *${fmtBRL(b.totalMes)}*\nJá paguei: *${fmtBRL(b.pago)}*\nFalta pagar: *${fmtBRL(b.falta)}*`;
  if (b.atrasadas.length) {
    t += `\n\n🔴 *Atrasadas*\n${b.atrasadas.map((p) => `• ${p.nome}: ${fmtBRL(p.valor_previsto)} (venceu ${fmtDataCurta(p.vencimento)})`).join('\n')}`;
  }
  if (b.proximos.length) {
    t += `\n\n🕒 *Próximos vencimentos*\n${b.proximos.map((p) => {
      const d = diffDias(hoje.dataIso, p.vencimento);
      return `• ${fmtDataCurta(p.vencimento)} — ${p.nome}: ${fmtBRL(p.valor_previsto)} (${d === 0 ? 'hoje' : d === 1 ? 'amanhã' : `em ${d} dias`})`;
    }).join('\n')}`;
  }
  return t;
}

async function comentarioBloco(b, titulo) {
  const temAtraso = b.atrasadas.length > 0;
  return ia.comentario({
    situacao: titulo,
    extras: { contas_atrasadas: b.atrasadas.length, contas_pendentes: b.proximos.length, tudo_pago: b.falta === 0 && b.doMes.length > 0 },
    fallback: temAtraso ? 'Tem conta atrasada me puxando pra baixo… vamos resolver? 😬'
      : b.falta === 0 && b.doMes.length ? 'Tudo pago! Hoje eu durmo tranquilo 😌' : 'Segue o baile, mas de olho nos vencimentos 👀',
  });
}

export async function resumoQuintoDiaUtil(hoje = agoraLocal()) {
  contas.gerarMes(hoje.ano, hoje.mes);
  contas.atualizarAtrasadas(hoje.dataIso);
  const b = blocoContas(hoje);
  const cab = `🗓️ *Resumo do 5º dia útil — ${nomeMes(hoje.mes)}/${hoje.ano}*`;
  if (!b.doMes.length && !b.atrasadas.length) return `${cab}\n\nSem contas fixas cadastradas. Manda *aluguel 1200 dia 5* pra começar.`;
  return `${cab}\n\n${textoBloco(b, hoje)}\n\n${await comentarioBloco(b, 'Quinto dia útil do mês: balanço das contas.')}`;
}

/** Comando "resumo": contas + movimentação do mês. */
export async function resumoAtual(hoje = agoraLocal()) {
  contas.gerarMes(hoje.ano, hoje.mes);
  contas.atualizarAtrasadas(hoje.dataIso);
  const b = blocoContas(hoje);
  const { entradas, saidas } = tx.totaisMes(hoje.ano, hoje.mes);
  const s = calcularSobra(hoje);
  let msg = `📊 *Resumo de ${nomeMes(hoje.mes)}/${hoje.ano}*\n\n`;
  msg += b.doMes.length || b.atrasadas.length ? `${textoBloco(b, hoje)}\n\n` : 'Sem contas fixas cadastradas.\n\n';
  msg += `Entrou: *${fmtBRL(entradas)}*\nSaiu: *${fmtBRL(saidas)}*`;
  if (s.sobra != null) msg += `\nSobra estimada: *${fmtBRL(s.sobra)}* (${s.baseTipo === 'renda' ? 'renda informada' : 'entradas do mês'} − gastos − contas pendentes)`;
  msg += `\n\n${await comentarioBloco(b, 'Resumo sob demanda do mês.')}`;
  return msg;
}
