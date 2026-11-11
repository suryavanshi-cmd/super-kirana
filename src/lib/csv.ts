import { formatPaisePlain } from './money';

const cell = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas and quote when needed.
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Amount as a plain decimal for spreadsheets: 12345 paise -> "123.45". */
export const csvMoney = (paise: number): string => formatPaisePlain(paise).replace(/,/g, '');

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['﻿', text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return 'shared'; }
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
    return 'failed';
  }
}
