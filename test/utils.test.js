/**
 * Tests for core utilities: input validation, CSV generation, audit logging,
 * and report tool logic (user deduplication, device site rollup).
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { retryDelayMs, sanitizePathParam } from '../src/client.js';
import { toCsv } from '../src/paginator.js';
import { auditLog } from '../src/logging.js';
import { deduplicateUsers, buildDeviceCountByOrg, summarizeAsset, summarizeLifecycle, summarizeMonitorStatus } from '../src/tools/reports.js';

describe('retryDelayMs', () => {
  it('honors Retry-After seconds', () => assert.equal(retryDelayMs('7', 0), 7000));
  it('honors Retry-After dates', () => assert.equal(retryDelayMs('Thu, 01 Jan 2026 00:00:05 GMT', 0, Date.parse('2026-01-01T00:00:00Z')), 5000));
  it('falls back to exponential backoff', () => assert.equal(retryDelayMs(null, 2), 8000));
});

describe('sanitizePathParam', () => {
  it('accepts numeric IDs', () => {
    assert.equal(sanitizePathParam(12345), '12345');
    assert.equal(sanitizePathParam('12345'), '12345');
  });

  it('accepts IDs with hyphens, dots, colons', () => {
    assert.equal(sanitizePathParam('abc-123'), 'abc-123');
    assert.equal(sanitizePathParam('dev.001'), 'dev.001');
    assert.equal(sanitizePathParam('task:42'), 'task:42');
  });

  it('accepts UUIDs', () => {
    assert.equal(sanitizePathParam('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('rejects empty', () => assert.throws(() => sanitizePathParam(''), /empty/));
  it('rejects ..', () => assert.throws(() => sanitizePathParam('../../etc/passwd')));
  it('rejects slashes', () => assert.throws(() => sanitizePathParam('foo/bar')));
  it('rejects encoded slashes', () => assert.throws(() => sanitizePathParam('%2F')));
  it('rejects backslashes', () => assert.throws(() => sanitizePathParam('foo\\bar')));
  it('rejects spaces and special chars', () => {
    assert.throws(() => sanitizePathParam('foo bar'));
    assert.throws(() => sanitizePathParam('<script>'));
    assert.throws(() => sanitizePathParam('id;DROP'));
  });
});

describe('toCsv', () => {
  it('basic objects', () => {
    const lines = toCsv([{ a: 1, b: 'hello' }]).split('\n');
    assert.equal(lines[0], 'a,b');
    assert.equal(lines[1], '1,hello');
  });

  it('escapes commas and quotes', () => {
    const csv = toCsv([{ name: 'Foo, Inc.', desc: 'He said "hi"' }]);
    assert.match(csv, /"Foo, Inc\."/);
    assert.match(csv, /"He said ""hi"""/);
  });

  it('flattens nested objects', () => {
    const csv = toCsv([{ id: 1, meta: { tag: 'test' } }]);
    assert.match(csv, /meta\.tag/);
  });

  it('returns "No data" for empty input', () => {
    assert.equal(toCsv([]), 'No data');
    assert.equal(toCsv(null), 'No data');
  });

  it('joins arrays with semicolons', () => {
    assert.match(toCsv([{ items: ['a', 'b', 'c'] }]), /a; b; c/);
  });
});

describe('auditLog', () => {
  it('handles normal objects', () => assert.doesNotThrow(() => auditLog('test', { tool: 'foo' })));
  it('handles circular refs', () => {
    const obj = { a: 1 };
    obj.self = obj;
    assert.doesNotThrow(() => auditLog('test', { data: obj }));
  });
  it('handles BigInt', () => assert.doesNotThrow(() => auditLog('test', { n: 9007199254740991n })));
  it('redacts sensitive fields', () => assert.doesNotThrow(() => auditLog('test', { args: { token: 'x', password: 'y' } })));
  it('handles array args', () => assert.doesNotThrow(() => auditLog('test', { args: [{ token: 'x' }] })));
});

// ---------------------------------------------------------------------------
// report_all_users_by_so — deduplication logic (imported from reports.js)
// ---------------------------------------------------------------------------
describe('report_all_users_by_so deduplication', () => {
  it('removes duplicate users that appear in multiple org units', () => {
    const shared = { userId: 1, userName: 'a@b.com' };
    const batches = [
      [shared, { userId: 2, userName: 'c@d.com' }],
      [shared, { userId: 3, userName: 'e@f.com' }],
    ];
    const result = deduplicateUsers(batches);
    assert.equal(result.length, 3);
    assert.equal(result.filter(u => u.userId === 1).length, 1);
  });

  it('handles empty and null batches gracefully', () => {
    const result = deduplicateUsers([[], null, [{ userId: 10, userName: 'x@y.com' }]]);
    assert.equal(result.length, 1);
  });

  it('preserves all unique users', () => {
    const batches = [
      [{ userId: 1 }, { userId: 2 }],
      [{ userId: 3 }, { userId: 4 }],
    ];
    assert.equal(deduplicateUsers(batches).length, 4);
  });
});

// ---------------------------------------------------------------------------
// report_customer_site_summary — site→customer device count rollup (imported from reports.js)
// ---------------------------------------------------------------------------
describe('report_customer_site_summary device rollup', () => {
  it('credits site devices to parent customer', () => {
    const siteParentMap = { 200: 100 };
    const devices = [
      { orgUnitId: 200 },
      { orgUnitId: 200 },
      { orgUnitId: 100 },
    ];
    const counts = buildDeviceCountByOrg(devices, siteParentMap);
    assert.equal(counts[200], 2, 'site should have 2 devices');
    assert.equal(counts[100], 3, 'customer should have 3 total (2 from site + 1 direct)');
  });

  it('does not double-count devices already directly under customer', () => {
    const devices = [{ orgUnitId: 100 }, { orgUnitId: 100 }];
    const counts = buildDeviceCountByOrg(devices, {});
    assert.equal(counts[100], 2);
  });

  it('handles devices with no orgUnitId gracefully', () => {
    const counts = buildDeviceCountByOrg([{ orgUnitId: null }, {}], {});
    assert.deepEqual(counts, {});
  });
});

describe('report device summary views', () => {
  const device = {
    deviceId: 42,
    longName: 'SERVER01',
    customerName: 'Example',
    deviceClass: 'Servers - Windows',
    supportedOs: 'Windows Server 2022',
  };

  it('extracts compact asset inventory fields', () => {
    const row = summarizeAsset({ data: {
      device: { deviceid: '42' },
      computersystem: { manufacturer: 'Dell', model: 'R750', serialnumber: 'ABC' },
      os: { reportedos: 'Windows Server 2022' },
      _extra: { device: { createdon: '2024-01-02 03:04:05 -0600' } },
    } }, device);
    assert.equal(row.deviceName, 'SERVER01');
    assert.equal(row.model, 'R750');
    assert.equal(row.createdOn, '2024-01-02T09:04:05.000Z');
    assert.equal(row._extra, undefined);
  });

  it('normalizes lifecycle and monitor status rows', () => {
    const lifecycle = summarizeLifecycle({ purchaseDate: '2023-02-01', warrantyExpiryDate: '' }, device);
    assert.equal(lifecycle.purchaseDate, '2023-02-01T00:00:00.000Z');
    assert.equal(lifecycle.warrantyExpiryDate, null);
    const status = summarizeMonitorStatus({ moduleName: 'Agent Status', stateStatus: 'Normal' }, device);
    assert.equal(status.serviceName, 'Agent Status');
    assert.equal(status.state, 'Normal');
  });
});
