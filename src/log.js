// Logger mínimo. NUNCA passe texto de notificação para cá: só tipo, valor e status.
const NIVEIS = { debug: 10, info: 20, warn: 30, erro: 40 };

function nivelAtual() {
  return NIVEIS[process.env.LOG_LEVEL] ?? NIVEIS.info;
}

function escrever(nivel, args) {
  if (NIVEIS[nivel] < nivelAtual()) return;
  const ts = new Date().toISOString();
  const fn = nivel === 'erro' ? console.error : nivel === 'warn' ? console.warn : console.log;
  fn(`[${ts}] [${nivel.toUpperCase()}]`, ...args);
}

export const log = {
  debug: (...a) => escrever('debug', a),
  info: (...a) => escrever('info', a),
  warn: (...a) => escrever('warn', a),
  erro: (...a) => escrever('erro', a),
};
