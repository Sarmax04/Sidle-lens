// End-to-end: the importer CLI on tiny generated models, writing into a temp --models-dir.
// Every run has test/fixtures/netspy.mjs preloaded, which records (and refuses) any network call.
import {test} from "node:test"
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

import {readDocument, measureCm, sceneBox} from "../lib/gltf.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const NETSPY = pathToFileURL(join(ROOT, "test", "fixtures", "netspy.mjs")).href

/** OBJ of an axis-aligned box from (0,0,0) to (x,y,z), in file units. */
function boxObj(x, y, z) {
  const v = []
  for (const [a, b, c] of [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]]) v.push(`v ${a} ${b} ${c}`)
  const f = [[1, 2, 3], [1, 3, 4], [5, 7, 6], [5, 8, 7], [1, 5, 6], [1, 6, 2], [4, 3, 7], [4, 7, 8], [1, 4, 8], [1, 8, 5], [2, 6, 7], [2, 7, 3]]
  return [...v, ...f.map((t) => `f ${t.join(" ")}`)].join("\n") + "\n"
}

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), "sidle-cli-"))
  t.after(() => rm(dir, {recursive: true, force: true}))
  const models = join(dir, "Models")
  return {dir, models, netlog: join(dir, "net.log")}
}

function run(ws, args) {
  const r = spawnSync(process.execPath, [join(ROOT, "import.mjs"), ...args, "--models-dir", ws.models], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180000,
    env: {...process.env, NODE_OPTIONS: `--import ${NETSPY}`, SIDLE_NETSPY_LOG: ws.netlog, SIDLE_IMPORTER_CHILD: "1"},
  })
  return {code: r.status, out: `${r.stdout}${r.stderr}`}
}

async function netCalls(ws) {
  return (await readFile(ws.netlog, "utf8").catch(() => "")).split("\n").filter(Boolean)
}

async function catalog(ws) {
  return JSON.parse(await readFile(join(ws.models, "catalog.json"), "utf8"))
}

async function writeObj(ws, name, x, y, z) {
  const folder = join(ws.dir, name)
  await mkdir(folder, {recursive: true})
  await writeFile(join(folder, `${name}.obj`), boxObj(x, y, z))
  return folder
}

test("local OBJ with a sharetextures.com --source: imported from disk, source only recorded, no network call", async (t) => {
  const ws = await workspace(t)
  const folder = await writeObj(ws, "test_sofa", 220, 85, 90) // centimetres
  const r = run(ws, ["--model", folder, "--name", "Test Sofa", "--category", "sofa", "--credit", "Someone", "--license", "CC0",
    "--source", "https://www.sharetextures.com/models/furniture/test-sofa"])
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(await netCalls(ws), [], "the importer made no network call at all")

  const [e] = await catalog(ws)
  assert.deepEqual(
    {id: e.id, name: e.name, category: e.category, w: e.widthCm, d: e.depthCm, h: e.heightCm, yaw: e.yawDeg, glb: e.glb},
    {id: "test_sofa", name: "Test Sofa", category: "sofa", w: 220, d: 90, h: 85, yaw: 0, glb: "Models/test_sofa.glb"},
  )
  assert.equal(e.sourceUrl, "https://www.sharetextures.com/models/furniture/test-sofa")
  assert.equal(e.domain, "sharetextures.com")
  assert.equal(e.credit, "Someone, CC0")
  assert.equal(e.thumbnail, "Models/thumbs/test_sofa.png", r.out)
  const png = await readFile(join(ws.models, "thumbs", "test_sofa.png"))
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [256, 256], "256×256 PNG")
  assert.match(r.out, /OBJ units: cm/)

  const doc = await readDocument(join(ws.models, "test_sofa.glb"))
  assert.deepEqual(measureCm(doc), {width: 220, height: 85, depth: 90})
  assert.ok(Math.abs(sceneBox(doc).min[1]) < 1e-6, "stands on the floor")
  assert.match(r.out, /Name +\| Category \| W × D × H cm +\| Triangles before → after \| Texture +\| Thumbnail \| Warnings/)
  assert.match(r.out, /Test Sofa \| sofa +\| 220 × 90 × 85 +\| 12 → 12 /)
  assert.match(await readFile(join(ws.models, "CREDITS.md"), "utf8"), /`test_sofa` — "Test Sofa" by Someone, CC0: https:\/\/www\.sharetextures\.com/)
})

test("a sharetextures.com or sketchfab.com page link is refused before any request", async (t) => {
  const ws = await workspace(t)
  for (const url of ["https://www.sharetextures.com/models/sofa_17", "https://sketchfab.com/3d-models/bed-123"]) {
    const r = run(ws, [url, "--dims", "220,90,85"])
    assert.notEqual(r.code, 0)
    assert.match(r.out, /refusing to contact/)
  }
  assert.deepEqual(await netCalls(ws), [], "no network call reached Node's network APIs")
})

test("OBJ bed in metres, long side on X: units guessed as m, yawDeg 90", async (t) => {
  const ws = await workspace(t)
  const folder = await writeObj(ws, "kids_bed", 2.05, 0.87, 0.92)
  const r = run(ws, ["--model", folder, "--license", "CC BY 3.0"])
  assert.equal(r.code, 0, r.out)
  const [e] = await catalog(ws)
  assert.deepEqual([e.category, e.yawDeg, e.widthCm, e.depthCm, e.heightCm], ["bed", 90, 92, 205, 87])
  // the model keeps its long side on X; the Lens turns it by yawDeg
  assert.deepEqual(measureCm(await readDocument(join(ws.models, "kids_bed.glb"))), {width: 205, height: 87, depth: 92})
  assert.match(r.out, /OBJ units: m/)
})

test("--dims overrides the bounding box; implausible sizes are refused with a clear message", async (t) => {
  const ws = await workspace(t)
  const folder = await writeObj(ws, "big_table", 120, 75, 80)
  const ok = run(ws, ["--model", folder, "--category", "table", "--dims", "160,90,74"])
  assert.equal(ok.code, 0, ok.out)
  const [e] = await catalog(ws)
  assert.deepEqual([e.widthCm, e.depthCm, e.heightCm], [160, 90, 74])
  assert.deepEqual(measureCm(await readDocument(join(ws.models, "big_table.glb"))), {width: 160, height: 74, depth: 90})

  const bad = run(ws, ["--model", folder, "--name", "Giant Table", "--category", "table", "--dims", "400,90,74"])
  assert.equal(bad.code, 1)
  assert.match(bad.out, /REFUSED: 400 × 90 × 74 cm is not a plausible table: width 400 cm is outside 40-240 cm/)
  assert.match(bad.out, /Giant Table \| table .*SKIPPED: 400 × 90 × 74 cm is not a plausible table/)
  assert.equal((await catalog(ws)).length, 1, "nothing was added")
})

test("OBJ that fits no unit is refused and the options are printed", async (t) => {
  const ws = await workspace(t)
  const folder = await writeObj(ws, "odd_chair", 5, 5, 5)
  const r = run(ws, ["--model", folder, "--category", "chair"])
  assert.equal(r.code, 1)
  assert.match(r.out, /no OBJ unit gives a plausible chair/)
  assert.match(r.out, /--units mm +→ 0\.5 × 0\.5 × 0\.5 cm/)
  assert.match(r.out, /--units cm +→ 5 × 5 × 5 cm/)
  assert.match(r.out, /--units m +→ 500 × 500 × 500 cm/)
  const ok = run(ws, ["--model", folder, "--category", "chair", "--units", "cm", "--dims", "60,60,90"])
  assert.equal(ok.code, 0, ok.out)
})

test("--add-thumbnails fills the thumbnail field for catalog pieces without one and never fails", async (t) => {
  const ws = await workspace(t)
  const folder = await writeObj(ws, "plain_chair", 55, 90, 52)
  assert.equal(run(ws, ["--model", folder, "--category", "chair"]).code, 0)
  const items = await catalog(ws)
  items[0].thumbnail = ""
  items.push({...items[0], id: "broken", name: "Broken", glb: "Models/missing.glb", thumbnail: ""})
  await writeFile(join(ws.models, "catalog.json"), JSON.stringify(items, null, 2))
  const r = run(ws, ["--add-thumbnails"])
  assert.equal(r.code, 0, r.out)
  const after = await catalog(ws)
  assert.equal(after[1].thumbnail, "", "a missing model leaves the field empty")
  assert.match(r.out, /Broken .*\| no +\| .*thumbnail not rendered/)
  if (after[0].thumbnail) assert.equal(after[0].thumbnail, "Models/thumbs/plain_chair.png")
  assert.deepEqual(await netCalls(ws), [])
})
