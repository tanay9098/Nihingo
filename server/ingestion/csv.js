// Minimal RFC-4180 CSV/TSV parser (quotes, escaped quotes, embedded newlines, BOM). No dependencies.

export function detectDelimiter(text) {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let inQ = false;
  for (const ch of first) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseDelimited(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"' && field === '') inQ = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  if (inQ) throw new Error('Unterminated quoted field');
  return rows;
}

/** @returns {{headers:string[], records:{row:number, values:Record<string,string>}[]}} (row is the 1-based file line of the record's first row index) */
export function parseTable(text) {
  const rows = parseDelimited(text);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((cells, i) => ({
    row: i + 2,
    values: Object.fromEntries(headers.map((h, j) => [h, (cells[j] ?? '').trim()])),
  }));
  return { headers, records };
}
