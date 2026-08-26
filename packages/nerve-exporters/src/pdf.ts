/**
 * PDF manufacturing packet (PRD §9.8, DoD #6).
 *
 * Readable without the app: cover page with revision metadata and
 * validation status, schematic and harness-board pages rendered from
 * DrawingIR, then BOM / cut list / labels / test tables and assembly
 * instructions. Deterministic: pinned creation dates, fixed producer
 * metadata, no randomness.
 */
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
  type PDFPageDrawLineOptions,
  type PDFPageDrawRectangleOptions,
  type PDFPageDrawSVGOptions,
  type RGB
} from "pdf-lib"
import { hasErrors, type Hir } from "@grayhaven/nerve"
import { draft } from "./draft.js"
import {
  bomTable,
  cutListTable,
  labelScheduleTable,
  testPlanTable,
  type CutListOptions,
  type TableData
} from "./csv.js"
import { generateTestPlan } from "./test-plan.js"
import { schematicDrawing } from "./svg.js"
import { boardDrawing } from "./board.js"
import { connectorFacesDrawing } from "./faces.js"
import { scaleDrawing, type Drawing } from "./drawing.js"
import { assemblyInstructions } from "./instructions.js"
import { bopTable, generateBop } from "./bop.js"
import { generateQuote, quoteTable } from "./cost.js"
import type { CostModel } from "@grayhaven/nerve"

// Letter landscape for everything: drawings need the width, and a single
// orientation keeps the packet printable as one document.
const PAGE_W = 792
const PAGE_H = 612
const MARGIN = 40

const NAMED_COLORS = new Map<string, readonly [number, number, number]>([
  ["red", [0.85, 0.1, 0.1]],
  ["black", [0.13, 0.13, 0.13]],
  ["blue", [0.1, 0.2, 0.85]],
  ["green", [0.1, 0.6, 0.2]],
  ["white", [0.72, 0.72, 0.72]],
  ["yellow", [0.79, 0.66, 0]],
  ["orange", [0.9, 0.5, 0.1]],
  ["gray", [0.5, 0.5, 0.5]],
  ["grey", [0.5, 0.5, 0.5]],
  ["brown", [0.5, 0.33, 0.2]],
  ["purple", [0.5, 0.2, 0.7]],
  ["pink", [0.9, 0.4, 0.6]]
])

const parseColor = (color: string | undefined): RGB => {
  if (color === undefined) return rgb(0.4, 0.4, 0.4)
  const named = NAMED_COLORS.get(color.toLowerCase())
  if (named !== undefined) return rgb(...named)
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1]
  if (hex !== undefined) {
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex
    return rgb(
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255
    )
  }
  return rgb(0.4, 0.4, 0.4)
}

/** WinAnsi-safe text for the standard fonts. */
const safe = (s: string): string =>
  s.replace(/→/g, "->").replace(/[^\x20-\x7E\xA0-\xFF·±—–]/g, "?")

interface Fonts {
  readonly regular: PDFFont
  readonly bold: PDFFont
  readonly mono: PDFFont
}

const drawDrawing = (page: PDFPage, drawing: Drawing, fonts: Fonts): void => {
  const availW = PAGE_W - 2 * MARGIN
  const availH = PAGE_H - 2 * MARGIN
  const s = Math.min(availW / drawing.width, availH / drawing.height, 1)
  const d = scaleDrawing(drawing, s)
  const ox = MARGIN + (availW - d.width) / 2
  const oyTop = MARGIN + (availH - d.height) / 2
  const flip = (y: number): number => PAGE_H - oyTop - y

  for (const item of d.items) {
    switch (item.kind) {
      case "rect": {
        const rect = draft<PDFPageDrawRectangleOptions>({
          x: ox + item.x,
          y: flip(item.y + item.h),
          width: item.w,
          height: item.h
        })
        if (item.fill !== undefined && item.fill !== "none") rect.color = parseColor(item.fill)
        if (item.stroke !== undefined) {
          rect.borderColor = parseColor(item.stroke)
          rect.borderWidth = item.strokeWidth ?? 1
        }
        page.drawRectangle(rect)
        break
      }
      case "line": {
        const line = draft<PDFPageDrawLineOptions>({
          start: { x: ox + item.x1, y: flip(item.y1) },
          end: { x: ox + item.x2, y: flip(item.y2) },
          thickness: item.strokeWidth ?? 1,
          color: parseColor(item.stroke)
        })
        if (item.dash !== undefined) line.dashArray = [...item.dash]
        page.drawLine(line)
        break
      }
      case "path": {
        // drawSvgPath interprets the path in SVG coordinates (y down) from
        // the given origin.
        const path = draft<PDFPageDrawSVGOptions>({
          x: ox,
          y: PAGE_H - oyTop,
          borderColor: parseColor(item.stroke),
          borderWidth: item.strokeWidth ?? 1
        })
        if (item.dash !== undefined) path.borderDashArray = [...item.dash]
        page.drawSvgPath(item.d, path)
        break
      }
      case "text": {
        const font = item.weight === "bold" ? fonts.bold : fonts.mono
        const size = item.size ?? 12
        const text = safe(item.text)
        const width = font.widthOfTextAtSize(text, size)
        const x =
          item.anchor === "middle"
            ? ox + item.x - width / 2
            : item.anchor === "end"
              ? ox + item.x - width
              : ox + item.x
        page.drawText(text, {
          x,
          y: flip(item.y),
          size,
          font,
          color: parseColor(item.fill ?? "#111")
        })
        break
      }
      case "circle":
        page.drawCircle({
          x: ox + item.cx,
          y: flip(item.cy),
          size: item.r,
          color: parseColor(item.fill)
        })
        break
    }
  }
}

const pageHeader = (page: PDFPage, fonts: Fonts, hir: Hir, title: string): number => {
  page.drawText(safe(title), {
    x: MARGIN,
    y: PAGE_H - MARGIN,
    size: 14,
    font: fonts.bold,
    color: rgb(0.07, 0.07, 0.07)
  })
  page.drawText(safe(`${hir.harness.id} · rev ${hir.harness.revision}`), {
    x: PAGE_W - MARGIN - fonts.mono.widthOfTextAtSize(`${hir.harness.id} · rev ${hir.harness.revision}`, 9),
    y: PAGE_H - MARGIN,
    size: 9,
    font: fonts.mono,
    color: rgb(0.45, 0.45, 0.45)
  })
  page.drawLine({
    start: { x: MARGIN, y: PAGE_H - MARGIN - 8 },
    end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 8 },
    thickness: 0.7,
    color: rgb(0.8, 0.8, 0.8)
  })
  return PAGE_H - MARGIN - 26
}

const drawTablePages = (
  doc: PDFDocument,
  fonts: Fonts,
  hir: Hir,
  title: string,
  table: TableData
): void => {
  const usable = PAGE_W - 2 * MARGIN
  const colW = usable / table.headers.length
  const rowH = 14
  const size = Math.min(8, colW / 6)
  const maxChars = Math.floor(colW / (size * 0.62))

  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = pageHeader(page, fonts, hir, title)

  const drawRow = (cells: ReadonlyArray<string | number | undefined>, bold: boolean) => {
    cells.forEach((cell, i) => {
      const text = safe(String(cell ?? ""))
      page.drawText(text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text, {
        x: MARGIN + i * colW,
        y,
        size,
        font: bold ? fonts.bold : fonts.mono,
        color: rgb(0.1, 0.1, 0.1)
      })
    })
    y -= rowH
  }

  drawRow(table.headers, true)
  for (const row of table.rows) {
    if (y < MARGIN + rowH) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = pageHeader(page, fonts, hir, `${title} (cont.)`)
      drawRow(table.headers, true)
    }
    drawRow(row, false)
  }
}

const drawTextPages = (
  doc: PDFDocument,
  fonts: Fonts,
  hir: Hir,
  title: string,
  body: string
): void => {
  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = pageHeader(page, fonts, hir, title)
  for (const line of body.split("\n")) {
    if (y < MARGIN + 12) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = pageHeader(page, fonts, hir, `${title} (cont.)`)
    }
    page.drawText(safe(line), {
      x: MARGIN,
      y,
      size: 9,
      font: fonts.mono,
      color: rgb(0.1, 0.1, 0.1)
    })
    y -= 12
  }
}

export interface PdfOptions extends CutListOptions {
  readonly costing?: CostModel
}

export const manufacturingPacketPdf = async (
  hir: Hir,
  options: PdfOptions = {}
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  // Pin all metadata so identical input yields identical bytes (PRD §15).
  const epoch = new Date("2000-01-01T00:00:00Z")
  doc.setCreationDate(epoch)
  doc.setModificationDate(epoch)
  doc.setProducer("Grayhaven Nerve")
  doc.setCreator("Grayhaven Nerve")
  doc.setTitle(`${hir.harness.id} rev ${hir.harness.revision} — manufacturing packet`)

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier)
  }

  // --- Cover ---------------------------------------------------------------
  const cover = doc.addPage([PAGE_W, PAGE_H])
  const errors = hir.diagnostics.filter((d) => d.severity === "error").length
  const warnings = hir.diagnostics.filter((d) => d.severity === "warning").length
  cover.drawText("GRAYHAVEN NERVE", {
    x: MARGIN,
    y: PAGE_H - 80,
    size: 12,
    font: fonts.bold,
    color: rgb(0.45, 0.45, 0.45)
  })
  cover.drawText("MANUFACTURING PACKET", {
    x: MARGIN,
    y: PAGE_H - 110,
    size: 26,
    font: fonts.bold,
    color: rgb(0.07, 0.07, 0.07)
  })
  const fields: ReadonlyArray<readonly [string, string]> = [
    ["Harness", hir.harness.id],
    ["Revision", hir.harness.revision],
    ["Units", hir.harness.units],
    ["HIR schema", hir.schemaVersion],
    ["Connectors", String(hir.connectors.length)],
    ["Wires", String(hir.wires.length)],
    ["Branches", String(hir.branches.length)],
    ["Labels", String(hir.labels.length)],
    [
      "Validation",
      hasErrors(hir.diagnostics)
        ? `FAILED — ${errors} error(s)`
        : `PASSED — 0 errors, ${warnings} warning(s)`
    ]
  ]
  let fy = PAGE_H - 160
  for (const [key, value] of fields) {
    cover.drawText(safe(key), { x: MARGIN, y: fy, size: 11, font: fonts.bold })
    cover.drawText(safe(value), { x: MARGIN + 130, y: fy, size: 11, font: fonts.mono })
    fy -= 20
  }
  cover.drawText("Revision history", { x: MARGIN, y: fy - 16, size: 11, font: fonts.bold })
  cover.drawText(safe(`rev ${hir.harness.revision} — this release`), {
    x: MARGIN + 130,
    y: fy - 16,
    size: 11,
    font: fonts.mono
  })

  // --- Drawings --------------------------------------------------------------
  const schematicPage = doc.addPage([PAGE_W, PAGE_H])
  drawDrawing(schematicPage, schematicDrawing(hir), fonts)
  const boardPage = doc.addPage([PAGE_W, PAGE_H])
  drawDrawing(boardPage, boardDrawing(hir), fonts)
  const facesPage = doc.addPage([PAGE_W, PAGE_H])
  drawDrawing(facesPage, connectorFacesDrawing(hir), fonts)

  // --- Tables ----------------------------------------------------------------
  drawTablePages(doc, fonts, hir, "Bill of Materials", bomTable(hir))
  drawTablePages(doc, fonts, hir, "Wire Cut List", cutListTable(hir, options))
  drawTablePages(doc, fonts, hir, "Bill of Process", bopTable(generateBop(hir)))
  drawTablePages(doc, fonts, hir, "Label Schedule", labelScheduleTable(hir))
  drawTablePages(doc, fonts, hir, "Continuity Test Procedure", testPlanTable(generateTestPlan(hir)))

  // --- Quote (when the org provides a cost model, PRD §29) ---------------------
  if (options.costing !== undefined) {
    drawTablePages(doc, fonts, hir, "Quote", quoteTable(generateQuote(hir, options.costing)))
  }

  // --- Assembly instructions ---------------------------------------------------
  drawTextPages(doc, fonts, hir, "Assembly Instructions", assemblyInstructions(hir))

  return doc.save()
}
