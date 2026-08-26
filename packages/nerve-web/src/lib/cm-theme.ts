/**
 * Grayhaven CodeMirror theme: code renders on the warm near-black card with
 * a small, rationed set of syntax hues. Keywords carry the signal orange
 * (the one accent the parent site licenses for meaning), strings sit in
 * warm sand, types and numbers in a cool gray-blue, comments recede, and
 * identifiers stay ivory — so the eye reads structure first, then names.
 * Surfaces mirror the app's luminance ladder (card -> muted); the two lint
 * hues are the shared warning/destructive tokens.
 */
import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags } from "@lezer/highlight"

// Warm ink scale (oklch, hue 60) and the four syntax hues, as hex so the
// editor does not depend on CSS custom properties being in scope.
const INK = {
  canvas: "#161513", // card
  raised: "#1d1b18", // active line / gutter step
  border: "#2a2723",
  ivory: "#f4f2ec",
  muted: "#9a948a",
  faint: "#6f6a62"
}
const HUE = {
  keyword: "#e8823f", // signal orange, lifted for text contrast on black
  string: "#d9c49a", // warm sand
  type: "#9fb4c7", // cool gray-blue
  number: "#c8b9a0" // sand, dimmer
}

const grayhavenHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.moduleKeyword, tags.operatorKeyword, tags.controlKeyword], color: HUE.keyword },
  { tag: [tags.string, tags.special(tags.string)], color: HUE.string },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: INK.muted, fontStyle: "italic" },
  { tag: [tags.number, tags.bool, tags.null], color: HUE.number },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: INK.ivory, fontWeight: "500" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: HUE.type },
  { tag: [tags.definition(tags.variableName)], color: INK.ivory, fontWeight: "500" },
  { tag: [tags.propertyName, tags.variableName], color: INK.ivory },
  { tag: [tags.punctuation, tags.bracket, tags.operator], color: INK.muted }
])

const grayhavenEditor = EditorView.theme(
  {
    "&": { backgroundColor: INK.canvas, color: INK.ivory },
    ".cm-content": { caretColor: INK.ivory },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: INK.ivory },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: "rgb(244 242 236 / 0.22)" },
    ".cm-activeLine": { backgroundColor: INK.raised },
    ".cm-gutters": {
      backgroundColor: INK.canvas,
      color: INK.faint,
      border: "none",
      borderRight: `1px solid ${INK.border}`
    },
    ".cm-activeLineGutter": { backgroundColor: INK.raised, color: INK.ivory },
    ".cm-matchingBracket": { backgroundColor: "rgb(244 242 236 / 0.14)", outline: "none" },
    ".cm-selectionMatch": { backgroundColor: "rgb(244 242 236 / 0.1)" },
    ".cm-tooltip": {
      backgroundColor: INK.raised,
      border: `1px solid ${INK.border}`,
      borderRadius: "0",
      color: INK.ivory,
      fontFamily: '"Geist Mono Variable", monospace',
      fontSize: "11px"
    },
    ".cm-lintRange-error": { textDecoration: "underline wavy #f32e40 1px" },
    ".cm-lintRange-warning": { textDecoration: "underline wavy #ed9a00 1px" }
  },
  { dark: true }
)

export const grayscaleTheme = [grayhavenEditor, syntaxHighlighting(grayhavenHighlight)]
