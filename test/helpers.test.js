/**
 * Tests for tool-registry, paginator, and shared helpers.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowed, buildToolAnnotations } from '../src/tool-registry.js';
import { fetchAll, unwrap, mapConcurrent, toCsv } from '../src/paginator.js';
import { fetchOrPaginate, paginationArgs } from '../src/shared.js';

// ---------------------------------------------------------------------------
// tool-registry: isToolAllowed
// ---------------------------------------------------------------------------
describe('isToolAllowed', () => {
  const readTool = { name: 'r' }; // no writeScope = read
  const explicitRead = { name: 'r2', writeScope: 'read' };
  const writeTool = { name: 'w', writeScope: 'write' };
  const destructiveTool = { name: 'd', writeScope: 'destructive' };

  it('read tools allowed in every mode', () => {
    for (const mode of ['read-only', 'write', 'full']) {
      assert.equal(isToolAllowed(readTool, mode), true);
      assert.equal(isToolAllowed(explicitRead, mode), true);
    }
  });

  it('write tools blocked in read-only, allowed in write/full', () => {
    assert.equal(isToolAllowed(writeTool, 'read-only'), false);
    assert.equal(isToolAllowed(writeTool, 'write'), true);
    assert.equal(isToolAllowed(writeTool, 'full'), true);
  });

  it('destructive tools only allowed in full', () => {
    assert.equal(isToolAllowed(destructiveTool, 'read-only'), false);
    assert.equal(isToolAllowed(destructiveTool, 'write'), false);
    assert.equal(isToolAllowed(destructiveTool, 'full'), true);
  });

  it('unknown scope is denied', () => {
    assert.equal(isToolAllowed({ writeScope: 'bogus' }, 'full'), false);
  });
});

// ---------------------------------------------------------------------------
// tool-registry: buildToolAnnotations
// ---------------------------------------------------------------------------
describe('buildToolAnnotations', () => {
  it('read tool maps to readOnlyHint=true', () => {
    const a = buildToolAnnotations({});
    assert.equal(a.readOnlyHint, true);
    assert.equal(a.destructiveHint, false);
    assert.equal(a.openWorldHint, true);
  });

  it('write tool maps to readOnlyHint=false, destructiveHint=false', () => {
    const a = buildToolAnnotations({ writeScope: 'write' });
    assert.equal(a.readOnlyHint, false);
    assert.equal(a.destructiveHint, false);
  });

  it('destructive tool maps both hints', () => {
    const a = buildToolAnnotations({ writeScope: 'destructive' });
    assert.equal(a.readOnlyHint, false);
    assert.equal(a.destructiveHint, true);
  });
});

// ---------------------------------------------------------------------------
// paginator: unwrap
// ---------------------------------------------------------------------------
describe('unwrap', () => {
  it('returns .data when present', () => {
    assert.deepEqual(unwrap({ data: [1, 2, 3], totalPages: 1 }), [1, 2, 3]);
  });
  it('returns the response itself when no .data', () => {
    assert.deepEqual(unwrap([1, 2, 3]), [1, 2, 3]);
    assert.deepEqual(unwrap({ id: 5 }), { id: 5 });
  });
  it('handles null/undefined safely', () => {
    assert.equal(unwrap(null), null);
    assert.equal(unwrap(undefined), undefined);
  });
});

// ---------------------------------------------------------------------------
// paginator: mapConcurrent
// ---------------------------------------------------------------------------
describe('mapConcurrent', () => {
  it('preserves input order even with varying delays', async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await mapConcurrent(items, async (n) => {
      await new Promise(r => setTimeout(r, n === 3 ? 50 : 1));
      return n * 10;
    }, 3);
    assert.deepEqual(result, [10, 20, 30, 40, 50]);
  });

  it('captures errors per-item without throwing', async () => {
    const items = [1, 2, 3];
    const result = await mapConcurrent(items, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }, 2);
    assert.equal(result[0], 1);
    assert.equal(result[1]._error, 'boom');
    assert.equal(result[1]._item, 2);
    assert.equal(result[2], 3);
  });

  it('empty input returns empty array (no crash on length=0)', async () => {
    assert.deepEqual(await mapConcurrent([], async (n) => n, 5), []);
    assert.deepEqual(await mapConcurrent(null, async (n) => n, 5), []);
    assert.deepEqual(await mapConcurrent(undefined, async (n) => n, 5), []);
  });
});

// ---------------------------------------------------------------------------
// shared: paginationArgs clamping
// ---------------------------------------------------------------------------
describe('paginationArgs', () => {
  it('clamps pageSize above 200 to 200', () => {
    assert.equal(paginationArgs({ pageSize: 5000 }).pageSize, 200);
  });
  it('clamps pageSize below 1 to 1', () => {
    assert.equal(paginationArgs({ pageSize: 0 }).pageSize, 1);
    assert.equal(paginationArgs({ pageSize: -10 }).pageSize, 1);
  });
  it('clamps pageNumber below 1 to 1', () => {
    assert.equal(paginationArgs({ pageNumber: 0 }).pageNumber, 1);
    assert.equal(paginationArgs({ pageNumber: -5 }).pageNumber, 1);
  });
  it('passes through valid values', () => {
    const out = paginationArgs({ pageSize: 100, pageNumber: 3, sortBy: 'name' });
    assert.equal(out.pageSize, 100);
    assert.equal(out.pageNumber, 3);
    assert.equal(out.sortBy, 'name');
  });
  it('leaves undefined args undefined', () => {
    const out = paginationArgs({});
    assert.equal(out.pageSize, undefined);
    assert.equal(out.pageNumber, undefined);
  });
});

describe('fetchOrPaginate', () => {
  it('preserves filters and sorting during auto-pagination', async () => {
    let captured;
    const result = await fetchOrPaginate('/api/devices', { filterId: 9 }, {
      all: true,
      pageSize: 50,
      select: 'customerId==103',
      sortBy: 'longName',
      sortOrder: 'asc',
    }, async (path, params, pageSize) => {
      captured = { path, params, pageSize };
      return [];
    });
    assert.deepEqual(result, []);
    assert.deepEqual(captured, {
      path: '/api/devices',
      params: { filterId: 9, select: 'customerId==103', sortBy: 'longName', sortOrder: 'asc' },
      pageSize: 50,
    });
  });
});

// ---------------------------------------------------------------------------
// paginator: toCsv edge cases (Date, nested arrays, embedded newlines)
// ---------------------------------------------------------------------------
describe('toCsv edge cases', () => {
  it('serializes Date as ISO string', () => {
    const d = new Date('2026-05-22T12:34:56Z');
    const csv = toCsv([{ when: d }]);
    assert.match(csv, /2026-05-22T12:34:56\.000Z/);
  });

  it('stringifies objects inside arrays instead of [object Object]', () => {
    const csv = toCsv([{ items: [{ id: 1 }, { id: 2 }] }]);
    assert.doesNotMatch(csv, /\[object Object\]/);
    assert.match(csv, /id/);
  });

  it('flattens nested objects with dot notation', () => {
    const csv = toCsv([{ id: 1, meta: { tag: 'x', deep: { val: 42 } } }]);
    assert.match(csv, /meta\.tag/);
    assert.match(csv, /meta\.deep\.val/);
  });

  it('quotes values with embedded newlines', () => {
    const csv = toCsv([{ note: 'line1\nline2' }]);
    assert.match(csv, /"line1\nline2"/);
  });
});

// ---------------------------------------------------------------------------
// paginator: fetchAll — null/string tolerance + MAX_PAGES throw.
// fetchAll closes over apiGet at import time. Direct testing requires either
// monkey-patching ESM bindings or refactoring to inject apiGet — left to
// integration coverage for now.
// ---------------------------------------------------------------------------
describe('fetchAll', () => {
  it('stops on a short filtered page even when totalPages is unfiltered', async () => {
    const calls = [];
    const result = await fetchAll('/api/devices', { select: 'customerId==103' }, 200, async (_path, params) => {
      calls.push(params);
      return { data: [{ id: 1 }, { id: 2 }], totalPages: 14 };
    });
    assert.deepEqual(result, [{ id: 1 }, { id: 2 }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].select, 'customerId==103');
  });

  it('continues without pagination metadata until a short page', async () => {
    const pages = [
      { data: [{ id: 1 }, { id: 2 }] },
      { data: [{ id: 3 }] },
    ];
    const result = await fetchAll('/api/devices', {}, 2, async (_path, params) => pages[params.pageNumber - 1]);
    assert.deepEqual(result.map(item => item.id), [1, 2, 3]);
  });
  it('placeholder — see integration coverage', () => {
    assert.ok(true);
  });
});
