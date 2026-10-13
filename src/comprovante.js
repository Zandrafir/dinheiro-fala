// Comprovante em foto ou PDF (ex.: Pix enviado pelo Nubank, que não gera notificação).
// O Gemini LÊ a imagem, mas nada é anotado sem o "sim" do dono: leitura de imagem pode errar.
import crypto from 'node:crypto';
import { db, getConfig, setConfig } from './db.js';
import * as ia from './ia.js';
import * as perguntas from './perguntas.js';
import { enviar } from './saida.js';
import { fmtBRL, fmtDataCurta } from './util.js';

export const MAX_BYTES = 5 * 1024 * 1024;

const ROTULO = {
  pix_enviado: 'Pix enviado', pix_recebido: 'Pix recebido', transferencia_enviada: 'transferência enviada',
  transferencia_recebida: 'transferência recebida', boleto: 'pagamento de boleto',
  compra_cartao: 'compra no cartão', debito: 'compra no débito', compra_credito: 'compra no crédito',
};
const PREPOSICAO = { pix_recebido: 'de', transferencia_recebida: 'de', compra_cartao: 'em', debito: 'em', compra_credito: 'em' };

export const NAO_LI = 'Hmm, não consegui ler esse comprovante 😕 Tenta uma foto mais nítida (ou o PDF), ou digita: *gastei 45 pix João*.';

export function hashDaImagem(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Lê o comprovante e pergunta se pode anotar. Retorna texto (resposta imediata) ou null (já mandou a pergunta). */
export async function tratarComprovante({ buffer, mimetype }, legenda = '') {
  if (!buffer?.length) return NAO_LI;
  if (buffer.length > MAX_BYTES) return 'Esse arquivo é grande demais pra eu ler (o limite é 5 MB) 🐘 Manda uma foto menor ou um print.';
  const hash = hashDaImagem(buffer);
  if (db().prepare('SELECT 1 FROM transacoes WHERE hash_notificacao = ?').get(`img:${hash}`)) {
    return 'Esse comprovante eu já anotei 😉';
  }
  if (!ia.disponivel()) return 'Agora eu estou sem a minha "visão" (a IA está desligada) 🙈 Digita pra mim: *gastei 45 pix João*.';

  const r = await ia.extrairComprovante({ buffer, mimetype, legenda });
  if (!r) return NAO_LI;
  if (r.tipo === 'nao_comprovante') return 'Isso não me parece um comprovante de pagamento ou Pix 🤔 Manda o comprovante (foto ou PDF) que eu leio.';

  const quem = r.contraparte ? ` ${PREPOSICAO[r.tipo] ?? 'para'} *${r.contraparte}*` : '';
  const quando = r.data ? ` em ${fmtDataCurta(r.data)}${r.hora ? ` às ${r.hora}` : ''}` : '';
  const texto = `📸 Li um *${ROTULO[r.tipo]}* de *${fmtBRL(r.valor)}*${quem}${quando}.\nPosso anotar? (responde *sim* ou *não*)`;
  const msgId = await enviar(texto);
  const id = perguntas.criar({ tipo: 'comprovante', msgId });
  setConfig(`comprovante_${id}`, JSON.stringify({ ...r, hash }));
  return null;
}

export function lerRascunho(perguntaId) {
  try { return JSON.parse(getConfig(`comprovante_${perguntaId}`) || 'null'); } catch { return null; }
}

/** Data/hora do comprovante no formato das transações ('YYYY-MM-DDTHH:MM:SS'), ou null para "agora". */
export function dataIsoDoComprovante(r) {
  if (!r?.data) return null;
  const hora = /^\d{2}:\d{2}$/.test(r.hora ?? '') ? r.hora : '12:00';
  return `${r.data}T${hora}:00`;
}
