import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tk_runtime import create_root


class TclError(Exception):
    pass


class TkRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name) / "Python.framework" / "Versions" / "3.9"
        self.startup_error = TclError("Can't find a usable init.tcl")
        self.window = object()
        self.tk = SimpleNamespace(
            TclError=TclError, TclVersion=8.6, TkVersion=8.6,
            Tk=Mock(side_effect=[self.startup_error, self.window]),
        )
        for patcher in (
            patch.dict(os.environ, {}, clear=True),
            patch("tk_runtime.sys.platform", "darwin"),
            patch("tk_runtime.sys.base_prefix", str(self.base)),
            patch("tk_runtime.sys.prefix", str(Path(self.temporary.name) / "venv")),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def resources(self, version="8.6"):
        for name, filename in (("tcl", "init.tcl"), ("tk", "tk.tcl")):
            directory = self.base / "lib" / f"{name}{version}"
            directory.mkdir(parents=True, exist_ok=True)
            (directory / filename).write_text("# runtime resource", encoding="utf-8")

    def test_retries_with_resources_from_base_interpreter_not_virtualenv(self):
        self.resources()
        self.assertIs(create_root(self.tk), self.window)
        self.assertEqual(self.tk.Tk.call_count, 2)
        self.assertEqual(os.environ["TCL_LIBRARY"], str(self.base / "lib" / "tcl8.6"))
        self.assertEqual(os.environ["TK_LIBRARY"], str(self.base / "lib" / "tk8.6"))

    def test_successful_native_startup_does_not_set_overrides(self):
        self.resources()
        self.tk.Tk.side_effect = None
        self.tk.Tk.return_value = self.window
        self.assertIs(create_root(self.tk), self.window)
        self.assertEqual(dict(os.environ), {})
        self.tk.Tk.assert_called_once_with()

    def test_preserves_explicit_paths_including_empty_values(self):
        self.resources()
        os.environ.update(TCL_LIBRARY="/chosen/tcl", TK_LIBRARY="")
        with self.assertRaises(TclError) as caught:
            create_root(self.tk)
        self.assertIs(caught.exception, self.startup_error)
        self.assertEqual(dict(os.environ), {"TCL_LIBRARY": "/chosen/tcl", "TK_LIBRARY": ""})
        self.tk.Tk.assert_called_once_with()

    def test_only_fills_missing_override_when_other_is_explicit(self):
        self.resources()
        os.environ["TCL_LIBRARY"] = "/chosen/tcl"
        self.assertIs(create_root(self.tk), self.window)
        self.assertEqual(os.environ["TCL_LIBRARY"], "/chosen/tcl")
        self.assertEqual(os.environ["TK_LIBRARY"], str(self.base / "lib" / "tk8.6"))

    def test_missing_or_different_version_resources_do_not_trigger_retry(self):
        self.resources(version="9.0")
        (self.base / "lib" / "tcl8.6").mkdir()
        with self.assertRaises(TclError) as caught:
            create_root(self.tk)
        self.assertIs(caught.exception, self.startup_error)
        self.assertEqual(dict(os.environ), {})
        self.tk.Tk.assert_called_once_with()

    def test_other_platforms_retain_native_startup_error(self):
        self.resources()
        for platform in ("linux", "win32"):
            with self.subTest(platform=platform), patch("tk_runtime.sys.platform", platform):
                self.tk.Tk.reset_mock(side_effect=True)
                self.tk.Tk.side_effect = self.startup_error
                with self.assertRaises(TclError) as caught:
                    create_root(self.tk)
                self.assertIs(caught.exception, self.startup_error)
                self.assertEqual(dict(os.environ), {})
                self.tk.Tk.assert_called_once_with()

    def test_unrelated_window_failure_does_not_override_resources_or_retry(self):
        self.resources()
        error = TclError("couldn't connect to display")
        self.tk.Tk.side_effect = error
        with self.assertRaises(TclError) as caught:
            create_root(self.tk)
        self.assertIs(caught.exception, error)
        self.assertEqual(dict(os.environ), {})
        self.tk.Tk.assert_called_once_with()

    def test_reports_failure_if_bundled_resources_cannot_start_tk(self):
        self.resources()
        error = TclError("cannot load the supplied init.tcl")
        self.tk.Tk.side_effect = [self.startup_error, error]
        with self.assertRaises(TclError) as caught:
            create_root(self.tk)
        self.assertIs(caught.exception, error)
        self.assertEqual(self.tk.Tk.call_count, 2)


if __name__ == "__main__":
    unittest.main()
