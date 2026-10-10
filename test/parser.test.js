import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { interpretarNotificacao } from '../src/parser.js';
import { parseValor, fmtBRL } from '../src/util.js';
import { _setCliente, valorApareceNoTexto } from '../src/ia.js';
import { NU } from './helpers.js';

test('parseValor / fmtBRL trabalham em centavos', () => {
  assert.equal(parseValor('1.234,56'), 123456);
  assert.equal(parseValor('R$ 45'), 4500);
  assert.equal(parseValor('55,90'), 5590);
  assert.equal(parseValor('1.200'), 120000);
  assert.equal(parseValor('45.90'), 4590);
  assert.equal(parseValor('abc'), null);
  assert.equal(fmtBRL(123456), 'R$ 1.234,56');
  assert.equal(fmtBRL(5), 'R$ 0,05');
});

test('todos os exemplos de exemplos/notificacoes.json batem com o esperado', async () => {
  const lista = JSON.parse(fs.readFileSync(new URL('../exemplos/notificacoes.json', import.meta.url))).filter((n) => n.app);
  assert.ok(lista.length >= 25);
  for (const n of lista) {
    const r = await interpretarNotificacao(n, { usarIA: false });
    const e = n.esperado;
    if (e.tipo === 'ignorar') { assert.ok(r.ignorar, `deveria ignorar: ${n.titulo}`); continue; }
    assert.ok(!r.ignorar, `não deveria ignorar: ${n.titulo} (${r.motivo})`);
    assert.equal(r.tipo, e.tipo, n.titulo);
    assert.equal(r.valor, e.valor, n.titulo);
    if (e.contraparte) assert.equal(r.contraparte, e.contraparte, n.titulo);
  }
});

test('app desconhecido e notificação sem valor são ignorados', async () => {
  assert.equal((await interpretarNotificacao({ app: 'com.outro', titulo: 'x', texto: 'R$ 10,00' })).motivo, 'app_desconhecido');
  assert.equal((await interpretarNotificacao({ app: NU, titulo: 'Oi', texto: 'Tem novidade no app' })).ignorar, true);
});

const texto = { app: NU, titulo: 'Movimentação', texto: 'Olha só: R$ 33,10 saíram da conta pra BAR DO ZE' };

test('fallback Gemini: aceita extração coerente', async () => {
  _setCliente({ json: async () => JSON.stringify({ tipo: 'pix_enviado', valor: '33,10', contraparte: 'BAR DO ZE', confianca: 0.9 }), texto: async () => '' });
  const r = await interpretarNotificacao(texto);
  assert.equal(r.via, 'ia'); assert.equal(r.valor, 3310); assert.equal(r.tipo, 'pix_enviado');
  _setCliente(null);
});

test('fallback Gemini: valor inventado (que não está no texto) é descartado', async () => {
  _setCliente({ json: async () => JSON.stringify({ tipo: 'pix_enviado', valor: '99,00', contraparte: 'BAR DO ZE', confianca: 0.95 }), texto: async () => '' });
  const r = await interpretarNotificacao(texto);
  assert.equal(r.ignorar, true);
  _setCliente(null);
});

test('fallback Gemini: "ignorar" e baixa confiança viram ignoradas', async () => {
  _setCliente({ json: async () => JSON.stringify({ tipo: 'ignorar', valor: null, contraparte: null, confianca: 1 }), texto: async () => '' });
  assert.equal((await interpretarNotificacao(texto)).ignorar, true);
  _setCliente({ json: async () => JSON.stringify({ tipo: 'pix_enviado', valor: '33,10', contraparte: 'X', confianca: 0.3 }), texto: async () => '' });
  assert.equal((await interpretarNotificacao(texto)).ignorar, true);
  _setCliente(null);
});

test('valorApareceNoTexto', () => {
  assert.ok(valorApareceNoTexto(123456, 'pagou R$ 1.234,56 hoje'));
  assert.ok(valorApareceNoTexto(4500, 'gastei 45 no mercado'));
  assert.ok(!valorApareceNoTexto(4500, 'gastei 145 no mercado'));
});
