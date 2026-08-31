function escapeCsvCell(value: unknown): string {
  let str: string;
  if (value === null || value === undefined) str = '';
  else if (typeof value === 'object') str = JSON.stringify(value);
  else str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
  return str;
}

// Descarga un CSV en el navegador. Incluye BOM UTF-8 para que Excel
// muestre bien tildes/ñ al abrirlo directamente.
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revocar de inmediato corta la descarga en algunos navegadores antes
  // de que alcance a iniciarse.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
