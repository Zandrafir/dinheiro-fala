// =============================================================================
//  APPS E PADRÕES DE NOTIFICAÇÃO  —  este é o arquivo que você vai ajustar!
// =============================================================================
//  Cada banco tem: nome, pacote Android e uma lista de padrões (regex).
//  Os textos reais variam por app/versão. Rode `npm run testar-parser`
//  com notificações reais em exemplos/notificacoes.json e corrija aqui.
//
//  Como escrever um padrão:  p('tipo', 'texto com {V} e {N}')
//    {V} = valor em R$ (captura o grupo "valor"; aceita 1.234,56 / 45,90 / 45)
//    {N} = contraparte/estabelecimento (grupo "contraparte"; vai até o fim da linha
//          se for o último item do padrão)
//    Espaço no padrão vira \s+ ; letras a,e,i,o,u,c aceitam acento automaticamente
//    (então "voce" casa com "você"); maiúsculas/minúsculas são ignoradas.
//    Você pode usar regex normal: (?:para|pra)  .*?  \b
//
//  Tipos: pix_enviado | pix_recebido | compra_cartao | debito | boleto
//         transferencia_enviada | transferencia_recebida
//
//  O texto analisado é:  titulo + "\n" + texto
//  Padrões do banco rodam primeiro; depois os PADROES_GENERICOS (valem p/ todos).
// =============================================================================

const VALOR = String.raw`R\$\s*(?<valor>\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)`;
const NOME = String.raw`(?<contraparte>[^\n]+?)`;
const FIM = String.raw`\.?\s*(?:\n|$)`;
const ACENTOS = { a: '[aáàâã]', e: '[eéèê]', i: '[iíì]', o: '[oóòôõ]', u: '[uúù]', c: '[cç]' };

export function p(tipo, fonte) {
  let f = fonte.replace(/[aeiouc]/g, (c) => ACENTOS[c]);   // tolerância a acentos
  f = f.replace(/ /g, String.raw`\s+`);
  // Se {N} é o último item (mesmo dentro de um grupo opcional), ele vai até o fim da linha.
  const ultimo = f.lastIndexOf('{N}');
  const ehFinal = ultimo >= 0 && /^[)?]*$/.test(f.slice(ultimo + 3));
  if (ehFinal) f = f.slice(0, ultimo) + NOME + FIM + f.slice(ultimo + 3);
  f = f.replaceAll('{V}', VALOR).replaceAll('{N}', NOME);
  return { tipo, fonte, regex: new RegExp(f, 'is') };
}

// ---------------------------------------------------------------------------
//  Padrões que valem para qualquer app (usados depois dos específicos)
// ---------------------------------------------------------------------------
export const PADROES_GENERICOS = [
  p('boleto', 'pagamento (?:de )?boleto.*?{V}(?:.*?(?:para|favorecido|beneficiario):? {N})?'),
  p('boleto', 'boleto.*?{V}.*?(?:pago|paga|efetuado|realizado)'),
  p('pix_recebido', '(?:voce )?recebeu (?:um |uma )?(?:pix|transferencia)?\\s*(?:de )?{V} (?:de|do|da) {N}'),
  p('pix_recebido', '{N} (?:te )?(?:enviou|transferiu|mandou) (?:um pix de |uma transferencia de )?{V}'),
  p('transferencia_recebida', 'transferencia recebida.*?{V}(?:.*?(?:de|do|da) {N})?'),
  p('pix_enviado', '(?:voce )?(?:enviou|transferiu|mandou) (?:um |uma )?(?:pix|transferencia)?\\s*(?:de )?{V} (?:para|pra|a) {N}'),
  p('pix_enviado', 'pix (?:enviado|realizado)(?: com sucesso)?.*?{V}.*?(?:para|pra|a) {N}'),
  p('transferencia_enviada', 'transferencia (?:enviada|realizada).*?{V}.*?(?:para|pra|a) {N}'),
  p('compra_cartao', 'compra (?:aprovada|realizada|no credito|no cartao)?.*?{V} (?:em|no|na) {N}'),
  p('compra_cartao', 'pagamento (?:aprovado|realizado|no cartao)?.*?{V} (?:em|no|na) {N}'),
  p('debito', 'debito.*?{V}.*?(?:em|no|na) {N}'),
];

// ---------------------------------------------------------------------------
//  Operações que NÃO aconteceram (recusada, negada, estorno...). Têm prioridade sobre
//  qualquer padrão: "Sua compra de R$ 10,00 em X não foi concluída" NÃO é um gasto.
// ---------------------------------------------------------------------------
export const RECUSADAS = [
  /\bn[aã]o\s+(?:foi\s+)?(?:realizad|conclu[ií]d|aprovad|efetuad|autorizad|processad)[ao]/i,
  /\b(?:recusad|negad|cancelad|estornad)[ao]\b/i,
  /\bestorno\b/i,
  /\bsaldo\s+insuficiente\b/i,
  /\bverifique\s+se\s+h[aá]\s+saldo\b/i,
];

// ---------------------------------------------------------------------------
//  Notificações que NÃO são movimentação (só vale se nada acima casar)
// ---------------------------------------------------------------------------
export const IGNORAR = [
  /\b(oferta|promo[cç][aãoõ]+\w*|cupom|ganhe|aproveite|n[aã]o perca|indique|convide|sorteio|pr[eé]-?aprovado|empr[eé]stimo|investimento|rende|rendimento)\b/i,
  /\bcashback\s+dispon[ií]vel/i,
  /\blimite\s+(?:aumentou|liberado|dispon[ií]vel|pr[eé])/i,
  /\b(?:veja|confira|sua|a)\s+fatura\b/i,
  /\bfatura\s+(?:fechou|fechada|dispon[ií]vel|vence|aberta|atual)/i,
  /\b(seguran[cç]a|c[oó]digo|token|senha|login|dispositivo|atualize|atualiza[cç][aã]o|novidade)\b/i,
];

// ---------------------------------------------------------------------------
//  Apps (confirme o pacote no seu aparelho: Configurações > Apps > Info do app)
// ---------------------------------------------------------------------------
export const APPS = [
  {
    nome: 'Nubank',
    pacote: 'com.nu.production',
    padroes: [
      p('pix_enviado', 'transferencia enviada.*?{V}.*?para {N}'),
      p('pix_recebido', 'recebeu uma transferencia de {N} no valor de {V}'),
      p('debito', 'compra no debito aprovada.*?compra de {V} em {N}'),
      p('compra_cartao', 'compra no credito aprovada.*?compra de {V} em {N}'),
      p('compra_cartao', 'compra de {V} aprovada em {N}'),
      p('boleto', 'pagamento.*?{V}.*?boleto.*?efetuado'),
    ],
  },
  {
    nome: 'Itaú',
    pacote: 'com.itau',
    padroes: [
      p('pix_enviado', 'pix de {V} enviado (?:para|a) {N}'),
      p('pix_recebido', 'recebeu um pix de {V} de {N}'),
      p('compra_cartao', 'compra aprovada.*?cartao final \\d{4}:?\\s*{V} em {N}'),
      p('boleto', 'pagamento de boleto de {V} realizado'),
    ],
  },
  {
    nome: 'Bradesco',
    pacote: 'com.bradesco',
    padroes: [
      p('compra_cartao', 'compra aprovada.*?{V}\\s+(?:em )?{N}'),
      p('pix_enviado', 'pix realizado:? {V} (?:para|a) {N}'),
      p('pix_recebido', 'pix recebido:? {V} de {N}'),
    ],
  },
  {
    nome: 'Banco do Brasil',
    pacote: 'br.com.bb.android',
    padroes: [
      p('pix_enviado', 'voce enviou {V} para {N}'),
      p('pix_recebido', 'voce recebeu {V} (?:via pix )?de {N}'),
      p('compra_cartao', 'compra aprovada.*?{V}.*?estabelecimento:? {N}'),
    ],
  },
  {
    nome: 'Caixa',
    pacote: 'br.com.gabba.Caixa',
    padroes: [
      p('compra_cartao', 'valor {V} estabelecimento:? {N}'),
      p('pix_enviado', 'pix de {V} enviado para {N}'),
      p('pix_recebido', 'pix de {V} recebido de {N}'),
    ],
  },
  {
    nome: 'Santander',
    pacote: 'com.santander.app',
    padroes: [
      p('compra_cartao', 'compra aprovada:?\\s*{V}\\s*[-–]\\s*{N}'),
      p('pix_enviado', 'pix enviado:?\\s*{V}\\s*[-–]\\s*(?:para )?{N}'),
      p('pix_recebido', 'pix recebido:?\\s*{V}\\s*[-–]\\s*(?:de )?{N}'),
    ],
  },
  {
    nome: 'Inter',
    pacote: 'br.com.intermedium',
    padroes: [
      p('pix_enviado', 'voce enviou {V} via pix para {N}'),
      p('pix_recebido', 'voce recebeu {V} via pix de {N}'),
      p('compra_cartao', 'compra no (?:credito|debito):?\\s*{V} em {N}'),
    ],
  },
  {
    nome: 'C6 Bank',
    pacote: 'com.c6bank.app',
    padroes: [
      p('compra_cartao', 'compra de {V} aprovada no estabelecimento {N}'),
      p('pix_enviado', 'pix de {V} enviado a {N}'),
      p('pix_recebido', 'pix de {V} recebido de {N}'),
    ],
  },
  {
    nome: 'PicPay',
    pacote: 'com.picpay',
    padroes: [
      p('transferencia_enviada', 'voce pagou {V} (?:para|a) {N}'),
      p('pix_recebido', 'voce recebeu {V} de {N}'),
    ],
  },
  {
    nome: 'Mercado Pago',
    pacote: 'com.mercadopago.wallet',
    padroes: [
      p('transferencia_enviada', 'voce pagou {V} (?:para|a) {N}'),
      p('pix_recebido', 'voce recebeu {V} de {N}'),
      p('pix_enviado', 'voce enviou {V} (?:para|a) {N}'),
    ],
  },
  {
    nome: 'Google Carteira',
    pacote: 'com.google.android.apps.walletnfcrel',
    // Carteira Google: sempre compra no cartão. Título costuma ser "R$ 45,90 em ESTABELECIMENTO".
    padroes: [
      // formato real: título = estabelecimento; texto = "R$ 20,00 com Nubank Mastercard Gold ••1234"
      p('compra_cartao', '^{N}\\n{V} com'),
      p('compra_cartao', '^\\s*{V} (?:em|no|na) {N}'),
      p('compra_cartao', 'pagamento (?:de )?{V} (?:em|no|na) {N}'),
    ],
  },
];

export function appPorPacote(pacote) {
  return APPS.find((a) => a.pacote === pacote) || null;
}
