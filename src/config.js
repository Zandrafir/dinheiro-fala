import 'dotenv/config';

export function lerConfig(env = process.env) {
  const modoChat = (env.MODO_CHAT || 'self').toLowerCase();
  return {
    geminiKey: env.GEMINI_API_KEY || '',
    // Lista separada por vírgula: tenta na ordem; cada modelo tem a sua própria cota gratuita.
    geminiModels: env.GEMINI_MODELS || 'gemini-flash-lite-latest,gemini-3.5-flash-lite',
    // Imagem/PDF: os modelos "lite" travam com imagem (testado em 13/10/2026); usa os completos.
    geminiModelosVisao: env.GEMINI_MODELS_VISAO || 'gemini-3.5-flash,gemini-flash-latest',
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
