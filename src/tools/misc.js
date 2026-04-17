/** Misc tools — filters, maintenance windows, tokens, server health, etc. */

import { apiGet, apiPost, apiPut, apiDelete, sanitizePathParam } from '../client.js';
import { paginationParams, paginationArgs } from '../shared.js';
import { fetchAll } from '../paginator.js';

export const miscTools = [
  {
    name: 'list_device_filters',
    description: 'Retrieve the list of device filters. Returns one page by default — set `all: true` to auto-paginate.',
    inputSchema: {
      type: 'object',
      properties: {
        viewScope: { type: 'string', description: 'View scope for filters' },
        ...paginationParams,
      },
    },
    handler: async (args) => {
      const params = args.viewScope ? { viewScope: args.viewScope } : {};
      if (args.all) return await fetchAll('/api/device-filters', params);
      return await apiGet('/api/device-filters', { ...params, ...paginationArgs(args) });
    },
  },
  {
    name: 'get_maintenance_windows',
    description: 'Retrieve all maintenance windows for a specific device.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/devices/${sanitizePathParam(args.deviceId)}/maintenance-windows`);
    },
  },
  {
    name: 'get_registration_token',
    description: 'Retrieve the registration token for a site, organization unit, or customer.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: {
          type: 'string',
          description: 'The type of entity to retrieve the token for',
          enum: ['site', 'orgUnit', 'customer'],
        },
        id: { type: 'number', description: 'The entity ID (siteId, orgUnitId, or customerId)' },
      },
      required: ['entityType', 'id'],
    },
    handler: async (args) => {
      const id = sanitizePathParam(args.id);
      switch (args.entityType) {
        case 'site':     return await apiGet(`/api/sites/${id}/registration-token`);
        case 'orgUnit':  return await apiGet(`/api/org-units/${id}/registration-token`);
        case 'customer': return await apiGet(`/api/customers/${id}/registration-token`);
        default: throw new Error(`Unknown entityType: ${args.entityType}`);
      }
    },
  },
  {
    name: 'get_server_info',
    description: 'Return N-central server information. Use level="health" for uptime/start time, level="extra" for system version details, or omit level (default) for API-service version info.',
    inputSchema: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          description: 'Information level: omit for basic API version info, "health" for uptime check, "extra" for system component versions',
          enum: ['basic', 'health', 'extra'],
        },
      },
    },
    handler: async (args) => {
      switch (args.level) {
        case 'health': return await apiGet('/api/health');
        case 'extra':  return await apiGet('/api/server-info/extra');
        default:       return await apiGet('/api/server-info');
      }
    },
  },
  {
    name: 'validate_token',
    description: 'Check the validity of the current API access token.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      return await apiGet('/api/auth/validate');
    },
  },
  {
    name: 'get_device_activation_key',
    description: 'Generate an activation key for a device by device ID.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/devices/${sanitizePathParam(args.deviceId)}/activation-key`);
    },
  },
  {
    name: 'get_software_installers',
    description: 'Retrieve software installer download URLs for a specific customer. Supports filtering by software type and installer type.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'number', description: 'The customer ID' },
        softwareType: { type: 'string', description: 'Software type filter (e.g. "agent")' },
        installerType: { type: 'string', description: 'Installer type filter (e.g. "msi", "exe")' },
      },
      required: ['customerId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/customers/${sanitizePathParam(args.customerId)}/software/installers`, {
        softwareType: args.softwareType,
        installerType: args.installerType,
      });
    },
  },
  {
    name: 'get_psa_customer_mapping',
    description: 'Retrieve PSA (Professional Services Automation) customer mapping for a given customer ID.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'number', description: 'The customer ID' },
      },
      required: ['customerId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/standard-psa/customer-mapping/${sanitizePathParam(args.customerId)}`);
    },
  },
  {
    name: 'get_report',
    description: 'Retrieve an N-central report by its report ID.',
    inputSchema: {
      type: 'object',
      properties: {
        reportId: { type: 'string', description: 'The report ID' },
      },
      required: ['reportId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/report/${sanitizePathParam(args.reportId)}`);
    },
  },
  {
    name: 'create_maintenance_windows',
    writeScope: 'write',
    description: 'Add a set of patch maintenance windows to a list of devices. Body shape: { deviceIDs: number[], maintenanceWindows: [...] }. See N-central API docs for MaintenanceWindowRequest field details.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceIDs: { type: 'array', description: 'Device IDs to apply maintenance windows to', items: { type: 'integer' } },
        maintenanceWindows: { type: 'array', description: 'Array of MaintenanceWindowRequest objects', items: { type: 'object' } },
      },
      required: ['deviceIDs', 'maintenanceWindows'],
    },
    handler: async (args) => {
      return await apiPost('/api/devices/maintenance-windows', {
        deviceIDs: args.deviceIDs,
        maintenanceWindows: args.maintenanceWindows,
      });
    },
  },
  {
    name: 'update_maintenance_windows',
    writeScope: 'write',
    description: 'Modify existing device patch maintenance windows by their ScheduleId (included in each window object).',
    inputSchema: {
      type: 'object',
      properties: {
        maintenanceWindows: { type: 'array', description: 'Array of MaintenanceWindowRequest objects (must include scheduleId)', items: { type: 'object' } },
      },
      required: ['maintenanceWindows'],
    },
    handler: async (args) => {
      return await apiPut('/api/devices/maintenance-windows', {
        maintenanceWindows: args.maintenanceWindows,
      });
    },
  },
  {
    name: 'delete_maintenance_windows',
    writeScope: 'destructive',
    description: 'Delete device patch maintenance windows by a list of Schedule IDs. IRREVERSIBLE.',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleIds: { type: 'array', description: 'Schedule IDs of maintenance windows to delete', items: { type: 'integer' } },
      },
      required: ['scheduleIds'],
    },
    handler: async (args) => {
      return await apiDelete('/api/devices/maintenance-windows', {}, { scheduleIds: args.scheduleIds });
    },
  },
  {
    name: 'validate_psa_credential',
    writeScope: 'write',
    description: 'Validate Standard PSA credentials for a given PSA type. Transmits credentials in the request body — use with care over untrusted transports.',
    inputSchema: {
      type: 'object',
      properties: {
        psaType: { type: 'string', description: 'The PSA type (as returned by list_standard_psa)' },
        username: { type: 'string', description: 'PSA username' },
        password: { type: 'string', description: 'PSA password' },
      },
      required: ['psaType', 'username', 'password'],
    },
    handler: async (args) => {
      return await apiPost(`/api/standard-psa/${sanitizePathParam(args.psaType)}/credential`, {
        username: args.username,
        password: args.password,
      });
    },
  },
  {
    name: 'get_custom_psa_ticket_detail',
    writeScope: 'write',
    description: 'Retrieve detailed information for a specific Custom PSA ticket. Uses POST because the endpoint requires PSA credentials in the body.',
    inputSchema: {
      type: 'object',
      properties: {
        customPsaTicketId: { type: 'string', description: 'The Custom PSA ticket ID' },
        username: { type: 'string', description: 'PSA username' },
        password: { type: 'string', description: 'PSA password' },
      },
      required: ['customPsaTicketId', 'username', 'password'],
    },
    handler: async (args) => {
      return await apiPost(
        `/api/custom-psa/tickets/${sanitizePathParam(args.customPsaTicketId)}`,
        { username: args.username, password: args.password }
      );
    },
  },
  {
    name: 'get_server_info_authenticated',
    writeScope: 'write',
    description: 'Retrieve extra server version information using supplied credentials (for third-party system versions).',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Username for the target system' },
        password: { type: 'string', description: 'Password for the target system' },
      },
      required: ['username', 'password'],
    },
    handler: async (args) => {
      return await apiPost('/api/server-info/extra/authenticated', {
        username: args.username,
        password: args.password,
      });
    },
  },
  {
    name: 'generate_software_download_link',
    writeScope: 'write',
    description: 'Generate a software download link for a customer. Provide the softwareId obtained from get_software_installers.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'number', description: 'The customer ID' },
        softwareId: { type: 'string', description: 'The software installer ID' },
      },
      required: ['customerId', 'softwareId'],
    },
    handler: async (args) => {
      return await apiPost(`/api/customers/${sanitizePathParam(args.customerId)}/software/installers`, {
        softwareId: args.softwareId,
      });
    },
  },
  {
    name: 'list_api_links',
    description: 'Retrieve HATEOAS _links for an API section — useful for API discovery. Sections: root (/api), auth (/api/auth), access-groups (/api/access-groups), users (/api/users), scheduled-tasks (/api/scheduled-tasks), standard-psa (/api/standard-psa), custom-psa (/api/custom-psa), custom-psa-tickets (/api/custom-psa/tickets). These endpoints return link catalogs, not data — use the dedicated tools (list_users, list_access_groups, etc.) for actual records.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'Which section of the API to list links for',
          enum: ['root', 'auth', 'access-groups', 'users', 'scheduled-tasks', 'standard-psa', 'custom-psa', 'custom-psa-tickets'],
        },
      },
      required: ['section'],
    },
    handler: async (args) => {
      const sectionMap = {
        'root': '/api',
        'auth': '/api/auth',
        'access-groups': '/api/access-groups',
        'users': '/api/users',
        'scheduled-tasks': '/api/scheduled-tasks',
        'standard-psa': '/api/standard-psa',
        'custom-psa': '/api/custom-psa',
        'custom-psa-tickets': '/api/custom-psa/tickets',
      };
      const path = sectionMap[args.section];
      if (!path) throw new Error(`Unknown section: ${args.section}`);
      return await apiGet(path);
    },
  },
];
