// End-of-run report: one row per piece.

export const REPORT_COLUMNS = [
  ["name", "Name"],
  ["category", "Category"],
  ["size", "W × D × H cm"],
  ["triangles", "Triangles before → after"],
  ["texture", "Texture"],
  ["thumbnail", "Thumbnail"],
  ["warnings", "Warnings"],
]

/** Row for a piece. `r` = {name, category, dims?, before?, after?, texture?, thumbnail?, warnings[], skipped?} */
export function reportRow(r) {
  const n = (v) => (v == null ? "-" : Number(v).toLocaleString("en"))
  return {
    name: r.name || "-",
    category: r.category || "-",
    size: r.dims ? `${r.dims.width} × ${r.dims.depth} × ${r.dims.height}` : "-",
    triangles: r.before == null ? "-" : `${n(r.before)} → ${r.skipped ? "not written" : n(r.after)}`,
    texture: r.texture || "-",
    thumbnail: r.thumbnail ? "yes" : "no",
    warnings: [r.skipped ? `SKIPPED: ${r.skipped}` : null, ...(r.warnings || [])].filter(Boolean).join("; ") || "-",
  }
}

/** Plain-text table (fixed-width columns, warnings column last and unpadded). */
export function formatReport(pieces) {
  const rows = pieces.map(reportRow)
  const keys = REPORT_COLUMNS.map(([k]) => k)
  const head = Object.fromEntries(REPORT_COLUMNS)
  const width = Object.fromEntries(keys.map((k) => [k, Math.max(head[k].length, ...rows.map((r) => String(r[k]).length))]))
  const line = (r) =>
    keys
      .map((k, i) => (i === keys.length - 1 ? String(r[k]) : String(r[k]).padEnd(width[k])))
      .join(" | ")
      .trimEnd()
  const sep = keys.map((k, i) => "-".repeat(i === keys.length - 1 ? head[k].length : width[k])).join("-|-")
  return [line(head), sep, ...rows.map(line)].join("\n")
}
