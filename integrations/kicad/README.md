# Nerve for KiCad

An IPC plugin for KiCad 9 and 10's PCB Editor. Run the project's Nerve interface
checks from KiCad, read every finding, and select its corresponding footprint or
pad in the open board. It uses the same `nerve contract --manifest` command as CI.

## Install

1. Install Nerve CLI 8.1.0 or later, which supports `contract --manifest`, and make it
   available to the Python process launched by KiCad. Check `nerve --help` in a
   terminal first. Desktop apps may have a different `PATH`; configuration below
   accepts an absolute executable path.
2. Enable the IPC API in KiCad's Preferences. On macOS or Windows, start with
   KiCad's default bundled Python interpreter in the PCB Editor's plugin
   preferences; the macOS KiCad 10 interpreter includes Tk. For Linux or a custom
   interpreter, select Python 3.9 or later with Tk support. Test the selected
   interpreter with `python -m tkinter`; a small window should open. On Linux,
   Tk is usually a separate distribution package, such as `python3-tk`. Tk cannot
   be installed by `requirements.txt` and is an explicit prerequisite. If macOS
   KiCad's relocated Python cannot find `init.tcl` or `tk.tcl`, Nerve retries using
   the matching scripts under that interpreter's `sys.base_prefix/lib`. Explicit
   `TCL_LIBRARY` and `TK_LIBRARY` settings are preserved.
3. Copy **this entire directory**, keeping `plugin.json` at its root, into a
   `com.grayhaven.nerve` subdirectory of KiCad's IPC plugin folder:

   | Platform | Default directory for KiCad 10 |
   | --- | --- |
   | macOS | `~/Documents/KiCad/10.0/plugins/com.grayhaven.nerve/` |
   | Windows | `%USERPROFILE%\Documents\KiCad\10.0\plugins\com.grayhaven.nerve\` |
   | Linux | `~/.local/share/KiCad/10.0/plugins/com.grayhaven.nerve/` |

   Substitute `9.0` for KiCad 9. With a custom `KICAD_DOCUMENTS_HOME`, KiCad appends
   `KiCad/10.0/plugins` to that base directory. **Tools → External Plugins →
   Reveal Plugin Folder** opens the location used by your editor. This is an IPC
   plugin, so the legacy `scripting/plugins`
   directory is not used.
4. Restart the PCB Editor and allow KiCad to create the plugin virtual environment
   and install `requirements.txt`. Click the Nerve icon on the PCB Editor toolbar;
   its tooltip is **Check Nerve harness**. Enable **Show Button** for that action
   in plugin preferences if it is hidden. Keep the `icons` directory alongside
   `plugin.json`: KiCad 10 does not provide a toolbar icon when these PNG files
   are missing. IPC actions use the toolbar; KiCad 10's **External Plugins** menu
   lists legacy action plugins. After changing the interpreter or requirements,
   choose **Recreate Plugin Environment** in plugin preferences.

The plugin is ready for manual installation; it has not been submitted to the
KiCad Plugin and Content Manager.

## Project mapping

Put `nerve-interfaces.json` beside your harness project, above the board files:

```json
{
  "schemaVersion": "0.1.0",
  "harness": "./src/main.harness.ts",
  "interfaces": [
    {
      "id": "controller",
      "connector": "J1",
      "against": "./boards/controller.kicad_pcb",
      "component": "J7",
      "pins": { "B1": "1", "B2": "2" }
    }
  ]
}
```

Paths are relative to the manifest. `component` is the PCB reference and
`connector` is the harness reference. `pins` maps **board pad → harness cavity**;
omit it when they use the same identifiers. The plugin searches from the board's
directory upward for the nearest manifest. Use **Browse…** or
`NERVE_KICAD_MANIFEST` to choose another file.

Click **Save board and check harness** in the plugin window. The button saves the
open board through KiCad before invoking Nerve. An unnamed board must be saved in
KiCad first. The result covers every interface in the manifest; other boards and
schematic inputs are read from their saved files. The status reports incomplete
checks distinctly from completed checks with design errors.

Choose a finding and click **Select on board**, or double-click it. Pin selection
uses the report's structured target and imported contract's `sourcePin` mapping.
Findings for another board or a missing board pad remain visible without selecting
an unrelated item. Connector-level findings select the mapped footprint. If you
edit the board after a check, rerun it before selecting a finding. Switching boards
requires reopening the plugin; an externally changed board file must be reloaded
in KiCad before checking again.

## CLI configuration

Set `NERVE_EXECUTABLE` to a single executable path, or copy `config.example.json`
to `config.json` beside the plugin and configure an argument array:

```json
{
  "command": ["node", "/absolute/path/to/nerve/packages/nerve-cli/bin/nerve.js"],
  "timeoutSeconds": 120
}
```

The example points at this repository's CLI launcher. An installed command
can instead use `"command": ["/absolute/path/to/nerve"]`; a project-local setup
can use `"command": ["pnpm", "exec", "nerve"]`. The command runs with the manifest's
directory as its working directory. Arguments are passed directly to the process,
without shell parsing. On Windows, use `node.exe` plus the CLI's JavaScript
entrypoint when your package manager exposes only a `.cmd` launcher.

Settings are read in this order: an explicit `NERVE_KICAD_CONFIG` file, then
`config.json` in KiCad's persistent directory returned by
`KiCad.get_plugin_settings_path("com.grayhaven.nerve")`, then `config.json` beside
the plugin. `NERVE_EXECUTABLE` overrides any command array. Configuration errors,
missing executables, compiler failures, and timeouts appear in the plugin window.
Output artifacts use a temporary directory that is removed after each run.

## Development and verification

From the repository root:

```sh
python3 -m unittest discover -s integrations/kicad/tests -v
```

Run this command with the interpreter selected in KiCad's plugin preferences as
well as your development Python. The plugin supports Python 3.9 and later,
including the bundled Python 3.9 in macOS KiCad 10.
CI runs the suite on Python 3.9 and 3.14 to catch minimum-version regressions.

Tests run without KiCad or Tk. They exercise a real fake-CLI subprocess, failures,
manifest discovery, report parsing, mapped pad selection, duplicate physical pad
numbers, and board isolation through a fake IPC board. GUI launch, toolbar
registration, and actual selection in KiCad require a desktop smoke check:
install the plugin, open a mapped board, swap two assigned nets, save and check,
and verify the resulting findings select the expected pads. Repeat after changing
a pad mapping and after editing the board without rerunning the check.

The implementation uses the
[official IPC plugin schema](https://go.kicad.org/api/schemas/v1),
[external Python plugin setup](https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/for-addon-developers/),
and [board save/selection API](https://docs.kicad.org/kicad-python-main/board.html).
Calls and object properties were checked against the `kicad-python` 0.6.0 release;
the dependency stays below 0.7 to avoid adopting later API additions implicitly.
