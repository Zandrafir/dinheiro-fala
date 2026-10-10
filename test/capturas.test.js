import test from 'node:test';
import assert from 'node:assert/strict';
import { processarNotificacao } from '../src/notificacoes.js';
import { tratarMensagem } from '../src/mensagens.js';
import { _setCliente } from '../src/ia.js';
import * as capturas from '../src/capturas.js';
import { mascarar } from '../src/util.js';
import { preparar, NU } from './helpers.js';

const msg = (texto) => tratarMensagem({ texto });

test('notificação que o regex não entende fica guardada (mascarada) para aprendermos o padrão', async () => {
  preparar();
  const r = await processarNotificacao({ app: NU, titulo: 'Movimentação', texto: 'Olha só: R$ 33,10 saíram da conta de CPF 123.456.789-09 pra BAR DO ZE' });
  assert.equal(r.motivo, 'regex_falhou');
  assert.equal(capturas.contar(), 1);
  const out = await msg('capturas');
  assert.match(out, /R\$ 33,10/); assert.match(out, /\*\*\*\.\*\*\*\.\*\*\*-\*\*/);
  assert.doesNotMatch(out, /123\.456\.789-09/);
  assert.match(out, /"_nome": "Nubank"/); assert.match(out, /regex_falhou/);
  assert.match(await msg('limpar capturas'), /Apaguei 1/);
  assert.match(await msg('capturas'), /Tudo que chegou eu entendi/);
});

test('app desconhecido com valor também é guardado; sem valor ou duplicado, não', async () => {
  preparar();
  await processarNotificacao({ app: 'com.banco.novo', titulo: 'Pix', texto: 'Você pagou R$ 5,00 para X' });
  await processarNotificacao({ app: 'com.banco.novo', titulo: 'Oi', texto: 'sem valor aqui' });
  assert.equal(capturas.contar(), 1);
  assert.equal(capturas.salvar({ app: 'com.banco.novo', titulo: 'Pix', texto: 'Você pagou R$ 5,00 para X', motivo: 'app_desconhecido' }), false);
});

test('quando só o Gemini entende, registra e guarda o exemplo (so_ia)', async () => {
  preparar();
  _setCliente({ json: async () => JSON.stringify({ tipo: 'pix_enviado', valor: '33,10', contraparte: 'BAR DO ZE', confianca: 0.9 }), texto: async () => { throw new Error('x'); } });
  const r = await processarNotificacao({ app: NU, titulo: 'Movimentação', texto: 'Olha só: R$ 33,10 saíram da conta pra BAR DO ZE' });
  assert.equal(r.status, 'registrada');
  assert.match(await msg('capturas'), /so_ia/);
  _setCliente(null);
});

test('promoção e recusa não entram nas capturas', async () => {
  preparar();
  await processarNotificacao({ app: NU, titulo: 'Ganhe cashback', texto: 'Até R$ 50 de volta, aproveite!' });
  await processarNotificacao({ app: NU, titulo: 'Compra no débito não realizada', texto: 'Sua compra de R$ 10,00 em X não foi concluída.' });
  assert.equal(capturas.contar(), 0);
});

test('mascarar preserva valores em R$ e esconde dados pessoais', () => {
  assert.equal(mascarar('R$ 120000,50 de a@b.com CNPJ 12.345.678/0001-90 chave 11999998888'), 'R$ 120000,50 de ***@*** CNPJ **.***.***/****-** chave ********');
});
