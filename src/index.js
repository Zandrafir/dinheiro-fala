import { config, validarConfig } from './config.js';
import { log } from './log.js';
import { iniciarDb } from './db.js';
import { iniciarIA } from './ia.js';
import { iniciarWebhook } from './webhook.js';
import { iniciarWhatsApp } from './whatsapp.js';
import { iniciarAgenda, recuperar } from './agenda.js';
import { tratarMensagem } from './mensagens.js';

const erros = validarConfig(config);
if (erros.length) {
  console.error('Configuração inválida:\n - ' + erros.join('\n - ') + '\nEdite o arquivo .env (veja .env.example).');
  process.exit(1);
}

iniciarDb();
if (iniciarIA()) log.info('Gemini ligado.');
else log.warn('GEMINI_API_KEY ausente: sigo só com regex e textos-padrão (sem conversa livre).');

await iniciarWebhook({ port: config.port, token: config.webhookToken });
await iniciarWhatsApp(tratarMensagem);
iniciarAgenda();
setTimeout(() => recuperar().catch((e) => log.erro('Recuperação falhou:', e.message)), 15000);

process.on('unhandledRejection', (e) => log.erro('unhandledRejection:', e?.message ?? e));
process.on('uncaughtException', (e) => log.erro('uncaughtException:', e?.message ?? e));
