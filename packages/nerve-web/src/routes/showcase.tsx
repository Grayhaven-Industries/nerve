import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  isPinEndpoint,
  type Diagnostic,
  type HirEndpoint,
} from "@grayhaven/nerve";
import { SchematicSheet } from "../components/SchematicSheet.js";
import {
  JPL_HARNESSES,
  JPL_SHOWCASE_SUMMARY,
  JPL_SOURCE,
  type JplHarnessProof,
} from "../showcase/jpl-rover.js";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/showcase")({
  head: () => ({
    meta: [
      { title: "Showcase · Grayhaven Nerve" },
      {
        name: "description",
        content:
          "Six NASA/JPL Open Source Rover harnesses imported from WireViz and reviewed with Nerve.",
      },
    ],
  }),
  component: RoverShowcase,
});

const sourceUrl = `${JPL_SOURCE.repository}/tree/${JPL_SOURCE.commit}/${JPL_SOURCE.path}`;

const endpoint = (value: HirEndpoint): string =>
  isPinEndpoint(value)
    ? `${value.connector}.${value.pin}`
    : `splice:${value.splice}`;

function Finding({ diagnostic }: { diagnostic: Diagnostic }) {
  return (
    <li className="showcase-finding">
      <span>{diagnostic.code}</span>
      <div>
        <p>{diagnostic.message}</p>
        {diagnostic.target !== undefined && <code>{diagnostic.target}</code>}
      </div>
    </li>
  );
}

function Review({ proof }: { proof: JplHarnessProof }) {
  return (
    <section
      className="showcase-review"
      aria-labelledby="showcase-review-title"
    >
      <header className="showcase-review-head">
        <div>
          <h2 id="showcase-review-title">{proof.title}</h2>
          <p>
            {proof.hir.wires.length} conductors ·{" "}
            {JPL_SHOWCASE_SUMMARY.ruleCount} checks
          </p>
        </div>
        <strong className={proof.releaseReady ? "gate-clear" : "gate-blocked"}>
          {proof.releaseReady ? "Clear" : "Blocked"}
        </strong>
      </header>

      {proof.reviewDiagnostics.length > 0 ? (
        <ol className="showcase-findings">
          {proof.reviewDiagnostics.map((diagnostic) => (
            <Finding
              // Code plus target identifies a finding; message disambiguates
              // the untargeted ones. Array position never enters the key, so
              // filtering or reordering cannot re-key a row onto stale data.
              key={`${diagnostic.code}-${diagnostic.target ?? diagnostic.message}`}
              diagnostic={diagnostic}
            />
          ))}
        </ol>
      ) : (
        <p className="showcase-no-findings">No findings.</p>
      )}
    </section>
  );
}

function ConductorTable({ proof }: { proof: JplHarnessProof }) {
  return (
    <div
      className="showcase-table-wrap"
      tabIndex={0}
      role="region"
      aria-label="Imported conductors"
    >
      <table className="showcase-wire-table">
        <thead>
          <tr>
            <th>Wire</th>
            <th>Signal</th>
            <th>From</th>
            <th>To</th>
            <th>Gauge</th>
            <th>Color</th>
            <th>Length</th>
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
              <td>{wire.color ?? "—"}</td>
              <td>{wire.length === undefined ? "—" : `${wire.length} mm`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PacketExport({ proof }: { proof: JplHarnessProof }) {
  const [exportState, setExportState] = useState<
    "idle" | "building" | "done" | "error"
  >("idle");

  const downloadPacket = async () => {
    setExportState("building");
    try {
      const { buildPacket } = await import("@grayhaven/nerve-exporters");
      const packet = await buildPacket(proof.hir);
      const bytes = new Uint8Array(packet.zip);
      const url = URL.createObjectURL(
        new Blob([bytes.buffer], { type: "application/zip" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${proof.hir.harness.id}-packet.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setExportState("done");
    } catch {
      setExportState("error");
    }
  };

  return (
    <section className="showcase-detail-section">
      <h2>Export</h2>
      <div className="showcase-export">
        <Button
          onClick={() => void downloadPacket()}
          disabled={exportState === "building"}
        >
          {exportState === "building"
            ? "Building…"
            : exportState === "done"
              ? "Downloaded"
              : "Download packet"}
        </Button>
        {exportState === "error" && <span>Export failed. Try again.</span>}
      </div>
    </section>
  );
}

function DesignDetails({ proof }: { proof: JplHarnessProof }) {
  return (
    <details className="showcase-details">
      <summary>Inspect design</summary>
      <div className="showcase-details-body">
        <section className="showcase-detail-section showcase-source">
          <div className="showcase-detail-head">
            <h2>Source</h2>
            <code>{proof.slug.replaceAll("-", "_")}.yml</code>
          </div>
          <pre tabIndex={0} aria-label={`${proof.name} WireViz source`}>
            <code>{proof.source}</code>
          </pre>
        </section>

        <section className="showcase-detail-section showcase-drawing">
          <h2>Schematic</h2>
          <SchematicSheet
            svg={proof.schematic}
            filename={`${proof.hir.harness.id}-schematic.svg`}
            hir={proof.hir}
            kind="schematic"
          />
        </section>

        <section className="showcase-detail-section">
          <h2>Conductors</h2>
          <ConductorTable proof={proof} />
        </section>

        <PacketExport proof={proof} />

        <footer className="showcase-provenance">
          <p>
            Imported from{" "}
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              nasa-jpl/open-source-rover
            </a>{" "}
            at <code>{JPL_SOURCE.commit.slice(0, 8)}</code>. Findings require
            engineering review; they do not certify the physical harness.
          </p>
        </footer>
      </div>
    </details>
  );
}

function RoverShowcase() {
  const [selectedSlug, setSelectedSlug] = useState(JPL_HARNESSES[0]!.slug);
  const proof =
    JPL_HARNESSES.find((candidate) => candidate.slug === selectedSlug) ??
    JPL_HARNESSES[0]!;

  return (
    <article className="showcase">
      <header className="showcase-hero">
        <h1>Rover harness review</h1>
        <p>NASA/JPL Open Source Rover · WireViz import</p>
      </header>

      <div className="showcase-picker">
        <label htmlFor="showcase-harness">Harness</label>
        <select
          id="showcase-harness"
          value={proof.slug}
          onChange={(event) => setSelectedSlug(event.target.value)}
        >
          {JPL_HARNESSES.map((candidate) => (
            <option key={candidate.slug} value={candidate.slug}>
              {candidate.name}
            </option>
          ))}
        </select>
        <a href={sourceUrl} target="_blank" rel="noreferrer">
          Source
        </a>
      </div>

      <Review proof={proof} />
      <DesignDetails proof={proof} />
    </article>
  );
}
