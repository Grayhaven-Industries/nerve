/**
 * What a clean report rests on.
 *
 * The findings say what is wrong. The margins say how close. Neither says
 * whether the numbers they were judged against were ever checked by anyone.
 * Four errors in this project's own bundled part data were found in one batch,
 * every one as a side effect of other work rather than because something was
 * looking, and all four sat in parts marked `inspired-by` — the tier that
 * sounds checked and is not.
 *
 * This view judges no value as right or wrong, because nothing here can. It
 * reports the evidence so a clean report is read with the right confidence.
 */
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import type { AuditedPart } from "@grayhaven/nerve-eval"
import { useSuspenseQuery } from "@tanstack/react-query"
import { DataTable } from "../components/DataTable.js"
import { compileQueryOptions } from "../lib/compile-client.js"

export const Route = createFileRoute("/projects/$projectId/provenance")({
  component: ProvenanceView
})

const columns: ColumnDef<AuditedPart, string | number>[] = [
  {
    header: "Evidence",
    accessorKey: "tier",
    cell: ({ row }) => (
      <span className={row.original.tier === "verified" ? undefined : "unverified"}>
        {row.original.tier}
      </span>
    )
  },
  { header: "Kind", accessorKey: "kind" },
  { header: "Part", accessorKey: "mpn" },
  {
    header: "Limits it supplies",
    accessorFn: (p) => p.decisiveFields.join(", ")
  },
  { header: "Used by", accessorFn: (p) => p.usedBy.join(", ") }
]

function ProvenanceView() {
  const { projectId } = Route.useParams()
  const { data } = useSuspenseQuery(compileQueryOptions(projectId))
  const { parts, summary } = data.provenance

  if (parts.length === 0) {
    return <p className="empty">This design uses no parts with recorded provenance.</p>
  }

  return (
    <>
      <p className="view-note">
        {summary.parts} part{summary.parts === 1 ? "" : "s"}.{" "}
        {summary.decisiveUnverified === 0
          ? "Every limit this design is judged against comes from verified part data."
          : `${summary.decisiveUnverified} supply a limit a rule judges against without being verified. A clean report is only as good as these.`}
      </p>
      <DataTable data={[...parts]} columns={columns} />
    </>
  )
}
