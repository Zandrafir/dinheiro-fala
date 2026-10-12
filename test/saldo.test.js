import test from 'node:test';
import assert from 'node:assert/strict';
import { jobPerguntaSaldo, jobReperguntaSaldo, saldoDoDia, lerEstado, ESPERA_MS } from '../src/saldo.js';
import { tratarMensagem } from '../src/mensagens.js';
import { cadastrarConta } from '../src/contas.js';
import { agoraLocal } from '../src/util.js';
import { preparar } from './helpers.js';

const T0 = new Date('2026-10-13T11:00:00Z').getTime();   // 08:00 em Brasília (terça, dia útil)
const local = (ms) => agoraLocal(new Date(ms));
const msg = (texto) => tratarMensagem({ texto });

test('pergunta o saldo às 8h uma única vez no dia', async () => {
  const env = preparar('2026-10-13T11:00:00Z');
  assert.equal(await jobPerguntaSaldo(local(T0), T0), true);
  assert.equal(await jobPerguntaSaldo(local(T0 + 60000), T0 + 60000), false);
  assert.equal(env.length, 1);
  assert.match(env[0].texto, /saldo/i);
});

test('não pergunta antes das 8h nem depois das 22h', async () => {
  const env = preparar('2026-10-13T08:00:00Z');
  const cedo = T0 - 2 * 3600 * 1000, tarde = T0 + 15 * 3600 * 1000;
  assert.equal(await jobPerguntaSaldo(local(cedo), cedo), false);
  assert.equal(await jobPerguntaSaldo(local(tarde), tarde), false);
  assert.equal(env.length, 0);
});

test('sem resposta: repergunta após 1h oferecendo "depois"; esgotadas as tentativas, fica quieto', async () => {
  const env = preparar('2026-10-13T11:00:00Z');
  await jobPerguntaSaldo(local(T0), T0);
  assert.equal(await jobReperguntaSaldo(local(T0 + ESPERA_MS - 1000), T0 + ESPERA_MS - 1000), false);   // ainda não deu 1h
  const t1 = T0 + ESPERA_MS;
  assert.equal(await jobReperguntaSaldo(local(t1), t1), true);
  assert.equal(env.length, 2);
  assert.match(env[1].texto, /depois/i);
  const t2 = t1 + ESPERA_MS;
  assert.equal(await jobReperguntaSaldo(local(t2), t2), false);   // 2ª tentativa foi a última
  assert.equal(env.length, 2);
  assert.equal(lerEstado(local(t2)).estado, 'adiada');
});

test('responder só com o valor grava o saldo e mostra o que sobra depois das contas', async () => {
  preparar('2026-10-13T11:00:00Z');
  cadastrarConta({ nome: 'Luz', valor: 18000, dia: 20 });
  await jobPerguntaSaldo(local(T0), T0);
  const r = await msg('R$ 1.234,50');
  assert.match(r, /Saldo de hoje: \*R\$ 1\.234,50\*/);
  assert.match(r, /R\$ 180,00/);
  assert.match(r, /R\$ 1\.054,50/);
  assert.equal(saldoDoDia(agoraLocal()), 123450);
});

test('"depois" para as perguntas do dia, mas o valor ainda pode vir mais tarde', async () => {
  const env = preparar('2026-10-13T11:00:00Z');
  await jobPerguntaSaldo(local(T0), T0);
  assert.match(await msg('depois'), /não pergunto mais hoje/);
  const t1 = T0 + ESPERA_MS;
  assert.equal(await jobReperguntaSaldo(local(t1), t1), false);
  assert.equal(env.length, 1);
  assert.match(await msg('980'), /Saldo de hoje: \*R\$ 980,00\*/);
});

test('"saldo 500" funciona a qualquer hora, inclusive negativo; número solto fora do contexto não vira saldo', async () => {
  const env = preparar('2026-10-13T11:00:00Z');
  assert.notEqual(saldoDoDia(agoraLocal()), 500);
  assert.match(await msg('saldo 500'), /R\$ 500,00/);
  await msg('saldo -50,25');                                     // diferente do esperado: o bot confirma e pergunta o motivo
  assert.match(env.at(-2).texto, /Saldo de hoje: \*-R\$ 50,25\*/);
  assert.equal(saldoDoDia(agoraLocal()), -5025);
  // com o saldo já respondido, um número solto não é capturado como saldo
  assert.doesNotMatch(await msg('300'), /Saldo de hoje/);
});

test('"saldo" sozinho mostra o saldo atual (e "sobra" continua sendo o quanto sobra no mês)', async () => {
  preparar('2026-10-13T11:00:00Z');
  assert.match(await msg('saldo'), /saldo 1234,50/);               // sem saldo informado: ensina a informar
  assert.match(await msg('sobra'), /renda|sobra|Sobram|vermelho/i);
});
