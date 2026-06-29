"""Agent-oriented device retrieval built exclusively on MCP tool calls."""

from __future__ import annotations

from collections import Counter
from typing import Any, Iterable


DEFAULT_DEVICE_FIELDS = (
    "deviceId",
    "deviceName",
    "customerName",
    "siteName",
    "deviceClass",
    "os",
    "lastCheckin",
)

DEFAULT_INVENTORY_FIELDS = (
    "deviceId",
    "deviceName",
    "deviceClass",
    "os",
    "createdOn",
    "manufacturer",
    "model",
    "serialNumber",
)

DEFAULT_ISSUE_FIELDS = (
    "deviceId",
    "deviceName",
    "serviceName",
    "notificationState",
)

DEFAULT_STATUS_FIELDS = (
    "deviceId",
    "deviceName",
    "serviceName",
    "state",
    "lastScanTime",
    "transitionTime",
)


class DeviceQueryService:
    def __init__(self, client: Any) -> None:
        self.client = client

    def resolve_scope(self, customer: str | None, site: str | None) -> dict[str, Any] | None:
        customer_row = None
        if customer:
            customers = rows(self.client.call_tool("list_customers", {"all": True, "format": "json"}))
            customer_row = resolve_named_row(customers, customer, "customerId", "customerName", "customer")

        if site:
            payload: dict[str, Any] = {"all": True, "format": "json"}
            if customer_row:
                payload["customerId"] = identifier(customer_row, "customerId")
            sites = rows(self.client.call_tool("list_sites", payload))
            site_row = resolve_named_row(sites, site, "siteId", "siteName", "site")
            return {
                "orgUnitId": identifier(site_row, "siteId"),
                "siteName": name(site_row, "siteName"),
                "customerId": identifier(customer_row, "customerId") if customer_row else site_row.get("customerId"),
                "customerName": name(customer_row, "customerName") if customer_row else site_row.get("customerName"),
            }

        if customer_row:
            return {
                "orgUnitId": identifier(customer_row, "customerId"),
                "customerId": identifier(customer_row, "customerId"),
                "customerName": name(customer_row, "customerName"),
            }
        return None

    def list_devices(
        self,
        *,
        scope: dict[str, Any] | None,
        select: str | None = None,
        page_number: int | None = None,
        page_size: int | None = None,
        sort_by: str | None = None,
        sort_order: str | None = None,
        all_pages: bool = False,
        filter_id: int | None = None,
    ) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"format": "json"}
        optional = {
            "select": select,
            "pageNumber": page_number,
            "pageSize": page_size,
            "sortBy": sort_by,
            "sortOrder": sort_order,
        }
        payload.update({key: value for key, value in optional.items() if value is not None})
        if all_pages:
            payload["all"] = True
        if scope:
            payload["orgUnitId"] = scope["orgUnitId"]
            tool = "list_devices_by_org_unit"
        else:
            tool = "list_devices"
            if filter_id is not None:
                payload["filterId"] = filter_id
        return [normalize_device(row) for row in rows(self.client.call_tool(tool, payload))]


def rows(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        data = data["data"]
    if not isinstance(data, list):
        return [data] if isinstance(data, dict) else []
    return [row for row in data if isinstance(row, dict)]


def identifier(row: dict[str, Any] | None, field: str) -> Any:
    if not row:
        return None
    value = row.get(field, row.get("orgUnitId", row.get("id")))
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return value


def name(row: dict[str, Any] | None, field: str) -> str | None:
    if not row:
        return None
    value = row.get(field, row.get("orgUnitName", row.get("name")))
    return str(value) if value is not None else None


def resolve_named_row(
    candidates: Iterable[dict[str, Any]],
    query: str,
    id_field: str,
    name_field: str,
    kind: str,
) -> dict[str, Any]:
    rows_list = list(candidates)
    query_folded = str(query).strip().casefold()
    id_matches = [row for row in rows_list if str(identifier(row, id_field)).casefold() == query_folded]
    if len(id_matches) == 1:
        return id_matches[0]
    exact = [row for row in rows_list if (name(row, name_field) or "").casefold() == query_folded]
    if len(exact) == 1:
        return exact[0]
    partial = [row for row in rows_list if query_folded in (name(row, name_field) or "").casefold()]
    if len(partial) == 1:
        return partial[0]
    if not partial:
        raise ValueError(f"No {kind} matched {query!r}")
    choices = ", ".join(f"{name(row, name_field)} ({identifier(row, id_field)})" for row in partial[:10])
    raise ValueError(f"Ambiguous {kind} {query!r}; matches: {choices}")


def normalize_device(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "deviceId": row.get("deviceId", row.get("id")),
        "deviceName": row.get("deviceName", row.get("longName", row.get("name"))),
        "customerId": row.get("customerId"),
        "customerName": row.get("customerName"),
        "siteName": row.get("siteName"),
        "deviceClass": row.get("deviceClass"),
        "os": row.get("os", row.get("supportedOs")),
        "lastCheckin": row.get("lastCheckin", row.get("lastApplianceCheckinTime")),
        **({"_raw": row} if row else {}),
    }


def filter_devices(
    devices: Iterable[dict[str, Any]],
    *,
    device_classes: Iterable[str] = (),
    device_type: str | None = None,
    os_family: str | None = None,
) -> list[dict[str, Any]]:
    class_names = {value.casefold() for value in device_classes}
    return [
        device for device in devices
        if (not class_names or str(device.get("deviceClass") or "").casefold() in class_names)
        and (not device_type or matches_device_type(device, device_type))
        and (not os_family or matches_os_family(device, os_family))
    ]


def matches_device_type(device: dict[str, Any], device_type: str) -> bool:
    value = str(device.get("deviceClass") or "").casefold()
    mappings = {
        "server": ("servers -",),
        "workstation": ("workstations -",),
        "laptop": ("laptop -",),
        "network": ("switch/router",),
        "printer": ("printer",),
    }
    prefixes = mappings.get(device_type, ())
    matched_known = any(value.startswith(prefix) for values in mappings.values() for prefix in values)
    return not matched_known if device_type == "other" else any(value.startswith(prefix) for prefix in prefixes)


def matches_os_family(device: dict[str, Any], family: str) -> bool:
    value = f"{device.get('os') or ''} {device.get('deviceClass') or ''}".casefold()
    if family == "windows":
        return "windows" in value
    if family == "linux":
        return "linux" in value
    if family == "mac":
        return any(token in value for token in ("mac", "darwin", "os x"))
    return not any(token in value for token in ("windows", "linux", "mac", "darwin", "os x"))


def aggregate(rows_list: list[dict[str, Any]], group_by: str | None, count: bool) -> Any:
    if group_by:
        counts = Counter(value_at(row, group_by) for row in rows_list)
        ordered = sorted(counts.items(), key=lambda item: (-item[1], str(item[0])))
        groups = [{"value": value, "count": amount} for value, amount in ordered]
        return {"count": len(rows_list), "groupBy": group_by, "groups": groups}
    if count:
        return {"count": len(rows_list)}
    return rows_list


def project(rows_list: list[dict[str, Any]], fields: Iterable[str]) -> tuple[list[dict[str, Any]], list[str]]:
    selected = tuple(fields)
    missing = [field for field in selected if rows_list and not any(has_path(row, field) for row in rows_list)]
    return [{field: value_at(row, field) for field in selected} for row in rows_list], missing


def value_at(row: dict[str, Any], path: str) -> Any:
    current: Any = row
    for part in path.split("."):
        if not isinstance(current, dict):
            current = None
            break
        current = current.get(part)
    if current is None and "." not in path and isinstance(row.get("_raw"), dict):
        return row["_raw"].get(path)
    return current


def has_path(row: dict[str, Any], path: str) -> bool:
    current: Any = row
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return "." not in path and isinstance(row.get("_raw"), dict) and path in row["_raw"]
        current = current[part]
    return True


def sort_rows(rows_list: list[dict[str, Any]], field: str, descending: bool = False) -> list[dict[str, Any]]:
    present = [row for row in rows_list if value_at(row, field) not in (None, "")]
    absent = [row for row in rows_list if value_at(row, field) in (None, "")]
    present.sort(key=lambda row: str(value_at(row, field)).casefold(), reverse=descending)
    return present + absent


def normalize_issue(row: dict[str, Any]) -> dict[str, Any]:
    extra = row.get("_extra") if isinstance(row.get("_extra"), dict) else {}
    return {
        "deviceId": row.get("deviceId", extra.get("deviceId")),
        "deviceName": row.get("deviceName") or extra.get("deviceName"),
        "serviceName": row.get("serviceName") or row.get("moduleName"),
        "notificationState": row.get("notificationState"),
        "state": row.get("state") or row.get("stateStatus"),
        "message": row.get("message") or row.get("taskNote"),
        "lastUpdate": row.get("lastUpdate") or row.get("transitionTime"),
        "_raw": row,
    }
