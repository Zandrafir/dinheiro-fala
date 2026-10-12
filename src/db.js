import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let conexao = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,                       -- horário local 'YYYY-MM-DDTHH:MM:SS'
  tipo TEXT NOT NULL,
  valor INTEGER NOT NULL CHECK (valor > 0), -- centavos
  contraparte TEXT,
  categoria TEXT,
  descricao TEXT,
  origem_app TEXT,
  status_categoria TEXT NOT NULL DEFAULT 'ok' CHECK (status_categoria IN ('ok','pendente','ignorada')),
  hash_notificacao TEXT
);
CREATE INDEX IF NOT EXISTS idx_transacoes_data ON transacoes(data);

CREATE TABLE IF NOT EXISTS contas_fixas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  nome_norm TEXT NOT NULL UNIQUE,
  valor INTEGER NOT NULL CHECK (valor > 0),
  dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  ativa INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pagamentos_mes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conta_id INTEGER NOT NULL REFERENCES contas_fixas(id) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  valor_previsto INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','atrasado')),
  data_pagamento TEXT,
  valor_pago INTEGER,
  transacao_id INTEGER,
  ultimo_aviso TEXT,                        -- 'YYYY-MM-DD' do último lembrete enviado
  UNIQUE (conta_id, ano, mes)
);

CREATE TABLE IF NOT EXISTS orcamentos (
  categoria TEXT PRIMARY KEY,
  limite INTEGER NOT NULL CHECK (limite > 0),
  alerta80 TEXT,                            -- 'YYYY-MM' em que o aviso de 80% já foi dado
  alerta100 TEXT
);

CREATE TABLE IF NOT EXISTS perguntas_pendentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                       -- categoria | origem | baixa_incerta | baixa_feita
  transacao_id INTEGER,
  pagamento_id INTEGER,
  msg_id TEXT,                              -- id da mensagem do bot (para casar com "responder")
  criada_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','respondida','pulada','expirada'))
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS capturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app TEXT NOT NULL,
  titulo TEXT,
  texto TEXT,
  motivo TEXT,                              -- app_desconhecido | regex_falhou | so_ia
  criada_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notificacoes_vistas (
  hash TEXT PRIMARY KEY,
  visto_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saldos_diarios (
  data TEXT PRIMARY KEY,
  valor INTEGER NOT NULL,                   -- centavos; pode ser negativo
  criada_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cartoes (
  chave TEXT PRIMARY KEY,                   -- 'nubank' | 'mercado pago'
  nome TEXT NOT NULL,
  limite INTEGER NOT NULL,                  -- centavos
  usado_base INTEGER NOT NULL DEFAULT 0,    -- quanto já estava usado quando o dono informou
  base_iso TEXT,                            -- 'YYYY-MM-DDTHH:MM:SS' do momento em que informou (NULL = nunca)
  alerta80 TEXT,
  alerta100 TEXT
);
`;

export function iniciarDb(arquivo = config.dbPath) {
  if (conexao) conexao.close();
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(arquivo)), { recursive: true });
  conexao = new Database(arquivo);
  conexao.pragma('journal_mode = WAL');
  conexao.pragma('foreign_keys = ON');
  conexao.exec(SCHEMA);
  migrar(conexao);
  return conexao;
}

// Colunas novas em bancos que já existem (CREATE TABLE IF NOT EXISTS não altera tabelas antigas).
function migrar(c) {
  const colunas = c.prepare('PRAGMA table_info(transacoes)').all().map((x) => x.name);
  if (!colunas.includes('cartao')) c.exec('ALTER TABLE transacoes ADD COLUMN cartao TEXT');
  if (!colunas.includes('fora_saldo')) c.exec('ALTER TABLE transacoes ADD COLUMN fora_saldo INTEGER NOT NULL DEFAULT 0');
  // Limites informados pelo dono em 12/10/2026 (ajustáveis por "limite nubank 600").
  if (c.prepare('SELECT COUNT(*) AS n FROM cartoes').get().n === 0) {
    const ins = c.prepare('INSERT INTO cartoes (chave, nome, limite) VALUES (?, ?, ?)');
    ins.run('nubank', 'Nubank', 60000);
    ins.run('mercado pago', 'Mercado Pago', 40000);
  }
}

export function db() {
  if (!conexao) iniciarDb();
  return conexao;
}

export function fecharDb() {
  if (conexao) conexao.close();
  conexao = null;
}

export function getConfig(chave, padrao = null) {
  const r = db().prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
  return r ? r.valor : padrao;
}

export function setConfig(chave, valor) {
  db().prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
    .run(chave, String(valor));
}
