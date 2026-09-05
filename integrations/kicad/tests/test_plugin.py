import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nerve_kicad import (
    CheckError, Settings, board_path, discover_manifest, load_settings,
    report_findings, run_check, save_board_for_check, select_finding, validate_report,
    verify_board_snapshot,
)


def report():
    diagnostic = {
        "code": "HK-IFC-004", "severity": "error",
        "message": "Deliberately misleading prose naming pad 99.", "target": "connector:J1.pin:1",
    }
    return {
        "schemaVersion": "0.1.0", "complete": True,
        "harness": {"id": "robot", "revision": "A"},
        "interfaces": [{
            "id": "controller", "source": "board.kicad_pcb", "component": "J7", "connector": "J1",
            "status": "fail", "contract": {"pinout": [{"pin": "1", "sourcePin": "B1"}]},
            "diagnostics": [diagnostic],
        }],
        "diagnostics": [diagnostic],
        "summary": {"interfaces": 1, "errors": 1, "warnings": 0, "uncheckedConnectors": []},
    }


class FakeBoard:
    def __init__(self, path, footprints=()):
        self.name = str(path)
        self.footprints = footprints
        self.selected = ["previous selection"]
        self.editor_content = "(kicad_pcb)"
        self.saves = 0

    def save(self):
        self.saves += 1
        Path(self.name).write_text(self.editor_content, encoding="utf-8")

    def get_as_string(self):
        return self.editor_content

    def get_footprints(self):
        return self.footprints

    def clear_selection(self):
        self.selected = []

    def add_to_selection(self, items):
        self.selected.extend(items)


def footprint(reference, *numbers):
    return SimpleNamespace(
        reference_field=SimpleNamespace(text=SimpleNamespace(value=reference)),
        definition=SimpleNamespace(pads=[SimpleNamespace(number=number) for number in numbers]),
    )


class PluginTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(prefix="nerve plugin tests ")
        self.root = Path(self.temp.name).resolve()
        self.board_file = self.root / "board.kicad_pcb"
        self.board_file.write_text("(kicad_pcb)", encoding="utf-8")
        self.manifest = self.root / "nerve-interfaces.json"
        self.manifest.write_text("{}", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_discovers_nearest_ancestor_manifest(self):
        nested = self.root / "boards" / "controller"
        nested.mkdir(parents=True)
        self.assertEqual(discover_manifest(nested / "controller.kicad_pcb"), self.manifest)
        closer = nested.parent / "nerve-interfaces.json"
        closer.write_text("{}", encoding="utf-8")
        self.assertEqual(discover_manifest(nested / "controller.kicad_pcb"), closer)

    def test_board_path_uses_project_directory(self):
        board = SimpleNamespace(name="board.kicad_pcb", get_project=lambda: SimpleNamespace(path=str(self.root)))
        self.assertEqual(board_path(board), self.board_file)

    def test_unsaved_board_is_rejected(self):
        with self.assertRaises(CheckError):
            board_path(FakeBoard(self.root / "unsaved.kicad_pcb"))
        with self.assertRaises(CheckError):
            board_path(FakeBoard(""))

    def test_save_reads_current_board_and_records_saved_snapshot(self):
        board = FakeBoard(self.board_file)
        board.editor_content = "(kicad_pcb (version 20250114))"
        snapshot = save_board_for_check(SimpleNamespace(get_board=lambda: board), self.board_file)
        self.assertEqual(board.saves, 1)
        self.assertEqual(self.board_file.read_text(), board.editor_content)
        verify_board_snapshot(board, snapshot)

    def test_switching_boards_does_not_save_the_new_board(self):
        other_path = self.root / "other.kicad_pcb"
        other_path.touch()
        other_board = FakeBoard(other_path)
        with self.assertRaisesRegex(CheckError, "open board changed"):
            save_board_for_check(SimpleNamespace(get_board=lambda: other_board), self.board_file)
        self.assertEqual(other_board.saves, 0)

    def test_selection_rejects_unsaved_edits_and_external_file_changes(self):
        board = FakeBoard(self.board_file)
        snapshot = save_board_for_check(SimpleNamespace(get_board=lambda: board), self.board_file)
        board.editor_content = "(kicad_pcb (changed))"
        with self.assertRaisesRegex(CheckError, "board changed since"):
            verify_board_snapshot(board, snapshot)
        board.editor_content = snapshot.editor_content
        self.board_file.write_text("(kicad_pcb (external change))")
        with self.assertRaisesRegex(CheckError, "changed on disk"):
            verify_board_snapshot(board, snapshot)

    def test_selection_rejects_switched_board_even_with_identical_contents(self):
        board = FakeBoard(self.board_file)
        snapshot = save_board_for_check(SimpleNamespace(get_board=lambda: board), self.board_file)
        other_path = self.root / "other.kicad_pcb"
        other_path.write_text(board.editor_content)
        with self.assertRaisesRegex(CheckError, "open board changed"):
            verify_board_snapshot(FakeBoard(other_path), snapshot)

    def test_configuration_keeps_executable_arguments_separate(self):
        config = self.root / "config.json"
        config.write_text(json.dumps({"command": ["node", "/path with spaces/nerve.js"], "timeoutSeconds": 10}))
        self.assertEqual(load_settings(config, {}).command, ("node", "/path with spaces/nerve.js"))
        self.assertEqual(load_settings(config, {"NERVE_EXECUTABLE": "/custom path/nerve"}).command, ("/custom path/nerve",))
        config.write_text('{"command": "nerve --some-option"}')
        with self.assertRaises(CheckError):
            load_settings(config, {})

    def test_invalid_configuration_reports_actionable_error(self):
        config = self.root / "config.json"
        for value in [[], {"command": []}, {"timeoutSeconds": True}, {"timeoutSeconds": 0}]:
            config.write_text(json.dumps(value))
            with self.assertRaises(CheckError):
                load_settings(config, {})

    def test_findings_preserve_interface_and_harness_diagnostics_once(self):
        value = report()
        value["diagnostics"].append({"code": "HK-WIRE-001", "severity": "warning", "message": "Wire warning"})
        findings = report_findings(value)
        self.assertEqual(len(findings), 2)
        self.assertEqual(findings[0].interface["id"], "controller")
        self.assertIsNone(findings[1].interface)

    def test_selects_source_pin_and_every_physical_pad_with_that_number(self):
        connector = footprint("J7", "B1", "B1", "1", "99")
        board = FakeBoard(self.board_file, [connector, footprint("J8", "B1")])
        finding = report_findings(report())[0]
        self.assertEqual(select_finding(board, finding, self.manifest, self.board_file), 2)
        self.assertEqual(board.selected, connector.definition.pads[:2])

    def test_other_board_with_same_name_is_never_selected(self):
        value = report()
        value["interfaces"][0]["source"] = "another/board.kicad_pcb"
        board = FakeBoard(self.board_file, [footprint("J7", "B1")])
        self.assertEqual(select_finding(board, report_findings(value)[0], self.manifest, self.board_file), 0)
        self.assertEqual(board.selected, ["previous selection"])

    def test_missing_pin_has_no_invented_counterpart(self):
        value = report()
        value["interfaces"][0]["contract"]["pinout"] = []
        board = FakeBoard(self.board_file, [footprint("J7", "1", "99")])
        self.assertEqual(select_finding(board, report_findings(value)[0], self.manifest, self.board_file), 0)
        self.assertEqual(board.selected, ["previous selection"])

    def test_connector_finding_selects_footprint(self):
        value = report()
        value["interfaces"][0]["diagnostics"][0]["target"] = "connector:J1"
        connector = footprint("J7", "B1")
        board = FakeBoard(self.board_file, [connector])
        self.assertEqual(select_finding(board, report_findings(value)[0], self.manifest, self.board_file), 1)
        self.assertEqual(board.selected, [connector])

    def test_report_validation_rejects_missing_status_and_bad_mapping(self):
        for mutate in (
            lambda value: value.update(schemaVersion="9.0"),
            lambda value: value.pop("complete"),
            lambda value: value["summary"].update(errors="0"),
            lambda value: value["interfaces"][0].update(status="unknown"),
            lambda value: value["interfaces"][0]["contract"].update(pinout=[{"pin": 1}]),
        ):
            value = report()
            mutate(value)
            with self.assertRaises(CheckError):
                validate_report(value)

    def test_real_cli_process_receives_paths_as_arguments_and_exit_one_report(self):
        fake_cli = self.root / "fake nerve.py"
        fake_cli.write_text(
            "import json, pathlib, sys\n"
            "assert sys.argv[1:3] == ['contract', '--manifest']\n"
            "assert pathlib.Path(sys.argv[3]).is_file()\n"
            "assert sys.argv[4:6] == ['--json', '--out']\n"
            "assert pathlib.Path(sys.argv[6]).is_dir()\n"
            "assert pathlib.Path.cwd() == pathlib.Path(sys.argv[3]).parent\n"
            f"print({json.dumps(report())!r})\n"
            "sys.exit(1)\n",
            encoding="utf-8",
        )
        result = run_check(self.manifest, Settings((sys.executable, str(fake_cli))))
        self.assertEqual(result["summary"]["errors"], 1)

    def test_incomplete_exit_two_report_remains_visible(self):
        value = report()
        value["complete"] = False
        value["interfaces"][0]["status"] = "incomplete"
        result = subprocess.CompletedProcess([], 2, json.dumps(value), "")
        with patch("nerve_kicad.subprocess.run", return_value=result):
            self.assertFalse(run_check(self.manifest, Settings())["complete"])

    def test_unknown_connectivity_warning_retains_contract_on_exit_two(self):
        value = report()
        value["complete"] = False
        interface = value["interfaces"][0]
        interface["status"] = "incomplete"
        diagnostic = interface["diagnostics"][0]
        diagnostic.update(code="HK-IFC-008", severity="warning", message="Source connectivity is unknown.")
        value["summary"].update(errors=0, warnings=1)
        result = subprocess.CompletedProcess([], 2, json.dumps(value), "")
        with patch("nerve_kicad.subprocess.run", return_value=result):
            parsed = run_check(self.manifest, Settings())
        finding = report_findings(parsed)[0]
        self.assertEqual(finding.interface["contract"]["pinout"][0]["sourcePin"], "B1")
        self.assertEqual(finding.diagnostic["code"], "HK-IFC-008")
        board = FakeBoard(self.board_file, [footprint("J7", "B1")])
        self.assertEqual(select_finding(board, finding, self.manifest, self.board_file), 1)

    def test_malformed_stdout_never_looks_like_a_clean_check(self):
        result = subprocess.CompletedProcess([], 0, "not JSON", "A compiler error")
        with patch("nerve_kicad.subprocess.run", return_value=result):
            with self.assertRaisesRegex(CheckError, "A compiler error"):
                run_check(self.manifest, Settings())

    def test_timeout_and_missing_executable_are_reported(self):
        for error, message in ((subprocess.TimeoutExpired("nerve", 5), "timed out"), (FileNotFoundError("nerve"), "Cannot launch")):
            with patch("nerve_kicad.subprocess.run", side_effect=error):
                with self.assertRaisesRegex(CheckError, message):
                    run_check(self.manifest, Settings())

    def test_failed_report_cannot_return_success(self):
        result = subprocess.CompletedProcess([], 0, json.dumps(report()), "")
        with patch("nerve_kicad.subprocess.run", return_value=result):
            with self.assertRaisesRegex(CheckError, "inconsistent success"):
                run_check(self.manifest, Settings())

    def test_plugin_registration_points_at_packaged_entrypoint(self):
        directory = Path(__file__).resolve().parents[1]
        registration = json.loads((directory / "plugin.json").read_text())
        self.assertEqual(registration["runtime"]["type"], "python")
        for action in registration["actions"]:
            self.assertEqual(action["scopes"], ["pcb"])
            self.assertTrue((directory / action["entrypoint"]).is_file())


if __name__ == "__main__":
    unittest.main()
