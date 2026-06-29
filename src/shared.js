// @ts-check
/** Shared tool schema helpers. */

import { apiGet } from './client.js';
import { fetchAll, toCsv } from './paginator.js';

/** @typedef {{ pageNumber?: number, pageSize?: number, select?: string, sortBy?: string, sortOrder?: string, all?: boolean, format?: 'csv' | 'json' }} PaginationArgs */

export const formatParam = {
  format: {
    type: 'string',
    description: 'Output format: "csv" or "json". Default varies by tool — list_* default to json; report_* default to csv.',
    enum: ['csv', 'json'],
  },
};

export const paginationParams = {
  pageNumber: { type: 'number', description: 'Page number (starts at 1)' },
  pageSize: { type: 'number', description: 'Number of items per page (max 200)' },
  select: {
    type: 'string',
    description: 'Filter expression (FIQL/RSQL predicate) — despite the "select" name, this filters rows, it does NOT pick fields. Syntax: `field==value`, join predicates with `;` for AND. Example: `soId==50` returns only the SO with that ID. Not all fields are queryable; unsupported ones error with "Field not found: X".',
  },
  sortBy: { type: 'string', description: 'Field to sort results by' },
  sortOrder: {
    type: 'string',
    description: 'Sort order: ASC, asc, ascending, natural, desc, descending, reverse',
    enum: ['ASC', 'asc', 'ascending', 'natural', 'desc', 'descending', 'reverse'],
  },
  all: {
    type: 'boolean',
    description: 'Auto-paginate: fetch every page and return the combined list. Ignores pageNumber/pageSize. Use for complete results; omit to return a single page (cheaper, safer for large environments).',
  },
};

export function paginationArgs(args) {
  // Clamp pageSize to N-central's documented range; pageNumber to >=1.
  const clampedPageSize = args.pageSize != null
    ? Math.min(200, Math.max(1, Number(args.pageSize) || 1))
    : undefined;
  const clampedPageNumber = args.pageNumber != null
    ? Math.max(1, Number(args.pageNumber) || 1)
    : undefined;
  return {
    pageNumber: clampedPageNumber,
    pageSize: clampedPageSize,
    select: args.select,
    sortBy: args.sortBy,
    sortOrder: args.sortOrder,
  };
}

/**
 * Fetch a single page or auto-paginate based on `args.all`.
 *
 * @param {string} path
 * @param {Record<string, unknown>} baseParams
 * @param {PaginationArgs} [args]
 * @returns {Promise<unknown>}
 */
export async function fetchOrPaginate(path, baseParams, args, allFetcher = fetchAll, oneFetcher = apiGet) {
  const params = { ...baseParams, ...paginationArgs(args || {}) };
  if (args?.all) {
    const pageSize = params.pageSize ?? 200;
    delete params.pageNumber;
    delete params.pageSize;
    return allFetcher(path, params, pageSize);
  }
  return oneFetcher(path, params);
}

/**
 * Format a result as JSON or CSV. Unwraps `.data` envelopes before CSV conversion.
 */
export function formatResult(result, format) {
  if (format !== 'csv') return result;
  const items = result?.data && Array.isArray(result.data) ? result.data
    : Array.isArray(result) ? result
    : result == null ? []
    : [result];
  return toCsv(items);
}
