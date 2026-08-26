import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState
} from "@tanstack/react-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

/** Per-column type treatment (reference admin tables): IDs/codes get mono,
 * numerics get sans + tabular-nums + muted, prose stays sans foreground. */
export type ColumnKind = "code" | "num" | "text"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    kind?: ColumnKind
  }
}

const cellClass = (kind: ColumnKind | undefined): string =>
  kind === "code" ? "cell-code" : kind === "num" ? "cell-num" : "cell-text"

export function DataTable<T>({
  data,
  columns,
  sorting,
  onSortingChange
}: {
  data: ReadonlyArray<T>
  columns: ColumnDef<T, string | number>[]
  /** Controlled sorting state — typically backed by the route's search params. */
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
}) {
  // SAFETY: table-core only reads `data` (row models are derived copies), so
  // handing it the readonly array as a mutable one cannot mutate the caller's.
  const rows = data as T[]
  const sortable = sorting !== undefined && onSortingChange !== undefined
  const table = useReactTable(
    sortable
      ? {
          data: rows,
          columns,
          state: { sorting },
          onSortingChange,
          getSortedRowModel: getSortedRowModel(),
          getCoreRowModel: getCoreRowModel()
        }
      : { data: rows, columns, getCoreRowModel: getCoreRowModel() }
  )

  if (table.getRowModel().rows.length === 0) {
    return (
      <Empty className="table-empty">
        <EmptyHeader>
          <EmptyTitle>No rows yet</EmptyTitle>
          <EmptyDescription>
            Compile a harness that produces this output and the rows appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Table className="data">
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id}>
            {hg.headers.map((header) => {
              const canSort = sortable && header.column.getCanSort()
              // @tanstack/react-table 8.21.3: getIsSorted() is
              // `false | "asc" | "desc"`. WAI-ARIA puts aria-sort on the
              // column header cell, and at most one header may be other than
              // "none" — the routes build `sorting` from a single sortBy
              // search param, so only one column is ever non-false here.
              const dir = header.column.getIsSorted()
              const ariaSort = dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"
              return (
                <TableHead
                  key={header.id}
                  className={canSort ? "sortable" : undefined}
                  aria-sort={canSort ? ariaSort : undefined}
                >
                  {canSort ? (
                    <button
                      type="button"
                      className="th-sort"
                      onClick={header.column.getToggleSortingHandler()}
                      aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      <span className="sort-icons" aria-hidden="true">
                        <span className={`sort-icon${dir === "asc" ? " on" : ""}`}>▲</span>
                        <span className={`sort-icon abs${dir === "desc" ? " on" : ""}`}>▼</span>
                      </span>
                    </button>
                  ) : header.isPlaceholder ? null : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id} className={cellClass(cell.column.columnDef.meta?.kind)}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

