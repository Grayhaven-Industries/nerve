import { createFileRoute } from "@tanstack/react-router"
import { PARTS_META } from "../docs/parts-meta.js"

export const Route = createFileRoute("/docs/library")({
  head: () => ({ meta: [{ title: "Part library · Grayhaven Nerve" }] }),
  component: LibraryReference
})

function LibraryReference() {
  const rows = PARTS_META
  const specCount = rows.filter((r) => r.spec !== undefined).length
  return (
    <>
      <span className="spec-tag">Part Library</span>
      <h1>
        {rows.length} connectors, {specCount}+ compact specs.
      </h1>
      <p>
        Reach parts with <code>part("spec")</code> — compact specs beat memorizing MPNs — or any
        raw MPN (case-insensitive; common vendor spellings normalize). This table renders
        extracted at build time from <code>@grayhaven/nerve-connectors</code>.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>Spec</th>
            <th>MPN</th>
            <th>Family</th>
            <th>Pins</th>
            <th>Gender</th>
            <th>Verification</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mpn}>
              <td className="cell-code">{r.spec ?? ""}</td>
              <td className="cell-code">{r.mpn}</td>
              <td className="cell-text">{r.family ?? ""}</td>
              <td className="cell-text">{r.pinCount}</td>
              <td className="cell-text">{r.gender ?? ""}</td>
              <td className="cell-text">{r.verification ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Verification states come from part provenance (PRD §30): <code>verified</code> passed a
        datasheet review; <code>inspired-by</code> is seed data awaiting one.
      </p>
    </>
  )
}
