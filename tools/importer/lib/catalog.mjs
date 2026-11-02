// Assets/Models/catalog.json and CREDITS.md bookkeeping.

import {readFile, writeFile} from "node:fs/promises"

export function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "model"
}

/** Adds or replaces the entry with the same id. The catalog is a JSON array. */
export async function upsertCatalog(path, entry) {
  let items = []
  try {
    items = JSON.parse(await readFile(path, "utf8"))
    if (!Array.isArray(items)) throw new Error(`${path} is not a JSON array`)
  } catch (e) {
    if (e.code !== "ENOENT") throw e
  }
  const i = items.findIndex((x) => x.id === entry.id)
  if (i >= 0) items[i] = entry
  else items.push(entry)
  await writeFile(path, JSON.stringify(items, null, 2) + "\n")
  return {items, updated: i >= 0}
}

/** Appends a credit line; re-imports replace that model's earlier line instead of duplicating it. */
export async function appendCredit(path, slug, line) {
  let text = ""
  try {
    text = await readFile(path, "utf8")
  } catch (e) {
    if (e.code !== "ENOENT") throw e
  }
  if (!text) text = "# Credits\n\nThird-party models and data used by Sidle.\n\n"
  const marker = `\`${slug}\``
  const lines = text.split("\n")
  const i = lines.findIndex((l) => l.startsWith("- ") && l.includes(marker))
  if (i >= 0) lines[i] = line
  else {
    while (lines.length && lines[lines.length - 1] === "") lines.pop()
    if (lines.length && !lines[lines.length - 1].startsWith("- ")) lines.push("") // blank line before the list
    lines.push(line, "")
  }
  await writeFile(path, lines.join("\n"))
}
