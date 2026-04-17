# N-central MCP Server

> A [Model Context Protocol](https://modelcontextprotocol.io/) server for **N-able N-central** — exposing the N-central REST API as AI-native tools, resources, and prompts for use with Claude, Antigravity, and any MCP-compatible client.

---

## Features at a Glance

- **78 tools** covering devices, organizations, users, custom properties, scheduled tasks, PSA integrations, maintenance windows, and reporting — full parity with the N-central REST API
- **Three write modes**: `read-only`, `write` (default), `full` — lets you expose only what agents should be allowed to do
- **Auto-paginated bulk reports** in CSV or JSON (page size 200, 5 concurrent API calls)
- **MCP Resources** for live org-hierarchy context without tool calls
- **MCP Prompts** for common audit and reporting workflows
- **Three transport modes**: Streamable HTTP, stdio (Claude Desktop), Docker
- **Production-grade auth**: JWT + Access Token auto-refresh, API key protection for the MCP endpoint, CORS support

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Get your N-central JWT token

In the N-central UI: **Administration → User Management → Users → [user] → API Access → Generate JSON Web Token**

> **Best practice:** Use a dedicated API-only user with least-privilege roles. The API user password expires every 90 days — reset it proactively to avoid auth failures.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Required | Description |
|---|---|---|
| `NC_SERVER_URL` | ✅ | Your N-central server URL (e.g. `https://ncentral.example.com`) |
| `NC_JWT_TOKEN` | ✅ | User-API JWT from the N-central UI |
| `NC_WRITE_MODE` | Optional | `read-only` \| `write` \| `full` — controls which tools get registered (default: `write`) |
| `MCP_API_KEY` | Recommended | Bearer token to protect the MCP HTTP endpoint |
| `MCP_PORT` | Optional | HTTP port (default: `3100`) |
| `MCP_BIND_ADDRESS` | Optional | Bind address (default: `127.0.0.1`, use `0.0.0.0` for Docker) |
| `MCP_CORS_ORIGIN` | Optional | Allowed CORS origin (e.g. `http://localhost:3000`) |

#### Write modes

`NC_WRITE_MODE` determines which tools the server exposes:

| Mode | Tool count | Includes |
|---|---|---|
| `read-only` | 56 | Only GET endpoints (devices, orgs, reports, etc.) |
| `write` *(default)* | 75 | Read tools + create/update tools (POST/PUT/PATCH) |
| `full` | 78 | Everything, including destructive tools: `delete_device`, `delete_maintenance_windows`, `create_direct_scheduled_task` |

All write tools are audit-logged automatically. Start in `read-only` if you are just evaluating, move to `write` once you trust the agent, and keep `full` reserved for trusted automation flows.

### 4. Start the server

**Option A — Streamable HTTP** *(recommended for Antigravity, MCP Inspector, REST clients)*

```bash
npm start
# Server available at http://localhost:3100/mcp
```

**Option B — stdio** *(for Claude Desktop)*

Add to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ncentral": {
      "command": "node",
      "args": ["/path/to/N-central_MCP/index.js"],
      "env": {
        "NC_SERVER_URL": "https://your-ncentral-server.com",
        "NC_JWT_TOKEN": "your-jwt-token-here",
        "NC_WRITE_MODE": "read-only"
      }
    }
  }
}
```

**Option C — Docker**

```bash
docker compose up -d
```

---

## Tools

Each tool is tagged with its required write mode:

- 🟢 **read** — available in every mode
- 🟡 **write** — requires `NC_WRITE_MODE=write` or `full`
- 🔴 **destructive** — requires `NC_WRITE_MODE=full`

### Pagination

Every `list_*` tool returns a single page by default (with pagination metadata: `pageNumber`, `pageSize`, `totalItems`, `totalPages`, `_links`). To retrieve every result across all pages in one call, pass `all: true` — the server will auto-paginate at 200 items per page (up to 40,000 items). For CSV/JSON exports over large datasets, use the matching `report_*` tool instead.

### Devices (13)

| Tool | Mode | Description |
|------|------|-------------|
| `list_devices` | 🟢 | List all devices with pagination, sorting, and filter support |
| `list_devices_by_org_unit` | 🟢 | List devices under a specific org unit |
| `get_device` | 🟢 | Get a device by ID |
| `get_device_status` | 🟢 | Get service monitoring status for a device |
| `get_device_assets` | 🟢 | Get hardware/software asset info for a device |
| `get_device_lifecycle` | 🟢 | Get warranty/lifecycle info for a device |
| `get_device_activation_key` | 🟢 | Generate an agent activation key |
| `get_maintenance_windows` | 🟢 | Get all maintenance windows for a device |
| `get_appliance_task` | 🟢 | Get appliance task info by task ID |
| `create_device` | 🟡 | Add a new device (customerId, networkAddress, longName, supportedOs, deviceClass required) |
| `update_device_lifecycle` | 🟡 | PUT — replace asset lifecycle/warranty info (all fields required) |
| `patch_device_lifecycle` | 🟡 | PATCH — partially update asset lifecycle info |
| `delete_device` | 🔴 | Delete a device by ID (optional `removeAgents`) |

### Organizations (14)

| Tool | Mode | Description |
|------|------|-------------|
| `list_service_orgs` | 🟢 | List all service organizations |
| `get_service_org` | 🟢 | Get a specific service org by ID |
| `list_customers` | 🟢 | List customers (all or filtered by SO) |
| `get_customer` | 🟢 | Get a specific customer by ID |
| `list_sites` | 🟢 | List sites (all or filtered by customer) |
| `get_site` | 🟢 | Get a specific site by ID |
| `list_org_units` | 🟢 | List all organization units |
| `get_org_unit` | 🟢 | Get a specific org unit by ID |
| `list_org_unit_children` | 🟢 | List child org units for a parent |
| `get_psa_customer_mapping` | 🟢 | Get PSA customer mapping for a customer |
| `get_registration_token` | 🟢 | Get agent registration token for a site/customer/org unit |
| `create_service_org` | 🟡 | Create a new service organization |
| `create_customer` | 🟡 | Create a new customer under a service org |
| `create_site` | 🟡 | Create a new site under a customer |

### Scheduled Tasks & Reports Access (5)

| Tool | Mode | Description |
|------|------|-------------|
| `get_scheduled_task` | 🟢 | Get general info for a scheduled task |
| `get_scheduled_task_status` | 🟢 | Get aggregated or per-device task status |
| `list_device_tasks` | 🟢 | List all scheduled tasks for a device |
| `get_report` | 🟢 | Get a report by ID |
| `create_direct_scheduled_task` | 🔴 | Run an Automation Policy / Script / MacScript on a device (direct support task) |

### Custom Properties (9)

| Tool | Mode | Description |
|------|------|-------------|
| `list_device_custom_properties` | 🟢 | List all custom properties for a device |
| `get_device_custom_property` | 🟢 | Get a specific device custom property |
| `get_device_default_custom_property` | 🟢 | Get default custom property for an org unit |
| `list_org_custom_properties` | 🟢 | List custom properties for an org unit |
| `get_org_unit_property` | 🟢 | Get a specific org unit custom property |
| `get_org_custom_property_default` | 🟢 | Get default value for an org unit custom property |
| `update_device_custom_property` | 🟡 | Update a custom property value on a device |
| `update_org_unit_custom_property` | 🟡 | Update a custom property value on an org unit |
| `update_org_custom_property_default` | 🟡 | Update the default value of an org-unit custom property (with propagation) |

### Users & Access (9)

| Tool | Mode | Description |
|------|------|-------------|
| `list_users` | 🟢 | List users for an org unit |
| `list_user_roles` | 🟢 | List user roles for an org unit |
| `get_user_role` | 🟢 | Get a specific user role |
| `list_access_groups` | 🟢 | List access groups for an org unit |
| `get_access_group` | 🟢 | Get a specific access group by ID |
| `get_software_installers` | 🟢 | Get agent installer download URLs for a customer |
| `create_user_role` | 🟡 | Create a new user role for an org unit (PREVIEW) |
| `create_access_group` | 🟡 | Create a new org-unit-type access group |
| `create_device_access_group` | 🟡 | Create a new device-type access group |

### Misc (11)

| Tool | Mode | Description |
|------|------|-------------|
| `get_server_info` | 🟢 | Server/API version info, health, or extended system details |
| `list_device_filters` | 🟢 | List all device filters |
| `validate_token` | 🟢 | Validate the current API access token |
| `list_api_links` | 🟢 | HATEOAS link catalogs for API discovery (8 sections) |
| `create_maintenance_windows` | 🟡 | Add a set of patch maintenance windows to a list of devices |
| `update_maintenance_windows` | 🟡 | Modify existing maintenance windows by ScheduleId |
| `validate_psa_credential` | 🟡 | Validate Standard PSA credentials |
| `get_custom_psa_ticket_detail` | 🟡 | Retrieve a Custom PSA ticket (POST — requires creds) |
| `get_server_info_authenticated` | 🟡 | Extra server version info using supplied credentials |
| `generate_software_download_link` | 🟡 | Generate a software download link for a customer |
| `delete_maintenance_windows` | 🔴 | Delete maintenance windows by ScheduleIds |

### Reports (17)

All report tools auto-paginate and return **CSV** (default) or **JSON**. Bulk reports use **5 concurrent** API calls for speed.

| Tool | Mode | Description |
|------|------|-------------|
| `report_all_devices` | 🟢 | Full device inventory across the entire estate |
| `report_devices_by_org_unit` | 🟢 | All devices under a specific org unit |
| `report_devices_by_so` | 🟢 | All devices under a service org |
| `report_all_users` | 🟢 | All users for an org unit (auto-paginated) |
| `report_all_users_by_so` | 🟢 | Deduplicated users across an SO and all its customers |
| `report_customer_site_summary` | 🟢 | Customers with sites, device counts, and active issue counts |
| `report_org_hierarchy` | 🟢 | Full SO → Customer → Site hierarchy flat table |
| `report_org_entities` | 🟢 | Paginated list of customers, sites, or org units |
| `report_active_issues` | 🟢 | All active issues for an org unit |
| `report_job_statuses` | 🟢 | All job statuses for an org unit |
| `report_org_custom_properties` | 🟢 | All custom properties for an org unit |
| `report_device_custom_properties` | 🟢 | All custom properties for a device |
| `report_all_custom_properties_bulk` | 🟢 | Custom properties across ALL devices in an org unit |
| `report_device_assets_bulk` | 🟢 | Hardware/asset info for all devices in an org unit |
| `report_device_status_bulk` | 🟢 | Service monitoring status for all devices in an org unit |
| `report_device_tasks` | 🟢 | All scheduled tasks for a device |
| `generate_patch_comparison_report` | 🟡 | Submit a patch comparison report job (returns report ID) |

---

## Resources

Resources provide live context to the AI without requiring explicit tool calls.

| URI | Description |
|-----|-------------|
| `ncentral://org-tree` | Full SO → Customer → Site hierarchy with IDs and names |
| `ncentral://customers` | Flat list of all customers (auto-paginated) |
| `ncentral://sites` | Flat list of all sites (auto-paginated) |
| `ncentral://status` | Server health + version snapshot |

---

## Prompts

| Name | Description |
|------|-------------|
| `full-customer-report` | Comprehensive customer/site report with org custom properties |
| `device-health-audit` | Active issues and monitoring status across the environment |
| `agent-deployment-status` | Find sites with missing or low device counts |
| `custom-property-audit` | Audit custom property consistency across all customers |

---

## Resilience

| Concern | Behavior |
|---------|----------|
| Rate limits (429) | Auto-retry with exponential backoff on all methods (up to 3 attempts) |
| Unauthorized (401) | Auto re-authenticates from JWT and replays the request on all methods |
| Token expiry | Access tokens (1hr) and refresh tokens (25hr) auto-refreshed; concurrent refreshes coalesced |
| Server errors (500/503) | Retried on GET/PUT/DELETE (idempotent). POST/PATCH fail fast to avoid duplicate writes |
| Request timeouts | 30s on API calls, 15s on auth calls. Retried on idempotent methods only |
| Stale HTTP sessions | Cleaned up after 30 minutes of inactivity |

---

## Known API Quirks

- **Probe assets:** Return 404 — probes don't have asset records (expected behavior, skipped in bulk reports)
- **Active issues:** `deviceClassValue` and `deviceClassLabel` are always `null` (known N-central API bug)
- **`get_device` by ID:** `lastLoggedInUser` and `stillLoggedIn` may return `null` — use `list_devices` instead for these fields
- **Active issues at SO level:** The `/active-issues` endpoint only supports customer/site org unit types, not service org
- **PREVIEW endpoints:** `create_site` and `create_user_role` are flagged PREVIEW by N-central — the request/response shape may change between versions
- **Credentialed POST endpoints:** `validate_psa_credential`, `get_custom_psa_ticket_detail`, and `get_server_info_authenticated` transmit plaintext credentials in request bodies — only use over HTTPS and be mindful of audit-log contents

---

## Project Structure

```
├── index.js                  # Entry point — transport selection (stdio / HTTP)
├── src/
│   ├── auth.js               # JWT → Access Token auth, auto-refresh logic
│   ├── client.js             # HTTP client with retry, timeout, and rate-limit handling
│   ├── logging.js            # Structured logger
│   ├── paginator.js          # Auto-pagination helper
│   ├── prompts.js            # MCP Prompts definitions
│   ├── resources.js          # MCP Resources definitions
│   ├── shared.js             # Shared pagination schema helpers
│   └── tools/
│       ├── custom-properties.js
│       ├── devices.js
│       ├── misc.js
│       ├── organizations.js
│       ├── reports.js
│       ├── scheduled-tasks.js
│       └── users.js
├── test/
│   └── utils.test.js
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

---

## License

Released under the [MIT License](LICENSE) — see the `LICENSE` file for the full text.
