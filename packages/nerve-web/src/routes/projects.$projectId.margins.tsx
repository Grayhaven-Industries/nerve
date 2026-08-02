/**
 * How close a passing design sits to each limit.
 *
 * Every other view here answers "is it wrong". This one answers "how close",
 * which the findings cannot: a wire at 99% of its derated ampacity and one at
 * 40% both produce no diagnostic and are not the same design. Sorted tightest
 * first, because the only row anyone opens this for is the top one.
 */
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import type { Margin } from "@grayhaven/nerve"
import { useSuspenseQuery } from "@tanstack/react-query"
import { DataTable } from "../components/DataTable.js"
import { compileQueryOptions } from "../lib/compile-client.js"

export const Route = createFileRoute("/projects/$projectId/margins")({
  component: MarginsView
})

/** Display only. The report JSON keeps full precision. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000

const columns: ColumnDef<Margin, string | number>[] = [
  {
    header: "Used",
    accessorFn: (m) => `${(m.utilization * 100).toFixed(1)}%`,
    // Over budget is a finding in its own right; the number is the story.
    cell: ({ row }) => (
      <span className={row.original.margin < 0 ? "over-budget" : undefined}>
        {(row.original.utilization * 100).toFixed(1)}%
      </span>
    )
  },
  { header: "Quantity", accessorKey: "quantity" },
  { header: "Object", accessorKey: "target" },
  { header: "Measured", accessorFn: (m) => `${round3(m.measured)}${m.unit}` },
  { header: "Limit", accessorFn: (m) => `${round3(m.limit)}${m.unit}` },
  { header: "Rule", accessorKey: "code" }
]

function MarginsView() {
  const { projectId } = Route.useParams()
  const { data } = useSuspenseQuery(compileQueryOptions(projectId))
  const margins = [...data.margins].sort((a, b) => a.margin - b.margin)
  const overBudget = margins.filter((m) => m.margin < 0).length

  if (margins.length === 0) {
    return (
      <p className="empty">
        No margins. Margins come from rules over a continuous quantity with a
        limit to divide by, and this design supplies none of those inputs yet.
      </p>
    )
  }

  return (
    <>
      <p className="view-note">
        {margins.length} measurement{margins.length === 1 ? "" : "s"},{" "}
        {overBudget} over budget. Tightest first.
      </p>
      <DataTable data={margins} columns={columns} />
    </>
  )
}
