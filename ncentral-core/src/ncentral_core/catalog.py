"""Static catalog of the N-central MCP command surface.

The catalog mirrors the tool list in the server README so the CLI can provide
role-filtered help and argument parsing without importing the JavaScript server.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


READ = "read"
WRITE = "write"
DESTRUCTIVE = "destructive"


@dataclass(frozen=True)
class ArgSpec:
    name: str
    kind: str = "str"
    required: bool = False
    choices: tuple[str, ...] = ()
    help: str = ""


@dataclass(frozen=True)
class ToolSpec:
    name: str
    scope: str
    category: str
    description: str
    args: tuple[ArgSpec, ...] = ()


PAGINATION_ARGS = (
    ArgSpec("pageNumber", "int", help="Page number, starting at 1."),
    ArgSpec("pageSize", "int", help="Page size, max 200."),
    ArgSpec("select", "str", help="FIQL/RSQL filter predicate. Example: soId==50."),
    ArgSpec("sortBy", "str", help="Field to sort by."),
    ArgSpec("sortOrder", "str", choices=("ASC", "asc", "ascending", "natural", "desc", "descending", "reverse"), help="Sort order."),
    ArgSpec("all", "bool", help="Auto-paginate all pages."),
)
FORMAT_ARG = ArgSpec("format", "str", choices=("json", "csv"), help="Server-side result format when supported.")


def a(name: str, kind: str = "str", required: bool = False, choices: Iterable[str] = (), help: str = "") -> ArgSpec:
    return ArgSpec(name=name, kind=kind, required=required, choices=tuple(choices), help=help)


def tool(name: str, category: str, description: str, args: Iterable[ArgSpec] = (), scope: str = READ) -> ToolSpec:
    return ToolSpec(name=name, scope=scope, category=category, description=description, args=tuple(args))


TOOLS: tuple[ToolSpec, ...] = (
    # Devices
    tool("list_devices", "devices", "List all devices with pagination, sorting, and filter support.", (a("filterId", "int"), *PAGINATION_ARGS, FORMAT_ARG)),
    tool("list_devices_by_org_unit", "devices", "List devices under a specific org unit.", (a("orgUnitId", "int", True), *PAGINATION_ARGS, FORMAT_ARG)),
    tool("get_device", "devices", "Get a device by ID.", (a("deviceId", required=True),)),
    tool("get_device_status", "devices", "Get service monitoring status for a device.", (a("deviceId", required=True),)),
    tool("get_device_assets", "devices", "Get hardware/software asset info for a device.", (a("deviceId", required=True),)),
    tool("get_device_lifecycle", "devices", "Get warranty/lifecycle info for a device.", (a("deviceId", required=True),)),
    tool("get_appliance_task", "devices", "Get appliance task info by task ID.", (a("taskId", required=True),)),
    tool("create_device", "devices", "Add a new device.", (a("body", "json", True),), WRITE),
    tool("update_device_lifecycle", "devices", "Replace asset lifecycle/warranty info.", (a("deviceId", required=True), a("warrantyExpiryDate", required=True), a("leaseExpiryDate", required=True), a("expectedReplacementDate", required=True), a("purchaseDate", required=True), a("cost", "float", True), a("location", required=True), a("assetTag", required=True), a("description", required=True)), WRITE),
    tool("patch_device_lifecycle", "devices", "Partially update asset lifecycle/warranty info.", (a("deviceId", required=True), a("warrantyExpiryDate"), a("leaseExpiryDate"), a("expectedReplacementDate"), a("purchaseDate"), a("cost", "float"), a("location"), a("assetTag"), a("description")), WRITE),
    tool("delete_device", "devices", "Delete a device by ID.", (a("deviceId", required=True), a("removeAgents", "bool")), DESTRUCTIVE),
    # Organizations
    tool("list_service_orgs", "organizations", "List all service organizations.", (*PAGINATION_ARGS, FORMAT_ARG)),
    tool("get_service_org", "organizations", "Get a service organization by ID.", (a("soId", "int", True),)),
    tool("list_customers", "organizations", "List customers, optionally filtered by service organization.", (a("soId", "int"), *PAGINATION_ARGS, FORMAT_ARG)),
    tool("get_customer", "organizations", "Get a customer by ID.", (a("customerId", "int", True),)),
    tool("list_sites", "organizations", "List sites, optionally filtered by customer.", (a("customerId", "int"), *PAGINATION_ARGS, FORMAT_ARG)),
    tool("get_site", "organizations", "Get a site by ID.", (a("siteId", "int", True),)),
    tool("list_org_units", "organizations", "List all organization units.", (*PAGINATION_ARGS, FORMAT_ARG)),
    tool("get_org_unit", "organizations", "Get an organization unit by ID.", (a("orgUnitId", "int", True),)),
    tool("get_org_unit_limits", "organizations", "Get licensing/usage limits for an org unit.", (a("orgUnitId", "int", True),)),
    tool("list_org_unit_children", "organizations", "List child organization units.", (a("orgUnitId", "int", True),)),
    tool("create_service_org", "organizations", "Create a service organization.", (a("soName", required=True), a("contactFirstName", required=True), a("contactLastName", required=True), a("externalId"), a("phone"), a("contactTitle"), a("contactEmail"), a("contactPhone"), a("contactPhoneExt"), a("contactDepartment"), a("street1"), a("street2"), a("city"), a("stateProv"), a("country"), a("postalCode")), WRITE),
    tool("create_customer", "organizations", "Create a customer under a service organization.", (a("soId", "int", True), a("customerName", required=True), a("contactFirstName", required=True), a("contactLastName", required=True), a("licenseType"), a("externalId"), a("phone"), a("contactTitle"), a("contactEmail"), a("contactPhone"), a("contactPhoneExt"), a("contactDepartment"), a("street1"), a("street2"), a("city"), a("stateProv"), a("country"), a("postalCode")), WRITE),
    tool("create_site", "organizations", "Create a site under a customer.", (a("customerId", "int", True), a("siteName", required=True), a("contactFirstName", required=True), a("contactLastName", required=True), a("licenseType"), a("externalId"), a("phone"), a("contactTitle"), a("contactEmail"), a("contactPhone"), a("contactPhoneExt"), a("contactDepartment"), a("street1"), a("street2"), a("city"), a("stateProv"), a("country"), a("postalCode")), WRITE),
    tool("update_org_unit_limits", "organizations", "Patch licensing/usage limits for an org unit.", (a("orgUnitId", "int", True), a("body", "json", True)), WRITE),
    # Scheduled tasks
    tool("list_scheduled_tasks", "scheduled-tasks", "List scheduled tasks.", (*PAGINATION_ARGS, FORMAT_ARG)),
    tool("get_scheduled_task", "scheduled-tasks", "Get a scheduled task.", (a("taskId", required=True),)),
    tool("get_scheduled_task_status", "scheduled-tasks", "Get aggregated or per-device task status.", (a("taskId", required=True), a("detailed", "bool"))),
    tool("list_device_tasks", "scheduled-tasks", "List scheduled tasks for a device.", (a("deviceId", required=True), *PAGINATION_ARGS, FORMAT_ARG)),
    tool("create_direct_scheduled_task", "scheduled-tasks", "Run an Automation Policy, Script, or MacScript on a device.", (a("name", required=True), a("itemId", "int", True), a("taskType", choices=("AutomationPolicy", "Script", "MacScript"), required=True), a("customerId", "int", True), a("deviceId", "int", True), a("credential", "json", True), a("parameters", "json")), DESTRUCTIVE),
    # Custom properties
    tool("list_device_custom_properties", "custom-properties", "List custom properties for a device.", (a("deviceId", required=True), FORMAT_ARG)),
    tool("get_device_custom_property", "custom-properties", "Get a device custom property.", (a("deviceId", required=True), a("propertyId", "int", True))),
    tool("get_device_default_custom_property", "custom-properties", "Get default device property for an org unit.", (a("orgUnitId", "int", True), a("propertyId", "int", True))),
    tool("list_org_custom_properties", "custom-properties", "List custom properties for an org unit.", (a("orgUnitId", "int", True), *PAGINATION_ARGS, FORMAT_ARG)),
    tool("get_org_unit_property", "custom-properties", "Get an org-unit custom property.", (a("orgUnitId", "int", True), a("propertyId", "int", True))),
    tool("get_org_custom_property_default", "custom-properties", "Get default value for an org-unit property.", (a("orgUnitId", "int", True), a("propertyId", "int", True))),
    tool("update_device_custom_property", "custom-properties", "Update a device custom property.", (a("deviceId", required=True), a("propertyId", "int", True), a("propertyName", required=True), a("propertyType", choices=("HTML_LINK", "TEXT", "DATE", "ENUMERATED", "PASSWORD"), required=True), a("value", required=True), a("enumeratedValueList", "json")), WRITE),
    tool("update_org_unit_custom_property", "custom-properties", "Update an org-unit custom property.", (a("orgUnitId", "int", True), a("propertyId", "int", True), a("propertyName", required=True), a("propertyType", choices=("HTML_LINK", "TEXT", "DATE", "ENUMERATED", "PASSWORD"), required=True), a("value", required=True), a("enumeratedValueList", "json")), WRITE),
    tool("update_org_custom_property_default", "custom-properties", "Update an org custom property default.", (a("orgUnitId", "int", True), a("propertyId", "int", True), a("propertyName", required=True), a("defaultValue", required=True), a("propagate", "bool"), a("propagationType", choices=("NO_PROPAGATION", "ALL_CHILDREN", "SPECIFIC_CHILDREN")), a("selectedOrgUnitIds", "json"), a("enumeratedValueList", "json")), WRITE),
    # Users and access
    tool("list_all_users", "users", "List all users globally.", (*PAGINATION_ARGS, FORMAT_ARG)),
    tool("get_current_user", "users", "Get the authenticated user.", ()),
    tool("list_users", "users", "List users for an org unit.", (a("orgUnitId", "int", True), *PAGINATION_ARGS, FORMAT_ARG)),
    tool("list_user_roles", "users", "List user roles for an org unit.", (a("orgUnitId", "int", True), *PAGINATION_ARGS)),
    tool("get_user_role", "users", "Get a user role.", (a("orgUnitId", "int", True), a("userRoleId", "int", True))),
    tool("list_access_groups", "users", "List access groups for an org unit.", (a("orgUnitId", "int", True), *PAGINATION_ARGS)),
    tool("get_access_group", "users", "Get an access group by ID.", (a("accessGroupId", required=True),)),
    tool("create_user_role", "users", "Create a user role.", (a("orgUnitId", "int", True), a("roleName", required=True), a("description", required=True), a("permissionIds", "json", True), a("userIds", "json")), WRITE),
    tool("create_access_group", "users", "Create an org-unit access group.", (a("orgUnitId", "int", True), a("groupName", required=True), a("groupDescription", required=True), a("orgUnitIds", "json"), a("userIds", "json"), a("autoIncludeNewOrgUnits")), WRITE),
    tool("create_device_access_group", "users", "Create a device access group.", (a("orgUnitId", "int", True), a("groupName", required=True), a("groupDescription", required=True), a("deviceIds", "json"), a("userIds", "json")), WRITE),
    # Server info and discovery
    tool("get_server_info", "server-info", "Server/API version info, health, or extended details.", (a("level", choices=("basic", "health", "extra")),)),
    tool("get_server_time", "server-info", "Get server time.", ()),
    tool("list_device_filters", "server-info", "List device filters.", (a("viewScope"), *PAGINATION_ARGS)),
    tool("get_report", "server-info", "Retrieve an N-central report by ID.", (a("reportId", required=True),)),
    tool("get_server_info_authenticated", "server-info", "Get extra server version info with supplied credentials.", (a("username", required=True), a("password", required=True)), WRITE),
    tool("logout", "server-info", "Invalidate the current N-central API session.", (), WRITE),
    # Registration and software
    tool("get_registration_token", "registration", "Get registration token for a site, org unit, or customer.", (a("entityType", required=True, choices=("site", "orgUnit", "customer")), a("id", "int", True))),
    tool("get_device_activation_key", "registration", "Generate a device activation key.", (a("deviceId", required=True),)),
    tool("get_software_installers", "registration", "List agent installer download URLs.", (a("customerId", "int", True), a("softwareType"), a("installerType"))),
    tool("generate_software_download_link", "registration", "Generate a software download link.", (a("customerId", "int", True), a("softwareId", required=True)), WRITE),
    # Maintenance windows
    tool("get_maintenance_windows", "maintenance-windows", "List maintenance windows for a device.", (a("deviceId", required=True),)),
    tool("create_maintenance_windows", "maintenance-windows", "Create patch maintenance windows.", (a("deviceIDs", "json", True), a("maintenanceWindows", "json", True)), WRITE),
    tool("update_maintenance_windows", "maintenance-windows", "Update patch maintenance windows.", (a("maintenanceWindows", "json", True),), WRITE),
    tool("delete_maintenance_windows", "maintenance-windows", "Delete maintenance windows by schedule ID.", (a("scheduleIds", "json", True),), DESTRUCTIVE),
    # PSA
    tool("get_psa_customer_mapping", "psa", "Get PSA customer mapping.", (a("customerId", "int", True),)),
    tool("list_psa_customer_mappings", "psa", "List PSA mappings for a customer.", (a("customerId", "int", True),)),
    tool("list_psa_companies", "psa", "List PSA companies for a customer.", (a("customerId", "int", True),)),
    tool("list_psa_company_contacts", "psa", "List contacts in a PSA company.", (a("customerId", "int", True), a("psaCompanyId", required=True))),
    tool("list_psa_company_sites", "psa", "List sites in a PSA company.", (a("customerId", "int", True), a("psaCompanyId", required=True))),
    tool("list_custom_psa_tickets", "psa", "List Custom PSA tickets.", ()),
    tool("validate_psa_credential", "psa", "Validate Standard PSA credentials.", (a("psaType", required=True), a("username", required=True), a("password", required=True)), WRITE),
    tool("get_custom_psa_ticket_detail", "psa", "Retrieve a Custom PSA ticket detail.", (a("customPsaTicketId", required=True), a("username", required=True), a("password", required=True)), WRITE),
    tool("create_custom_psa_ticket", "psa", "Create a Custom PSA ticket.", (a("body", "json", True),), WRITE),
    tool("update_psa_customer_mappings", "psa", "Update PSA mappings for a customer.", (a("customerId", "int", True), a("body", "json", True)), WRITE),
    # Device notes
    tool("list_device_notes", "notes", "List notes attached to a device.", (a("deviceId", required=True),)),
    tool("add_device_note", "notes", "Add a note to a device.", (a("deviceId", required=True), a("text", required=True)), WRITE),
    tool("add_notes_bulk", "notes", "Add the same note to many devices.", (a("deviceIDs", "json", True), a("text", required=True)), WRITE),
    tool("update_device_note", "notes", "Update a device note.", (a("deviceId", required=True), a("noteId", required=True), a("text", required=True)), WRITE),
    tool("delete_device_note", "notes", "Delete a device note.", (a("deviceId", required=True), a("noteId", required=True)), DESTRUCTIVE),
    tool("clear_device_notes", "notes", "Delete all notes on a device.", (a("deviceId", required=True),), DESTRUCTIVE),
    # Reports
    tool("report_devices_bulk", "reports", "Fan out a per-device call across an org unit.", (a("orgUnitId", "int", True), a("dataType", required=True, choices=("custom-properties", "assets", "lifecycle", "monitor-status")), a("select"), a("deviceIds", "json"), a("deviceLimit", "int"), a("view", choices=("raw", "summary")), FORMAT_ARG, a("concurrency", "int"))),
    tool("report_all_users_by_so", "reports", "Deduplicated users across an SO and its customers.", (a("soId", "int", True), FORMAT_ARG, a("concurrency", "int"))),
    tool("report_devices_by_so", "reports", "All devices under a service org.", (a("soId", "int", True), FORMAT_ARG)),
    tool("report_customer_site_summary", "reports", "Customers with sites and device counts.", (FORMAT_ARG,)),
    tool("report_org_hierarchy", "reports", "Flat SO/customer/site hierarchy report.", (FORMAT_ARG,)),
    tool("list_active_issues", "reports", "List active issues for an org unit.", (a("orgUnitId", "int", True), FORMAT_ARG)),
    tool("list_job_statuses", "reports", "List job statuses for an org unit.", (a("orgUnitId", "int", True), FORMAT_ARG)),
    tool("generate_patch_comparison_report", "reports", "Submit a patch comparison report job.", (a("startDate", required=True), a("installStatuses", "json"), a("patchApprovals", "json"), a("patchCategories", "json")), WRITE),
)

TOOL_BY_NAME: dict[str, ToolSpec] = {spec.name: spec for spec in TOOLS}
CATEGORIES: tuple[str, ...] = tuple(dict.fromkeys(spec.category for spec in TOOLS))

SEARCH_TARGETS: dict[str, tuple[str, dict[str, Any]]] = {
    "devices": ("list_devices", {"pageSize": 200, "format": "json"}),
    "org-units": ("list_org_units", {"all": True, "format": "json"}),
    "service-orgs": ("list_service_orgs", {"all": True, "format": "json"}),
    "customers": ("list_customers", {"all": True, "format": "json"}),
    "sites": ("list_sites", {"all": True, "format": "json"}),
    "users": ("list_all_users", {"all": True, "format": "json"}),
    "device-filters": ("list_device_filters", {"all": True}),
    "scheduled-tasks": ("list_scheduled_tasks", {"all": True, "format": "json"}),
    "custom-psa-tickets": ("list_custom_psa_tickets", {}),
}


def allowed_scopes(role: str) -> set[str]:
    if role == "read":
        return {READ}
    if role == "read-write":
        return {READ, WRITE}
    if role == "destructive":
        return {READ, WRITE, DESTRUCTIVE}
    raise ValueError(f"Unknown role: {role}")


def tools_for_role(role: str) -> tuple[ToolSpec, ...]:
    scopes = allowed_scopes(role)
    return tuple(spec for spec in TOOLS if spec.scope in scopes)


def counts_by_scope(tools: Iterable[ToolSpec] = TOOLS) -> dict[str, int]:
    counts = {READ: 0, WRITE: 0, DESTRUCTIVE: 0}
    for spec in tools:
        counts[spec.scope] += 1
    return counts
