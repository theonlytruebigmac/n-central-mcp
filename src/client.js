// @ts-check
/** N-central API client: authenticated HTTP with retry and auto re-auth on 401. */

import { getAccessToken, reAuthenticate } from './auth.js';
import { getContext, MULTI_TENANT } from './context.js';
import { auditLog } from './logging.js';
import { inc } from './metrics.js';

const MAX_RETRIES = Number(process.env.NC_MAX_RETRIES) || 3;
const RETRY_DELAY_MS = Number(process.env.NC_RETRY_DELAY_MS) || 2000;
const TIMEOUT_MS = Number(process.env.NC_REQUEST_TIMEOUT_MS) || 30_000;

/** @typedef {'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'} HttpMethod */

// Idempotent methods retry on timeouts and 5xx. POST/PATCH retry only on
// auth/rate-limit failures (where the request did not reach the handler).
const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'DELETE', 'HEAD']);

/**
 * Validate a value for safe use in a URL path segment.
 *
 * @param {string | number} value
 * @returns {string}
 * @throws {Error}
 */
export function sanitizePathParam(value) {
  const str = String(value);
  if (!str.length) throw new Error('Path parameter must not be empty');
  if (
    str.includes('..') ||
    str.includes('/') ||
    str.includes('\\') ||
    str.includes('%2F') ||
    str.includes('%2f')
  ) {
    throw new Error('Invalid path parameter');
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(str)) throw new Error('Invalid path parameter');
  return str;
}

/**
 * @param {HttpMethod} method
 * @param {string} path
 * @param {{ params?: Record<string, unknown>, body?: unknown }} [options]
 * @returns {Promise<unknown>}
 */
async function apiRequest(method, path, { params = {}, body = null } = {}) {
  // Resolve the tenant context once and reuse it for the whole request,
  // including retries — never re-read mid-flight (defends against any future
  // async-context drift, and one request always belongs to one tenant).
  const ctx = getContext();

  const url = buildUrl(ctx.fqdn, path, params);
  const hasBody = body != null;
  const canRetryTransient = IDEMPOTENT_METHODS.has(method);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const token = await getAccessToken(ctx);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (hasBody) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        if (attempt < MAX_RETRIES && canRetryTransient) {
          const delay = RETRY_DELAY_MS * 2 ** attempt;
          auditLog('api_retry', { method, path: stripQuery(path), reason: 'timeout', attempt: attempt + 1, delayMs: delay });
        inc('nc_mcp_api_retries_total', { reason: 'timeout' });
          await sleep(delay);
          continue;
        }
        throw new Error(`Request timed out on ${method} ${stripQuery(path)}`, { cause: err });
      }
      throw err;
    }

    clearTimeout(timer);

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const delay = retryDelayMs(res.headers.get('retry-after'), attempt);
        auditLog('api_retry', { method, path: stripQuery(path), status: 429, attempt: attempt + 1, delayMs: delay });
        inc('nc_mcp_api_retries_total', { reason: '429' });
        await sleep(delay);
        continue;
      }
      throw new Error('Rate limited (429) after retries');
    }

    if (res.status === 401) {
      if (attempt < MAX_RETRIES) {
        const delay = attempt > 0 ? RETRY_DELAY_MS * 2 ** (attempt - 1) : 0;
        auditLog('api_retry', { method, path: stripQuery(path), status: 401, attempt: attempt + 1, delayMs: delay });
        inc('nc_mcp_api_retries_total', { reason: '401' });
        await reAuthenticate(ctx);
        if (delay) await sleep(delay);
        continue;
      }
      throw new Error('Unauthorized (401) after re-auth');
    }

    if (res.status === 500 || res.status === 503) {
      if (attempt < MAX_RETRIES && canRetryTransient) {
        const delay = RETRY_DELAY_MS * 2 ** attempt;
        auditLog('api_retry', { method, path: stripQuery(path), status: res.status, attempt: attempt + 1, delayMs: delay });
        inc('nc_mcp_api_retries_total', { reason: String(res.status) });
        await sleep(delay);
        continue;
      }
      throw new Error(`Server error ${res.status} on ${method} ${stripQuery(path)}`);
    }

    if (!res.ok) {
      // In multi-tenant mode, do not echo the response body into the error —
      // it can carry tenant-identifying detail into shared operator logs.
      const errBody = MULTI_TENANT ? '' : await res.text();
      const detail = errBody ? `: ${truncate(errBody, 200)}` : '';
      throw new Error(`API error ${res.status} on ${method} ${stripQuery(path)}${detail}`);
    }

    if (res.status === 204) return null;

    const text = await res.text();
    if (!text) return null;

    const contentType = res.headers.get('content-type') || '';
    const looksJson = contentType.includes('json') || /^\s*[{[]/.test(text);

    if (!looksJson) return text;

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from ${method} ${stripQuery(path)}: ${truncate(text, 120)}`);
    }

    // N-central wraps some errors as `error message` inside 200 responses.
    if (data?.['error message']) {
      const detail = MULTI_TENANT ? '' : `: ${truncate(data['error message'], 200)}`;
      throw new Error(`API error in 200 response${detail}`);
    }

    return data;
  }
  throw new Error(`apiRequest: retry loop exhausted on ${method} ${stripQuery(path)} without returning`);
}

export function apiGet(path, params = {}) {
  return apiRequest('GET', path, { params });
}

export function apiPost(path, body = null, params = {}) {
  return apiRequest('POST', path, { body, params });
}

export function apiPut(path, body = null, params = {}) {
  return apiRequest('PUT', path, { body, params });
}

export function apiPatch(path, body = null, params = {}) {
  return apiRequest('PATCH', path, { body, params });
}

export function apiDelete(path, params = {}, body = null) {
  return apiRequest('DELETE', path, { body, params });
}

function stripQuery(path) {
  const q = path.indexOf('?');
  return q === -1 ? path : path.slice(0, q);
}

function truncate(str, max) {
  if (!str) return '';
  const s = String(str);
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function buildUrl(fqdn, path, params) {
  const url = new URL(`${fqdn}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function retryDelayMs(retryAfter, attempt, now = Date.now()) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return RETRY_DELAY_MS * 2 ** attempt;
}
