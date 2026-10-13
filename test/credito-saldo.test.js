import test from 'node:test';
import assert from 'node:assert/strict';
import { processarNotificacao, jobFormaPendente } from '../src/notificacoes.js';
import { tratarMensagem } from '../src/mensagens.js';
import { jobPerguntaSaldo, saldoAtual } from '../src/saldo.js';
import { reservarChamada, MAX_CHAMADAS_DIA, _setCliente } from '../src/ia.js';
import * as cartoes from '../src/cartoes.js';
import { db } from '../src/db.js';
import { setRelogio, agoraLocal } from '../src/util.js';
import { preparar, NU, WALLET } from './helpers.js';

const MP = 'com.mercadopago.wallet';
const BASE = new Date('2026-10-13T11:00:00Z').getTime();      // terça 08:00 em Brasília
let agoraMs = BASE;
const avancar = (min) => { agoraMs += min * 60_000; setRelogio(() => new Date(agoraMs)); };
const msg = (texto, citadoId = null) => tratarMensagem({ texto, citadoId });
const notif = (n) => processarNotificacao(n, { agoraMs });
const debito = (v, onde) => ({ app: NU, titulo: 'Compra no débito aprovada', texto: `Compra de R$ ${v} em ${onde}` });
const credito = (v, onde) => ({ app: NU, titulo: 'Compra no crédito aprovada', texto: `Compra de R$ ${v} em ${onde}` });
const linhas = () => db().prepare('SELECT * FROM transacoes ORDER BY id').all();

function iniciar() {
  agoraMs = BASE;
  const env = preparar('2026-10-13T11:00:00Z');
  return env;
}

test('débito desconta do saldo; "saldo" mostra o valor atual', async () => {
  iniciar();
  assert.match(await msg('saldo 200'), /Saldo de hoje: \*R\$ 200,00\*/);
  avancar(10);
  await notif(debito('10,00', 'MERCADO DO ZE'));
  assert.match(await msg('saldo'), /R\$ 190,00/);
  assert.match(await msg('saldo atual'), /R\$ 190,00/);
  assert.match(await msg('quanto tenho?'), /R\$ 190,00/);
});

test('Pix recebido e Pix enviado mexem no saldo; Pix do Mercado Pago não', async () => {
  iniciar();
  await msg('saldo 100');
  avancar(5);
  await notif({ app: NU, titulo: 'Transferência recebida', texto: 'Você recebeu uma transferência de João Souza no valor de R$ 50,00.' });
  await notif({ app: MP, titulo: 'Seu dinheiro já está disponível', texto: 'Você depositou R$ 30 via Pix e o valor já está rendendo na sua conta.' });
  await notif({ app: NU, titulo: 'Transferência enviada', texto: 'Você enviou uma transferência de R$ 20,00 para Maria.' });
  assert.equal(saldoAtual().saldo, 13000);       // 100 + 50 − 20 (o depósito no Mercado Pago não conta)
});

test('compra no crédito NÃO sai do saldo, só ocupa o limite do cartão', async () => {
  iniciar();
  await msg('saldo 200');
  assert.match(await msg('usado nubank 450'), /resta \*R\$ 150,00\*/);
  avancar(5);
  await notif(credito('25,00', 'PADARIA XYZ'));
  assert.equal(saldoAtual().saldo, 20000);
  const r = cartoes.resumo('nubank');
  assert.equal(r.usado, 47500); assert.equal(r.disponivel, 12500);
  assert.match(await msg('limites'), /Nubank[\s\S]*Resta: \*R\$ 125,00\*/);
});

test('NuPay aprovado é crédito e passa de 80% do limite: avisa', async () => {
  const env = iniciar();
  await msg('usado nubank 500');
  avancar(5);
  await notif({ app: '{notification_package}', titulo: '{notification_title}', texto: 'R$ 18,00 em 1x no crédito sem juros com NuPay APROVADO em 99.' });
  const t = linhas().at(-1);
  assert.equal(t.tipo, 'compra_credito'); assert.equal(t.cartao, 'nubank'); assert.equal(t.valor, 1800);
  assert.match(env.at(-1).texto, /Cuidado: já usei 86%/);
});

test('comandos de limite e pagamento de fatura', async () => {
  iniciar();
  assert.match(await msg('limite mercado pago 450'), /limite do \*Mercado Pago\* agora é R\$ 450,00/);
  await msg('saldo 1000');
  await msg('usado nubank 300');
  avancar(5);
  const r = await msg('paguei fatura nubank 100');
  assert.match(r, /Fatura do \*Nubank\* paga/);
  assert.equal(saldoAtual().saldo, 90000);       // pagar fatura sai da conta
  assert.equal(cartoes.resumo('nubank').usado, 20000);
});

test('gasto digitado: débito/dinheiro desconta; "no crédito" não desconta', async () => {
  iniciar();
  await msg('saldo 300');
  avancar(5);
  await msg('gastei 10 no mercado');
  avancar(5);
  assert.match(await msg('gastei 20 no mercado no crédito nubank'), /crédito do \*Nubank\*/);
  assert.equal(saldoAtual().saldo, 29000);
  assert.equal(linhas().at(-1).tipo, 'compra_credito');
  assert.equal(cartoes.resumo('nubank').usado, 2000);
});

test('compra só da Carteira: espera o banco; sem aviso do banco pergunta débito ou crédito', async () => {
  const env = iniciar();
  await msg('saldo 100');
  avancar(1);
  const wallet = { app: WALLET, titulo: 'CAFE NA MEDIDA', texto: 'R$ 10,00 com Nubank Mastercard Gold ••4516' };
  assert.equal((await notif(wallet)).status, 'registrada');
  assert.equal(await jobFormaPendente(agoraMs + 60_000), 0);              // ainda é cedo
  avancar(5);
  assert.equal(await jobFormaPendente(agoraMs), 1);
  assert.match(env.at(-1).texto, /débito\* ou no \*crédito/);
  assert.equal(await jobFormaPendente(agoraMs + 60_000), 0);              // não pergunta duas vezes
  assert.equal(saldoAtual().saldo, 10000);                                // sem saber, não desconta
  assert.match(await msg('responde isso'), /débito\* ou \*crédito/);        // resposta inválida: insiste
  await msg('débito');
  assert.equal(linhas().length, 1); assert.equal(linhas()[0].tipo, 'debito');
  assert.equal(saldoAtual().saldo, 9000);
});

test('compra da Carteira respondida como crédito ocupa o limite do Nubank', async () => {
  iniciar();
  await msg('saldo 100');
  avancar(1);
  await notif({ app: WALLET, titulo: 'CAFE NA MEDIDA', texto: 'R$ 10,00 com Nubank Mastercard Gold ••4516' });
  avancar(5);
  await jobFormaPendente(agoraMs);
  await msg('crédito');
  assert.equal(linhas()[0].tipo, 'compra_credito'); assert.equal(linhas()[0].cartao, 'nubank');
  assert.equal(saldoAtual().saldo, 10000);
  assert.equal(cartoes.resumo('nubank').usado, 1000);
});

test('Carteira primeiro e aviso do banco depois: o banco decide (débito) e só fica 1 lançamento', async () => {
  iniciar();
  await msg('saldo 100');
  avancar(1);
  await notif({ app: WALLET, titulo: 'TERRA DOS', texto: 'R$ 20,00 com Nubank Mastercard Gold ••0000' });
  avancar(1);
  assert.equal((await notif(debito('20,00', 'TERRA DOS DINOSSAUROS'))).status, 'registrada');
  assert.equal(linhas().length, 1);
  assert.equal(linhas()[0].tipo, 'debito'); assert.equal(linhas()[0].contraparte, 'TERRA DOS DINOSSAUROS');
  assert.equal(saldoAtual().saldo, 8000);
});

test('banco primeiro e Carteira depois: continua 1 lançamento', async () => {
  iniciar();
  await msg('saldo 100');
  avancar(1);
  await notif(credito('20,00', 'TERRA DOS'));
  avancar(1);
  assert.equal((await notif({ app: WALLET, titulo: 'TERRA DOS', texto: 'R$ 20,00 com Nubank Mastercard Gold ••0000' })).status, 'duplicada_entre_apps');
  assert.equal(linhas().length, 1); assert.equal(linhas()[0].tipo, 'compra_credito');
});

test('saldo da manhã diferente do esperado: pergunta o motivo e registra a diferença', async () => {
  const env = iniciar();
  await msg('saldo 200');
  avancar(10);
  await notif(debito('10,00', 'MERCADO DO ZE'));                // esperado: 190
  agoraMs += 24 * 3600_000; setRelogio(() => new Date(agoraMs));
  assert.equal(await msg('saldo 150'), null);                   // a conferência vai por mensagens separadas
  assert.match(env.at(-2).texto, /Saldo de hoje: \*R\$ 150,00\*/);
  assert.match(env.at(-1).texto, /esperava \*R\$ 190,00\*.*faltam \*R\$ 40,00\*/s);
  const r = await msg('pix pro joão');
  assert.match(r, /R\$ 40,00/);
  const t = linhas().at(-1);
  assert.equal(t.tipo, 'gasto_manual'); assert.equal(t.valor, 4000); assert.equal(t.fora_saldo, 1);
  assert.equal(saldoAtual().saldo, 15000);                      // o saldo informado continua valendo
});

test('saldo da manhã MAIOR que o esperado vira entrada; igual ao esperado "bate certinho"', async () => {
  const env = iniciar();
  await msg('saldo 100');
  agoraMs += 24 * 3600_000; setRelogio(() => new Date(agoraMs));
  assert.equal(await msg('saldo 130'), null);
  assert.match(env.at(-1).texto, /sobram \*R\$ 30,00\*/);
  assert.match(await msg('pula'), /deixo essa diferença quieta/);
  assert.equal(linhas().length, 0);
  agoraMs += 24 * 3600_000; setRelogio(() => new Date(agoraMs));
  assert.match(await msg('saldo 130'), /Bateu certinho/);
});

test('a pergunta das 8h usa a data do relógio e não incomoda se já informou', async () => {
  const env = iniciar();
  assert.equal(await jobPerguntaSaldo(agoraLocal(), agoraMs), true);
  assert.match(env[0].texto, /Bom dia/);
});

test('teto diário de chamadas ao Gemini', () => {
  iniciar();
  const hoje = agoraLocal();
  for (let i = 0; i < MAX_CHAMADAS_DIA; i++) assert.equal(reservarChamada(hoje), true);
  assert.equal(reservarChamada(hoje), false);
  const amanha = agoraLocal(new Date(agoraMs + 24 * 3600_000));
  assert.equal(reservarChamada(amanha), true);
});

test('perguntar o limite de crédito: geral, por cartão e em frases naturais', async () => {
  iniciar();
  await msg('usado nubank 300');
  for (const frase of ['limites', 'Limite', 'qual meu limite?', 'quanto tenho de limite?', 'quanto resta de crédito', 'meus cartões']) {
    const r = await msg(frase);
    assert.match(r, /Nubank/, frase);
    assert.match(r, /Mercado Pago/, frase);
    assert.match(r, /Resta: \*R\$ 300,00\*/, frase);
  }
  for (const frase of ['limite do nubank', 'quanto tenho de limite no nubank?', 'qual o limite da nubank']) {
    const r = await msg(frase);
    assert.match(r, /Nubank/, frase);
    assert.doesNotMatch(r, /Mercado Pago/, frase);
  }
  assert.match(await msg('limite do mercado pago'), /Mercado Pago[\s\S]*Resta: \*R\$ 400,00\*/);
  assert.match(await msg('limite nubank 700'), /agora é R\$ 700,00/);   // com valor continua sendo para DEFINIR
});

test('corrida: o Nubank espera o Gemini enquanto a Carteira chega; no fim fica UMA compra só', async () => {
  const env = iniciar();
  await msg('saldo 100');
  avancar(1);
  let liberar;
  _setCliente({
    json: () => new Promise((res) => { liberar = () => res(JSON.stringify({ categoria: 'alimentação', confianca: 0.9 })); }),
    texto: async () => { throw new Error('x'); },
  });
  const nubank = notif(debito('14,00', 'ZZXQ KALINKA'));            // fica esperando o Gemini categorizar
  await new Promise((r) => setTimeout(r, 20));
  await notif({ app: WALLET, titulo: 'ZZXQ KALINKA', texto: 'R$ 14,00 com Nubank Mastercard Gold ••4516' });   // chega no meio da espera
  assert.equal(linhas().length, 1);                                  // por enquanto só o rascunho da Carteira
  liberar();
  await nubank;
  const l = linhas();
  assert.equal(l.length, 1); assert.equal(l[0].tipo, 'debito'); assert.equal(l[0].categoria, 'alimentação');
  assert.equal(saldoAtual().saldo, 8600);
  assert.equal(await jobFormaPendente(agoraMs + 10 * 60_000), 0);   // nenhuma pergunta "débito ou crédito" sobrou
  assert.equal(env.filter((e) => /débito\* ou no \*crédito/.test(e.texto)).length, 0);
  _setCliente(null);
});

test('rede de segurança: rascunho repetido de uma compra que o banco já registrou é descartado sem perguntar', async () => {
  const env = iniciar();
  await msg('saldo 100');
  avancar(1);
  db().prepare("INSERT INTO transacoes (data, tipo, valor, contraparte, origem_app, status_categoria) VALUES (?,?,?,?,?,?)").run(agoraLocal().iso, 'compra_cartao', 1400, 'LANCHES', 'Google Carteira', 'pendente');
  db().prepare("INSERT INTO transacoes (data, tipo, valor, contraparte, origem_app, status_categoria, categoria) VALUES (?,?,?,?,?,?,?)").run(agoraLocal().iso, 'debito', 1400, 'LANCHES', 'Nubank', 'ok', 'alimentação');
  avancar(5);
  assert.equal(await jobFormaPendente(agoraMs), 0);
  assert.equal(linhas().length, 1);
  assert.equal(env.filter((e) => /débito\* ou no \*crédito/.test(e.texto)).length, 0);
});
