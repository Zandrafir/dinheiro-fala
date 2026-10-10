// Uso: npm run testar-parser [-- --ia] [-- arquivo.json]
// Lê exemplos/notificacoes.json, mostra o que o parser extrai de cada notificação e compara com
// o campo opcional "esperado". Saída com código 1 se alguma expectativa falhar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpretarNotificacao } from '../src/parser.js';
import { iniciarIA, disponivel } from '../src/ia.js';
import { fmtBRL } from '../src/util.js';
import { appPorPacote } from '../config/apps.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const usarIA = args.includes('--ia');
const arquivo = args.find((a) => !a.startsWith('--')) || path.join(raiz, 'exemplos/notificacoes.json');

if (usarIA) {
  const { config } = await import('../src/config.js');
  if (!iniciarIA(config.geminiKey, config.geminiModel)) console.log('⚠️  --ia pedido mas GEMINI_API_KEY não está no .env; seguindo só com regex.\n');
}

const lista = JSON.parse(fs.readFileSync(arquivo, 'utf8')).filter((n) => n.app);
let ok = 0; let falhas = 0; let semEsperado = 0;

for (const n of lista) {
  const r = await interpretarNotificacao(n, { usarIA: usarIA && disponivel() });
  const nomeApp = appPorPacote(n.app)?.nome ?? n.app;
  const obtido = r.ignorar ? { tipo: 'ignorar' } : { tipo: r.tipo, valor: r.valor, contraparte: r.contraparte };
  const resumo = r.ignorar
    ? `IGNORADA (${r.motivo})`
    : `${r.tipo} | ${fmtBRL(r.valor)} | ${r.contraparte ?? '—'} | via ${r.via}`;

  let marca = '•';
  if (n.esperado) {
    const e = n.esperado;
    const bate = e.tipo === obtido.tipo
      && (e.valor === undefined || e.valor === obtido.valor)
      && (e.contraparte === undefined || e.contraparte === obtido.contraparte);
    marca = bate ? '✔' : '✘';
    bate ? ok++ : falhas++;
  } else semEsperado++;

  console.log(`${marca} [${nomeApp}] ${n.titulo}`);
  console.log(`    texto: ${n.texto}`);
  console.log(`    → ${resumo}`);
  if (marca === '✘') console.log(`    esperado: ${JSON.stringify(n.esperado)}`);
}

console.log(`\n${lista.length} notificações: ${ok} ok, ${falhas} divergentes, ${semEsperado} sem "esperado".`);
process.exit(falhas ? 1 : 0);
