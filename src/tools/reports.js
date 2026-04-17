/** Report tools — auto-paginated exports and cross-entity aggregate reports. */

import { apiGet, apiPost, sanitizePathParam } from '../client.js';
import { fetchAll, mapConcurrent, toCsv } from '../paginator.js';

export const reportTools = [
  {
    name: 'report_all_devices',
    description: 'Generate a full device summary report across all devices. Auto-paginates through all results. Returns CSV or JSON. Useful for device inventory lists and summary reports.',
    inputSchema: {
      type: 'object',
      properties: {
        filterId: { type: 'number', description: 'Optional filter ID to narrow results' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
    },
    handler: async (args) => {
      const params = args.filterId != null ? { filterId: args.filterId } : {};
      const devices = await fetchAll('/api/devices', params);
      if (args.format === 'json') return devices;
      return toCsv(devices);
    },
  },
  {
    name: 'report_devices_by_org_unit',
    description: 'Generate a device report for a specific organization unit. Auto-paginates through all results. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const devices = await fetchAll(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/devices`);
      if (args.format === 'json') return devices;
      return toCsv(devices);
    },
  },
  {
    name: 'report_org_entities',
    description: 'Generate a full auto-paginated list of customers, sites, or org units. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: {
          type: 'string',
          description: 'The type of entity to list',
          enum: ['customers', 'sites', 'orgUnits'],
        },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['entityType'],
    },
    handler: async (args) => {
      const endpointMap = { customers: '/api/customers', sites: '/api/sites', orgUnits: '/api/org-units' };
      const endpoint = endpointMap[args.entityType];
      if (!endpoint) throw new Error(`Unknown entityType: ${args.entityType}`);
      const items = await fetchAll(endpoint);
      if (args.format === 'json') return items;
      return toCsv(items);
    },
  },
  {
    name: 'report_device_custom_properties',
    description: 'Generate a report of all custom properties for a specific device. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      const props = await apiGet(`/api/devices/${sanitizePathParam(args.deviceId)}/custom-properties`);
      const items = props.data || props;
      if (args.format === 'json') return items;
      return toCsv(Array.isArray(items) ? items : [items]);
    },
  },
  {
    name: 'report_org_custom_properties',
    description: 'Generate a report of all custom properties for an organization unit. Auto-paginates. Returns CSV or JSON. Useful for exporting all org-level custom properties.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const props = await fetchAll(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/custom-properties`);
      if (args.format === 'json') return props;
      return toCsv(props);
    },
  },
  {
    name: 'report_all_custom_properties_bulk',
    description: 'Generate a bulk report of custom properties across ALL devices in an org unit. Fetches all devices, then retrieves custom properties for each device in parallel (5 concurrent). Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID to scan all devices from' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const devices = await fetchAll(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/devices`);
      console.error(`[bulk-custom-props] Fetching custom properties for ${devices.length} devices...`);

      const rawResults = await mapConcurrent(devices, async (device) => {
        const deviceId = device.deviceId || device.id;
        if (!deviceId) return null;

        const propsResponse = await apiGet(`/api/devices/${sanitizePathParam(deviceId)}/custom-properties`);
        const props = propsResponse.data || propsResponse;
        const propList = Array.isArray(props) ? props : [props];

        return propList.map(prop => ({
          deviceId,
          deviceName: device.longName || device.deviceName || device.name || '',
          ...prop,
        }));
      }, 5);

      const results = rawResults
        .filter(r => r !== null)
        .flatMap(r => {
          if (r._error) {
            const item = r._item || {};
            return [{ error: r._error, deviceId: item.deviceId || item.id || '' }];
          }
          return r;
        });

      if (args.format === 'json') return results;
      return toCsv(results);
    },
  },
  {
    name: 'report_device_assets_bulk',
    description: 'Generate a bulk device asset/inventory report for all devices in an org unit. Fetches each device\'s asset info in parallel (5 concurrent). Note: probes return 404 for assets (skipped). Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID to scan all devices from' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const devices = await fetchAll(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/devices`);
      console.error(`[bulk-assets] Fetching assets for ${devices.length} devices...`);

      const rawResults = await mapConcurrent(devices, async (device) => {
        const deviceId = device.deviceId || device.id;
        if (!deviceId) return null;

        const assets = await apiGet(`/api/devices/${sanitizePathParam(deviceId)}/assets`);
        return {
          deviceId,
          deviceName: device.longName || device.deviceName || device.name || '',
          ...(assets.data || assets),
        };
      }, 5);

      // Filter out nulls and 404 errors (probes), clean up error rows
      const results = rawResults.filter(r => {
        if (r === null) return false;
        if (r._error && r._error.includes('404')) return false;
        return true;
      }).map(r => {
        if (r._error) {
          const item = r._item || {};
          return { error: r._error, deviceId: item.deviceId || item.id || '', deviceName: item.longName || item.deviceName || '' };
        }
        return r;
      });

      if (args.format === 'json') return results;
      return toCsv(results);
    },
  },
  {
    name: 'report_active_issues',
    description: 'Generate a report of all active issues for an organization unit. Returns CSV or JSON. Useful for creating active issues exports.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const issues = await apiGet(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/active-issues`);
      const items = issues.data || issues;
      if (args.format === 'json') return items;
      return toCsv(Array.isArray(items) ? items : [items]);
    },
  },
  {
    name: 'report_job_statuses',
    description: 'Generate a report of all job statuses for an organization unit. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const statuses = await apiGet(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/job-statuses`);
      const items = statuses.data || statuses;
      if (args.format === 'json') return items;
      return toCsv(Array.isArray(items) ? items : [items]);
    },
  },
  {
    name: 'report_device_tasks',
    description: 'Generate a full report of all scheduled tasks for a specific device. Auto-paginates. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      const tasks = await fetchAll(`/api/devices/${sanitizePathParam(args.deviceId)}/scheduled-tasks`);
      if (args.format === 'json') return tasks;
      return toCsv(tasks);
    },
  },

  // --- Auto-paginated user reports ---
  {
    name: 'report_all_users',
    description: 'Generate a full list of all users for an org unit. Auto-paginates through all pages. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID (e.g. a service org, customer, or site ID)' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const users = await fetchAll(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/users`);
      console.error(`[report-all-users] Fetched ${users.length} users for org unit ${args.orgUnitId}.`);
      if (args.format === 'json') return users;
      return toCsv(users);
    },
  },
  {
    name: 'report_all_users_by_so',
    description: 'Generate a complete deduplicated user report for all customers under a service org. Fetches users from the SO itself and each customer concurrently (5 concurrent), then deduplicates by userId. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        soId: { type: 'number', description: 'The service organization ID' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['soId'],
    },
    handler: async (args) => {
      const soId = args.soId;
      console.error(`[report-all-users-by-so] Fetching customers under SO ${soId}...`);
      const customers = await fetchAll(`/api/service-orgs/${sanitizePathParam(soId)}/customers`);

      // Org unit IDs to query: the SO itself plus every customer
      const orgIds = [soId, ...customers.map(c => c.customerId || c.id).filter(Boolean)];
      console.error(`[report-all-users-by-so] Fetching users for ${orgIds.length} org units...`);

      const perOrgUsers = await mapConcurrent(orgIds, (orgId) =>
        fetchAll(`/api/org-units/${sanitizePathParam(orgId)}/users`).catch(() => []),
        5
      );

      // Flatten and deduplicate by userId
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

      console.error(`[report-all-users-by-so] Total unique users: ${users.length} (across ${orgIds.length} org units).`);
      if (args.format === 'json') return users;
      return toCsv(users);
    },
  },

  // --- SO-scoped device report ---
  {
    name: 'report_devices_by_so',
    description: 'Generate a full device report for all devices under a specific service org. Fetches all devices and filters by soId field. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        soId: { type: 'number', description: 'The service organization ID' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['soId'],
    },
    handler: async (args) => {
      const allDevices = await fetchAll('/api/devices');
      const devices = allDevices.filter(d => Number(d.soId) === Number(args.soId));
      console.error(`[report-devices-by-so] ${devices.length} of ${allDevices.length} devices belong to SO ${args.soId}.`);
      if (args.format === 'json') return devices;
      return toCsv(devices);
    },
  },

  // --- Cross-Entity Reports ---
  {
    name: 'report_customer_site_summary',
    description: 'Generate a summary report: all customers with their sites, device counts, and active issue counts. Correlates data across customers, sites, and devices into one table. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
    },
    handler: async (args) => {
      console.error('[customer-site-summary] Fetching customers, sites, and devices...');

      const [customers, sites, devices] = await Promise.all([
        fetchAll('/api/customers'),
        fetchAll('/api/sites'),
        fetchAll('/api/devices'),
      ]);

      // Build a map of siteId → parentCustomerId for rollup
      const siteParentMap = {};
      for (const s of sites) {
        const siteId = s.siteId || s.id;
        if (siteId && s.parentId) siteParentMap[siteId] = s.parentId;
      }

      // Count devices by their direct orgUnitId, then roll up site counts to customer
      const deviceCountByOrg = {};
      for (const d of devices) {
        const orgId = d.orgUnitId || d.customerId;
        if (!orgId) continue;
        deviceCountByOrg[orgId] = (deviceCountByOrg[orgId] || 0) + 1;
        // If this device's org is a site, also credit the parent customer
        const parentId = siteParentMap[orgId];
        if (parentId) deviceCountByOrg[parentId] = (deviceCountByOrg[parentId] || 0) + 1;
      }

      // Build site lookup by parent customer
      const sitesByCustomer = {};
      for (const s of sites) {
        const parentId = s.parentId;
        if (!sitesByCustomer[parentId]) sitesByCustomer[parentId] = [];
        sitesByCustomer[parentId].push(s);
      }

      // Build report rows
      const rows = [];
      for (const cust of customers) {
        const custId = cust.customerId || cust.id;
        const custSites = sitesByCustomer[custId] || [];
        // Total devices for this customer = direct devices + all devices under its sites
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
      if (args.format === 'json') return rows;
      return toCsv(rows);
    },
  },
  {
    name: 'report_org_hierarchy',
    description: 'Generate a flat CSV/JSON of the full Service Org → Customer → Site hierarchy with IDs, names, contacts, and addresses. Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
    },
    handler: async (args) => {
      console.error('[org-hierarchy] Fetching full hierarchy...');

      const [serviceOrgs, customers, sites] = await Promise.all([
        fetchAll('/api/service-orgs'),
        fetchAll('/api/customers'),
        fetchAll('/api/sites'),
      ]);

      const rows = [];

      for (const so of serviceOrgs) {
        rows.push({
          orgType: 'ServiceOrg',
          orgId: so.soId || so.id,
          orgName: so.soName || so.name || '',
          parentId: '',
          contactFirstName: so.contactFirstName || '',
          contactLastName: so.contactLastName || '',
          contactEmail: so.contactEmail || '',
          phone: so.phone || '',
          street1: so.street1 || '',
          city: so.city || '',
          stateProv: so.stateProv || '',
          country: so.country || '',
          postalCode: so.postalCode || '',
        });
      }

      for (const cust of customers) {
        rows.push({
          orgType: 'Customer',
          orgId: cust.customerId || cust.id,
          orgName: cust.customerName || cust.name || '',
          parentId: cust.parentId || '',
          contactFirstName: cust.contactFirstName || '',
          contactLastName: cust.contactLastName || '',
          contactEmail: cust.contactEmail || '',
          phone: cust.phone || '',
          street1: cust.street1 || '',
          city: cust.city || '',
          stateProv: cust.stateProv || '',
          country: cust.country || '',
          postalCode: cust.postalCode || '',
        });
      }

      for (const site of sites) {
        rows.push({
          orgType: 'Site',
          orgId: site.siteId || site.id,
          orgName: site.siteName || site.name || '',
          parentId: site.parentId || '',
          contactFirstName: site.contactFirstName || '',
          contactLastName: site.contactLastName || '',
          contactEmail: site.contactEmail || '',
          phone: site.phone || '',
          street1: site.street1 || '',
          city: site.city || '',
          stateProv: site.stateProv || '',
          country: site.country || '',
          postalCode: site.postalCode || '',
        });
      }

      console.error(`[org-hierarchy] Generated ${rows.length} rows (${serviceOrgs.length} SOs, ${customers.length} customers, ${sites.length} sites).`);
      if (args.format === 'json') return rows;
      return toCsv(rows);
    },
  },
  {
    name: 'report_device_status_bulk',
    description: 'Generate a bulk service monitoring status report for all devices in an org unit. Fetches each device\'s monitor status in parallel (5 concurrent). Returns CSV or JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        format: { type: 'string', description: 'Output format: "csv" or "json" (default: csv)', enum: ['csv', 'json'] },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const devices = await fetchAll(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/devices`);
      console.error(`[bulk-status] Fetching monitor status for ${devices.length} devices...`);

      const rawResults = await mapConcurrent(devices, async (device) => {
        const deviceId = device.deviceId || device.id;
        if (!deviceId) return null;

        const status = await apiGet(`/api/devices/${sanitizePathParam(deviceId)}/service-monitor-status`);
        const statusItems = status.data || status;
        const statusList = Array.isArray(statusItems) ? statusItems : [statusItems];

        return statusList.map(s => ({
          deviceId,
          deviceName: device.longName || device.deviceName || device.name || '',
          ...s,
        }));
      }, 5);

      const results = rawResults
        .filter(r => r !== null)
        .flatMap(r => {
          if (r._error) return [{ error: r._error }];
          return r;
        });

      if (args.format === 'json') return results;
      return toCsv(results);
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
