/** Report tools: cross-entity aggregates and bulk fan-out reports. */

import { apiGet, apiPost, sanitizePathParam } from '../client.js';
import { fetchAll, mapConcurrent, unwrap } from '../paginator.js';
import { formatParam, formatResult } from '../shared.js';

// N-central FAQ: concurrency caps vary per endpoint (1-50).
// /api/devices = 5; /api/devices/{id}/assets/lifecycle-info = 1; others unpublished.
const CONCURRENCY = {
  customProperties: 5,
  assets: 1,
  lifecycle: 1,
  monitorStatus: 1,
  users: 5,
};

function first(...values) {
  return values.find(value => value != null && value !== '') ?? null;
}

function normalizedDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
}

export function summarizeAsset(response, device = {}) {
  const asset = unwrap(response) || {};
  const assetDevice = asset.device || {};
  const system = asset.computersystem || {};
  const os = asset.os || {};
  const extraDevice = asset._extra?.device || {};
  return {
    deviceId: first(device.deviceId, device.id, assetDevice.deviceid),
    deviceName: first(device.longName, device.deviceName, device.name, assetDevice.longname),
    customerId: first(device.customerId, extraDevice.customerid),
    customerName: first(device.customerName),
    siteName: first(device.siteName),
    deviceClass: first(device.deviceClass, assetDevice.deviceclass),
    os: first(device.supportedOs, os.reportedos),
    createdOn: normalizedDate(extraDevice.createdon),
    lastCheckin: normalizedDate(first(device.lastApplianceCheckinTime, assetDevice.lastlogin)),
    manufacturer: first(system.manufacturer),
    model: first(system.model),
    serialNumber: first(system.serialnumber),
    warrantyExpiryDate: normalizedDate(extraDevice.warrantyexpirydate),
  };
}

export function summarizeLifecycle(response, device = {}) {
  const lifecycle = unwrap(response) || {};
  return {
    deviceId: first(device.deviceId, device.id),
    deviceName: first(device.longName, device.deviceName, device.name),
    purchaseDate: normalizedDate(lifecycle.purchaseDate),
    warrantyExpiryDate: normalizedDate(lifecycle.warrantyExpiryDate),
    leaseExpiryDate: normalizedDate(lifecycle.leaseExpiryDate),
    expectedReplacementDate: normalizedDate(lifecycle.expectedReplacementDate),
    assetTag: first(lifecycle.assetTag),
    location: first(lifecycle.location),
  };
}

export function summarizeMonitorStatus(status, device = {}) {
  return {
    deviceId: first(device.deviceId, device.id),
    deviceName: first(device.longName, device.deviceName, device.name),
    serviceName: first(status.moduleName, status.serviceName),
    state: first(status.stateStatus, status.state),
    lastScanTime: normalizedDate(status.lastScanTime),
    transitionTime: normalizedDate(status.transitionTime),
  };
}

function clampConcurrency(requested, fallback) {
  if (requested == null) return fallback;
  const n = Number(requested);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10, Math.max(1, Math.floor(n)));
}

/** Deduplicate users across per-org batches by `userId`. */
export function deduplicateUsers(perOrgUsers) {
  const seen = new Set();
  const users = [];
  for (const batch of perOrgUsers) {
    if (!Array.isArray(batch)) continue;
    for (const user of batch) {
      const uid = user.userId;
      if (uid != null && !seen.has(uid)) {
        seen.add(uid);
        users.push(user);
      }
    }
  }
  return users;
}

/** Roll up per-device counts to their direct orgUnit and parent customer. */
export function buildDeviceCountByOrg(devices, siteParentMap) {
  const deviceCountByOrg = {};
  for (const d of devices) {
    const orgId = d.orgUnitId || d.customerId;
    if (!orgId) continue;
    deviceCountByOrg[orgId] = (deviceCountByOrg[orgId] || 0) + 1;
    const parentId = siteParentMap[orgId];
    if (parentId) deviceCountByOrg[parentId] = (deviceCountByOrg[parentId] || 0) + 1;
  }
  return deviceCountByOrg;
}

// Per-dataType config for `report_devices_bulk`: which endpoint to call per
// device, what concurrency to use, and how to shape the result row.
const BULK_DATA_TYPES = {
  'custom-properties': {
    endpoint: (deviceId) => `/api/devices/${sanitizePathParam(deviceId)}/custom-properties`,
    concurrency: CONCURRENCY.customProperties,
    transform: (response, device) => {
      const props = unwrap(response);
      const propList = Array.isArray(props) ? props : [props];
      return propList.map(p => ({
        deviceId: device.deviceId || device.id,
        deviceName: device.longName || device.deviceName || device.name || '',
        ...p,
      }));
    },
    skip404: false,
  },
  'assets': {
    endpoint: (deviceId) => `/api/devices/${sanitizePathParam(deviceId)}/assets`,
    concurrency: CONCURRENCY.assets,
    transform: (response, device) => ({
      deviceId: device.deviceId || device.id,
      deviceName: device.longName || device.deviceName || device.name || '',
      ...unwrap(response),
    }),
    skip404: true, // probes don't have assets
    summarize: summarizeAsset,
  },
  'lifecycle': {
    endpoint: (deviceId) => `/api/devices/${sanitizePathParam(deviceId)}/assets/lifecycle-info`,
    concurrency: CONCURRENCY.lifecycle,
    transform: (response, device) => ({
      deviceId: device.deviceId || device.id,
      deviceName: device.longName || device.deviceName || device.name || '',
      ...unwrap(response),
    }),
    skip404: true,
    summarize: summarizeLifecycle,
  },
  'monitor-status': {
    endpoint: (deviceId) => `/api/devices/${sanitizePathParam(deviceId)}/service-monitor-status`,
    concurrency: CONCURRENCY.monitorStatus,
    transform: (response, device) => {
      const items = unwrap(response);
      const list = Array.isArray(items) ? items : [items];
      return list.map(s => ({
        deviceId: device.deviceId || device.id,
        deviceName: device.longName || device.deviceName || device.name || '',
        ...s,
      }));
    },
    skip404: false,
    summarize: summarizeMonitorStatus,
  },
};

export const reportTools = [
  {
    name: 'report_devices_bulk',
    description: 'Fan out a per-device API call across devices in an org unit. Filter before fan-out with select, deviceIds, or deviceLimit. Set view: "summary" for compact normalized asset, lifecycle, and monitor-status rows. Returns CSV by default (set format: "json" to override).',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID to scan all devices from' },
        dataType: {
          type: 'string',
          description: 'Which per-device endpoint to call',
          enum: ['custom-properties', 'assets', 'lifecycle', 'monitor-status'],
        },
        select: { type: 'string', description: 'FIQL/RSQL device filter applied before fan-out' },
        deviceIds: { type: 'array', items: { type: 'string' }, description: 'Only fan out to these device IDs' },
        deviceLimit: { type: 'number', description: 'Maximum devices to process after filtering' },
        view: { type: 'string', enum: ['raw', 'summary'], description: 'Result detail. Default: raw.' },
        ...formatParam,
        concurrency: { type: 'number', description: 'Concurrent API calls (1-10). Default varies by dataType.' },
      },
      required: ['orgUnitId', 'dataType'],
    },
    handler: async (args) => {
      const cfg = BULK_DATA_TYPES[args.dataType];
      if (!cfg) throw new Error(`Unknown dataType: ${args.dataType}`);

      let devices = await fetchAll(
        `/api/org-units/${sanitizePathParam(args.orgUnitId)}/devices`,
        args.select ? { select: args.select } : {},
      );
      if (Array.isArray(args.deviceIds) && args.deviceIds.length) {
        const requested = new Set(args.deviceIds.map(String));
        devices = devices.filter(device => requested.has(String(device.deviceId || device.id)));
      }
      if (args.deviceLimit != null) devices = devices.slice(0, Math.max(0, Number(args.deviceLimit) || 0));
      console.error(`[bulk-${args.dataType}] Fetching for ${devices.length} devices...`);

      const rawResults = await mapConcurrent(devices, async (device) => {
        const deviceId = device.deviceId || device.id;
        if (!deviceId) return null;
        const response = await apiGet(cfg.endpoint(deviceId));
        if (args.view === 'summary' && cfg.summarize) {
          const items = unwrap(response);
          if (args.dataType === 'monitor-status') {
            const list = Array.isArray(items) ? items : [items];
            return list.map(item => cfg.summarize(item || {}, device));
          }
          return cfg.summarize(response, device);
        }
        return cfg.transform(response, device);
      }, clampConcurrency(args.concurrency, cfg.concurrency));

      const results = rawResults
        .filter(r => {
          if (r === null) return false;
          if (r._error && cfg.skip404 && r._error.includes('404')) return false;
          return true;
        })
        .flatMap(r => {
          if (r._error) {
            const item = r._item || {};
            return [{ error: r._error, deviceId: item.deviceId || item.id || '', deviceName: item.longName || item.deviceName || '' }];
          }
          return Array.isArray(r) ? r : [r];
        });

      return formatResult(results, args.format ?? 'csv');
    },
  },
  {
    name: 'list_active_issues',
    description: 'List active issues for an organization unit. Returns CSV or JSON. KNOWN N-CENTRAL BUG: `_extra.deviceClassValue` and `_extra.deviceClassLabel` are always null. The underlying endpoint only supports customer/site org units, not service-orgs.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        ...formatParam,
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const issues = await apiGet(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/active-issues`);
      const items = unwrap(issues);
      return formatResult(Array.isArray(items) ? items : [items], args.format);
    },
  },
  {
    name: 'list_job_statuses',
    description: 'List job statuses for an organization unit. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        ...formatParam,
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const statuses = await apiGet(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/job-statuses`);
      const items = unwrap(statuses);
      return formatResult(Array.isArray(items) ? items : [items], args.format);
    },
  },
  {
    name: 'report_all_users_by_so',
    description: 'Generate a complete deduplicated user report for all customers under a service org. Fetches users from the SO itself and each customer concurrently, then deduplicates by userId. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        soId: { type: 'number', description: 'The service organization ID' },
        ...formatParam,
        concurrency: { type: 'number', description: 'Concurrent API calls (1-10, default 5)' },
      },
      required: ['soId'],
    },
    handler: async (args) => {
      const soId = args.soId;
      console.error(`[report-all-users-by-so] Fetching customers under SO ${soId}...`);
      const customers = await fetchAll(`/api/service-orgs/${sanitizePathParam(soId)}/customers`);

      const orgIds = [soId, ...customers.map(c => c.customerId || c.id).filter(Boolean)];
      console.error(`[report-all-users-by-so] Fetching users for ${orgIds.length} org units...`);

      const perOrgUsers = await mapConcurrent(orgIds, (orgId) =>
        fetchAll(`/api/org-units/${sanitizePathParam(orgId)}/users`).catch(err => {
          console.error(`[report-all-users-by-so] Failed to fetch users for org ${orgId}: ${err.message}`);
          return [];
        }),
        clampConcurrency(args.concurrency, CONCURRENCY.users)
      );

      const users = deduplicateUsers(perOrgUsers);
      console.error(`[report-all-users-by-so] Total unique users: ${users.length} (across ${orgIds.length} org units).`);

      return formatResult(users, args.format ?? 'csv');
    },
  },
  {
    name: 'report_devices_by_so',
    description: 'Generate a full device report for all devices under a specific service org. Fetches all devices and filters by soId field. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        soId: { type: 'number', description: 'The service organization ID' },
        ...formatParam,
      },
      required: ['soId'],
    },
    handler: async (args) => {
      const allDevices = await fetchAll('/api/devices');
      const devices = allDevices.filter(d => Number(d.soId) === Number(args.soId));
      console.error(`[report-devices-by-so] ${devices.length} of ${allDevices.length} devices belong to SO ${args.soId}.`);
      return formatResult(devices, args.format ?? 'csv');
    },
  },
  {
    name: 'report_customer_site_summary',
    description: 'Generate a summary report: all customers with their sites, device counts. Correlates data across customers, sites, and devices into one table. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: { ...formatParam },
    },
    handler: async (args) => {
      console.error('[customer-site-summary] Fetching customers, sites, and devices...');

      const [customers, sites, devices] = await Promise.all([
        fetchAll('/api/customers'),
        fetchAll('/api/sites'),
        fetchAll('/api/devices'),
      ]);

      const siteParentMap = {};
      for (const s of sites) {
        const siteId = s.siteId || s.id;
        if (siteId && s.parentId) siteParentMap[siteId] = s.parentId;
      }

      const deviceCountByOrg = buildDeviceCountByOrg(devices, siteParentMap);

      const sitesByCustomer = {};
      for (const s of sites) {
        const parentId = s.parentId;
        if (!sitesByCustomer[parentId]) sitesByCustomer[parentId] = [];
        sitesByCustomer[parentId].push(s);
      }

      const rows = [];
      for (const cust of customers) {
        const custId = cust.customerId || cust.id;
        const custSites = sitesByCustomer[custId] || [];
        const totalCustomerDevices = deviceCountByOrg[custId] || 0;

        if (custSites.length === 0) {
          rows.push({
            customerName: cust.customerName || cust.name || '',
            customerId: custId,
            siteName: '(no sites)',
            siteId: '',
            siteDeviceCount: 0,
            totalDeviceCount: totalCustomerDevices,
            siteCount: 0,
          });
        } else {
          for (const site of custSites) {
            const siteId = site.siteId || site.id;
            rows.push({
              customerName: cust.customerName || cust.name || '',
              customerId: custId,
              siteName: site.siteName || site.name || '',
              siteId,
              siteDeviceCount: deviceCountByOrg[siteId] || 0,
              totalDeviceCount: totalCustomerDevices,
              siteCount: custSites.length,
            });
          }
        }
      }

      console.error(`[customer-site-summary] Generated ${rows.length} rows across ${customers.length} customers and ${sites.length} sites.`);
      return formatResult(rows, args.format ?? 'csv');
    },
  },
  {
    name: 'report_org_hierarchy',
    description: 'Generate a flat CSV/JSON of the full Service Org → Customer → Site hierarchy with IDs, names, contacts, and addresses. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: { ...formatParam },
    },
    handler: async (args) => {
      console.error('[org-hierarchy] Fetching full hierarchy...');

      const [serviceOrgs, customers, sites] = await Promise.all([
        fetchAll('/api/service-orgs'),
        fetchAll('/api/customers'),
        fetchAll('/api/sites'),
      ]);

      const baseCols = ['contactFirstName', 'contactLastName', 'contactEmail', 'phone', 'street1', 'city', 'stateProv', 'country', 'postalCode'];
      const rowFor = (orgType, id, name, parentId, src) => {
        const out = { orgType, orgId: id, orgName: name, parentId: parentId || '' };
        for (const k of baseCols) out[k] = src[k] || '';
        return out;
      };

      const rows = [
        ...serviceOrgs.map(so => rowFor('ServiceOrg', so.soId || so.id, so.soName || so.name || '', '', so)),
        ...customers.map(c => rowFor('Customer', c.customerId || c.id, c.customerName || c.name || '', c.parentId, c)),
        ...sites.map(s => rowFor('Site', s.siteId || s.id, s.siteName || s.name || '', s.parentId, s)),
      ];

      console.error(`[org-hierarchy] Generated ${rows.length} rows (${serviceOrgs.length} SOs, ${customers.length} customers, ${sites.length} sites).`);
      return formatResult(rows, args.format ?? 'csv');
    },
  },
  {
    name: 'generate_patch_comparison_report',
    writeScope: 'write',
    description: 'Submit a request to generate a patch comparison report. Required: startDate. Optional filters: installStatuses[], patchApprovals[], patchCategories[]. Returns a report ID (fetch via get_report).',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Report start date (ISO-8601)' },
        installStatuses: { type: 'array', description: 'Filter by install statuses', items: { type: 'string' } },
        patchApprovals: { type: 'array', description: 'Filter by patch approval states', items: { type: 'string' } },
        patchCategories: { type: 'array', description: 'Filter by patch categories', items: { type: 'string' } },
      },
      required: ['startDate'],
    },
    handler: async (args) => {
      return await apiPost('/api/report/patch-comparison', args);
    },
  },
];
