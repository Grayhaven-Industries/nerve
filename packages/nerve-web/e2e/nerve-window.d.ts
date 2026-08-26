import type { EditorView } from "@codemirror/view"

declare global {
  interface Window {
    /** Automation hook set by SourcePane: the live CodeMirror view. */
    __nerveEditor?: EditorView
  }
}

export {}
