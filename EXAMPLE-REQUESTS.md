# Example HTTP Requests

This server exposes **Streamable HTTP** on `POST /mcp`. The payloads are **JSON-RPC**, not REST.

Use these examples to verify the HTTP listener by hand in normal single-tenant mode.

## Quick Start: Single-Tenant Curl Session

For simple manual testing, run the MCP server in single-tenant mode. The server reads the N-central credentials from its own environment, and each curl request only needs the MCP HTTP API key plus the MCP session ID.

In one terminal, export the server-side N-central settings and start the HTTP listener:

```bash
export NC_SERVER_URL="https://your-ncentral.example.com"
export NC_JWT_TOKEN="<your-ncentral-user-api-jwt>"
export MCP_API_KEY="<choose-a-local-test-api-key>"

npm run start:http
```

In a second terminal, export the curl-side settings:

```bash
export BASE_URL="http://127.0.0.1:3100/mcp"
export API_KEY="<same-value-as-MCP_API_KEY>"
export PROTOCOL_VERSION="2025-11-25"
```

Create one MCP HTTP session and store its ID:

```bash
export SESSION_ID="$(
  curl -sS -D - -o /tmp/mcp-init.json -X POST "$BASE_URL" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Accept: application/json, text/event-stream" \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\":\"2.0\",
      \"id\":1,
      \"method\":\"initialize\",
      \"params\":{
        \"protocolVersion\":\"$PROTOCOL_VERSION\",
        \"clientInfo\":{\"name\":\"curl\",\"version\":\"1.0\"},
        \"capabilities\":{}
      }
    }" \
  | awk -F': ' 'tolower($1)=="mcp-session-id" {gsub("\r", "", $2); print $2}'
)"
```

Confirm the session ID was captured:

```bash
echo "$SESSION_ID"
```

If `SESSION_ID` is empty, inspect the initialize response:

```bash
cat /tmp/mcp-init.json
```

Common causes:

- `401`: `API_KEY` does not match the server's `MCP_API_KEY`.
- `406`: missing `Accept: application/json, text/event-stream`.
- Startup failure: the server terminal is missing `NC_SERVER_URL`, `NC_JWT_TOKEN`, or `MCP_API_KEY`.

All later `/mcp` requests reuse:

- `Authorization: Bearer $API_KEY`
- `mcp-session-id: $SESSION_ID`
- `Accept: application/json, text/event-stream`
- `Content-Type: application/json`

MCP `POST /mcp` responses use server-sent events, so the raw body starts with `event:` and `data:` lines. The examples below pipe responses through:

```bash
sed -n 's/^data: //p'
```

That extracts the JSON-RPC response before handing it to `jq`.

## Notes

- The current SDK accepts protocol versions `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, and `2024-10-07`.
- `2025-11-25` is the right default for these curl examples.
- For simple testing, do not set `NC_MULTI_TENANT=1`.
- If you intentionally use multi-tenant mode, include `X-NC-FQDN` and `X-NC-JWT` on the initial `initialize` request.

## 1. Health check

```bash
curl -s http://127.0.0.1:3100/healthz | jq
```

Expected shape:

```json
{"status":"ok","sessions":0}
```

`/metrics` is also available:

```bash
curl -s http://127.0.0.1:3100/metrics | head
```

Expected output type:

- Prometheus text format

## 2. Initialize a session manually

The quick-start section already captured `SESSION_ID`. Use this manual request only when you want to see the raw initialization response and headers.

```bash
curl -i -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\":\"2.0\",
    \"id\":1,
    \"method\":\"initialize\",
    \"params\":{
      \"protocolVersion\":\"$PROTOCOL_VERSION\",
      \"clientInfo\":{
        \"name\":\"curl\",
        \"version\":\"1.0\"
      },
      \"capabilities\":{}
    }
  }"
```

Expected output type:

- server-sent event with a JSON-RPC response in the `data:` line

Expected response fields:

- `result.protocolVersion`
- `result.capabilities`
- `result.serverInfo`
- optional `result.instructions`

Important:

- The response includes a `mcp-session-id` header.
- Save that value and send it on later `/mcp` requests.

## 3. List tools

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/list",
    "params":{}
  }' \
  | sed -n 's/^data: //p' \
  | jq
```

Expected output type:

- JSON-RPC response with `result.tools[]`

Each tool entry includes:

- `name`
- `description`
- `inputSchema`
- optional `annotations`

The standard list methods also accept the MCP pagination cursor:

- `params.cursor`

This server has a small fixed set of tools, so pagination is usually unnecessary.

## 4. Inspect one tool schema

Use `tools/list` and filter locally. Example:

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/list",
    "params":{}
  }' \
  | sed -n 's/^data: //p' \
  | jq '.result.tools[] | select(.name=="list_devices")'
```

This is the authoritative way to see the exact inputs for a tool on your running server.

## 5. Call a read-only list tool

Example: `list_devices`

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":4,
    "method":"tools/call",
    "params":{
      "name":"list_devices",
      "arguments":{
        "pageNumber":1,
        "pageSize":5,
        "sortBy":"deviceName",
        "sortOrder":"ascending",
        "format":"json"
      }
    }
  }' \
  | sed -n 's/^data: //p' \
  | jq -r '.result.content[0].text | fromjson'
```

Available inputs for `list_devices`:

- `filterId` number
- `pageNumber` number
- `pageSize` number
- `select` string filter expression
- `sortBy` string
- `sortOrder` string
- `all` boolean
- `format` string, `json` or `csv`

Expected output type:

- Parsed JSON from the MCP tool result
- The example above extracts and parses `result.content[0].text`
- If `format` is `csv`, remove `| fromjson` and print the text directly

Typical payload shape:

- JSON output: a page envelope with `data`, `pageNumber`, `pageSize`, `totalItems`, `totalPages`, and `_links`
- CSV output: spreadsheet-friendly comma-separated text

## 6. Call a tool that takes an ID

Example: `get_device`

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":5,
    "method":"tools/call",
    "params":{
      "name":"get_device",
      "arguments":{
        "deviceId":"12345"
      }
    }
  }' \
  | sed -n 's/^data: //p' \
  | jq -r '.result.content[0].text | fromjson'
```

Available inputs:

- `deviceId` string

Expected output type:

- Parsed JSON from `result.content[0].text`

Other ID-based tools follow the same pattern, for example:

- `get_customer` with `customerId`
- `get_org_unit` with `orgUnitId`
- `get_site` with `siteId`
- `get_scheduled_task` with `taskId`

## 7. Read resources

List resources:

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":6,
    "method":"resources/list",
    "params":{}
  }' \
  | sed -n 's/^data: //p' \
  | jq
```

Expected resources:

- `ncentral://org-tree`
- `ncentral://status`
- `ncentral://device/{deviceId}`
- `ncentral://customer/{customerId}`
- `ncentral://org-unit/{orgUnitId}`

Read a resource:

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":7,
    "method":"resources/read",
    "params":{
      "uri":"ncentral://status"
    }
  }' \
  | sed -n 's/^data: //p' \
  | jq -r '.result.contents[0].text | fromjson? // .'
```

Expected output type:

- Parsed JSON from `result.contents[0].text`

Each resource content item includes:

- `uri`
- `mimeType`
- `text`

For this server, the resource text is JSON serialized as a string.

Example templated resource:

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":8,
    "method":"resources/read",
    "params":{
      "uri":"ncentral://device/12345"
    }
  }' \
  | sed -n 's/^data: //p' \
  | jq -r '.result.contents[0].text | fromjson? // .'
```

## 8. Read prompts

List prompts:

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":9,
    "method":"prompts/list",
    "params":{}
  }' \
  | sed -n 's/^data: //p' \
  | jq
```

Expected prompts:

- `full-customer-report`
- `device-health-audit`
- `agent-deployment-status`
- `custom-property-audit`

Get a prompt:

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":10,
    "method":"prompts/get",
    "params":{
      "name":"device-health-audit",
      "arguments":{
        "orgUnitId":"42"
      }
    }
  }' \
  | sed -n 's/^data: //p' \
  | jq
```

Expected output type:

- JSON-RPC response with `result.messages[]`

Each message contains:

- `role`
- `content.type`
- `content.text`

Prompt arguments are strings.

## 9. TOON output examples

For heavily repeated JSON arrays, TOON is usually easier to read in a terminal than raw JSON. Keep the tool request as `format: "json"`, extract the JSON from the MCP text payload, then pass it to `toon -e -`.

Example: show a compact device list in TOON:

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":12,
    "method":"tools/call",
    "params":{
      "name":"list_devices",
      "arguments":{
        "pageNumber":1,
        "pageSize":10,
        "sortBy":"deviceName",
        "sortOrder":"ascending",
        "format":"json"
      }
    }
  }' \
  | sed -n 's/^data: //p' \
  | jq '.result.content[0].text | fromjson | .data' \
  | toon -e -
```

That produces a TOON array table instead of a large repeated JSON object list.

For a narrower, more readable view, select only the fields you care about before converting:

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":13,
    "method":"tools/call",
    "params":{
      "name":"list_devices",
      "arguments":{
        "pageNumber":1,
        "pageSize":10,
        "sortBy":"deviceName",
        "sortOrder":"ascending",
        "format":"json"
      }
    }
  }' \
  | sed -n 's/^data: //p' \
  | jq '.result.content[0].text
        | fromjson
        | .data
        | map({
            deviceId,
            longName,
            customerName,
            deviceClass,
            lastLoggedInUser,
            lastApplianceCheckinTime
          })' \
  | toon -e -
```

If you want the page metadata too, convert a small object containing both `_page` and `devices`:

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":14,
    "method":"tools/call",
    "params":{
      "name":"list_devices",
      "arguments":{
        "pageNumber":1,
        "pageSize":10,
        "sortBy":"deviceName",
        "sortOrder":"ascending",
        "format":"json"
      }
    }
  }' \
  | sed -n 's/^data: //p' \
  | jq '.result.content[0].text
        | fromjson
        | {
            page: {
              pageNumber,
              pageSize,
              itemCount,
              totalItems,
              totalPages
            },
            devices: .data
          }' \
  | toon -e -
```

The same pattern works for other list tools:

```bash
| sed -n 's/^data: //p' \
| jq '.result.content[0].text | fromjson | .data' \
| toon -e -
```

## 10. How to read the outputs

The server returns MCP `POST /mcp` results in four layers:

1. HTTP response
2. Server-sent event frame
3. JSON-RPC envelope
4. MCP content blocks

Useful rules:

- Pipe MCP POST responses through `sed -n 's/^data: //p'` before `jq`.
- Tool success responses are usually `result.content[0].text`, even when the payload is JSON.
- For repeated JSON arrays, pipe parsed JSON to `toon -e -` for terminal-readable output.
- Tool errors are reported with `isError: true` in the MCP result, not as a protocol-level failure.
- Resources use `result.contents[]`.
- Prompts use `result.messages[]`.

To extract the inner JSON from a tool result:

```bash
curl -sS -X POST "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":11,
    "method":"tools/call",
    "params":{
      "name":"get_device",
      "arguments":{"deviceId":"12345"}
    }
  }' \
  | sed -n 's/^data: //p' \
  | jq -r '.result.content[0].text | fromjson? // .'
```

## 11. Session shutdown

If you want to close the session explicitly:

```bash
curl -sS -X DELETE "$BASE_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID"
```

`GET /mcp` also exists for long-lived session traffic, but it is not needed for simple manual testing of tool results.
