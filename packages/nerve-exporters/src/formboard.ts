/**
 * Formboard / nailboard production output (PRD §33).
 *
 * 1:1-scale print tiling: the board drawing is rendered at exactly
 * 1 SVG unit = 1 mm and windowed into paper-sized sheets via viewBox
 * (printers clip natively). Each sheet carries fiducial crosses, dashed
 * stitch borders, a sheet label (R1C1-style), and sheet 1 carries a 100 mm
 * calibration ruler so the technician can verify the printer didn't scale.
 *
 * Print at 100% / "actual size".
 *
 * Routed branches. A branch that carries an authored 3D centerline is laid
 * into the sheet by arc-length unroll (board.ts documents the projection in
 * full). That choice is made for THIS output specifically: a formboard is a
 * physical template that someone lays bundle against and cuts, so the property
 * worth guaranteeing is that distance measured ALONG a printed trunk equals
 * the harness's real routed length — which every planar projection breaks by
 * foreshortening, silently and in the short direction. The cost is that the
 * sheet is not a true plan view of a route with torsion: straight-line
 * distances ACROSS the paper between two trunks, or between two points on one
 * trunk, are not real distances, and a bundle that passes over itself in space
 * may cross itself here. Sheets carrying a routed trunk say so on the page.
 */
import type { Hir } from "@grayhaven/nerve"
import { boardDrawing, isRoutedBranch, ROUTED_PROJECTION_NOTE } from "./board.js"
import { renderItems } from "./drawing.js"

const PAPERS = {
  // Landscape, mm.
  letter: { w: 279.4, h: 215.9 },
  a4: { w: 297, h: 210 }
} as const

export type Paper = keyof typeof PAPERS

export interface FormboardOptions {
  readonly paper?: Paper
  /** Unprintable margin per edge, mm. */
  readonly marginMm?: number
}

export interface FormboardSheet {
  readonly name: string
  readonly row: number
  readonly col: number
  readonly svg: string
}

export interface Formboard {
  readonly rows: number
  readonly cols: number
  readonly sheets: ReadonlyArray<FormboardSheet>
  readonly boardWidthMm: number
  readonly boardHeightMm: number
}

const fiducial = (x: number, y: number): string =>
  `<g stroke="#000" stroke-width="0.3">` +
  `<line x1="${x - 4}" y1="${y}" x2="${x + 4}" y2="${y}"/>` +
  `<line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y + 4}"/>` +
  `<circle cx="${x}" cy="${y}" r="2" fill="none"/>` +
  `</g>`

export const formboardSheets = (
  hir: Hir,
  options: FormboardOptions = {}
): Formboard => {
  const paper = PAPERS[options.paper ?? "letter"]
  const margin = options.marginMm ?? 10
  const tileW = paper.w - 2 * margin
  const tileH = paper.h - 2 * margin

  // boardDrawing is mm-native (1 unit = 1 mm): windowed as-is, no
  // rescale and no lossy path round-trip — calibration is exact by
  // construction.
  const drawing = boardDrawing(hir)
  // The template is 1:1 along a routed trunk but not across the sheet, and the
  // person holding the paper is the one who has to know that. Emitted only
  // when a routed trunk exists, so unrouted sheets are unchanged.
  const routedNote = hir.branches.some(isRoutedBranch)
  const cols = Math.max(1, Math.ceil(drawing.width / tileW))
  const rows = Math.max(1, Math.ceil(drawing.height / tileH))
  const body = renderItems(drawing.items)

  const sheets: Array<FormboardSheet> = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * tileW
      const y0 = r * tileH
      const label = `R${r + 1}C${c + 1}`
      const overlay = [
        // Stitch border: dashed cut/align line around the printable window.
        `<rect x="${x0}" y="${y0}" width="${tileW}" height="${tileH}" fill="none" stroke="#000" stroke-width="0.25" stroke-dasharray="4 3"/>`,
        fiducial(x0 + 6, y0 + 6),
        fiducial(x0 + tileW - 6, y0 + 6),
        fiducial(x0 + 6, y0 + tileH - 6),
        fiducial(x0 + tileW - 6, y0 + tileH - 6),
        `<text x="${x0 + tileW - 12}" y="${y0 + tileH - 10}" font-size="5" text-anchor="end" fill="#000">${hir.harness.id} rev ${hir.harness.revision} · ${label} of R${rows}C${cols} · 1:1</text>`,
        ...(routedNote
          ? [
              `<text x="${x0 + 12}" y="${y0 + tileH - 10}" font-size="5" fill="#000">${ROUTED_PROJECTION_NOTE}</text>`
            ]
          : []),
        ...(r === 0 && c === 0
          ? [
              // Calibration ruler: exactly 100 mm with 10 mm ticks.
              `<g stroke="#000" stroke-width="0.4">` +
                `<line x1="${x0 + 15}" y1="${y0 + 14}" x2="${x0 + 115}" y2="${y0 + 14}"/>` +
                Array.from({ length: 11 }, (_, i) =>
                  `<line x1="${x0 + 15 + i * 10}" y1="${y0 + 14}" x2="${x0 + 15 + i * 10}" y2="${y0 + (i % 5 === 0 ? 19 : 17)}"/>`
                ).join("") +
                `</g>`,
              `<text x="${x0 + 15}" y="${y0 + 25}" font-size="4" fill="#000">CALIBRATION 100 mm — measure after printing; reprint at 100% if off</text>`
            ]
          : [])
      ].join("\n")

      sheets.push({
        name: `formboard-${label}.svg`,
        row: r + 1,
        col: c + 1,
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}mm" height="${tileH}mm" viewBox="${x0} ${y0} ${tileW} ${tileH}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">\n` +
          `<rect x="${x0}" y="${y0}" width="${tileW}" height="${tileH}" fill="#ffffff"/>\n` +
          body +
          "\n" +
          overlay +
          "\n</svg>\n"
      })
    }
  }

  return {
    rows,
    cols,
    sheets,
    boardWidthMm: Math.ceil(drawing.width),
    boardHeightMm: Math.ceil(drawing.height)
  }
}
