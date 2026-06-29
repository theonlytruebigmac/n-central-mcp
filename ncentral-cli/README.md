# ncentral-cli

Agent-first Python CLI for N-central through the MCP server in this repository.

## Install

Install the CLI globally with `pipx`, using exactly one role extra:

```bash
pipx install "ncentral-cli[read]"
pipx install "ncentral-cli[readwrite]"
pipx install "ncentral-cli[destructive]"
```

Choose one role:

- `ncentral-cli[read]`: read-only, 56 tools.
- `ncentral-cli[readwrite]`: read plus write, 82 tools.
- `ncentral-cli[destructive]`: full surface, 87 tools.

For a local checkout, build wheels and install globally from `dist/`:

```bash
./tools/build_python_packages.py --outdir ./dist
pipx install --force --pip-args="--find-links $(pwd)/dist" "ncentral-cli[read]"
pipx install --force --pip-args="--find-links $(pwd)/dist" "ncentral-cli[readwrite]"
pipx install --force --pip-args="--find-links $(pwd)/dist" "ncentral-cli[destructive]"
```

Run only one of those `pipx install` commands on a machine. If switching roles,
reinstall with `--force` for the desired role.

Create `~/.ncentral-mcp/config.json` so agents do not need to pass env vars or
credentials on every command:

```json
{
  "endpoint": "http://127.0.0.1:3100/mcp",
  "api_key": "replace-with-mcp-api-key"
}
```

The `--url` flag can override the configured endpoint for diagnostics, but auth
always comes from `~/.ncentral-mcp/config.json`:

```bash
ncentral --url http://127.0.0.1:3100/mcp tools
```

## Quick Checks

```bash
ncentral tools
ncentral devices list --customer "Example Customer" --device-type server --count
ncentral devices list --customer "Example Customer" --group-by deviceClass
ncentral devices inventory --customer "Example Customer" --device-type server --oldest 10
ncentral call get_server_info --arg level=health
```

## Agent Retrieval Pattern

Prefer the smallest query that answers the question:

```bash
# One cheap discovery page, projected to the useful fields.
ncentral devices list --page-size 5 --fields deviceId,deviceName,customerName

# Complete scoped count and grouping without external scripts.
ncentral devices list --customer "Example Customer" --device-type server --count
ncentral devices list --customer "Example Customer" --group-by deviceClass

# Compact asset data; --oldest sorts by the normalized creation date.
ncentral devices inventory --customer "Example Customer" \
  --device-class "Workstations - Windows" --oldest 10

# Normalized active issues and monitor status.
ncentral devices issues --customer "Example Customer" --group-by serviceName
ncentral devices monitor-status --customer "Example Customer" --state Failed --count

# Raw MCP escape hatch for full API coverage.
ncentral call list_devices --arg pageSize=5 --arg format=json
```

The default output is TOON via the `python-toon` package. Use `--output json`
for exact JSON, `--output compact-json` for byte-tight JSON, or `--output table`
for human scanning.

Inventory `createdOn` is the N-central record/enrollment creation time, not a
hardware manufacture date. Asset enrichment runs conservatively to respect
upstream rate limits, so always scope it by customer/site and class/type.

## Roles

The role marker packages mirror the MCP server write modes:

- `ncentral-cli-role-read`: read-only, 56 tools.
- `ncentral-cli-role-readwrite`: read plus write, 82 tools.
- `ncentral-cli-role-destructive`: full surface, 87 tools.

For source-tree testing, pass `--role read`, `--role read-write`, or
`--role destructive`.
