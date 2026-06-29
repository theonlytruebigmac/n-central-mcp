import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest import mock

from ncentral.cli.device_queries import (
    DeviceQueryService,
    aggregate,
    filter_devices,
    normalize_issue,
    project,
    resolve_named_row,
    sort_rows,
)
from ncentral.cli.main import build_parser, main
from ncentral_core.catalog import DESTRUCTIVE, READ, TOOLS, WRITE, counts_by_scope, tools_for_role
from ncentral_core.mcp import McpConfig, load_config_file
from ncentral_core.output import to_toon
from ncentral_core.role import resolve_role


class CatalogTests(unittest.TestCase):
    def test_catalog_matches_readme_tool_counts(self):
        counts = counts_by_scope(TOOLS)
        self.assertEqual(len(TOOLS), 87)
        self.assertEqual(counts, {READ: 56, WRITE: 26, DESTRUCTIVE: 5})
        self.assertEqual(len(tools_for_role("read")), 56)
        self.assertEqual(len(tools_for_role("read-write")), 82)
        self.assertEqual(len(tools_for_role("destructive")), 87)

    def test_role_filtered_parser_hides_destructive_commands(self):
        build_parser("read").parse_args(["devices", "list", "--all", "--fields", "deviceId,longName"])
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                build_parser("read").parse_args(["devices", "delete-device", "--device-id", "1"])
        build_parser("destructive").parse_args(["devices", "delete-device", "--device-id", "1"])
        build_parser("destructive").parse_args(["devices", "delete_device", "--deviceId", "1"])

    def test_role_marker_distribution_resolution(self):
        self.assertEqual(resolve_role(["ncentral-cli-role-read"]), "read")
        self.assertEqual(resolve_role(["ncentral-cli-role-readwrite"]), "read-write")
        self.assertEqual(resolve_role(["ncentral-cli-role-destructive"]), "destructive")

    def test_toon_encoder_uses_local_cli(self):
        encoded = to_toon({"a": 1, "rows": [{"x": 2}]})
        self.assertIn("a: 1", encoded)
        self.assertIn("rows[1,]{x}", encoded)

    def test_mcp_config_reads_home_config(self):
        with tempfile.TemporaryDirectory() as home:
            config_dir = os.path.join(home, ".ncentral-mcp")
            os.makedirs(config_dir)
            with open(os.path.join(config_dir, "config.json"), "w", encoding="utf-8") as handle:
                json.dump({"endpoint": "http://example.test/mcp", "api_key": "abc123"}, handle)

            with mock.patch.dict(os.environ, {"HOME": home}, clear=True):
                self.assertEqual(load_config_file(), {"endpoint": "http://example.test/mcp", "api_key": "abc123"})
                config = McpConfig.from_env()

        self.assertEqual(config.url, "http://example.test/mcp")
        self.assertEqual(config.api_key, "abc123")

    def test_mcp_config_cli_url_overrides_home_config(self):
        with tempfile.TemporaryDirectory() as home:
            config_dir = os.path.join(home, ".ncentral-mcp")
            os.makedirs(config_dir)
            with open(os.path.join(config_dir, "config.json"), "w", encoding="utf-8") as handle:
                json.dump({"endpoint": "http://config.test/mcp", "api_key": "config-key"}, handle)

            with mock.patch.dict(os.environ, {"HOME": home}, clear=True):
                config = McpConfig.from_env(url="http://cli.test/mcp")

        self.assertEqual(config.url, "http://cli.test/mcp")
        self.assertEqual(config.api_key, "config-key")

    def test_auth_flags_are_not_exposed(self):
        for flag in ("--api-key", "--fqdn", "--jwt"):
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                result = main([flag, "value", "tools"])
            self.assertEqual(result, 1)
            self.assertIn("~/.ncentral-mcp/config.json", stderr.getvalue())

    def test_agent_device_commands_parse(self):
        args = build_parser("read").parse_args([
            "devices", "list", "--customer", "Midwest Disability",
            "--device-class", "Servers - Windows", "--count",
        ])
        self.assertEqual(args.customer, "Midwest Disability")
        self.assertEqual(args.device_class, ["Servers - Windows"])
        self.assertTrue(args.count)

        inventory = build_parser("read").parse_args([
            "devices", "inventory", "--customer", "Pointsmith", "--device-type", "server", "--oldest", "5",
        ])
        self.assertEqual(inventory.device_type, "server")
        self.assertEqual(inventory.oldest, 5)

        status = build_parser("read").parse_args([
            "devices", "monitor-status", "--customer", "Pointsmith", "--state", "Failed", "--count",
        ])
        self.assertEqual(status.state, "Failed")


class FakeClient:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def call_tool(self, name, payload):
        self.calls.append((name, payload))
        response = self.responses[name]
        return response(payload) if callable(response) else response


class DeviceQueryTests(unittest.TestCase):
    def test_scope_resolution_prefers_exact_name_and_uses_org_endpoint(self):
        client = FakeClient({
            "list_customers": {"data": [
                {"customerId": "103", "customerName": "Midwest Disability"},
                {"customerId": 104, "customerName": "Midwest Other"},
            ]},
            "list_devices_by_org_unit": {"data": [{"deviceId": 1, "longName": "S1"}]},
        })
        service = DeviceQueryService(client)
        scope = service.resolve_scope("Midwest Disability", None)
        devices = service.list_devices(scope=scope, all_pages=True)
        self.assertEqual(scope["orgUnitId"], 103)
        self.assertEqual(devices[0]["deviceName"], "S1")
        self.assertEqual(client.calls[-1][0], "list_devices_by_org_unit")
        self.assertTrue(client.calls[-1][1]["all"])

    def test_name_resolution_reports_ambiguous_candidates(self):
        candidates = [
            {"customerId": 1, "customerName": "Example East"},
            {"customerId": 2, "customerName": "Example West"},
        ]
        with self.assertRaisesRegex(ValueError, r"Example East \(1\).+Example West \(2\)"):
            resolve_named_row(candidates, "Example", "customerId", "customerName", "customer")

    def test_filters_groups_projects_and_sorts_normalized_rows(self):
        devices = [
            {"deviceId": 1, "deviceClass": "Servers - Windows", "os": "Windows Server", "createdOn": "2024-01-01"},
            {"deviceId": 2, "deviceClass": "Workstations - Windows", "os": "Windows 11", "createdOn": "2023-01-01"},
            {"deviceId": 3, "deviceClass": "Servers - Linux", "os": "Ubuntu", "createdOn": None},
        ]
        servers = filter_devices(devices, device_type="server")
        self.assertEqual([row["deviceId"] for row in servers], [1, 3])
        self.assertEqual(aggregate(servers, "deviceClass", False)["count"], 2)
        self.assertEqual([row["deviceId"] for row in sort_rows(devices, "createdOn")], [2, 1, 3])
        projected, missing = project(devices, ["deviceId", "missingField"])
        self.assertEqual(missing, ["missingField"])
        self.assertIsNone(projected[0]["missingField"])

    def test_issue_name_is_normalized_from_extra(self):
        issue = normalize_issue({"deviceId": 7, "serviceName": "Patch Status", "_extra": {"deviceName": "PC7"}})
        self.assertEqual(issue["deviceName"], "PC7")


if __name__ == "__main__":
    unittest.main()
