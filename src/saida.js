// Ponto único de envio de mensagens ao dono. O whatsapp.js registra o enviador real;
// nos testes registramos um falso. Evita dependência circular entre módulos.
import { log } from './log.js';

let enviador = async (texto) => { log.warn('Nenhum enviador registrado; mensagem descartada.'); return null; };

export function setEnviador(fn) { enviador = fn; }

/** Envia texto ao dono. Retorna o id da mensagem (ou null). */
export async function enviar(texto) {
  try {
    return await enviador(texto);
  } catch (e) {
    log.erro('Falha ao enviar mensagem:', e.message);
    return null;
  }
}
