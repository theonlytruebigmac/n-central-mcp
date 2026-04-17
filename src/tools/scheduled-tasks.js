/** Scheduled task tools. */

import { apiGet, apiPost, sanitizePathParam } from '../client.js';
import { paginationParams, paginationArgs } from '../shared.js';
import { fetchAll } from '../paginator.js';

export const scheduledTaskTools = [
  {
    name: 'get_scheduled_task',
    description: 'Retrieve general information for a given scheduled task by ID. Returns parent ID, name, type, customer ID, device IDs, and enabled status.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The scheduled task ID' },
      },
      required: ['taskId'],
    },
    handler: async (args) => {
      return await apiGet(`/api/scheduled-tasks/${sanitizePathParam(args.taskId)}`);
    },
  },
  {
    name: 'get_scheduled_task_status',
    description: 'Retrieve status for a given scheduled task. Returns aggregated status by default; set detailed=true to get per-device status breakdown.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The scheduled task ID' },
        detailed: { type: 'boolean', description: 'If true, returns per-device status details instead of the aggregated summary' },
      },
      required: ['taskId'],
    },
    handler: async (args) => {
      const base = `/api/scheduled-tasks/${sanitizePathParam(args.taskId)}/status`;
      return await apiGet(args.detailed ? `${base}/details` : base);
    },
  },
  {
    name: 'list_device_tasks',
    description: 'Retrieve scheduled tasks for a specific device. Returns task ID, task name, and status. Returns one page by default — set `all: true` to auto-paginate.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
        ...paginationParams,
      },
      required: ['deviceId'],
    },
    handler: async (args) => {
      const path = `/api/devices/${sanitizePathParam(args.deviceId)}/scheduled-tasks`;
      if (args.all) return await fetchAll(path);
      return await apiGet(path, paginationArgs(args));
    },
  },
  {
    name: 'create_direct_scheduled_task',
    writeScope: 'destructive',
    description: 'Create a direct-support scheduled task that executes an Automation Policy, Script, or MacScript on a target device. This runs arbitrary code on the managed endpoint — treat as destructive. Required body fields: name, itemId, taskType, customerId, deviceId, credential. Optional: parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Unique task name' },
        itemId: { type: 'number', description: 'Remote execution item ID (from the N-central UI)' },
        taskType: { type: 'string', description: 'Task type', enum: ['AutomationPolicy', 'Script', 'MacScript'] },
        customerId: { type: 'number', description: 'Customer ID' },
        deviceId: { type: 'number', description: 'Target device ID' },
        credential: { type: 'object', description: 'ScheduledTaskCredential object specifying credentials for the task' },
        parameters: { type: 'array', description: 'Optional array of ScheduledTaskParameter objects', items: { type: 'object' } },
      },
      required: ['name', 'itemId', 'taskType', 'customerId', 'deviceId', 'credential'],
    },
    handler: async (args) => {
      return await apiPost('/api/scheduled-tasks/direct', args);
    },
  },
];
