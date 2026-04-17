/** Organization tools — service orgs, customers, sites. */

import { apiGet, apiPost, sanitizePathParam } from '../client.js';
import { paginationParams, paginationArgs } from '../shared.js';
import { fetchAll } from '../paginator.js';

export const organizationTools = [
  {
    name: 'list_org_units',
    description: 'Retrieve a list of all organization units. Returns one page by default — set `all: true` to auto-paginate.',
    inputSchema: {
      type: 'object',
      properties: { ...paginationParams },
    },
    handler: async (args) => {
      if (args.all) return await fetchAll('/api/org-units');
      return await apiGet('/api/org-units', paginationArgs(args));
    },
  },
  {
    name: 'get_org_unit',
    description: 'Retrieve a specific organization unit by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The organization unit ID' },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/org-units/${sanitizePathParam(args.orgUnitId)}`);
    },
  },
  {
    name: 'list_org_unit_children',
    description: 'Retrieve a list of all child organization units for a given org unit.',
    inputSchema: {
      type: 'object',
      properties: {
        orgUnitId: { type: 'number', description: 'The parent organization unit ID' },
      },
      required: ['orgUnitId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/org-units/${sanitizePathParam(args.orgUnitId)}/children`);
    },
  },
  {
    name: 'list_service_orgs',
    description: 'Retrieve a list of all service organizations. Returns one page by default — set `all: true` to auto-paginate.',
    inputSchema: {
      type: 'object',
      properties: { ...paginationParams },
    },
    handler: async (args) => {
      if (args.all) return await fetchAll('/api/service-orgs');
      return await apiGet('/api/service-orgs', paginationArgs(args));
    },
  },
  {
    name: 'get_service_org',
    description: 'Retrieve a specific service organization by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        soId: { type: 'number', description: 'The service organization ID' },
      },
      required: ['soId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/service-orgs/${sanitizePathParam(args.soId)}`);
    },
  },
  {
    name: 'list_customers',
    description: 'Retrieve a list of customers. If soId is provided, returns only customers under that service organization; otherwise returns all customers. Returns one page by default — set `all: true` to auto-paginate.',
    inputSchema: {
      type: 'object',
      properties: {
        soId: { type: 'number', description: 'Optional service organization ID to filter customers by SO' },
        ...paginationParams,
      },
    },
    handler: async (args) => {
      const path = args.soId != null
        ? `/api/service-orgs/${sanitizePathParam(args.soId)}/customers`
        : '/api/customers';
      if (args.all) return await fetchAll(path);
      return await apiGet(path, paginationArgs(args));
    },
  },
  {
    name: 'get_customer',
    description: 'Retrieve a specific customer by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'number', description: 'The customer ID' },
      },
      required: ['customerId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/customers/${sanitizePathParam(args.customerId)}`);
    },
  },
  {
    name: 'list_sites',
    description: 'Retrieve a list of sites. If customerId is provided, returns only sites under that customer; otherwise returns all sites. Returns one page by default — set `all: true` to auto-paginate.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'number', description: 'Optional customer ID to filter sites by customer' },
        ...paginationParams,
      },
    },
    handler: async (args) => {
      const path = args.customerId != null
        ? `/api/customers/${sanitizePathParam(args.customerId)}/sites`
        : '/api/sites';
      if (args.all) return await fetchAll(path);
      return await apiGet(path, paginationArgs(args));
    },
  },
  {
    name: 'get_site',
    description: 'Retrieve a specific site by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        siteId: { type: 'number', description: 'The site ID' },
      },
      required: ['siteId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/sites/${sanitizePathParam(args.siteId)}`);
    },
  },
  {
    name: 'create_service_org',
    writeScope: 'write',
    description: 'Create a new service organization. Required: contactFirstName, contactLastName, soName. Optional: externalId, phone, contactTitle, contactEmail, contactPhone, contactPhoneExt, contactDepartment, street1, street2, city, stateProv, country (ISO 2-letter), postalCode.',
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          description: 'ServiceOrganizationCreation payload. Required: contactFirstName, contactLastName, soName.',
        },
      },
      required: ['body'],
    },
    handler: async (args) => {
      return await apiPost('/api/service-orgs', args.body);
    },
  },
  {
    name: 'create_customer',
    writeScope: 'write',
    description: 'Create a new customer under a service organization. Required body fields: contactFirstName, contactLastName, customerName. Optional: licenseType, externalId, contact info, address.',
    inputSchema: {
      type: 'object',
      properties: {
        soId: { type: 'number', description: 'The service organization ID this customer belongs to' },
        body: {
          type: 'object',
          description: 'CustomerCreation payload. Required: contactFirstName, contactLastName, customerName.',
        },
      },
      required: ['soId', 'body'],
    },
    handler: async (args) => {
      return await apiPost(`/api/service-orgs/${sanitizePathParam(args.soId)}/customers`, args.body);
    },
  },
  {
    name: 'create_site',
    writeScope: 'write',
    description: 'Create a new site under a customer (PREVIEW endpoint). Required body fields: contactFirstName, contactLastName, siteName. Optional: licenseType, externalId, contact info, address.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'number', description: 'The customer ID this site belongs to' },
        body: {
          type: 'object',
          description: 'SiteCreation payload. Required: contactFirstName, contactLastName, siteName.',
        },
      },
      required: ['customerId', 'body'],
    },
    handler: async (args) => {
      return await apiPost(`/api/customers/${sanitizePathParam(args.customerId)}/sites`, args.body);
    },
  },
];
