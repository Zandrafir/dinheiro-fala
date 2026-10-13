import test from 'node:test';
import assert from 'node:assert/strict';
import { tratarMensagem } from '../src/mensagens.js';
import { saldoAtual } from '../src/saldo.js';
import { db } from '../src/db.js';
import { _setCliente, extrairComprovante } from '../src/ia.js';
import { setRelogio } from '../src/util.js';
import { preparar } from './helpers.js';

const BASE = new Date('2026-10-13T11:00:00Z').getTime();
let agoraMs = BASE;
const avancar = (min) => { agoraMs += min * 60_000; setRelogio(() => new Date(agoraMs)); };
const msg = (texto, extra = {}) => tratarMensagem({ texto, ...extra });
const foto = (conteudo = 'imagem-1') => ({ imagem: { buffer: Buffer.from(conteudo), mimetype: 'image/jpeg' } });
const linhas = () => db().prepare('SELECT * FROM transacoes ORDER BY id').all();

const leitura = (r) => ({ json: async () => '{}', texto: async () => { throw new Error('x'); }, visao: async () => JSON.stringify(r) });
const PIX = { tipo: 'pix_enviado', valor: '45,90', contraparte: 'Maria Silva', data: '2026-10-13', hora: '08:30', confianca: 0.95 };

function iniciar(cliente) {
  agoraMs = BASE;
  const env = preparar('2026-10-13T11:00:00Z');
  _setCliente(cliente);
  return env;
}

test('comprovante de Pix enviado: lê, pergunta, e só anota depois do "sim" (e desconta do saldo)', async () => {
  const env = iniciar(leitura(PIX));
  await msg('saldo 200');
  avancar(30);
  assert.equal(await msg('', foto()), null);                                // a pergunta vai à parte
  assert.match(env.at(-1).texto, /Pix enviado\* de \*R\$ 45,90\* para \*Maria Silva\* em 13\/10 às 08:30/);
  assert.equal(linhas().length, 0);                                         // nada anotado ainda
  await msg('sim');                                                         // anota e pergunta "foi pra quê?"
  const t = linhas()[0];
  assert.equal(t.tipo, 'pix_enviado'); assert.equal(t.valor, 4590); assert.equal(t.contraparte, 'Maria Silva');
  assert.equal(t.origem_app, 'Nubank');
  assert.match(env.at(-1).texto, /Foi pra quê\?/);
  assert.equal(saldoAtual().saldo, 15410);                                  // 200,00 − 45,90 (o comprovante é de 08:30, depois do saldo das 08:00)
  _setCliente(null);
});

test('comprovante: "não" não anota nada; resposta torta insiste', async () => {
  iniciar(leitura(PIX));
  await msg('', foto());
  assert.match(await msg('talvez'), /não entendi/);                         // fora de sim/não é conversa comum; a pergunta continua aberta
  assert.match(await msg('não'), /não anotei/);
  assert.equal(linhas().length, 0);
  _setCliente(null);
});

test('o mesmo comprovante não é anotado duas vezes', async () => {
  iniciar(leitura(PIX));
  await msg('', foto('mesma-imagem'));
  await msg('sim');
  assert.equal(linhas().length, 1);
  assert.match(await msg('', foto('mesma-imagem')), /já anotei/);
  _setCliente(null);
});

test('imagem que não é comprovante, leitura fraca ou IA desligada: respostas claras', async () => {
  iniciar(leitura({ tipo: 'nao_comprovante' }));
  assert.match(await msg('', foto()), /não me parece um comprovante/);
  _setCliente(leitura({ ...PIX, confianca: 0.3 }));
  assert.match(await msg('', foto('b')), /não consegui ler/);
  _setCliente(leitura({ ...PIX, valor: null }));
  assert.match(await msg('', foto('c')), /não consegui ler/);
  _setCliente(null);
  assert.match(await msg('', foto('d')), /IA está desligada/);
});

test('arquivo grande demais é recusado', async () => {
  iniciar(leitura(PIX));
  const r = await tratarMensagem({ texto: '', imagem: { buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mimetype: 'image/jpeg' } });
  assert.match(r, /grande demais/);
  _setCliente(null);
});

test('extrairComprovante valida o JSON: tipo desconhecido e valor absurdo são rejeitados', async () => {
  iniciar(leitura({ ...PIX, tipo: 'qualquer_coisa' }));
  assert.equal(await extrairComprovante({ buffer: Buffer.from('x'), mimetype: 'image/png' }), null);
  _setCliente(leitura({ ...PIX, valor: '9.999.999.999,00' }));
  assert.equal(await extrairComprovante({ buffer: Buffer.from('x'), mimetype: 'image/png' }), null);
  _setCliente(leitura({ ...PIX, data: 'ontem' }));
  const r = await extrairComprovante({ buffer: Buffer.from('x'), mimetype: 'image/png' });
  assert.equal(r.data, null); assert.equal(r.valor, 4590);
  _setCliente(null);
});
