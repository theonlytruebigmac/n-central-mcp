/** Device tools — N-central device API endpoints. */

import { apiGet, apiPost, apiPut, apiPatch, apiDelete, sanitizePathParam } from '../client.js';
import { paginationParams, paginationArgs } from '../shared.js';
import { fetchAll } from '../paginator.js';

export const deviceTools = [
  {
    name: 'list_devices',
    description: 'Retrieve the list of all devices from N-central for the logged-in user. Returns one page by default — set `all: true` to auto-paginate through every page.',
    inputSchema: {
      type: 'object',
      properties: {
        filterId: { type: 'number', description: 'Filter ID to apply to device list' },
        ...paginationParams,
      },
    },
    handler: async (args) => {
      const params = args.filterId != null ? { filterId: args.filterId } : {};
      if (args.all) return await fetchAll('/api/devices', params);
      return await apiGet('/api/devices', { ...params, ...paginationArgs(args) });
    },
  },
  {
    name: 'get_device',
    description: 'Retrieve a specific device by its ID. Note: lastLoggedInUser and stillLoggedIn fields may be null (known issue) — use list_devices to get these values instead.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/devices/${sanitizePathParam(args.deviceId)}`);
    },
  },
  {
    name: 'get_device_status',
    description: 'Retrieve the status of service monitoring tasks for a given device.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/devices/${sanitizePathParam(args.deviceId)}/service-monitor-status`);
    },
  },
  {
    name: 'get_device_assets',
    description: 'Retrieve asset information for a device by ID. Note: Probes do not have assets and will return 404.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/devices/${sanitizePathParam(args.deviceId)}/assets`);
    },
  },
  {
    name: 'get_device_lifecycle',
    description: 'Retrieve asset lifecycle (warranty) information for a device by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/devices/${sanitizePathParam(args.deviceId)}/assets/lifecycle-info`);
    },
  },
  {
    name: 'list_devices_by_org_unit',
    description: 'Retrieve the list of devices belonging to a specific organization unit. Returns one page by default — set `all: true` to auto-paginate.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        ...paginationParams,
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const path = `/api/org-units/${sanitizePathParam(args.orgUnitId)}/devices`;
      if (args.all) return await fetchAll(path);
      return await apiGet(path, paginationArgs(args));
    },
  },
  {
    name: 'get_appliance_task',
    description: 'Retrieve appliance-task information by task ID.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The appliance task ID' },
      },
      required: ['taskId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/appliance-tasks/${sanitizePathParam(args.taskId)}`);
    },
  },
  {
    name: 'create_device',
    writeScope: 'write',
    description: 'Add a new device to N-central. Required body fields: customerId, networkAddress, longName, supportedOs, deviceClass. Optional: description, licenseMode, macAddress, username, password.',
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description: 'Device creation payload (DeviceAddRequest). Required: customerId, networkAddress, longName, supportedOs, deviceClass.',
        },
      },
      required: ['body'],
    },
    handler: async (args) => {
      return await apiPost('/api/device', args.body);
    },
  },
  {
    name: 'delete_device',
    writeScope: 'destructive',
    description: 'Delete a device from N-central by ID. Optionally remove agents installed on the device. IRREVERSIBLE.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID to delete' },
        removeAgents: { type: 'boolean', description: 'Whether to also uninstall agents from the device' },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      return await apiDelete(
        `/api/devices/${sanitizePathParam(args.deviceId)}`,
        args.removeAgents != null ? { removeAgents: args.removeAgents } : {}
      );
    },
  },
  {
    name: 'update_device_lifecycle',
    writeScope: 'write',
    description: 'Replace the asset lifecycle/warranty information for a device (PUT — all required fields must be provided).',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
        warrantyExpiryDate: { type: 'string', description: 'Warranty expiry date (ISO-8601 or YYYY-MM-DD)' },
        leaseExpiryDate: { type: 'string', description: 'Lease expiry date' },
        expectedReplacementDate: { type: 'string', description: 'Expected replacement date' },
        purchaseDate: { type: 'string', description: 'Purchase date' },
        cost: { type: 'number', description: 'Asset cost' },
        location: { type: 'string', description: 'Asset location' },
        assetTag: { type: 'string', description: 'Asset tag' },
        description: { type: 'string', description: 'Asset description' },
      },
      required: ['deviceId', 'warrantyExpiryDate', 'leaseExpiryDate', 'expectedReplacementDate', 'purchaseDate', 'cost', 'location', 'assetTag', 'description'],
    },
    handler: async (args) => {
      const { deviceId, ...body } = args;
      return await apiPut(`/api/devices/${sanitizePathParam(deviceId)}/assets/lifecycle-info`, body);
    },
  },
  {
    name: 'patch_device_lifecycle',
    writeScope: 'write',
    description: 'Partially update asset lifecycle/warranty information for a device (PATCH — only provided fields are modified).',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
        warrantyExpiryDate: { type: 'string', description: 'Warranty expiry date' },
        leaseExpiryDate: { type: 'string', description: 'Lease expiry date' },
        expectedReplacementDate: { type: 'string', description: 'Expected replacement date' },
        purchaseDate: { type: 'string', description: 'Purchase date' },
        cost: { type: 'number', description: 'Asset cost' },
        location: { type: 'string', description: 'Asset location' },
        assetTag: { type: 'string', description: 'Asset tag' },
        description: { type: 'string', description: 'Asset description' },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      const { deviceId, ...body } = args;
      return await apiPatch(`/api/devices/${sanitizePathParam(deviceId)}/assets/lifecycle-info`, body);
    },
  },
];
