// @ts-check
/**
 * Pagination and concurrency utilities for N-central API.
 */

import { apiGet } from './client.js';

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGES = 200;

/**
 * Auto-paginate through a list endpoint, returning all items.
 * Throws if MAX_PAGES is reached with more pages still indicated.
 */
export async function fetchAll(path, params = {}, pageSize = DEFAULT_PAGE_SIZE, get = apiGet) {
  const all = [];
  let page = 1;

  while (page <= MAX_PAGES) {
    const res = /** @type {any} */ (await get(path, { ...params, pageNumber: page, pageSize }));
    if (res == null) break;

    const items = Array.isArray(res) ? res : (res.data ?? []);
    all.push(...items);

    const totalPages = res.totalPages ?? res._page?.totalPages;
    // N-central sometimes reports unfiltered totals for filtered pages. A
    // short page is authoritative and prevents requests for phantom pages.
    if (items.length < pageSize || (totalPages != null && page >= totalPages)) break;

    if (page === MAX_PAGES) {
      const detail = totalPages == null ? 'an unknown number of' : totalPages;
      throw new Error(`fetchAll: hit MAX_PAGES (${MAX_PAGES}) on ${path} with ${detail} pages reported. Use a tighter filter or paginate manually.`);
    }
    page++;
  }

  return all;
}

/**
 * Map over items with bounded concurrency. Preserves input order.
 * Errors are captured per-item as `{ _error, _item }`.
 *
 * @template T, R
 * @param {readonly T[] | null | undefined} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {number} [concurrency=5]
 * @returns {Promise<(R | { _error: string, _item: T })[]>}
 */
export async function mapConcurrent(items, fn, concurrency = 5) {
  if (!items?.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { _error: err.message, _item: items[i] };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/** Unwrap an N-central `{ data: ... }` envelope, or return the value as-is. */
export function unwrap(res) {
  return res?.data ?? res;
}

/**
 * Convert an array of objects to CSV.
 * Nested objects are flattened with dot notation.
 */
export function toCsv(items, columns = null) {
  if (!items?.length) return 'No data';

  const flat = items.map(flatten);
  const cols = columns ?? [...new Set(flat.flatMap(Object.keys))];
  const header = cols.map(csvEscape).join(',');
  const rows = flat.map(item => cols.map(c => csvEscape(item[c] ?? '')).join(','));

  return [header, ...rows].join('\n');
}

function flatten(obj, prefix = '') {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v == null) out[key] = '';
    else if (v instanceof Date) out[key] = v.toISOString();
    else if (Array.isArray(v)) {
      out[key] = v.map(x => (x && typeof x === 'object' ? JSON.stringify(x) : x)).join('; ');
    }
    else if (typeof v === 'object') Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

function csvEscape(value) {
  if (value instanceof Date) value = value.toISOString();
  const s = String(value);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}
