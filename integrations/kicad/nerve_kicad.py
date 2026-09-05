"""Nerve CLI boundary and KiCad selection helpers, independent of the GUI."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from typing import Any, Mapping


PLUGIN_ID = "com.grayhaven.nerve"
MANIFEST_NAME = "nerve-interfaces.json"


class CheckError(Exception):
    """A check could not produce a usable report."""


@dataclass(frozen=True)
class Settings:
    command: tuple[str, ...] = ("nerve",)
    timeout_seconds: int = 120


@dataclass(frozen=True)
class Finding:
    diagnostic: dict[str, Any]
    interface: dict[str, Any] | None = None


@dataclass(frozen=True)
class BoardSnapshot:
    path: Path
    editor_content: str
    file_fingerprint: str


def load_settings(config_path: Path | None, env: Mapping[str, str] = os.environ) -> Settings:
    config: dict[str, Any] = {}
    if config_path is not None:
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise CheckError(f"Cannot read plugin settings at {config_path}: {error}") from error
        if not isinstance(config, dict):
            raise CheckError("Plugin settings must be a JSON object.")
    command = config.get("command", ["nerve"])
    if env.get("NERVE_EXECUTABLE"):
        command = [env["NERVE_EXECUTABLE"]]
    if not isinstance(command, list) or not command or any(
        not isinstance(arg, str) or not arg.strip() or "\0" in arg for arg in command
    ):
        raise CheckError('Plugin command must be a nonempty JSON array, e.g. ["nerve"].')
    timeout = config.get("timeoutSeconds", 120)
    if type(timeout) is not int or not 1 <= timeout <= 3600:
        raise CheckError("timeoutSeconds must be an integer between 1 and 3600.")
    return Settings(tuple(command), timeout)


def board_path(board: Any) -> Path:
    if not board.name or not board.name.endswith(".kicad_pcb"):
        raise CheckError("Save this board as a .kicad_pcb file in KiCad first.")
    path = Path(board.name)
    if not path.is_absolute():
        project_path = board.get_project().path
        if not project_path or not Path(project_path).is_absolute():
            raise CheckError("KiCad did not provide a saved project directory. Save the board first.")
        path = Path(project_path) / path
    path = path.resolve()
    if not path.is_file():
        raise CheckError("Save this board in KiCad before running a harness check.")
    return path


def discover_manifest(saved_board: Path) -> Path | None:
    for parent in saved_board.resolve().parents:
        candidate = parent / MANIFEST_NAME
        if candidate.is_file():
            return candidate
    return None


def save_board_for_check(kicad: Any, expected_path: Path) -> BoardSnapshot:
    board = kicad.get_board()
    if board_path(board) != expected_path:
        raise CheckError("The open board changed. Close this window and reopen the plugin.")
    board.save()
    return BoardSnapshot(
        expected_path, board.get_as_string(), sha256(expected_path.read_bytes()).hexdigest(),
    )


def verify_board_snapshot(board: Any, snapshot: BoardSnapshot) -> None:
    if board_path(board) != snapshot.path:
        raise CheckError("The open board changed. Close this window and reopen the plugin.")
    if board.get_as_string() != snapshot.editor_content:
        raise CheckError("The board changed since this check. Save and check again before selecting a finding.")
    if sha256(snapshot.path.read_bytes()).hexdigest() != snapshot.file_fingerprint:
        raise CheckError("The board file changed on disk since this check. Reload it in KiCad and check again.")


def validate_report(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schemaVersion") != "0.1.0":
        raise CheckError("Nerve returned an unsupported interface report. Update the CLI and plugin together.")
    if not isinstance(value.get("complete"), bool):
        raise CheckError("Nerve's interface report has no completion status.")
    interfaces, diagnostics, summary = (
        value.get("interfaces"), value.get("diagnostics"), value.get("summary")
    )
    if not isinstance(interfaces, list) or not isinstance(diagnostics, list) or not isinstance(summary, dict):
        raise CheckError("Nerve returned an invalid interface report.")
    if any(type(summary.get(key)) is not int or summary[key] < 0 for key in ("interfaces", "errors", "warnings")):
        raise CheckError("Nerve returned invalid report counts.")
    if summary["interfaces"] != len(interfaces):
        raise CheckError("Nerve returned inconsistent interface counts.")
    unchecked = summary.get("uncheckedConnectors", [])
    if not isinstance(unchecked, list) or any(not isinstance(ref, str) for ref in unchecked):
        raise CheckError("Nerve returned invalid unmapped connector references.")
    all_diagnostics = list(diagnostics)
    for interface in interfaces:
        if not isinstance(interface, dict) or any(
            not isinstance(interface.get(key), str) or not interface[key]
            for key in ("id", "connector", "component", "source")
        ) or not isinstance(interface.get("diagnostics"), list):
            raise CheckError("Nerve returned an invalid interface entry.")
        if interface.get("status") not in ("pass", "fail", "incomplete"):
            raise CheckError("Nerve returned an invalid interface status.")
        contract = interface.get("contract")
        if contract is not None:
            if not isinstance(contract, dict) or not isinstance(contract.get("pinout"), list):
                raise CheckError("Nerve returned an invalid connector pinout.")
            for pin in contract["pinout"]:
                if not isinstance(pin, dict) or not isinstance(pin.get("pin"), str) or (
                    "sourcePin" in pin and not isinstance(pin["sourcePin"], str)
                ):
                    raise CheckError("Nerve returned an invalid pin mapping.")
        all_diagnostics.extend(interface["diagnostics"])
    for diagnostic in all_diagnostics:
        if not isinstance(diagnostic, dict) or any(
            not isinstance(diagnostic.get(key), str) for key in ("message", "code", "severity")
        ) or diagnostic["severity"] not in ("error", "warning", "info"):
            raise CheckError("Nerve returned an invalid diagnostic.")
    return value


def run_check(manifest: Path, settings: Settings) -> dict[str, Any]:
    manifest = manifest.resolve()
    if not manifest.is_file():
        raise CheckError(f"Interface manifest does not exist: {manifest}")
    with TemporaryDirectory(prefix="nerve-kicad-") as output:
        command = [*settings.command, "contract", "--manifest", str(manifest), "--json", "--out", output]
        try:
            result = subprocess.run(
                command, cwd=manifest.parent, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=settings.timeout_seconds, check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise CheckError(f"Nerve timed out after {settings.timeout_seconds} seconds.") from error
        except OSError as error:
            raise CheckError(
                f"Cannot launch {settings.command[0]}: {error}\n"
                "Set NERVE_EXECUTABLE or the plugin's command setting to your Nerve CLI."
            ) from error
        try:
            report = validate_report(json.loads(result.stdout))
        except (ValueError, CheckError) as error:
            detail = result.stderr.strip() or str(error)
            raise CheckError(f"Nerve did not complete the check (exit {result.returncode}).\n{detail}") from error
        if result.returncode not in (0, 1, 2):
            raise CheckError(f"Nerve failed (exit {result.returncode}).\n{result.stderr.strip()}")
        if result.returncode == 2 and report["complete"]:
            raise CheckError("Nerve reported an invocation failure with a completed report.")
        if result.returncode == 0 and (not report["complete"] or report["summary"]["errors"]):
            raise CheckError("Nerve returned inconsistent success and report status.")
        if result.returncode == 1 and not report["summary"]["errors"]:
            raise CheckError("Nerve reported design errors without any errors in the report.")
        return report


def report_findings(report: dict[str, Any]) -> list[Finding]:
    findings = []
    included: Counter[str] = Counter()
    for interface in report["interfaces"]:
        for diagnostic in interface["diagnostics"]:
            findings.append(Finding(diagnostic, interface))
            included[json.dumps(diagnostic, sort_keys=True)] += 1
    for diagnostic in report["diagnostics"]:
        key = json.dumps(diagnostic, sort_keys=True)
        if included[key]:
            included[key] -= 1
        else:
            findings.append(Finding(diagnostic))
    return findings


def source_path(interface: dict[str, Any], manifest: Path) -> Path:
    return (manifest.parent / interface["source"]).resolve()


def select_finding(board: Any, finding: Finding, manifest: Path, checked_board: Path) -> int:
    """Select only explicitly mapped source pads in the board that was checked."""
    interface = finding.interface
    if interface is None or source_path(interface, manifest) != checked_board:
        return 0
    if board_path(board) != checked_board:
        raise CheckError("The active board changed. Run the check again.")
    target = finding.diagnostic.get("target")
    connector_target = f"connector:{interface['connector']}"
    pin_prefix = connector_target + ".pin:"
    selected = []
    if not isinstance(target, str):
        return 0
    pin_numbers = set()
    if target.startswith(pin_prefix):
        harness_pin = target[len(pin_prefix):]
        contract = interface.get("contract") or {}
        pin_numbers = {
            entry.get("sourcePin", entry["pin"])
            for entry in contract.get("pinout", []) if entry["pin"] == harness_pin
        }
    for footprint in board.get_footprints():
        if footprint.reference_field.text.value != interface["component"]:
            continue
        if target == connector_target:
            selected.append(footprint)
        else:
            selected.extend(pad for pad in footprint.definition.pads if pad.number in pin_numbers)
    if selected:
        board.clear_selection()
        board.add_to_selection(selected)
    return len(selected)
