/**
 * Manufacturing packet (PRD §9.8).
 *
 * A zip archive containing every exported artifact plus the machine-readable
 * HIR. Deterministic: fixed file order, pinned timestamps, pinned
 * compression level, and a content-derived cover sheet instead of a
 * generation timestamp.
 */
import { zipSync, strToU8 } from "fflate"
import { hasErrors, type Hir } from "@grayhaven/nerve"
import { bomCsv, cutListCsv, labelScheduleCsv, testPlanCsv, type CutListOptions } from "./csv.js"
import { schematicHtml } from "./html.js"
import {
  bomJsonSatellite,
  cutListJsonSatellite,
  diagnosticsJson,
  graphJson,
  labelScheduleJsonSatellite,
  renderLayoutJson
} from "./satellites.js"
import { coverage, generateTestPlan, testPlanJson } from "./test-plan.js"
import { schematicSvg } from "./svg.js"
import { boardSvg } from "./board.js"
import { connectorFacesSvg } from "./faces.js"
import { pinoutSvg } from "./pinout.js"
import { assemblyInstructions } from "./instructions.js"
import { bopCsv, bopJson } from "./bop.js"
import { quoteCsv, quoteJson } from "./cost.js"
import type { CostModel } from "@grayhaven/nerve"
import { manufacturingPacketPdf } from "./pdf.js"

export interface PacketOptions extends CutListOptions {
  readonly costing?: CostModel
}

export interface Packet {
  /** File name → contents, in archive order. */
  readonly files: ReadonlyMap<string, string | Uint8Array>
  readonly zip: Uint8Array
}

const coverSheet = (hir: Hir): string => {
  const errors = hir.diagnostics.filter((d) => d.severity === "error").length
  const warnings = hir.diagnostics.filter((d) => d.severity === "warning").length
  return [
    "GRAYHAVEN NERVE — MANUFACTURING PACKET",
    "",
    `Harness:      ${hir.harness.id}`,
    `Revision:     ${hir.harness.revision}`,
    `Units:        ${hir.harness.units}`,
    `HIR schema:   ${hir.schemaVersion}`,
    `Connectors:   ${hir.connectors.length}`,
    `Wires:        ${hir.wires.length}`,
    `Validation:   ${errors} error(s), ${warnings} warning(s)`,
    "",
    "Contents:",
    "  manufacturing-packet.pdf    printable packet (readable without the app)",
    "  harness.json                machine-readable HIR",
    "  schematic.svg               wiring diagram",
    "  board.svg                   harness board / nailboard view",
    "  connector-faces.svg         cavity layouts, population, orientation",
    "  pinout.svg                  per-cavity pinout cards with terminals/seals",
    "  bom.csv                     bill of materials",
    "  cut-list.csv                wire cut list",
    "  labels.csv                  label schedule",
    "  tests.csv                   continuity-test procedure",
    "  test-plan.json              machine-readable test plan",
    "  assembly-instructions.txt   build steps",
    ""
  ].join("\n")
}

export const buildPacket = async (
  hir: Hir,
  options: PacketOptions = {}
): Promise<Packet> => {
  const plan = generateTestPlan(hir)
  const files = new Map<string, string | Uint8Array>([
    ["COVER.txt", coverSheet(hir)],
    ["manufacturing-packet.pdf", await manufacturingPacketPdf(hir, options)],
    ["harness.json", JSON.stringify(hir, null, 2) + "\n"],
    ["graph.json", graphJson(hir)],
    ["render-layout.json", renderLayoutJson(hir)],
    ["diagnostics.json", diagnosticsJson(hir)],
    ["schematic.svg", schematicSvg(hir)],
    ["schematic.html", schematicHtml(hir)],
    ["board.svg", boardSvg(hir)],
    ["connector-faces.svg", connectorFacesSvg(hir)],
    ["pinout.svg", pinoutSvg(hir)],
    ["bom.csv", bomCsv(hir)],
    ["cut-list.csv", cutListCsv(hir, options)],
    ["labels.csv", labelScheduleCsv(hir)],
    ["bom.json", bomJsonSatellite(hir)],
    ["cut-list.json", cutListJsonSatellite(hir, options)],
    ["label-schedule.json", labelScheduleJsonSatellite(hir)],
    ["bop.csv", bopCsv(hir)],
    ["bop.json", bopJson(hir)],
    ["tests.csv", testPlanCsv(plan)],
    ["test-plan.json", testPlanJson(hir)],
    ["assembly-instructions.txt", assemblyInstructions(hir)],
    ...(options.costing !== undefined
      ? ([
          ["quote.csv", quoteCsv(hir, options.costing)],
          ["quote.json", quoteJson(hir, options.costing)]
        ] as const)
      : [])
  ])
  // Zip's DOS timestamp floor is 1980-01-01 (interpreted in local time by
  // fflate); pin every entry well clear of the floor so the archive is
  // byte-identical for identical inputs in any timezone.
  const ZIP_EPOCH = new Date(1980, 5, 1)
  const zipInput: Record<string, [Uint8Array, { level: 6; mtime: Date }]> = {}
  for (const [name, contents] of files) {
    zipInput[name] = [
      contents instanceof Uint8Array ? contents : strToU8(contents),
      { level: 6, mtime: ZIP_EPOCH }
    ]
  }
  return { files, zip: zipSync(zipInput) }
}

/** Release exports must fail closed on validation errors (PRD §15). */
export const canRelease = (hir: Hir): boolean => {
  if (hasErrors(hir.diagnostics)) return false
  const plan = generateTestPlan(hir)
  const result = coverage(hir, plan)
  return result.covered === result.nets
}
