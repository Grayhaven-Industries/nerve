"""KiCad IPC entrypoint. Tk and KiCad are loaded only when launching the UI."""

import os
from pathlib import Path
from queue import Empty, Queue
import sys
from threading import Thread

from tk_runtime import create_root

from nerve_kicad import (
    PLUGIN_ID, CheckError, board_path, discover_manifest, load_settings,
    report_findings, run_check, save_board_for_check, select_finding, source_path,
    verify_board_snapshot,
)


def main() -> int:
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, ttk
        from kipy import KiCad
    except ImportError as error:
        print(
            f"Nerve plugin could not start: {error}. Choose a Python interpreter with Tk support "
            "in KiCad Preferences > Plugins and recreate this plugin's environment.",
            file=sys.stderr,
        )
        return 2

    try:
        root = create_root(tk)
    except tk.TclError as error:
        print(f"Nerve plugin could not open its window: {error}", file=sys.stderr)
        return 2
    root.title("Nerve harness interfaces")
    root.geometry("980x620")
    root.minsize(720, 480)
    try:
        kicad = KiCad()
        board = kicad.get_board()
        saved_board = board_path(board)
        explicit_config = os.environ.get("NERVE_KICAD_CONFIG")
        config = Path(explicit_config).expanduser() if explicit_config else None
        if config is None:
            user_config = Path(kicad.get_plugin_settings_path(PLUGIN_ID)) / "config.json"
            local_config = Path(__file__).with_name("config.json")
            config = next((path for path in (user_config, local_config) if path.is_file()), None)
        settings = load_settings(config)
    except Exception as error:
        messagebox.showerror("Nerve could not start", str(error), parent=root)
        root.destroy()
        return 2

    frame = ttk.Frame(root, padding=16)
    frame.pack(fill="both", expand=True)
    frame.columnconfigure(1, weight=1)
    frame.rowconfigure(5, weight=1)
    ttk.Label(frame, text=f"Board: {saved_board}", wraplength=900).grid(
        row=0, column=0, columnspan=3, sticky="w", pady=(0, 12)
    )
    manifest = tk.StringVar(value=os.environ.get("NERVE_KICAD_MANIFEST") or str(discover_manifest(saved_board) or ""))
    ttk.Label(frame, text="Interfaces manifest").grid(row=1, column=0, sticky="w", padx=(0, 12))
    manifest_entry = ttk.Entry(frame, textvariable=manifest)
    manifest_entry.grid(row=1, column=1, sticky="ew")

    def browse():
        selected = filedialog.askopenfilename(
            parent=root, title="Choose Nerve interfaces manifest", initialdir=saved_board.parent,
            filetypes=[("JSON manifests", "*.json")],
        )
        if selected:
            manifest.set(selected)

    browse_button = ttk.Button(frame, text="Browse…", command=browse)
    browse_button.grid(row=1, column=2, padx=(8, 0))
    ttk.Label(
        frame, text="Saves this board, then checks all mapped interfaces using files on disk.",
    ).grid(row=2, column=0, columnspan=3, sticky="w", pady=(10, 8))
    status = tk.StringVar(value="Choose a manifest and run the check.")
    ttk.Label(frame, textvariable=status, wraplength=900).grid(
        row=4, column=0, columnspan=3, sticky="w", pady=12
    )
    tree = ttk.Treeview(frame, columns=("severity", "interface", "code", "message"), show="headings")
    for key, title, width in (
        ("severity", "Severity", 75), ("interface", "Interface", 130),
        ("code", "Code", 115), ("message", "Finding", 560),
    ):
        tree.heading(key, text=title)
        tree.column(key, width=width, stretch=key == "message")
    tree.grid(row=5, column=0, columnspan=2, sticky="nsew")
    scrollbar = ttk.Scrollbar(frame, orient="vertical", command=tree.yview)
    scrollbar.grid(row=5, column=2, sticky="ns")
    tree.configure(yscrollcommand=scrollbar.set)
    details = tk.Text(frame, height=5, wrap="word", state="disabled")
    details.grid(row=6, column=0, columnspan=3, sticky="ew", pady=(12, 8))
    queue: Queue = Queue()
    state = {"running": False, "findings": [], "snapshot": None, "manifest": None}

    def show_details(_event=None):
        selected = tree.selection()
        if not selected:
            return
        finding = state["findings"][int(selected[0])]
        text = finding.diagnostic["message"]
        if finding.interface:
            text += f"\nSource: {source_path(finding.interface, state['manifest'])}"
            text += f"\nComponent: {finding.interface['component']} → {finding.interface['connector']}"
        details.configure(state="normal")
        details.delete("1.0", "end")
        details.insert("1.0", text)
        details.configure(state="disabled")

    tree.bind("<<TreeviewSelect>>", show_details)

    def select():
        selected = tree.selection()
        if not selected or state["running"]:
            return
        try:
            current_board = kicad.get_board()
            verify_board_snapshot(current_board, state["snapshot"])
            count = select_finding(
                current_board, state["findings"][int(selected[0])], state["manifest"], saved_board,
            )
            status.set(f"Selected {count} board item(s)." if count else "This finding has no selectable counterpart on the current board.")
        except Exception as error:
            messagebox.showerror("Cannot select finding", str(error), parent=root)

    select_button = ttk.Button(frame, text="Select on board", command=select, state="disabled")
    select_button.grid(row=7, column=0, sticky="w")
    tree.bind("<Double-1>", lambda _event: select())

    def finish():
        try:
            result = queue.get_nowait()
        except Empty:
            root.after(100, finish)
            return
        state["running"] = False
        run_button.configure(state="normal")
        browse_button.configure(state="normal")
        manifest_entry.configure(state="normal")
        if isinstance(result, Exception):
            status.set("Check failed. No completed verification is available.")
            messagebox.showerror("Nerve check failed", str(result), parent=root)
            return
        state["findings"] = report_findings(result)
        for index, finding in enumerate(state["findings"]):
            diagnostic = finding.diagnostic
            tree.insert("", "end", iid=str(index), values=(
                diagnostic["severity"], finding.interface["id"] if finding.interface else "Harness",
                diagnostic["code"], diagnostic["message"],
            ))
        summary = result["summary"]
        label = "Checked" if result["complete"] else "Incomplete check of"
        text = f"{label} {summary['interfaces']} interfaces: {summary['errors']} errors, {summary['warnings']} warnings."
        if summary.get("uncheckedConnectors"):
            text += " Unmapped harness connectors: " + ", ".join(summary["uncheckedConnectors"]) + "."
        if not any(source_path(entry, state["manifest"]) == saved_board for entry in result["interfaces"]):
            text += " The current board is not mapped in this manifest."
        text += " Results describe saved files at check time."
        status.set(text)
        if state["findings"]:
            select_button.configure(state="normal")
            first = tree.get_children()[0]
            tree.focus(first)
            tree.selection_set(first)
            tree.see(first)
            tree.focus_set()

    def check():
        if state["running"]:
            return
        try:
            path = Path(manifest.get()).expanduser().resolve()
            if not path.is_file():
                raise CheckError("Choose an existing interfaces manifest first.")
            state["snapshot"] = save_board_for_check(kicad, saved_board)
        except Exception as error:
            messagebox.showerror("Cannot start check", str(error), parent=root)
            return
        state.update(running=True, manifest=path, findings=[])
        tree.delete(*tree.get_children())
        details.configure(state="normal")
        details.delete("1.0", "end")
        details.configure(state="disabled")
        for widget in (run_button, select_button, browse_button, manifest_entry):
            widget.configure(state="disabled")
        status.set("Board saved. Checking project interfaces…")

        def worker():
            try:
                queue.put(run_check(path, settings))
            except Exception as error:
                queue.put(error)

        Thread(target=worker, daemon=True).start()
        root.after(100, finish)

    run_button = ttk.Button(frame, text="Save board and check harness", command=check)
    run_button.grid(row=3, column=0, columnspan=3, sticky="w")

    def close():
        if state["running"]:
            status.set("Wait for the current check to finish before closing this window.")
            return
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", close)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
