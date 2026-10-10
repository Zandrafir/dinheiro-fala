import { iniciarDb } from '../src/db.js';
import { setEnviador } from '../src/saida.js';
import { setRelogio } from '../src/util.js';
import { _setCliente } from '../src/ia.js';

/** Banco novo em memória, relógio fixo e WhatsApp falso que guarda o que seria enviado. */
export function preparar(dataIsoUtc = '2026-10-12T15:00:00Z') {
  iniciarDb(':memory:');
  _setCliente(null);
  setRelogio(() => new Date(dataIsoUtc));
  const enviadas = [];
  setEnviador(async (texto) => { const id = `m${enviadas.length + 1}`; enviadas.push({ id, texto }); return id; });
  return enviadas;
}

export const NU = 'com.nu.production';
export const WALLET = 'com.google.android.apps.walletnfcrel';
