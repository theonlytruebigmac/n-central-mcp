/** Custom property tools — device and org unit properties. */

import { apiGet, apiPut, sanitizePathParam } from '../client.js';
import { paginationParams, paginationArgs } from '../shared.js';
import { fetchAll } from '../paginator.js';

const PROPERTY_TYPES = ['HTML_LINK', 'TEXT', 'DATE', 'ENUMERATED', 'PASSWORD'];
const PROPAGATION_TYPES = [
  'NO_PROPAGATION', 'SERVICE_ORGANIZATION_ONLY',
  'SERVICE_ORGANIZATION_AND_CUSTOMER_AND_SITE', 'SERVICE_ORGANIZATION_AND_CUSTOMER',
  'SERVICE_ORGANIZATION_AND_SITE', 'CUSTOMER_AND_SITE', 'CUSTOMER_ONLY', 'SITE_ONLY',
  'SERVICE_AND_ORGANIZATION', 'SERVICE_AND_ORGANIZATION_AND_DEVICE',
  'SERVICE_AND_DEVICE', 'ORGANIZATION_AND_DEVICE', 'ORGANIZATION_ONLY', 'DEVICE_ONLY',
];

export const customPropertyTools = [
  {
    name: 'list_device_custom_properties',
    description: 'Retrieve all custom properties for a specific device.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/devices/${sanitizePathParam(args.deviceId)}/custom-properties`);
    },
  },
  {
    name: 'get_device_custom_property',
    description: 'Retrieve a specific custom property for a device.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
        propertyId: { type: 'number', description: 'The custom property ID' },
      },
      required: ['deviceId', 'propertyId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/devices/${sanitizePathParam(args.deviceId)}/custom-properties/${sanitizePathParam(args.propertyId)}`);
    },
  },
  {
    name: 'list_org_custom_properties',
    description: 'Retrieve the list of custom properties for an organization unit. Returns one page by default — set `all: true` to auto-paginate.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        ...paginationParams,
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const path = `/api/org-units/${sanitizePathParam(args.orgUnitId)}/custom-properties`;
      if (args.all) return await fetchAll(path);
      return await apiGet(path, paginationArgs(args));
    },
  },
  {
    name: 'get_org_unit_property',
    description: 'Retrieve a specific custom property for an organization unit.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        propertyId: { type: 'number', description: 'The custom property ID' },
      },
      required: ['orgUnitId', 'propertyId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/custom-properties/${sanitizePathParam(args.propertyId)}`);
    },
  },
  {
    name: 'get_org_custom_property_default',
    description: 'Retrieve the default value for an organization unit custom property.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        propertyId: { type: 'number', description: 'The custom property ID' },
      },
      required: ['orgUnitId', 'propertyId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/org-custom-property-defaults/${sanitizePathParam(args.propertyId)}`);
    },
  },
  {
    name: 'get_device_default_custom_property',
    description: 'Retrieve the default device custom property information by organization unit ID and property ID.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        propertyId: { type: 'number', description: 'The custom property ID' },
      },
      required: ['orgUnitId', 'propertyId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/custom-properties/device-custom-property-defaults/${sanitizePathParam(args.propertyId)}`);
    },
  },
  {
    name: 'update_device_custom_property',
    writeScope: 'write',
    description: 'Update a custom property value on a specific device. propertyType must match the property definition (HTML_LINK, TEXT, DATE, ENUMERATED, or PASSWORD).',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
        propertyId: { type: 'number', description: 'The custom property ID' },
        propertyName: { type: 'string', description: 'The property name' },
        propertyType: { type: 'string', description: 'Property type', enum: PROPERTY_TYPES },
        value: { type: 'string', description: 'The property value to set' },
        enumeratedValueList: { type: 'array', description: 'Allowed values if propertyType is ENUMERATED', items: { type: 'string' } },
      },
      required: ['deviceId', 'propertyId'],
    },
    handler: async (args) => {
      const { deviceId, propertyId, ...body } = args;
      return await apiPut(
        `/api/devices/${sanitizePathParam(deviceId)}/custom-properties/${sanitizePathParam(propertyId)}`,
        { propertyId: String(propertyId), ...body }
      );
    },
  },
  {
    name: 'update_org_unit_custom_property',
    writeScope: 'write',
    description: 'Update a custom property value on an organization unit (SO, customer, or site). propertyType must match the property definition.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
        propertyId: { type: 'number', description: 'The custom property ID' },
        propertyName: { type: 'string', description: 'The property name' },
        propertyType: { type: 'string', description: 'Property type', enum: PROPERTY_TYPES },
        value: { type: 'string', description: 'The property value to set' },
        enumeratedValueList: { type: 'array', description: 'Allowed values if propertyType is ENUMERATED', items: { type: 'string' } },
      },
      required: ['orgUnitId', 'propertyId'],
    },
    handler: async (args) => {
      const { orgUnitId, propertyId, ...body } = args;
      return await apiPut(
        `/api/org-units/${sanitizePathParam(orgUnitId)}/custom-properties/${sanitizePathParam(propertyId)}`,
        { propertyId: String(propertyId), ...body }
      );
    },
  },
  {
    name: 'update_org_custom_property_default',
    writeScope: 'write',
    description: 'Update the default value of an org-unit custom property and optionally propagate the change down the org hierarchy. propagationType controls which levels receive the update.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID that owns the property' },
        propertyId: { type: 'number', description: 'The custom property ID' },
        propertyName: { type: 'string', description: 'The property name' },
        defaultValue: { type: 'string', description: 'The new default value' },
        propagate: { type: 'boolean', description: 'Whether to propagate changes to children org units' },
        propagationType: { type: 'string', description: 'Propagation strategy', enum: PROPAGATION_TYPES },
        selectedOrgUnitIds: { type: 'array', description: 'Specific org unit IDs the property applies to', items: { type: 'integer' } },
        enumeratedValueList: { type: 'array', description: 'Allowed values if the property type is ENUMERATED', items: { type: 'string' } },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      const { orgUnitId, ...body } = args;
      return await apiPut(`/api/org-units/${sanitizePathParam(orgUnitId)}/org-custom-property-defaults`, body);
    },
  },
];
