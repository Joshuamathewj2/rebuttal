// Grounding guard: before anything is sent to PayPal, every sentence of the
// response is checked against the evidence it cites. Dates, amounts, IDs and
// quoted text must appear in the cited evidence, so the AI cannot slip in a
// fact the seller cannot prove.

const TOKEN_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/g, // dates
  /\$?\d[\d,]*\.\d{2}\b/g, // money
  /\b(?=[A-Z0-9]*\d)[A-Z0-9]{10,}\b/g, // tracking / refund / transaction ids
  /\b\d{2,}\b/g, // other multi-digit numbers (ZIPs, counts)
];

const norm = (s) => s.replace(/[$,]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

export function checkableTokens(text) {
  const found = new Set();
  for (const re of TOKEN_PATTERNS) for (const m of text.matchAll(re)) found.add(norm(m[0]));
  // Drop numbers that are just part of a date or money token already captured.
  const list = [...found];
  return list.filter((t) => !list.some((o) => o !== t && o.includes(t) && /^\d+$/.test(t)));
}

export function quotes(text) {
  return [...text.matchAll(/"([^"]{6,})"/g)].map((m) => norm(m[1]));
}

export function groundResponse(sentences, evidence) {
  const byId = new Map(evidence.map((e) => [e.id, norm(e.facts.join(' \n '))]));
  const results = sentences.map((s) => {
    const issues = [];
    const unknown = s.cites.filter((c) => !byId.has(c));
    if (unknown.length) issues.push(`cites unknown evidence ${unknown.join(', ')}`);
    const corpus = s.cites.filter((c) => byId.has(c)).map((c) => byId.get(c)).join(' \n ');
    const tokens = checkableTokens(s.text);
    const qs = quotes(s.text);
    if (!s.cites.length && (tokens.length || qs.length)) issues.push('states specific facts without citing evidence');
    else {
      for (const t of tokens) if (!corpus.includes(t)) issues.push(`"${t}" is not in the cited evidence`);
      for (const q of qs) if (!corpus.includes(q)) issues.push('quoted text does not match the cited evidence');
    }
    return { ...s, grounded: issues.length === 0, issues };
  });
  const failed = results.filter((r) => !r.grounded).length;
  return { sentences: results, ok: failed === 0, failed, total: results.length };
}
