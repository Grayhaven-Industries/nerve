"""Locate Tcl/Tk scripts shipped with a relocated macOS Python interpreter."""

import os
from pathlib import Path
import sys


def _configure_bundled_resources(tk) -> bool:
    if sys.platform != "darwin":
        return False

    library = Path(sys.base_prefix) / "lib"
    changed = False
    for variable, directory, marker in (
        ("TCL_LIBRARY", f"tcl{tk.TclVersion}", "init.tcl"),
        ("TK_LIBRARY", f"tk{tk.TkVersion}", "tk.tcl"),
    ):
        if variable in os.environ:
            continue
        resource = library / directory
        if (resource / marker).is_file():
            os.environ[variable] = str(resource)
            changed = True
    return changed


def create_root(tk):
    try:
        return tk.Tk()
    except tk.TclError as error:
        if not any(name in str(error) for name in ("init.tcl", "tk.tcl")):
            raise
        if not _configure_bundled_resources(tk):
            raise
        return tk.Tk()
