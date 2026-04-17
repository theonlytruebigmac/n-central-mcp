/**
 * N-central API client — authenticated HTTP with retry, rate-limit handling,
 * and automatic token refresh on 401.
 */

import { getAccessToken, reAuthenticate } from './auth.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const TIMEOUT_MS = 30_000;

// GET/PUT/DELETE are idempotent — safe to retry on timeouts and 5xx.
// POST/PATCH are not — retry only auth/rate-limit failures (which did not process the request).
const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'DELETE', 'HEAD']);

let serverUrl = null;

export function setServerUrl(url) {
  serverUrl = url.replace(/\/+$/, '');
}

/**
 * Validates a value for safe use in a URL path segment.
 * Rejects empty strings, path traversal, slashes, and special chars.
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

async function apiRequest(method, path, { params = {}, body = null } = {}) {
  if (!serverUrl) throw new Error('Server URL not set');

  const url = buildUrl(path, params);
  const hasBody = body != null;
  const canRetryTransient = IDEMPOTENT_METHODS.has(method);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const token = await getAccessToken();
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
          console.error(`Timeout on ${method} ${stripQuery(path)}, retry in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        throw new Error(`Request timed out on ${method} ${stripQuery(path)}`);
      }
      throw err;
    }

    clearTimeout(timer);

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * 2 ** attempt;
        console.error(`Rate limited (429), retry in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw new Error('Rate limited (429) after retries');
    }

    if (res.status === 401) {
      if (attempt < MAX_RETRIES) {
        console.error('Got 401, re-authenticating...');
        await reAuthenticate();
        continue;
      }
      throw new Error('Unauthorized (401) after re-auth');
    }

    if (res.status === 500 || res.status === 503) {
      if (attempt < MAX_RETRIES && canRetryTransient) {
        const delay = RETRY_DELAY_MS * 2 ** attempt;
        console.error(`Server error (${res.status}) on ${method} ${stripQuery(path)}, retry in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw new Error(`Server error ${res.status} on ${method} ${stripQuery(path)}`);
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`API error ${res.status} on ${method} ${stripQuery(path)}: ${truncate(errBody, 200)}`);
    }

    if (res.status === 204) return null;

    const text = await res.text();
    if (!text) return null;

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return text;
    }

    // N-central sometimes wraps errors inside 200 responses
    if (data?.['error message']) {
      throw new Error(`API error in 200 response: ${truncate(data['error message'], 200)}`);
    }

    return data;
  }
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

function buildUrl(path, params) {
  const url = new URL(`${serverUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
