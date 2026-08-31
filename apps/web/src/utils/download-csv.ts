/**
 * Save a CSV string to the visitor's machine. Shared by the audit log, the
 * ticket list and the reports page (card 1.13) so the download behaves the same
 * everywhere.
 */
export function downloadCsvContent(content: string, fileName: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(url);
}
