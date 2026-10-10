// "Modo aprender": guarda (mascaradas) as notificações que o parser não conseguiu ler sozinho,
// para o dono mandar depois ao Claude e os padrões em config/apps.js serem ajustados.
import { db } from './db.js';
import { appPorPacote } from '../config/apps.js';
import { mascarar } from './util.js';

const MAX = 100;

export function salvar({ app, titulo, texto, motivo }, agoraMs = Date.now()) {
  const t = mascarar(titulo).slice(0, 300); const x = mascarar(texto).slice(0, 800);
  const ja = db().prepare('SELECT 1 FROM capturas WHERE app = ? AND titulo = ? AND texto = ?').get(app, t, x);
  if (ja) return false;
  db().prepare('INSERT INTO capturas (app, titulo, texto, motivo, criada_ms) VALUES (?,?,?,?,?)').run(app, t, x, motivo, agoraMs);
  db().prepare(`DELETE FROM capturas WHERE id NOT IN (SELECT id FROM capturas ORDER BY id DESC LIMIT ${MAX})`).run();
  return true;
}

export const contar = () => db().prepare('SELECT COUNT(*) n FROM capturas').get().n;
export const limpar = () => db().prepare('DELETE FROM capturas').run().changes;

/** JSON no formato de exemplos/notificacoes.json (as 15 mais recentes, da mais antiga p/ a mais nova). */
export function exportarJson(limite = 15) {
  const linhas = db().prepare('SELECT * FROM capturas ORDER BY id DESC LIMIT ?').all(limite).reverse();
  return JSON.stringify(linhas.map((c) => ({
    _nome: appPorPacote(c.app)?.nome ?? c.app, _motivo: c.motivo, app: c.app, titulo: c.titulo, texto: c.texto,
  })), null, 2);
}
