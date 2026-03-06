/**
 * Export formatters for report results — CSV and JSON.
 */

import type { ReportResult } from './engine';

/**
 * Format report result as CSV string.
 */
export function formatCSV(result: ReportResult): string {
  const lines: string[] = [];

  // Header
  lines.push(result.columns.join(','));

  // Data rows
  for (const row of result.rows) {
    const cells = result.columns.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Escape CSV fields containing commas, quotes, or newlines
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(cells.join(','));
  }

  // Summary section
  lines.push('');
  lines.push('Summary');
  for (const [key, value] of Object.entries(result.summary)) {
    lines.push(`${key},${value}`);
  }

  if (result.dateRange) {
    lines.push('');
    lines.push(`Date Range,${result.dateRange.from} to ${result.dateRange.to}`);
  }

  return lines.join('\n');
}

/**
 * Format report result as a JSON export (pretty-printed).
 */
export function formatJSON(result: ReportResult): string {
  return JSON.stringify({
    metric: result.metric,
    columns: result.columns,
    rows: result.rows,
    summary: result.summary,
    dateRange: result.dateRange ?? null,
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

/**
 * Get the content type for a given export format.
 */
export function getContentType(format: string): string {
  switch (format) {
    case 'csv': return 'text/csv';
    case 'json': return 'application/json';
    default: return 'application/octet-stream';
  }
}

/**
 * Get the file extension for a given export format.
 */
export function getFileExtension(format: string): string {
  switch (format) {
    case 'csv': return '.csv';
    case 'json': return '.json';
    default: return '.dat';
  }
}
