import test from 'node:test';
import assert from 'node:assert/strict';
import { criarApp } from '../src/webhook.js';
import { preparar } from './helpers.js';

test('webhook: 401 sem token, 400 sem campos, 202 com token e processa em background', async () => {
  preparar();
  const recebidas = [];
  const app = criarApp({ token: 'segredo', processar: async (b) => { recebidas.push(b); } });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const corpo = JSON.stringify({ app: 'com.nu.production', titulo: 't', texto: 'R$ 1,00' });
  const h = (token) => ({ 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) });
  try {
    assert.equal((await fetch(`${base}/notificacao`, { method: 'POST', headers: h(), body: corpo })).status, 401);
    assert.equal((await fetch(`${base}/notificacao`, { method: 'POST', headers: h('errado'), body: corpo })).status, 401);
    assert.equal((await fetch(`${base}/notificacao`, { method: 'POST', headers: h('segredo'), body: '{}' })).status, 400);
    assert.equal((await fetch(`${base}/notificacao`, { method: 'POST', headers: h('segredo'), body: '{quebrado' })).status, 400);
    const ok = await fetch(`${base}/notificacao`, { method: 'POST', headers: h('segredo'), body: corpo });
    assert.equal(ok.status, 202);
    const form = await fetch(`${base}/notificacao`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-token': 'segredo' },
      body: new URLSearchParams({ app: 'a', titulo: 'ele disse "oi"', texto: 'R$ 2,00' }),
    });
    assert.equal(form.status, 202);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(recebidas.length, 2);
    assert.equal(recebidas[1].titulo, 'ele disse "oi"');
    assert.equal((await fetch(`${base}/saude`)).status, 200);
  } finally { server.close(); }
});
