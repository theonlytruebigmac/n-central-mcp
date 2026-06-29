"""CLI entry point for the N-central MCP client."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from ncentral.cli.device_queries import (
    DEFAULT_DEVICE_FIELDS,
    DEFAULT_INVENTORY_FIELDS,
    DEFAULT_ISSUE_FIELDS,
    DEFAULT_STATUS_FIELDS,
    DeviceQueryService,
    aggregate,
    filter_devices,
    normalize_issue,
    project,
    rows,
    sort_rows,
)
from ncentral_core.catalog import (
    CATEGORIES,
    DESTRUCTIVE,
    SEARCH_TARGETS,
    TOOL_BY_NAME,
    TOOLS,
    ArgSpec,
    ToolSpec,
    allowed_scopes,
    counts_by_scope,
)
from ncentral_core.mcp import McpConfig, NcentralMcpError, StreamableHttpMcpClient
from ncentral_core.output import emit, filter_rows, limit_rows, project_fields
from ncentral_core.role import RoleError, resolve_role


def main(argv: list[str] | None = None) -> int:
    try:
        raw_argv = list(argv) if argv is not None else sys.argv[1:]
        reject_removed_auth_flags(raw_argv)
        role = resolve_role(override=extract_role_override(raw_argv))
        parser = build_parser(role)
        args = parser.parse_args(raw_argv)
        role = resolve_role(override=args.role)
        handler = getattr(args, "handler", None)
        if handler is None:
            parser.print_help()
            return 1
        return int(handler(args, role) or 0)
    except (NcentralMcpError, RoleError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        payload = getattr(exc, "payload", None)
        if payload is not None:
            print(json.dumps(payload, indent=2, sort_keys=True), file=sys.stderr)
        return 1


def extract_role_override(argv: list[str]) -> str | None:
    for index, value in enumerate(argv):
        if value == "--role" and index + 1 < len(argv):
            return argv[index + 1]
        if value.startswith("--role="):
            return value.split("=", 1)[1]
    return None


def reject_removed_auth_flags(argv: list[str]) -> None:
    removed = {"--api-key", "--fqdn", "--jwt"}
    for value in argv:
        option = value.split("=", 1)[0]
        if option in removed:
            raise ValueError(f"{option} has been removed; configure authentication in ~/.ncentral-mcp/config.json")


def build_parser(role: str = "read") -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ncentral", description="N-central MCP-backed CLI", allow_abbrev=False)
    parser.add_argument("--url", help="MCP endpoint URL. Default: ~/.ncentral-mcp/config.json endpoint, env, or http://127.0.0.1:3100/mcp")
    parser.add_argument("--timeout", type=float, help="HTTP timeout in seconds.")
    parser.add_argument("--role", choices=("read", "read-write", "destructive", "write", "rw", "full"), help="Override installed role marker.")
    parser.add_argument("--output", choices=("toon", "json", "compact-json", "raw", "table"), default="toon", help="Output format. Default: toon.")
    sub = parser.add_subparsers(dest="command", required=True)

    tools_parser = sub.add_parser("tools", help="List known MCP tools.")
    add_output_arg(tools_parser)
    tools_parser.add_argument("--scope", choices=("read", "write", "destructive"))
    tools_parser.add_argument("--category", choices=CATEGORIES)
    tools_parser.set_defaults(handler=handle_tools)

    call_parser = sub.add_parser("call", help="Call any MCP tool by name.")
    add_output_arg(call_parser)
    call_parser.add_argument("tool")
    add_payload_args(call_parser)
    call_parser.add_argument("--fields", help="Comma-separated fields to keep from JSON results.")
    call_parser.add_argument("--limit", type=int, help="Limit list-like JSON results.")
    call_parser.set_defaults(handler=handle_call)

    search_parser = sub.add_parser("search", help="Search common read endpoints with server filters plus local matching.")
    add_output_arg(search_parser)
    search_parser.add_argument("target", choices=tuple(SEARCH_TARGETS.keys()))
    search_parser.add_argument("query", nargs="?", help="Case-insensitive local text match across returned rows.")
    search_parser.add_argument("--select", help="Server-side FIQL/RSQL filter where supported.")
    search_parser.add_argument("--arg", action="append", default=[], help="Extra tool argument as key=value.")
    search_parser.add_argument("--fields", help="Comma-separated fields to keep.")
    search_parser.add_argument("--limit", type=int, default=25, help="Maximum rows after local matching. Default: 25.")
    search_parser.set_defaults(handler=handle_search)

    resource_parser = sub.add_parser("resource", help="Read an MCP resource URI.")
    add_output_arg(resource_parser)
    resource_parser.add_argument("uri", help="Example: ncentral://org-tree")
    resource_parser.set_defaults(handler=handle_resource)

    org_tree_parser = sub.add_parser("org-tree", help="Read ncentral://org-tree.")
    add_output_arg(org_tree_parser)
    org_tree_parser.add_argument("--fields", help="Comma-separated fields to keep when the resource is tabular.")
    org_tree_parser.set_defaults(handler=handle_org_tree)

    prompts_parser = sub.add_parser("prompts", help="List MCP prompts.")
    add_output_arg(prompts_parser)
    prompts_parser.set_defaults(handler=handle_prompts)

    prompt_parser = sub.add_parser("prompt", help="Get an MCP prompt by name.")
    add_output_arg(prompt_parser)
    prompt_parser.add_argument("name")
    prompt_parser.add_argument("--arg", action="append", default=[], help="Prompt argument as key=value.")
    prompt_parser.set_defaults(handler=handle_prompt)

    visible_scopes = allowed_scopes(role)
    for category in CATEGORIES:
        visible_tools = [tool for tool in TOOLS if tool.category == category and tool.scope in visible_scopes]
        if not visible_tools:
            continue
        category_parser = sub.add_parser(category, help=f"{category} tools")
        category_sub = category_parser.add_subparsers(dest=f"{category}_command", required=True)
        for spec in visible_tools:
            command_name = command_alias(spec)
            tool_parser = category_sub.add_parser(command_name, aliases=[spec.name], help=spec.description, description=spec.description)
            add_output_arg(tool_parser)
            add_tool_args(tool_parser, spec)
            tool_parser.add_argument("--fields", help="Comma-separated fields to keep from JSON results.")
            tool_parser.add_argument("--limit", type=int, help="Limit list-like JSON results.")
            if spec.name == "list_devices":
                add_device_filter_args(tool_parser)
                tool_parser.add_argument("--count", action="store_true", help="Return the number of matching devices.")
                tool_parser.add_argument("--group-by", help="Group matching devices by a field and count each value.")
                tool_parser.add_argument("--full", action="store_true", help="Return full native device records.")
                tool_parser.set_defaults(handler=handle_device_list, tool_name=spec.name)
            else:
                tool_parser.set_defaults(handler=handle_structured_tool, tool_name=spec.name)

        if category == "devices":
            add_device_query_parsers(category_sub)

    return parser


def handle_tools(args: argparse.Namespace, role: str) -> int:
    scopes = allowed_scopes(role)
    tools = [
        {"name": spec.name, "command": f"{spec.category} {command_alias(spec)}", "category": spec.category, "scope": spec.scope, "description": spec.description}
        for spec in TOOLS
        if spec.scope in scopes
        and (args.scope is None or spec.scope == args.scope)
        and (args.category is None or spec.category == args.category)
    ]
    emit({"role": role, "counts": counts_by_scope(TOOLS), "visible": len(tools), "tools": tools}, output=args.output)
    return 0


def handle_call(args: argparse.Namespace, role: str) -> int:
    spec = TOOL_BY_NAME.get(args.tool)
    if spec is None:
        raise ValueError(f"Unknown tool: {args.tool}")
    enforce_scope(spec, role)
    payload = load_payload(args)
    data = call_tool(args, args.tool, payload)
    data = shape_result(data, args.fields, args.limit)
    emit(data, output=args.output)
    return 0


def handle_structured_tool(args: argparse.Namespace, role: str) -> int:
    spec = TOOL_BY_NAME[args.tool_name]
    enforce_scope(spec, role)
    payload = payload_from_tool_args(args, spec)
    data = call_tool(args, spec.name, payload)
    data = shape_result(data, args.fields, args.limit)
    emit(data, output=args.output)
    return 0


def handle_device_list(args: argparse.Namespace, role: str) -> int:
    enforce_scope(TOOL_BY_NAME["list_devices"], role)
    with client_from_args(args) as client:
        service = DeviceQueryService(client)
        scope = service.resolve_scope(args.customer, args.site)
        has_local_filters = bool(args.device_class or args.device_type or args.os_family)
        devices = service.list_devices(
            scope=scope,
            select=args.select,
            page_number=args.pageNumber,
            page_size=args.pageSize,
            sort_by=args.sortBy,
            sort_order=args.sortOrder,
            all_pages=args.all or args.count or bool(args.group_by) or has_local_filters,
            filter_id=args.filterId,
        )
    devices = filter_devices(
        devices,
        device_classes=args.device_class,
        device_type=args.device_type,
        os_family=args.os_family,
    )
    result = aggregate(devices, args.group_by, args.count)
    if not isinstance(result, list):
        emit(result, output=args.output)
        return 0
    if args.limit is not None:
        result = result[: max(0, args.limit)]
    if args.full:
        result = [row.get("_raw", row) for row in result]
        fields = split_fields(args.fields)
    else:
        fields = split_fields(args.fields) or list(DEFAULT_DEVICE_FIELDS)
    if fields:
        result, missing = project(result, fields)
        warn_missing_fields(missing)
    emit(result, output=args.output)
    return 0


def handle_device_inventory(args: argparse.Namespace, role: str) -> int:
    enforce_scope(TOOL_BY_NAME["report_devices_bulk"], role)
    with client_from_args(args) as client:
        service = DeviceQueryService(client)
        scope = require_device_scope(service.resolve_scope(args.customer, args.site))
        devices = filter_devices(
            service.list_devices(scope=scope, all_pages=True, page_size=args.page_size),
            device_classes=args.device_class,
            device_type=args.device_type,
            os_family=args.os_family,
        )
        inventory = merge_inventory(devices, bulk_summary(client, scope, devices, "assets", args.concurrency))
        if args.include_lifecycle and devices:
            inventory = merge_inventory(inventory, bulk_summary(client, scope, devices, "lifecycle", args.concurrency))

    sort_field = args.sort
    descending = args.descending
    result_limit = args.limit
    if args.oldest is not None:
        sort_field, descending, result_limit = "createdOn", False, args.oldest
    elif args.newest is not None:
        sort_field, descending, result_limit = "createdOn", True, args.newest
    if sort_field:
        inventory = sort_rows(inventory, sort_field, descending)
    if result_limit is not None:
        inventory = inventory[: max(0, result_limit)]
    fields = split_fields(args.fields) or list(DEFAULT_INVENTORY_FIELDS)
    result, missing = project(inventory, fields)
    warn_missing_fields(missing)
    emit(result, output=args.output)
    return 0


def handle_device_issues(args: argparse.Namespace, role: str) -> int:
    enforce_scope(TOOL_BY_NAME["list_active_issues"], role)
    with client_from_args(args) as client:
        service = DeviceQueryService(client)
        scope = require_device_scope(service.resolve_scope(args.customer, args.site))
        issues = [normalize_issue(row) for row in rows(client.call_tool("list_active_issues", {
            "orgUnitId": scope["orgUnitId"],
            "format": "json",
        }))]
        if args.device_class or args.device_type or args.os_family:
            devices = filter_devices(
                service.list_devices(scope=scope, all_pages=True),
                device_classes=args.device_class,
                device_type=args.device_type,
                os_family=args.os_family,
            )
            allowed = {str(row.get("deviceId")) for row in devices}
            issues = [row for row in issues if str(row.get("deviceId")) in allowed]
    if args.service:
        query = args.service.casefold()
        issues = [row for row in issues if query in str(row.get("serviceName") or "").casefold()]
    if args.notification_state:
        query = args.notification_state.casefold()
        issues = [row for row in issues if str(row.get("notificationState") or "").casefold() == query]
    result = aggregate(issues, args.group_by, args.count)
    if isinstance(result, list):
        if args.limit is not None:
            result = result[: max(0, args.limit)]
        if args.full:
            result = [row.get("_raw", row) for row in result]
            fields = split_fields(args.fields)
        else:
            fields = split_fields(args.fields) or list(DEFAULT_ISSUE_FIELDS)
        if fields:
            result, missing = project(result, fields)
            warn_missing_fields(missing)
    emit(result, output=args.output)
    return 0


def handle_device_monitor_status(args: argparse.Namespace, role: str) -> int:
    enforce_scope(TOOL_BY_NAME["report_devices_bulk"], role)
    with client_from_args(args) as client:
        service = DeviceQueryService(client)
        scope = require_device_scope(service.resolve_scope(args.customer, args.site))
        devices = filter_devices(
            service.list_devices(scope=scope, all_pages=True, page_size=args.page_size),
            device_classes=args.device_class,
            device_type=args.device_type,
            os_family=args.os_family,
        )
        statuses = bulk_summary(client, scope, devices, "monitor-status", args.concurrency)
    if args.state:
        query = args.state.casefold()
        statuses = [row for row in statuses if str(row.get("state") or "").casefold() == query]
    if args.service:
        query = args.service.casefold()
        statuses = [row for row in statuses if query in str(row.get("serviceName") or "").casefold()]
    result = aggregate(statuses, args.group_by, args.count)
    if isinstance(result, list):
        if args.limit is not None:
            result = result[: max(0, args.limit)]
        fields = split_fields(args.fields) or list(DEFAULT_STATUS_FIELDS)
        result, missing = project(result, fields)
        warn_missing_fields(missing)
    emit(result, output=args.output)
    return 0


def handle_search(args: argparse.Namespace, role: str) -> int:
    tool_name, defaults = SEARCH_TARGETS[args.target]
    spec = TOOL_BY_NAME[tool_name]
    enforce_scope(spec, role)
    payload = dict(defaults)
    if args.select:
        payload["select"] = args.select
    payload.update(parse_key_values(args.arg))
    data = call_tool(args, tool_name, payload)
    data = filter_rows(data, args.query)
    data = limit_rows(data, args.limit)
    data = project_fields(data, split_fields(args.fields))
    emit({"target": args.target, "tool": tool_name, "query": args.query, "result": data}, output=args.output)
    return 0


def handle_resource(args: argparse.Namespace, role: str) -> int:
    if role not in {"read", "read-write", "destructive"}:
        raise ValueError(f"Unknown role: {role}")
    with client_from_args(args) as client:
        data = client.read_resource(args.uri)
    emit(data, output=args.output)
    return 0


def handle_org_tree(args: argparse.Namespace, role: str) -> int:
    if role not in {"read", "read-write", "destructive"}:
        raise ValueError(f"Unknown role: {role}")
    with client_from_args(args) as client:
        data = client.read_resource("ncentral://org-tree")
    data = project_fields(data, split_fields(args.fields))
    emit(data, output=args.output)
    return 0


def handle_prompts(args: argparse.Namespace, role: str) -> int:
    if role not in {"read", "read-write", "destructive"}:
        raise ValueError(f"Unknown role: {role}")
    with client_from_args(args) as client:
        data = client.list_prompts()
    emit(data, output=args.output)
    return 0


def handle_prompt(args: argparse.Namespace, role: str) -> int:
    if role not in {"read", "read-write", "destructive"}:
        raise ValueError(f"Unknown role: {role}")
    with client_from_args(args) as client:
        data = client.get_prompt(args.name, parse_key_values(args.arg))
    emit(data, output=args.output)
    return 0


def add_device_filter_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--customer", help="Customer name or ID. Unique partial names are accepted.")
    parser.add_argument("--site", help="Site name or ID. Use with --customer when the site name is not unique.")
    parser.add_argument("--device-class", action="append", default=[], help="Exact device class. May be repeated.")
    parser.add_argument("--device-type", choices=("server", "workstation", "laptop", "network", "printer", "other"))
    parser.add_argument("--os-family", choices=("windows", "linux", "mac", "other"))


def add_device_query_parsers(subparsers: argparse._SubParsersAction) -> None:
    inventory = subparsers.add_parser("inventory", help="Retrieve compact asset inventory for matching devices.")
    add_output_arg(inventory)
    add_device_filter_args(inventory)
    inventory.add_argument("--page-size", type=int, default=200, help="Device-list page size. Default: 200.")
    inventory.add_argument("--include-lifecycle", action="store_true", help="Include purchase and warranty lifecycle fields.")
    inventory.add_argument("--sort", help="Sort locally by a normalized inventory field.")
    inventory.add_argument("--descending", action="store_true", help="Reverse local sort order.")
    age = inventory.add_mutually_exclusive_group()
    age.add_argument("--oldest", type=int, metavar="N", help="Return the N oldest devices by creation date.")
    age.add_argument("--newest", type=int, metavar="N", help="Return the N newest devices by creation date.")
    inventory.add_argument("--fields", help="Comma-separated normalized fields to keep.")
    inventory.add_argument("--limit", type=int, help="Limit rows after enrichment and sorting.")
    inventory.add_argument("--concurrency", type=int, help="Bulk endpoint concurrency. Default: 1.")
    inventory.set_defaults(handler=handle_device_inventory)

    issues = subparsers.add_parser("issues", help="List normalized active issues for a customer or site.")
    add_output_arg(issues)
    add_device_filter_args(issues)
    issues.add_argument("--service", help="Case-insensitive service-name match.")
    issues.add_argument("--notification-state", help="Exact notification-state match.")
    issues.add_argument("--count", action="store_true")
    issues.add_argument("--group-by", help="Group issues by a normalized field.")
    issues.add_argument("--fields", help="Comma-separated normalized fields to keep.")
    issues.add_argument("--limit", type=int, help="Limit returned issue rows.")
    issues.add_argument("--full", action="store_true", help="Return full native issue records.")
    issues.set_defaults(handler=handle_device_issues)

    status = subparsers.add_parser("monitor-status", help="List normalized service-monitor status for matching devices.")
    add_output_arg(status)
    add_device_filter_args(status)
    status.add_argument("--page-size", type=int, default=200, help="Device-list page size. Default: 200.")
    status.add_argument("--state", help="Exact normalized status match, such as Failed or Normal.")
    status.add_argument("--service", help="Case-insensitive service-name match.")
    status.add_argument("--count", action="store_true")
    status.add_argument("--group-by", help="Group statuses by a normalized field.")
    status.add_argument("--fields", help="Comma-separated normalized fields to keep.")
    status.add_argument("--limit", type=int, help="Limit returned status rows.")
    status.add_argument("--concurrency", type=int, help="Bulk endpoint concurrency. Default: 1.")
    status.set_defaults(handler=handle_device_monitor_status)


def require_device_scope(scope: dict[str, Any] | None) -> dict[str, Any]:
    if scope is None:
        raise ValueError("This command requires --customer or --site to bound bulk retrieval")
    return scope


def bulk_summary(
    client: StreamableHttpMcpClient,
    scope: dict[str, Any],
    devices: list[dict[str, Any]],
    data_type: str,
    concurrency: int | None,
) -> list[dict[str, Any]]:
    if not devices:
        return []
    payload: dict[str, Any] = {
        "orgUnitId": scope["orgUnitId"],
        "dataType": data_type,
        "deviceIds": [str(row.get("deviceId")) for row in devices if row.get("deviceId") is not None],
        "view": "summary",
        "format": "json",
    }
    if concurrency is not None:
        payload["concurrency"] = concurrency
    return rows(client.call_tool("report_devices_bulk", payload))


def merge_inventory(base_rows: list[dict[str, Any]], detail_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {str(row.get("deviceId")): {key: value for key, value in row.items() if key != "_raw"} for row in base_rows}
    for detail in detail_rows:
        key = str(detail.get("deviceId"))
        current = by_id.setdefault(key, {})
        current.update({field: value for field, value in detail.items() if value not in (None, "")})
    return list(by_id.values())


def warn_missing_fields(fields: list[str]) -> None:
    if fields:
        print(f"Warning: fields absent from every row: {', '.join(fields)}", file=sys.stderr)


def call_tool(args: argparse.Namespace, tool_name: str, payload: dict[str, Any]) -> Any:
    with client_from_args(args) as client:
        return client.call_tool(tool_name, payload)


def client_from_args(args: argparse.Namespace) -> StreamableHttpMcpClient:
    return StreamableHttpMcpClient(
        McpConfig.from_env(
            url=args.url,
            timeout=args.timeout,
        )
    )


def enforce_scope(spec: ToolSpec, role: str) -> None:
    if spec.scope not in allowed_scopes(role):
        raise ValueError(f"Tool {spec.name} requires {spec.scope} scope; current role is {role}")


def add_payload_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", help="JSON object payload.")
    parser.add_argument("--input", help="Path to JSON payload, or '-' for stdin.")
    parser.add_argument("--arg", action="append", default=[], help="Tool argument as key=value. May be repeated.")


def add_output_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--output",
        choices=("toon", "json", "compact-json", "raw", "table"),
        default=argparse.SUPPRESS,
        help="Output format. Default: toon.",
    )


def add_tool_args(parser: argparse.ArgumentParser, spec: ToolSpec) -> None:
    for arg in spec.args:
        options = [f"--{kebab(arg.name)}"]
        raw_option = f"--{arg.name}"
        if raw_option not in options:
            options.append(raw_option)
        kwargs: dict[str, Any] = {"dest": arg.name, "required": arg.required, "help": arg.help or None}
        if arg.kind == "bool":
            parser.add_argument(*options, action="store_true", **kwargs)
            continue
        if arg.kind == "int":
            kwargs["type"] = int
        elif arg.kind == "float":
            kwargs["type"] = float
        if arg.choices:
            kwargs["choices"] = arg.choices
        parser.add_argument(*options, **kwargs)
    add_payload_args(parser)


def payload_from_tool_args(args: argparse.Namespace, spec: ToolSpec) -> dict[str, Any]:
    payload = load_payload(args)
    for arg in spec.args:
        value = getattr(args, arg.name, None)
        if value is None:
            continue
        if arg.kind == "json" and isinstance(value, str):
            value = json.loads(value)
        payload[arg.name] = value
    return payload


def load_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if getattr(args, "input", None):
        text = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8")
        loaded = json.loads(text)
        if not isinstance(loaded, dict):
            raise ValueError("Input JSON payload must be an object")
        payload.update(loaded)
    if getattr(args, "json", None):
        loaded = json.loads(args.json)
        if not isinstance(loaded, dict):
            raise ValueError("--json payload must be an object")
        payload.update(loaded)
    payload.update(parse_key_values(getattr(args, "arg", [])))
    return payload


def parse_key_values(items: list[str]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for item in items:
        if "=" not in item:
            raise ValueError(f"Expected key=value argument, got: {item}")
        key, raw = item.split("=", 1)
        values[key] = parse_scalar(raw)
    return values


def parse_scalar(raw: str) -> Any:
    stripped = raw.strip()
    if stripped == "":
        return ""
    if stripped.lower() in {"true", "false"}:
        return stripped.lower() == "true"
    if stripped.lower() == "null":
        return None
    if stripped[:1] in "[{":
        return json.loads(stripped)
    if re.fullmatch(r"-?\d+", stripped):
        return int(stripped)
    if re.fullmatch(r"-?\d+\.\d+", stripped):
        return float(stripped)
    return raw


def shape_result(data: Any, fields: str | None, limit: int | None) -> Any:
    data = limit_rows(data, limit)
    data = project_fields(data, split_fields(fields))
    return data


def split_fields(fields: str | None) -> list[str]:
    if not fields:
        return []
    return [field.strip() for field in fields.split(",") if field.strip()]


def command_alias(spec: ToolSpec) -> str:
    name = spec.name
    if spec.scope != "read":
        return kebab(name)
    explicit = {
        "list_devices": "list",
        "list_devices_by_org_unit": "by-org-unit",
        "get_device": "get",
        "get_appliance_task": "appliance-task",
        "list_org_units": "org-units",
        "get_org_unit": "org-unit",
        "get_org_unit_limits": "org-unit-limits",
        "list_org_unit_children": "org-unit-children",
        "get_server_info": "info",
        "get_server_time": "time",
        "list_device_filters": "device-filters",
        "get_registration_token": "registration-token",
        "get_device_activation_key": "activation-key",
        "get_software_installers": "software-installers",
        "get_maintenance_windows": "maintenance-windows",
        "get_psa_customer_mapping": "customer-mapping",
        "list_psa_customer_mappings": "customer-mappings",
        "get_custom_psa_ticket_detail": "custom-ticket-detail",
    }
    if name in explicit:
        return explicit[name]
    prefixes = {
        "devices": ("list_devices_by_", "list_devices", "get_device_", "get_device", "create_device", "update_device_", "patch_device_", "delete_device"),
        "organizations": ("list_", "get_", "create_", "update_"),
        "scheduled-tasks": ("list_", "get_", "create_"),
        "custom-properties": ("list_", "get_", "update_"),
        "users": ("list_", "get_", "create_"),
        "server-info": ("get_server_", "get_", "list_", "logout"),
        "registration": ("get_", "generate_"),
        "maintenance-windows": ("get_", "create_", "update_", "delete_"),
        "psa": ("list_", "get_", "create_", "update_", "validate_"),
        "notes": ("list_", "add_", "update_", "delete_", "clear_"),
        "reports": ("report_", "list_", "generate_"),
    }.get(spec.category, ())
    for prefix in prefixes:
        if name == prefix:
            return kebab(name)
        if name.startswith(prefix):
            trimmed = name[len(prefix):]
            return kebab(trimmed or name)
    return kebab(name)


def kebab(value: str) -> str:
    value = re.sub(r"(.)([A-Z][a-z]+)", r"\1-\2", value)
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", value)
    return value.replace("_", "-").lower()


if __name__ == "__main__":
    raise SystemExit(main())
