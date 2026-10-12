import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretarNotificacao, resolverPacote, limparVariavel } from '../src/parser.js';

const NU = 'com.nu.production';

test('variável do MacroDroid não substituída vira vazio', () => {
  assert.equal(limparVariavel('{notification_title}'), '');
  assert.equal(limparVariavel('{not_title}'), '');
  assert.equal(limparVariavel('Compra aprovada'), 'Compra aprovada');
});

test('pacote conhecido ou nome do app continuam valendo', () => {
  assert.equal(resolverPacote(NU, '', ''), NU);
  assert.equal(resolverPacote('Nubank', '', ''), NU);
});

test('sem pacote: deduz o app pelo conteúdo (NuPay, Mercado Pago, Carteira)', () => {
  assert.equal(resolverPacote('{notification_package}', '{notification_title}', 'R$ 18,00 em 1x no crédito sem juros com NuPay APROVADO em 99.'), NU);
  assert.equal(resolverPacote('{notification_package}', 'Você pagou R$ 33,40 a Cartão de TODOS', 'O valor vai entrar na próxima fatura do seu Cartão Mercado Pago.'), 'com.mercadopago.wallet');
  assert.equal(resolverPacote('', 'CAFE NA MEDIDA', 'R$ 10,00 com Nubank Mastercard Gold ••4516'), 'com.google.android.apps.walletnfcrel');
  assert.equal(resolverPacote('x', 'Promoção', 'Aproveite'), null);
});

test('NuPay aprovado sem título nem pacote vira compra no cartão', async () => {
  const r = await interpretarNotificacao({ app: '{notification_package}', titulo: '{notification_title}', texto: 'R$ 18,00 em 1x no crédito sem juros com NuPay APROVADO em 99.' }, { usarIA: false });
  assert.equal(r.tipo, 'compra_credito'); assert.equal(r.valor, 1800); assert.equal(r.contraparte, '99');
});

test('NuPay negada sem pacote continua sendo recusada (só avisa)', async () => {
  const r = await interpretarNotificacao({ app: '{notification_package}', titulo: '{notification_title}', texto: 'Compra de R$ 18,00 em 99 NEGADA por falta de limite de crédito.' }, { usarIA: false });
  assert.equal(r.ignorar, true); assert.equal(r.motivo, 'recusada'); assert.equal(r.valor, 1800);
});
