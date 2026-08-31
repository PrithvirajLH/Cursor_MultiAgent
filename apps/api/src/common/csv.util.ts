const NEEDS_QUOTING = /[",\r\n]/;
const INJECTION_PREFIXES = ['=', '+', '-', '@'];
const MILLISECONDS_SUFFIX = /\.\d{3}Z$/;

function formatCsvValue(
  value: string | number | Date | null | undefined,
): string {
  if (value == null) {
    return '';
  }
  if (value instanceof Date) {
    // ISO 8601 UTC without milliseconds — unambiguous, and Excel parses it.
    return value.toISOString().replace(MILLISECONDS_SUFFIX, 'Z');
  }
  const raw = String(value);
  // Spreadsheet injection: a cell starting =, +, - or @ is executed as a formula
  // when the file is opened. These files are opened in Excel by definition.
  const guarded = INJECTION_PREFIXES.some((prefix) => raw.startsWith(prefix))
    ? `'${raw}`
    : raw;
  if (!NEEDS_QUOTING.test(guarded)) {
    return guarded;
  }
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * Format one CSV record, newline included. Dates become ISO 8601 UTC, null and
 * undefined become empty cells, values are quoted only when they need it, and a
 * value that would be read as a formula is prefixed with an apostrophe.
 */
export function toCsvRow(
  values: (string | number | Date | null | undefined)[],
): string {
  return `${values.map(formatCsvValue).join(',')}\n`;
}
