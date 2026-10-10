import test from 'node:test';
import assert from 'node:assert/strict';
import { processarNotificacao } from '../src/notificacoes.js';
import { tratarMensagem } from '../src/mensagens.js';
import { db } from '../src/db.js';
import { _setCliente, voz } from '../src/ia.js';
import * as contas from '../src/contas.js';
import { preparar, NU, WALLET } from './helpers.js';

const pixEnviado = (valor, nome) => ({ app: NU, titulo: 'Transferência enviada', texto: `Você enviou uma transferência de R$ ${valor} para ${nome}.` });
const tr = () => db().prepare('SELECT * FROM transacoes ORDER BY id').all();
const msg = (texto, citadoId = null) => tratarMensagem({ texto, citadoId });

test('Pix enviado: pergunta "foi pra quê?" e a próxima resposta vira a categoria', async () => {
  const env = preparar();
  const r = await processarNotificacao(pixEnviado('45,00', 'Maria Silva'));
  assert.equal(r.pergunta, 'categoria');
  assert.match(env[0].texto, /Pix|transferência/);
  assert.match(env[0].texto, /R\$ 45,00/); assert.match(env[0].texto, /Maria Silva/);
  assert.equal(tr()[0].status_categoria, 'pendente');

  const resp = await msg('almoço de domingo');
  assert.match(resp, /Anotado/);
  const t = tr()[0];
  assert.equal(t.status_categoria, 'ok'); assert.equal(t.descricao, 'almoço de domingo'); assert.equal(t.categoria, 'alimentação');
});

test('"pula" encerra a pergunta sem categoria', async () => {
  preparar();
  await processarNotificacao(pixEnviado('10,00', 'Zé'));
  assert.match(await msg('pula'), /sem categoria/);
  assert.equal(tr()[0].status_categoria, 'ignorada');
  assert.match(await msg('pula'), /nenhuma pergunta pendente/);
});

test('várias perguntas: fila FIFO e resposta citada vai para a pergunta certa', async () => {
  const env = preparar();
  await processarNotificacao(pixEnviado('10,00', 'Ana'));
  await processarNotificacao(pixEnviado('20,00', 'Bia'));
  await msg('presente', env[1].id);               // citando a 2ª pergunta
  assert.equal(tr()[1].descricao, 'presente');
  assert.equal(tr()[0].status_categoria, 'pendente');
  await msg('farmácia');                           // sem citar => a mais antiga (1ª)
  assert.equal(tr()[0].descricao, 'farmácia');
  assert.equal(tr()[0].categoria, 'saúde');
});

test('comandos não são engolidos como resposta de pergunta pendente', async () => {
  preparar();
  await processarNotificacao(pixEnviado('10,00', 'Ana'));
  assert.match(await msg('ajuda'), /O que eu sei fazer/);
  assert.match(await msg('gastei 30 no mercado'), /R\$ 30,00/);
  assert.equal(tr()[0].status_categoria, 'pendente');   // continua esperando
});

test('Pix recebido com origem conhecida vira entrada e avisa; sem origem, pergunta', async () => {
  const env = preparar();
  const r = await processarNotificacao({ app: NU, titulo: 'Transferência recebida', texto: 'Você recebeu uma transferência de João Souza no valor de R$ 300,00.' });
  assert.equal(r.status, 'registrada');
  assert.match(env[0].texto, /R\$ 300,00/);
  assert.equal(tr()[0].tipo, 'pix_recebido');
  const r2 = await processarNotificacao({ app: 'com.itau', titulo: 'Pix', texto: 'Você recebeu um Pix de R$ 10,00' });
  // sem "de fulano" o regex não casa => ignorado (na dúvida, ignora)
  assert.equal(r2.status, 'ignorada');
});

test('Carteira Google: categoriza sozinho e avisa sem perguntar', async () => {
  const env = preparar();
  const r = await processarNotificacao({ app: WALLET, titulo: 'R$ 45,90 em PADARIA XYZ', texto: 'Cartão •••• 1234' });
  assert.equal(r.categoria, 'alimentação');
  assert.match(env[0].texto, /R\$ 45,90/);
  assert.equal(db().prepare("SELECT COUNT(*) n FROM perguntas_pendentes").get().n, 0);
});

test('Carteira Google: categoria desconhecida (confiança baixa) => pergunta', async () => {
  const env = preparar();
  const r = await processarNotificacao({ app: WALLET, titulo: 'R$ 99,00 em XPTO COMERCIO LTDA', texto: '' });
  assert.equal(r.pergunta, 'categoria');
  assert.match(env[0].texto, /categoria/);
});

test('Carteira Google com Gemini categorizando', async () => {
  const env = preparar();
  _setCliente({
    json: async () => JSON.stringify({ categoria: 'compras', confianca: 0.9 }),
    texto: async () => 'Saiu R$ 99,00 da gente na XPTO, tá caro hein 😅',
  });
  const r = await processarNotificacao({ app: WALLET, titulo: 'R$ 99,00 em XPTO COMERCIO LTDA', texto: '' });
  assert.equal(r.categoria, 'compras');
  assert.match(env[0].texto, /tá caro/);
  _setCliente(null);
});

test('baixa automática FORTE: nome + valor parecidos => marca paga e pede confirmação', async () => {
  const env = preparar();
  await msg('luz 180 dia 10');
  await processarNotificacao(pixEnviado('185,00', 'LUZ ENERGIA SA'));
  assert.match(env.at(-1).texto, /conta \*luz\* foi paga.*Certo\?/s);
  const p = db().prepare('SELECT * FROM pagamentos_mes').get();
  assert.equal(p.status, 'pago'); assert.equal(p.valor_pago, 18500);
  assert.match(await msg('sim'), /conta fechada/);
});

test('baixa automática: responder "não" desfaz a baixa e pergunta a categoria', async () => {
  const env = preparar();
  await msg('luz 180 dia 10');
  await processarNotificacao(pixEnviado('185,00', 'LUZ ENERGIA SA'));
  await msg('não');
  assert.notEqual(db().prepare('SELECT status FROM pagamentos_mes').get().status, 'pago');   // volta a ficar em aberto
  assert.match(env.at(-1).texto, /foram pra quê/);
  assert.equal(tr()[0].status_categoria, 'pendente');
});

test('baixa INCERTA: valor igual mas nome diferente => pergunta antes de marcar', async () => {
  const env = preparar();
  await msg('aluguel 1200 dia 5');
  await processarNotificacao(pixEnviado('1.200,00', 'JOAO DA SILVA'));
  assert.match(env.at(-1).texto, /é a conta \*aluguel\*/);
  assert.equal(db().prepare('SELECT status FROM pagamentos_mes').get().status, 'pendente');
  assert.match(await msg('sim'), /aluguel.*paga/s);
  assert.equal(db().prepare('SELECT status FROM pagamentos_mes').get().status, 'pago');
});

test('baixa incerta: "não" segue para a pergunta de categoria', async () => {
  const env = preparar();
  await msg('aluguel 1200 dia 5');
  await processarNotificacao(pixEnviado('1.200,00', 'JOAO DA SILVA'));
  assert.equal(await msg('não'), null);
  assert.match(env.at(-1).texto, /não é conta fixa/);
  assert.equal(db().prepare('SELECT status FROM pagamentos_mes').get().status, 'pendente');
});

test('valor muito diferente não dá baixa nem pergunta', async () => {
  const env = preparar();
  await msg('luz 180 dia 10');
  await processarNotificacao(pixEnviado('50,00', 'LUZ DO LAR PADARIA'));
  assert.doesNotMatch(env.at(-1).texto, /é a conta/);
});

test('cadastro: uma linha, várias linhas, formatos e erros', async () => {
  preparar();
  assert.match(await msg('conta fixa: aluguel 1200 dia 5'), /aluguel: R\$ 1\.200,00, todo dia 5/);
  assert.match(await msg('netflix 55,90 dia 20'), /R\$ 55,90/);
  const r = await msg('contas fixas:\nluz 180 dia 10\nágua 90,50 dia 31\nlinha sem sentido');
  assert.match(r, /luz: R\$ 180,00/); assert.match(r, /água: R\$ 90,50, todo dia 31/); assert.match(r, /Não entendi: "linha sem sentido"/);
  assert.equal(contas.listarContas().length, 4);
  assert.match(await msg('minhas contas'), /Total por mês: \*R\$ 1\.526,40\*/);
});

test('editar, remover e "paguei"', async () => {
  preparar();
  await msg('luz 180 dia 10');
  assert.match(await msg('editar luz 200 dia 12'), /R\$ 200,00, todo dia 12/);
  assert.match(await msg('paguei a luz 195'), /paga \(R\$ 195,00\)/);
  assert.match(await msg('paguei luz'), /já está paga/);
  assert.match(await msg('paguei internet'), /Não achei conta/);
  assert.match(await msg('remover luz'), /tirei \*luz\*/);
  assert.equal(contas.listarContas().length, 0);
});

test('"paguei 45 no mercado" é gasto, não conta', async () => {
  preparar();
  await msg('luz 180 dia 10');
  assert.match(await msg('paguei 45 no mercado'), /R\$ 45,00/);
  assert.equal(tr().at(-1).categoria, 'mercado');
  assert.equal(db().prepare('SELECT status FROM pagamentos_mes').get().status, 'pendente');
});

test('conversa livre: gasto, entrada e consultas (números vêm do SQL)', async () => {
  preparar();
  await msg('renda 5000');
  await msg('aluguel 1200 dia 25');
  await msg('gastei 45 no mercado');
  await msg('gastei 100,50 no uber');
  await msg('recebi 300 do João');
  assert.match(await msg('quanto gastei esse mês?'), /R\$ 145,50/);
  const cat = await msg('gastos por categoria');
  assert.match(cat, /mercado: R\$ 45,00/); assert.match(cat, /transporte: R\$ 100,50/);
  assert.match(await msg('últimos gastos'), /uber/i);
  // sobra = renda 5000 - gastos 145,50 - contas abertas 1200 = 3654,50
  assert.match(await msg('quanto sobra?'), /R\$ 3\.654,50/);
  assert.match(await msg('resumo'), /Sobra estimada: \*R\$ 3\.654,50\*/);
});

test('"quanto sobra" sem renda orienta o usuário', async () => {
  preparar();
  assert.match(await msg('quanto sobra?'), /renda 5000/);
});

test('orçamento: avisa aos 80% e aos 100%, uma vez por nível', async () => {
  preparar();
  assert.match(await msg('orçamento mercado 100'), /R\$ 100,00/);
  assert.doesNotMatch(await msg('gastei 50 no mercado'), /orçamento/);
  assert.match(await msg('gastei 35 no mercado'), /85%/);
  assert.doesNotMatch(await msg('gastei 1 no mercado'), /85%|Estourei/);
  assert.match(await msg('gastei 20 no mercado'), /Estourei o orçamento de \*mercado\*/);
  assert.doesNotMatch(await msg('gastei 10 no mercado'), /Estourei/);
  assert.match(await msg('orçamentos'), /mercado: R\$ 116,00 de R\$ 100,00 \(116%\)/);
});

test('Gemini interpreta mensagem livre quando nenhum comando casa', async () => {
  preparar();
  _setCliente({
    json: async () => JSON.stringify({ acao: 'gasto', valor: '28', descricao: 'pizza', categoria: 'alimentação', nome: null }),
    texto: async () => { throw new Error('sem texto'); },
  });
  assert.match(await msg('ontem rolou uma pizza de 28 reais'), /R\$ 28,00/);
  assert.equal(tr()[0].categoria, 'alimentação');
  // valor alucinado => descartado, cai no "não entendi"
  _setCliente({ json: async () => JSON.stringify({ acao: 'gasto', valor: '99', descricao: 'x' }), texto: async () => '' });
  assert.match(await msg('comprei uma coisa por 28 reais ontem'), /não entendi/);
  _setCliente(null);
});

test('voz: número inventado pelo Gemini é rejeitado (usa o texto-padrão)', async () => {
  preparar();
  const base = { situacao: 's', valores: { valor: 4500 }, obrigatorios: ['valor'], fallback: 'PADRAO R$ 45,00' };
  _setCliente({ json: async () => '{}', texto: async () => 'Saiu R$ 99,99 de mim!' });
  assert.equal(await voz(base), 'PADRAO R$ 45,00');
  _setCliente({ json: async () => '{}', texto: async () => 'Saiu algo de mim, nem sei quanto' });   // omitiu o obrigatório
  assert.equal(await voz(base), 'PADRAO R$ 45,00');
  _setCliente({ json: async () => '{}', texto: async () => 'Saiu R$ 45,00 de mim 😅' });
  assert.equal(await voz(base), 'Saiu R$ 45,00 de mim 😅');
  _setCliente({ json: async () => '{}', texto: async () => { throw new Error('429'); } });
  assert.equal(await voz(base), 'PADRAO R$ 45,00');
  _setCliente(null);
});

test('mensagem não entendida e perguntas antigas expiram', async () => {
  preparar();
  assert.match(await msg('blablabla'), /não entendi/);
  await processarNotificacao(pixEnviado('10,00', 'Ana'));
  db().prepare('UPDATE perguntas_pendentes SET criada_ms = criada_ms - ?').run(49 * 3600 * 1000);
  assert.match(await msg('blablabla'), /não entendi/);   // pergunta velha não engole a mensagem
});
