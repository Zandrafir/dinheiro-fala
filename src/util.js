import { config } from './config.js';

// ---------- Relógio (injetável nos testes) ----------
let relogio = () => new Date();
export function setRelogio(fn) { relogio = fn; }
export function agora() { return relogio(); }

/** Data/hora no fuso do bot: { ano, mes, dia, hora, minuto, dataIso: 'YYYY-MM-DD', iso: 'YYYY-MM-DDTHH:MM:SS' } */
export function agoraLocal(d = agora(), tz = config.tz) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  const dataIso = `${p.year}-${p.month}-${p.day}`;
  return {
    ano: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora: Number(p.hour), minuto: Number(p.minute),
    dataIso, iso: `${dataIso}T${p.hour}:${p.minute}:${p.second}`,
  };
}

export function diasNoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

export function chaveMes(ano, mes) {
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

/** Diferença em dias (b - a) entre duas datas 'YYYY-MM-DD'. */
export function diffDias(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

export function dataIsoDe(ano, mes, dia) {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function fmtDataCurta(dataIso) {
  const [, m, d] = dataIso.split('-');
  return `${d}/${m}`;
}

// ---------- Dinheiro (sempre em centavos) ----------
/** Aceita "1.234,56", "1234,56", "45", "45,5", "45.90", "1.200". Retorna centavos ou null. */
export function parseValor(txt) {
  if (txt == null) return null;
  let s = String(txt).replace(/R\$/gi, '').replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function fmtBRL(centavos) {
  const neg = centavos < 0;
  const abs = Math.abs(Math.round(centavos));
  const reais = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  const milhar = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${milhar},${cents}`;
}

// ---------- Texto ----------
export function semAcento(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '');
}

/** minúsculo, sem acento, só letras/dígitos/espaço. */
export function normalizar(s) {
  return semAcento(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function maiusculaInicial(s) {
  s = String(s ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Esconde CPF, CNPJ, e-mail e números longos (valores em R$ são preservados). */
export function mascarar(s) {
  return String(s ?? '')
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '**.***.***/****-**')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '***.***.***-**')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '***@***')
    .replace(/(?<![\d.,])\d{8,}(?!\d|,\d{2})/g, '********');
}
