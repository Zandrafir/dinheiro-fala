// Webhook que recebe as notificações do Android (Tasker/MacroDroid).
import express from 'express';
import crypto from 'node:crypto';
import { processarNotificacao } from './notificacoes.js';
import { log } from './log.js';

function tokenValido(recebido, esperado) {
  if (!recebido || !esperado) return false;
  const a = crypto.createHash('sha256').update(String(recebido)).digest();
  const b = crypto.createHash('sha256').update(String(esperado)).digest();
  return crypto.timingSafeEqual(a, b);   // comparação em tempo constante
}

export function criarApp({ token, processar = processarNotificacao }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' })); // aceita formulário (evita quebrar com aspas)

  app.get('/saude', (_req, res) => res.json({ ok: true }));

  app.post('/notificacao', (req, res) => {
    if (!tokenValido(req.get('x-token'), token)) {
      log.warn('Webhook: token inválido.');
      return res.status(401).json({ ok: false, erro: 'token inválido' });
    }
    const { app: pacote, titulo, texto } = req.body || {};
    if (!pacote || (!titulo && !texto)) return res.status(400).json({ ok: false, erro: 'campos app e titulo/texto são obrigatórios' });

    // Responde já (o Android não precisa esperar o Gemini) e processa em segundo plano.
    res.status(202).json({ ok: true });
    Promise.resolve(processar(req.body)).catch((e) => log.erro('Erro ao processar notificação:', e.message));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.type === 'entity.parse.failed' ? 400 : err.status || 500;
    res.status(status).json({ ok: false, erro: status === 400 ? 'corpo inválido (JSON malformado?)' : 'erro interno' });
  });
  return app;
}

export function iniciarWebhook({ port, token }) {
  const app = criarApp({ token });
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      log.info(`Webhook ouvindo na porta ${port} (POST /notificacao).`);
      resolve(server);
    });
  });
}
