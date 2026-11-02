#!/usr/bin/env node
// Prints every catalog entry with its .glb size and triangle count.
//   node tools/importer/stats.mjs

import {readFile, stat} from "node:fs/promises"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {readDocument, countTriangles, measureCm} from "./lib/gltf.mjs"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const items = JSON.parse(await readFile(join(REPO, "Assets", "Models", "catalog.json"), "utf8"))

const rows = []
for (const it of items) {
  const path = join(REPO, "Assets", it.glb)
  const doc = await readDocument(path)
  const bb = measureCm(doc)
  rows.push({
    id: it.id,
    category: it.category,
    "W×D×H cm": `${it.widthCm}×${it.depthCm}×${it.heightCm}`,
    "bbox W×D×H cm": `${bb.width}×${bb.depth}×${bb.height}`,
    "size KB": Math.round((await stat(path)).size / 1024),
    triangles: countTriangles(doc),
  })
}
console.table(rows)
