# N-Central CLI Architecture

This document explains why the Python `ncentral` CLI exists, how it is wired,
and what a future implementer needs to know before extending it.

## Purpose

The JavaScript MCP server in this repo exposes N-able N-central as MCP tools,
resources, and prompts. It is complete, but MCP-native tool use is verbose for
agents: every call requires loading large tool schemas and returning full JSON
unless the agent is very deliberate.

The Python CLI is an agent-first client of that MCP server. It does not call the
N-central REST API directly. Its job is to give agents a small, stable command
surface for:

- Fast targeted retrieval.
- Field projection.
- Result limiting.
- TOON output by default.
- Role-limited command exposure.
- A generic escape hatch for full MCP tool coverage.

The design intentionally preserves the upstream MCP server code. Keep new CLI
work in the Python packages unless a server bug requires a server fix.

## Package Layout

The CLI follows the same broad install-time role pattern as `halopsa-cli`.

```text
ncentral-core/
  src/ncentral_core/
    catalog.py       Static MCP tool catalog and role/category metadata.
    mcp.py           Minimal Streamable HTTP MCP client and config loading.
    output.py        TOON/JSON/table output and local projection helpers.
    role.py          Role marker discovery and role override handling.

ncentral-cli/
  src/ncentral/cli/main.py
                    Argparse command construction and command handlers.
  tests/test_catalog.py
                    Stdlib tests for counts, role gating, config, and output.

ncentral-cli-role-read/
ncentral-cli-role-readwrite/
ncentral-cli-role-destructive/
                    Empty marker packages discovered at runtime.

tools/build_python_packages.py
                    Builds local wheels for pipx installs.
```

The package split is deliberate:

- `ncentral-core` is reusable, dependency-owning code. It depends on
  `python-toon`.
- `ncentral-cli` owns the global `ncentral` entry point.
- Role packages are marker distributions. They should stay tiny.

## Installation Model

The intended install is global `pipx`, not a project-local virtualenv.

For a local checkout:

```bash
./tools/build_python_packages.py --outdir ./dist
pipx install --force --pip-args="--find-links $(pwd)/dist" "ncentral-cli[read]"
```

Use exactly one role extra:

- `ncentral-cli[read]`
- `ncentral-cli[readwrite]`
- `ncentral-cli[destructive]`

The extras pull in one marker package. Installing conflicting role markers in
the same environment is an error. Source-tree testing may use `--role`, but
normal agent use should rely on the installed role marker.

## Configuration And Auth

Runtime auth is config-file based. The CLI reads:

```text
~/.ncentral-mcp/config.json
```

Expected shape:

```json
{
  "endpoint": "http://127.0.0.1:3100/mcp",
  "api_key": "replace-with-mcp-api-key"
}
```

Important constraints:

- `api_key` is only read from `~/.ncentral-mcp/config.json`.
- `--api-key`, `--fqdn`, and `--jwt` were removed on purpose.
- `X-NC-FQDN` and `X-NC-JWT` are not emitted by the CLI.
- `--url` remains for endpoint diagnostics, but auth still comes from config.
- `NCENTRAL_MCP_URL` / `MCP_URL` still work as endpoint fallbacks; they do not
  carry auth.
- `NCENTRAL_MCP_TIMEOUT` may override timeout.

This is meant to keep agent commands short and avoid credentials in command
history or prompt logs. If you add config fields later, prefer config file over
new auth flags.

## MCP Transport

`ncentral_core.mcp.StreamableHttpMcpClient` implements the minimum MCP
Streamable HTTP flow needed by the CLI:

1. `initialize`
2. `notifications/initialized`
3. `tools/call`, `resources/read`, `prompts/list`, `prompts/get`
4. `DELETE` session close

It uses the standard library `urllib` to avoid adding an HTTP dependency. The
client accepts JSON and server-sent event style responses.

Tool results are MCP content arrays. The client extracts text content and parses
JSON-looking text back to Python objects. If the MCP server marks a tool result
as error, the CLI raises `NcentralMcpError` and prints the payload on stderr.

The CLI does not try to reimplement N-central auth, pagination, retry behavior,
or endpoint quirks. Those stay in the MCP server.

## Tool Catalog

`ncentral_core.catalog.TOOLS` is a static mirror of the MCP server tool surface.
It currently covers all 87 tools:

- 56 read tools.
- 26 write tools.
- 5 destructive tools.

Why static instead of introspecting the server at runtime:

- Help must be role-filtered before connecting to the MCP server.
- Agents need fast local discoverability.
- The CLI should still show useful help when the server is down.
- The implementation stays independent from the JavaScript modules.

When the MCP server adds or changes tools:

1. Update `ncentral_core.catalog.TOOLS`.
2. Keep scopes aligned with server `writeScope`.
3. Update expected counts in `ncentral-cli/tests/test_catalog.py`.
4. Re-run a catalog comparison against JS exports if available:

```bash
node --input-type=module -e '
import { deviceTools } from "./src/tools/devices.js";
import { organizationTools } from "./src/tools/organizations.js";
import { scheduledTaskTools } from "./src/tools/scheduled-tasks.js";
import { customPropertyTools } from "./src/tools/custom-properties.js";
import { userTools } from "./src/tools/users.js";
import { noteTools } from "./src/tools/notes.js";
import { maintenanceWindowTools } from "./src/tools/maintenance-windows.js";
import { registrationTools } from "./src/tools/registration.js";
import { psaTools } from "./src/tools/psa.js";
import { serverInfoTools } from "./src/tools/server-info.js";
import { reportTools } from "./src/tools/reports.js";
const tools=[...deviceTools,...organizationTools,...scheduledTaskTools,...customPropertyTools,...userTools,...noteTools,...maintenanceWindowTools,...registrationTools,...psaTools,...serverInfoTools,...reportTools].map(t=>({name:t.name,scope:t.writeScope||"read"}));
console.log(JSON.stringify(tools));
'
```

## Role Model

Roles are intentionally install-time markers, not config-driven scopes.

```text
read         -> read tools only
read-write   -> read + write tools
destructive  -> read + write + destructive tools
```

`ncentral_core.role.resolve_role()` discovers installed marker distributions:

- `ncentral-cli-role-read`
- `ncentral-cli-role-readwrite`
- `ncentral-cli-role-destructive`

If no marker is installed, source-tree execution defaults to `read`. If more
than one marker is installed, the CLI errors.

`--role` and `NCENTRAL_CLI_ROLE` exist for development and source-tree testing.
Do not rely on them for production role separation.

Role filtering affects both:

- What appears in help.
- What can execute.

This matters for agent safety. A read-role install should not even advertise
destructive commands.

## Command Surface

There are three command styles:

1. Category commands:

```bash
ncentral devices list --page-size 5 --fields deviceId,longName,customerName
ncentral organizations customers --page-size 10
ncentral reports active-issues --org-unit-id 123 --format json
```

2. Search shortcuts:

```bash
ncentral search devices server --fields deviceId,longName,customerName --limit 10
```

3. Agent-oriented device queries:

```bash
ncentral devices list --customer "Example Customer" --device-type server --count
ncentral devices inventory --customer "Example Customer" --device-type server --oldest 10
ncentral devices issues --customer "Example Customer" --group-by serviceName
```

4. Full-coverage escape hatch:

```bash
ncentral call list_devices --arg pageSize=5
```

Category commands are generated from the static catalog. For each tool, the CLI
creates:

- A human-friendlier command alias such as `devices list`.
- The raw MCP tool name alias such as `list_devices`.
- Kebab-case CLI options such as `--device-id`.
- Raw schema-name aliases such as `--deviceId`.

Mutation aliases keep their verbs explicit (`delete-device`, not `device`) so
help remains self-explanatory.

## Search And Retrieval Ergonomics

The main retrieval goal is token efficiency for agents. The preferred pattern:

1. Start with a small page.
2. Use server-side `--select` filters when supported.
3. Use `--fields` to project only useful fields.
4. Use `--limit` for local search output.
5. Keep default TOON output.

`SEARCH_TARGETS` maps common nouns to list tools:

- `devices`
- `org-units`
- `service-orgs`
- `customers`
- `sites`
- `users`
- `device-filters`
- `scheduled-tasks`
- `custom-psa-tickets`

Search fetches the mapped list endpoint, applies an optional server `select`,
then does local case-insensitive matching and field projection. Device search
uses one bounded 200-row page by default; use the scoped device commands when a
complete customer result is required.

Device list queries resolve `--customer` and `--site` names through MCP, use the
org-unit device endpoint, and normalize common fields. Friendly class/type/OS
filters, `--count`, and `--group-by` retrieve the complete scoped result before
local processing. `--full` restores native device records.

`devices inventory` requests the MCP bulk report's compact summary view. This
exposes creation, hardware, OS, and optional lifecycle fields without returning
the full nested asset document. `devices issues` normalizes active issue names;
`devices monitor-status` provides bounded per-device service status retrieval.

## Output

Default output is TOON because it is compact and agent-readable.

`ncentral_core.output.to_toon()` first uses:

```python
from toon import encode
```

from the `python-toon` package. It falls back to invoking `toon -` only for
source-tree situations where the package import is unavailable. If both fail,
it returns compact JSON.

Supported output modes:

- `toon`: default.
- `json`: pretty JSON.
- `compact-json`: dense JSON.
- `table`: simple human scan table.
- `raw`: print strings unchanged, otherwise JSON.

`--fields` and `--limit` are local shaping features. They do not change the MCP
server request unless the underlying tool arg is also present. This distinction
matters: `--select` is passed through as N-central's server-side FIQL/RSQL row
filter, while `--fields` is local projection.

## Resources And Prompts

The CLI exposes the MCP resources and prompts:

```bash
ncentral resource ncentral://status
ncentral org-tree
ncentral prompts
ncentral prompt device-health-audit --arg orgUnitId=123
```

Resources are read through `resources/read`. Prompts use `prompts/list` and
`prompts/get`. These are useful when an agent needs broader context without
remembering specific tool names.

## Build Tool

`tools/build_python_packages.py` builds wheels for every repo-root directory
with a `pyproject.toml`. It bootstraps `.build-tools-venv` if the current
Python cannot import `build`.

Artifacts normally go to `dist/`, which is gitignored.

Use this before local pipx installs:

```bash
./tools/build_python_packages.py --outdir ./dist
pipx install --force --pip-args="--find-links $(pwd)/dist" "ncentral-cli[read]"
```

## Tests And Verification

Use stdlib tests:

```bash
PYTHONPATH=ncentral-core/src:ncentral-cli/src python3 -m unittest discover -s ncentral-cli/tests -v
```

Current tests verify:

- Catalog count matches README expectations.
- Role-filtered parser hides destructive commands in read role.
- Role marker distribution names resolve correctly.
- TOON encoding works.
- Config loading reads `~/.ncentral-mcp/config.json`.
- `--url` overrides configured endpoint while auth remains config-based.
- Removed auth flags are rejected.
- Agent-oriented command parsing, scope resolution, filtering, grouping, and
  normalized field projection.

Live smoke test with configured auth:

```bash
PYTHONPATH=ncentral-core/src:ncentral-cli/src python3 -m ncentral.cli.main \
  --output json call get_server_info --arg level=health
```

Installed smoke test:

```bash
ncentral tools
ncentral devices list --customer "Example Customer" --device-type server --count
```

## Known Quirks

- `get_server_time` may return a 404 from some N-central versions even though
  the MCP tool exists. The CLI should surface that as an upstream API error.
- N-central's `select` parameter is a row filter, not a field projection.
  Use CLI `--fields` for projection.
- Device search is bounded and may not represent a complete tenant. Prefer
  customer/site-scoped device commands for counts and inventory.
- N-central can report tenant-wide page totals for a filtered response. The MCP
  paginator treats empty and short pages as authoritative termination signals.
- Config auth currently supports only the MCP bearer token, not multi-tenant
  N-central headers.

## Extension Guidelines

When adding a feature:

1. Keep N-central API access behind the MCP server.
2. Prefer adding CLI-side ergonomics over changing the MCP server.
3. Keep auth out of command flags.
4. Keep read/write/destructive role behavior obvious in help and execution.
5. Add tests for command parsing and output behavior.
6. Preserve raw `call` coverage even when adding friendlier commands.
7. Avoid new runtime dependencies unless they clearly reduce complexity.

Good future features:

- Target-specific default field sets for `search`.
- Saved query presets in config, if they do not include credentials.
- Better local filtering operators.
- Optional command to print effective non-secret config.
- A generated catalog checker script.

Avoid:

- Direct REST calls to N-central.
- Reintroducing auth flags.
- Writing credentials to logs.
- Making role scope configurable in `~/.ncentral-mcp/config.json`.
