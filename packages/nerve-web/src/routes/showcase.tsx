import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { isPinEndpoint, type Diagnostic, type HirEndpoint } from "@grayhaven/nerve"
import { SchematicSheet } from "../components/SchematicSheet.js"
import {
  JPL_HARNESSES,
  JPL_SHOWCASE_SUMMARY,
  JPL_SOURCE,
  PACKET_MANIFEST,
  type JplHarnessProof
} from "../showcase/jpl-rover.js"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/showcase")({
  head: () => ({
    meta: [
      { title: "Showcase · Grayhaven Nerve" },
      {
        name: "description",
        content:
          "Six NASA/JPL Open Source Rover harnesses imported from WireViz and rebuilt with Nerve."
      }
    ]
  }),
  component: RoverShowcase
})

const sourceUrl = `${JPL_SOURCE.repository}/tree/${JPL_SOURCE.commit}/${JPL_SOURCE.path}`

const endpoint = (value: HirEndpoint): string =>
  isPinEndpoint(value) ? `${value.connector}.${value.pin}` : `splice:${value.splice}`

const diagnosticCount = (diagnostics: ReadonlyArray<Diagnostic>, severity: string): number =>
  diagnostics.filter((diagnostic) => diagnostic.severity === severity).length

const sum = (pick: (proof: JplHarnessProof) => number): number =>
  JPL_HARNESSES.reduce((total, proof) => total + pick(proof), 0)

/* The corpus totals, derived rather than written down, so the page cannot
   claim a number the imported data does not support. */
const CORPUS = {
  designs: JPL_SHOWCASE_SUMMARY.designs,
  conductors: JPL_SHOWCASE_SUMMARY.conductors,
  importErrors: sum((proof) => diagnosticCount(proof.importDiagnostics, "error")),
  checks: JPL_SHOWCASE_SUMMARY.ruleCount,
  findings: sum((proof) => proof.reviewDiagnostics.length),
  blocked: JPL_HARNESSES.filter((proof) => !proof.releaseReady).length
}

/** Number over label, hairline above: the page opens with measurements. */
function Fact({ value, label, flagged }: { value: string; label: string; flagged?: boolean }) {
  return (
    <div className={flagged === true ? "showcase-fact showcase-fact-flagged" : "showcase-fact"}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

/**
 * Figure head: a number, a name, and one line saying where the content came
 * from. The note sits to the right of the name so the head spans the page
 * instead of leaving the right half empty.
 */
function FigureHead({ index, name, note }: { index: string; name: string; note: string }) {
  return (
    <div className="showcase-fig-head">
      <h2>
        <span>{index}</span>
        {name}
      </h2>
      <p>{note}</p>
    </div>
  )
}

function Finding({ diagnostic }: { diagnostic: Diagnostic }) {
  return (
    <li className={`showcase-finding finding-${diagnostic.severity}`}>
      <div className="showcase-finding-code">
        <span>{diagnostic.code}</span>
        <span>{diagnostic.severity}</span>
      </div>
      <p>{diagnostic.message}</p>
      {diagnostic.target !== undefined && <code>{diagnostic.target}</code>}
    </li>
  )
}

function ProofStage({ proof }: { proof: JplHarnessProof }) {
  const importErrors = diagnosticCount(proof.importDiagnostics, "error")
  const importWarnings = diagnosticCount(proof.importDiagnostics, "warning")
  const reviewErrors = diagnosticCount(proof.reviewDiagnostics, "error")
  const sourceLines = proof.source.split("\n").length

  return (
    <section className="showcase-stage" aria-label="WireViz source and Nerve review">
      <div className="showcase-source">
        <div className="showcase-panel-head">
          <div>
            <h2>{proof.title}</h2>
            <span className="showcase-kicker">WireViz source, {sourceLines} lines</span>
          </div>
          <span className="showcase-file">{proof.slug.replaceAll("-", "_")}.yml</span>
        </div>
        <pre tabIndex={0} aria-label={`${proof.name} WireViz source`}>
          <code>{proof.source}</code>
        </pre>
        <div className="showcase-source-foot">
          <span>Plus the shared templates.yml</span>
          <span>{JPL_SOURCE.license}</span>
        </div>
      </div>

      <div className="showcase-evidence">
        <div className="showcase-panel-head">
          <div>
            <h2>Nerve review</h2>
            <span className="showcase-kicker">
              {JPL_SHOWCASE_SUMMARY.ruleCount} checks run against the imported model
            </span>
          </div>
          <span className={`showcase-gate ${proof.releaseReady ? "gate-clear" : "gate-blocked"}`}>
            {proof.releaseReady ? "No blockers" : "Release blocked"}
          </span>
        </div>

        <div className="showcase-ledger">
          <div>
            <strong>{importErrors} errors</strong>
            <span>on import, {proof.hir.wires.length} wires read</span>
          </div>
          <div>
            <strong>{reviewErrors} findings</strong>
            <span>from {JPL_SHOWCASE_SUMMARY.ruleCount} checks</span>
          </div>
          <div>
            <strong>{proof.fingerprint.slice(0, 8)}</strong>
            <span>fingerprint of this exact design</span>
          </div>
        </div>

        {proof.reviewDiagnostics.length > 0 ? (
          <ol className="showcase-findings">
            {proof.reviewDiagnostics.map((diagnostic, index) => (
              <Finding key={`${diagnostic.code}-${diagnostic.target ?? index}`} diagnostic={diagnostic} />
            ))}
          </ol>
        ) : (
          <div className="showcase-no-findings">
            <strong>No checks flagged anything in this design.</strong>
            <p>It still needs a normal engineering review of the design and its source data.</p>
          </div>
        )}

        <details className="showcase-import-notes">
          <summary>{importWarnings} import note{importWarnings === 1 ? "" : "s"}</summary>
          <ul>
            {proof.importDiagnostics
              .filter((diagnostic) => diagnostic.severity === "warning")
              .map((diagnostic, index) => (
                <li key={`${diagnostic.message}-${index}`}>{diagnostic.message}</li>
              ))}
          </ul>
        </details>
      </div>
    </section>
  )
}

function ConductorTable({ proof }: { proof: JplHarnessProof }) {
  return (
    <div className="showcase-table-wrap" tabIndex={0} role="region" aria-label="Imported wire data">
      <table className="showcase-wire-table">
        <thead>
          <tr>
            <th>Wire</th>
            <th>Signal</th>
            <th>From</th>
            <th>To</th>
            <th>Gauge</th>
            <th>Color</th>
            <th>Cut length</th>
          </tr>
        </thead>
        <tbody>
          {proof.hir.wires.map((wire) => (
            <tr key={wire.id}>
              <td>{wire.id}</td>
              <td>{wire.signal ?? "—"}</td>
              <td>{endpoint(wire.from)}</td>
              <td>{endpoint(wire.to)}</td>
              <td>{wire.gauge ?? "—"}</td>
              <td>
                <span className="showcase-color">
                  <i style={{ backgroundColor: wire.color ?? "transparent" }} />
                  {wire.color ?? "—"}
                </span>
              </td>
              <td>{wire.length === undefined ? "—" : `${wire.length} mm`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The packet, shown as its actual file list. A four-column rail of capability
 * words ("Inspect · Build · Test · Communicate") said less than the manifest
 * does, and the manifest cannot be written to flatter the product.
 */
function PacketFigure({ proof }: { proof: JplHarnessProof }) {
  const [exportState, setExportState] = useState<"idle" | "building" | "done" | "error">("idle")

  const downloadPacket = async () => {
    setExportState("building")
    try {
      const { buildPacket } = await import("@grayhaven/nerve-exporters")
      const packet = await buildPacket(proof.hir)
      const bytes = new Uint8Array(packet.zip)
      const url = URL.createObjectURL(new Blob([bytes.buffer], { type: "application/zip" }))
      const link = document.createElement("a")
      link.href = url
      link.download = `${proof.hir.harness.id}-packet.zip`
      link.click()
      URL.revokeObjectURL(url)
      setExportState("done")
    } catch {
      setExportState("error")
    }
  }

  return (
    <section className="showcase-fig">
      <FigureHead
        index="03"
        name="Packet"
        note={`Every file the exporter writes for this harness, including ${proof.testPlan.tests.length} continuity and isolation steps.`}
      />
      <ul className="showcase-manifest">
        {PACKET_MANIFEST.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
      <div className="showcase-export">
        <Button onClick={() => void downloadPacket()} disabled={exportState === "building"}>
          {exportState === "building"
            ? "Building packet…"
            : exportState === "done"
              ? "Packet downloaded"
              : `Download the packet (${JPL_SHOWCASE_SUMMARY.packetFiles} files)`}
        </Button>
        <span>
          {exportState === "error"
            ? "Packet generation failed. Try again."
            : "Built in your browser from the imported design. Nothing is uploaded."}
        </span>
      </div>
    </section>
  )
}

/**
 * Closing notes as a spec sheet: term on the left, prose on the right. This
 * was three separate marketing sections (a comparison, a bullet list of what
 * Nerve adds, and a disclaimer). They are all the same kind of statement, so
 * they read better as rows of one list, and the honest one is not buried last.
 */
function Notes() {
  return (
    <footer className="showcase-notes">
      <dl>
        <div>
          <dt>Relationship to WireViz</dt>
          <dd>
            WireViz is the input here, not the competition. It gives engineers concise wiring docs
            and diagrams, and it is what these six designs were written in. Nerve reads those files
            and adds the step after: a typed model with a stable fingerprint,{" "}
            {JPL_SHOWCASE_SUMMARY.ruleCount} repeatable checks that can block a release, and the
            build and test artifacts a shop needs.
          </dd>
        </div>
        <div>
          <dt>What a finding means</dt>
          <dd>
            Findings are prompts for an engineer to review, not defects. <code>G</code> versus{" "}
            <code>GND</code> may well be an intentional alias, and the point of the check is that
            somebody confirms it and records the answer.
          </dd>
        </div>
        <div>
          <dt>Limits of this page</dt>
          <dd>
            Nerve imported the published files exactly as they are and checked what they state.
            Nothing here is a claim that the physical rover harness is unsafe, a certification, or
            an endorsement by NASA or JPL.
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              nasa-jpl/open-source-rover
            </a>
            , {JPL_SOURCE.path}, {JPL_SOURCE.license}, commit{" "}
            <code>{JPL_SOURCE.commit.slice(0, 8)}</code>.
          </dd>
        </div>
      </dl>
    </footer>
  )
}

function RoverShowcase() {
  const [selectedSlug, setSelectedSlug] = useState(JPL_HARNESSES[0]!.slug)
  const proof = JPL_HARNESSES.find((candidate) => candidate.slug === selectedSlug) ?? JPL_HARNESSES[0]!

  return (
    <article className="showcase">
      {/* One statement, then the sentence that qualifies it, in the same
          display size. The old hero split a slogan across two lines and greyed
          the second half, which reads as a landing page rather than a report. */}
      <header className="showcase-hero">
        <h1>
          Six harnesses from the NASA JPL Open Source Rover.{" "}
          <span>
            Imported from their published WireViz YAML, compiled to a typed model, and run through
            Nerve&rsquo;s release checks. Nothing retyped, no cleaned-up demo data.
          </span>
        </h1>
        <div className="showcase-facts">
          <Fact value={String(CORPUS.designs)} label="harnesses imported" />
          <Fact value={String(CORPUS.conductors)} label="conductors" />
          <Fact value={String(CORPUS.importErrors)} label="import errors" />
          <Fact value={String(CORPUS.checks)} label="checks per harness" />
          <Fact value={String(CORPUS.findings)} label="findings raised" />
          <Fact
            value={`${CORPUS.blocked} of ${CORPUS.designs}`}
            label="release blocked"
            flagged={CORPUS.blocked > 0}
          />
        </div>
      </header>

      {/* Picker, source, review, schematic, table, and packet are all the one
          selected harness. They stay in a tight rhythm so they read as a
          single inspection surface; the page break comes after them. */}
      <nav className="showcase-picker" aria-label="Choose a rover harness">
        {JPL_HARNESSES.map((candidate) => (
          <button
            key={candidate.slug}
            type="button"
            aria-pressed={candidate.slug === proof.slug}
            onClick={() => setSelectedSlug(candidate.slug)}
          >
            <span>{candidate.name}</span>
            <small>
              {candidate.hir.wires.length} wires, {candidate.reviewDiagnostics.length} findings
            </small>
          </button>
        ))}
      </nav>

      <ProofStage proof={proof} />

      <section className="showcase-fig showcase-drawing">
        <FigureHead
          index="01"
          name="Schematic"
          note="Drawn from the imported design data. Hover a wire to follow it."
        />
        <SchematicSheet
          svg={proof.schematic}
          filename={`${proof.hir.harness.id}-schematic.svg`}
          hir={proof.hir}
          kind="schematic"
        />
      </section>

      <section className="showcase-fig">
        <FigureHead
          index="02"
          name="Conductors"
          note="Endpoints, signals, gauges, colors, and lengths, as the importer read them."
        />
        <ConductorTable proof={proof} />
      </section>

      <PacketFigure proof={proof} />

      <Notes />
    </article>
  )
}
