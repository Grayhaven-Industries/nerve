---
"@grayhaven/nerve": minor
"@grayhaven/nerve-cli": minor
"@grayhaven/nerve-connectors": minor
"@grayhaven/nerve-exporters": minor
---

Add project interface manifests, explicit pad-to-cavity mapping, structured check reports, and KiCad schematic netlist import. Direct schematic checks invoke KiCad's CLI; incomplete evidence blocks the command. Support KiCad 10 board nets and preserve intentional no-connect metadata.

Carry revision-pinned KiCad symbol, footprint, and STEP references in connector metadata, with initial links for JST PH/XH. Add a KiCad IPC plugin that runs project checks and selects affected board pads.

Include visible plugin toolbar icons, support Tcl/Tk resources in KiCad's bundled macOS Python, and initialize keyboard navigation through findings. Show contract command help without touching project files and report manifest validation errors with concise field paths.
