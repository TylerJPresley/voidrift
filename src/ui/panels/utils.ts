/** Truncate a string to max length, adding … if cut. Pad to width. */
export function trunc(str: string, max: number, pad: number): string {
  const t = str.length > max ? str.slice(0, max - 1) + "…" : str;
  return t.padEnd(pad);
}

/** Format a table cell: truncate content to fit within width (includes 1 char right padding). */
export function cell(str: string, width: number): string {
  const max = width - 1;
  const t = str.length > max ? str.slice(0, max - 1) + "…" : str;
  return t.padEnd(width);
}

export function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
