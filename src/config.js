import 'dotenv/config';

export function lerConfig(env = process.env) {
  const modoChat = (env.MODO_CHAT || 'self').toLowerCase();
  return {
    geminiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || 'gemini-flash-latest',
    webhookToken: env.WEBHOOK_TOKEN || '',
    meuNumero: (env.MEU_NUMERO || '').replace(/\D/g, ''),
    modoChat,
    port: Number(env.PORT) || 3000,
    tz: env.TZ || 'America/Sao_Paulo',
    dbPath: env.DB_PATH || './data/dinheiro.db',
    authDir: env.AUTH_DIR || './auth',
  };
}

export function validarConfig(cfg) {
  const erros = [];
  if (!cfg.meuNumero) erros.push('MEU_NUMERO não definido (ex.: 5511999998888).');
  if (!['self', 'dedicado'].includes(cfg.modoChat)) erros.push('MODO_CHAT deve ser "self" ou "dedicado".');
  if (!cfg.webhookToken || cfg.webhookToken.startsWith('troque-por')) {
    erros.push('WEBHOOK_TOKEN não definido (ou ainda é o valor de exemplo).');
  }
  return erros;
}

export const config = lerConfig();
