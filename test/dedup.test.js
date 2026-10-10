import test from 'node:test';
import assert from 'node:assert/strict';
import { processarNotificacao, hashNotificacao, JANELA_DEDUP_MS } from '../src/notificacoes.js';
import { db } from '../src/db.js';
import { preparar, NU } from './helpers.js';

const notif = { app: NU, titulo: 'Transferência recebida', texto: 'Você recebeu uma transferência de João Souza no valor de R$ 300,00.' };

test('hash é estável e depende de app+título+texto', () => {
  assert.equal(hashNotificacao(notif), hashNotificacao({ ...notif }));
  assert.notEqual(hashNotificacao(notif), hashNotificacao({ ...notif, texto: 'outro' }));
});

test('notificação repetida dentro de 2 minutos é descartada; depois da janela conta de novo', async () => {
  const enviadas = preparar();
  const t0 = Date.now();
  assert.equal((await processarNotificacao(notif, { agoraMs: t0 })).status, 'registrada');
  assert.equal((await processarNotificacao(notif, { agoraMs: t0 + 30_000 })).status, 'duplicada');
  assert.equal((await processarNotificacao(notif, { agoraMs: t0 + JANELA_DEDUP_MS - 1000 })).status, 'duplicada');
  assert.equal((await processarNotificacao(notif, { agoraMs: t0 + JANELA_DEDUP_MS + 1000 })).status, 'registrada');
  assert.equal(db().prepare('SELECT COUNT(*) n FROM transacoes').get().n, 2);
  assert.equal(enviadas.length, 2);
});

test('valores são guardados como inteiros (centavos)', async () => {
  preparar();
  await processarNotificacao(notif);
  const t = db().prepare('SELECT valor FROM transacoes').get();
  assert.equal(t.valor, 30000);
  assert.ok(Number.isInteger(t.valor));
});

test('notificações inválidas e promoções não geram transação', async () => {
  const enviadas = preparar();
  assert.equal((await processarNotificacao({ app: NU })).status, 'invalida');
  assert.equal((await processarNotificacao({ app: NU, titulo: 'Ganhe R$ 50', texto: 'Aproveite nossa oferta!' })).status, 'ignorada');
  assert.equal(enviadas.length, 0);
});

test('mesma compra vinda do Nubank e da Carteira Google conta uma vez só (e fica o nome mais completo)', async () => {
  preparar();
  const nu = { app: NU, titulo: 'Compra no débito aprovada', texto: 'Compra de R$ 20,00 em TERRA DOS DINOSSAUROS' };
  const wallet = { app: 'com.google.android.apps.walletnfcrel', titulo: 'TERRA DOS', texto: 'R$ 20,00 com Nubank Mastercard Gold ••0000' };
  assert.equal((await processarNotificacao(wallet)).status, 'registrada');
  assert.equal((await processarNotificacao(nu)).status, 'duplicada_entre_apps');
  const linhas = db().prepare('SELECT contraparte FROM transacoes').all();
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].contraparte, 'TERRA DOS DINOSSAUROS');
});

test('compras de valores ou lugares diferentes não são confundidas', async () => {
  preparar();
  const nu = (v, l) => ({ app: NU, titulo: 'Compra no débito aprovada', texto: `Compra de R$ ${v} em ${l}` });
  const wallet = { app: 'com.google.android.apps.walletnfcrel', titulo: 'TERRA DOS', texto: 'R$ 20,00 com Nubank Mastercard Gold ••0000' };
  await processarNotificacao(wallet);
  assert.equal((await processarNotificacao(nu('21,00', 'TERRA DOS'))).status, 'registrada');       // valor diferente
  assert.equal((await processarNotificacao(nu('20,00', 'PADARIA XYZ'))).status, 'registrada');     // lugar diferente
  assert.equal(db().prepare('SELECT COUNT(*) n FROM transacoes').get().n, 3);
});

test('compra recusada/não concluída NÃO vira gasto', async () => {
  const enviadas = preparar();
  const r1 = await processarNotificacao({ app: NU, titulo: 'Compra no débito não realizada', texto: 'Sua compra de R$ 10,00 em TERRA DOS não foi concluída, verifique se há saldo suficiente.' });
  const r2 = await processarNotificacao({ app: 'com.google.android.apps.walletnfcrel', titulo: 'TERRA DOS', texto: 'RECUSADA: R$ 10,00 com Nubank Mastercard Gold ••0000' });
  assert.equal(r1.motivo, 'recusada'); assert.equal(r2.motivo, 'recusada');
  assert.equal(db().prepare('SELECT COUNT(*) n FROM transacoes').get().n, 0);   // nunca vira gasto
  assert.equal(enviadas.length, 1);                                               // banco + Carteira = 1 aviso só
  assert.match(enviadas[0].texto, /R\$ 10,00/);
  assert.match(enviadas[0].texto, /TERRA DOS/);
  assert.match(enviadas[0].texto, /recus/i);
});
