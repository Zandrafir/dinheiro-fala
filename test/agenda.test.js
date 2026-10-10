import test from 'node:test';
import assert from 'node:assert/strict';
import { enesimoDiaUtil, ehQuintoDiaUtil, ehDiaUtil, jobResumo5DU, jobResumoDia1, jobLembretes } from '../src/agenda.js';
import { vencimentoNoMes, cadastrarConta, gerarMes, pagamentosDoMes } from '../src/contas.js';
import { agoraLocal } from '../src/util.js';
import { preparar } from './helpers.js';

const local = (iso) => agoraLocal(new Date(iso));

test('5º dia útil considera fins de semana e feriados nacionais', () => {
  assert.equal(enesimoDiaUtil(2026, 10, 5), 7);   // qui 1, sex 2, seg 5, ter 6, qua 7
  assert.equal(enesimoDiaUtil(2026, 11, 5), 9);   // 2/11 (Finados) é feriado: 3,4,5,6,9
  assert.equal(enesimoDiaUtil(2027, 1, 5), 8);    // 1/1 feriado: 4,5,6,7,8
  assert.equal(enesimoDiaUtil(2026, 5, 5), 8);    // 1/5 (Trabalho) é feriado: 4,5,6,7,8
  assert.equal(enesimoDiaUtil(2026, 9, 5), 8);    // 7/9 (Independência) é feriado: 1,2,3,4,8
  assert.equal(enesimoDiaUtil(2026, 4, 5), 8);    // 3/4 (Sexta Santa) é feriado: 1,2,6,7,8
});

test('ehDiaUtil / ehQuintoDiaUtil', () => {
  assert.equal(ehDiaUtil(2026, 10, 3), false);    // sábado
  assert.equal(ehDiaUtil(2026, 10, 12), false);   // feriado (N. Sra. Aparecida)
  assert.equal(ehDiaUtil(2026, 10, 13), true);
  assert.equal(ehQuintoDiaUtil(local('2026-10-07T15:00:00Z')), true);
  assert.equal(ehQuintoDiaUtil(local('2026-10-06T15:00:00Z')), false);
});

test('vencimento dia 31 cai no último dia de meses curtos', () => {
  assert.equal(vencimentoNoMes(2026, 2, 31), 28);
  assert.equal(vencimentoNoMes(2028, 2, 31), 29);   // bissexto
  assert.equal(vencimentoNoMes(2026, 4, 31), 30);
  assert.equal(vencimentoNoMes(2026, 1, 31), 31);
  assert.equal(vencimentoNoMes(2026, 2, 5), 5);
});

test('conta dia 31 aparece com vencimento 28/02 em fevereiro', () => {
  preparar();
  cadastrarConta({ nome: 'Condomínio', valor: 50000, dia: 31 }, { ano: 2026, mes: 2 });
  const [p] = pagamentosDoMes(2026, 2, '2026-02-01');
  assert.equal(p.vencimento, '2026-02-28');
});

test('resumo do 5º dia útil é enviado uma única vez no dia certo', async () => {
  const enviadas = preparar('2026-10-07T12:00:00Z');
  cadastrarConta({ nome: 'Aluguel', valor: 120000, dia: 5 });
  assert.equal(await jobResumo5DU(local('2026-10-06T12:00:00Z')), false);
  assert.equal(await jobResumo5DU(local('2026-10-07T12:00:00Z')), true);
  assert.equal(await jobResumo5DU(local('2026-10-07T12:00:00Z')), false);
  assert.equal(enviadas.length, 1);
  assert.match(enviadas[0].texto, /5º dia útil/);
  assert.match(enviadas[0].texto, /R\$ 1\.200,00/);
});

test('resumo do dia 1 só no dia 1 e traz saldo estimado com renda', async () => {
  const enviadas = preparar('2026-11-01T12:00:00Z');
  const { setRenda } = await import('../src/transacoes.js');
  setRenda(500000);
  cadastrarConta({ nome: 'Luz', valor: 18000, dia: 10 });
  assert.equal(await jobResumoDia1(local('2026-11-02T12:00:00Z')), false);
  assert.equal(await jobResumoDia1(local('2026-11-01T12:00:00Z')), true);
  assert.match(enviadas[0].texto, /Total a pagar: \*R\$ 180,00\*/);
  assert.match(enviadas[0].texto, /R\$ 4\.820,00/);
});

test('lembretes: 3 dias, 1 dia, no dia; paga nunca mais; atrasada a cada 2 dias', async () => {
  const enviadas = preparar('2026-10-01T12:00:00Z');
  const { id } = cadastrarConta({ nome: 'Luz', valor: 18000, dia: 10 });
  gerarMes(2026, 10);
  const dias = {};
  for (const d of ['06', '07', '08', '09', '10', '11', '12', '13', '14', '15']) {
    const antes = enviadas.length;
    await jobLembretes(local(`2026-10-${d}T12:00:00Z`));
    dias[d] = enviadas.length > antes;
  }
  assert.deepEqual(dias, {
    '06': false, '07': true, '08': false, '09': true, '10': true,   // 3d, 1d, dia
    '11': true, '12': false, '13': true, '14': false, '15': true,   // atrasada: dia seguinte e depois a cada 2 dias
  });
  assert.match(enviadas.at(-1).texto, /atrasada/);
  assert.ok(id);
});

test('conta paga nunca mais é cobrada', async () => {
  const enviadas = preparar('2026-10-01T12:00:00Z');
  cadastrarConta({ nome: 'Luz', valor: 18000, dia: 10 });
  const { tratarMensagem } = await import('../src/mensagens.js');
  await tratarMensagem({ texto: 'paguei luz' });
  for (const d of ['07', '09', '10', '11', '13']) await jobLembretes(local(`2026-10-${d}T12:00:00Z`));
  assert.equal(enviadas.length, 0);
});

test('conta atrasada de um mês continua sendo cobrada no mês seguinte', async () => {
  const enviadas = preparar('2026-10-01T12:00:00Z');
  cadastrarConta({ nome: 'Luz', valor: 18000, dia: 10 });
  await jobLembretes(local('2026-11-02T12:00:00Z'));
  assert.equal(enviadas.length, 1);
  assert.match(enviadas[0].texto, /atrasada/);
});
