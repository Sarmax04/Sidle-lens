import {test} from "node:test"
import assert from "node:assert/strict"
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {Document} from "@gltf-transform/core"
import sharp from "sharp"

import {mapCategory} from "../lib/polyhaven.mjs"
import {parseDimsFlag} from "../lib/dims.mjs"
import {guessCategory} from "../import.mjs"
import {resolveModel} from "../lib/convert.mjs"
import {classifyTexture, pickTextures, applyTextures} from "../lib/textures.mjs"
import {RANGES, checkPlausible, orient, guessObjUnits} from "../lib/ranges.mjs"
import {HARD_TRIANGLE_CAP, fitToSize, reduceTriangles} from "../lib/optimize.mjs"
import {sceneBox} from "../lib/gltf.mjs"
import {formatReport} from "../lib/report.mjs"
import {tryThumbnail} from "../lib/thumbs.mjs"

const dims = (d) => d && {width: d.width, depth: d.depth, height: d.height}

async function tempDir(files) {
  const dir = await mkdtemp(join(tmpdir(), "sidle-test-"))
  for (const f of files) await writeFile(join(dir, f), "x")
  return dir
}

// --- 1. category mapping -------------------------------------------------------------------

test("Poly Haven category mapping: 'other' maps to bed, sofa/chair/table unchanged", () => {
  assert.equal(mapCategory("furniture/seating/sofas"), "sofa")
  assert.equal(mapCategory("furniture/seating/chairs"), "chair")
  assert.equal(mapCategory("furniture/tables"), "table")
  assert.equal(mapCategory("furniture/other"), "bed")
  assert.equal(mapCategory("furniture/beds"), "bed")
  assert.equal(mapCategory(""), "bed")
})

test("category guess from local names (underscores count as spaces)", () => {
  assert.equal(guessCategory("children_bed"), "bed")
  assert.equal(guessCategory("bed1"), "bed")
  assert.equal(guessCategory("3D_armchair_16"), "chair")
  assert.equal(guessCategory("Table_3"), "table")
  assert.equal(guessCategory("sofa bed"), "sofa")
  assert.equal(guessCategory("bedside table"), "table")
  assert.equal(guessCategory("lamp_2"), "other")
})

// --- 2. local mode ----------------------------------------------------------------------------

test("--model: accepts .glb/.gltf/.fbx/.obj files and folders holding exactly one model", async () => {
  const dir = await tempDir(["3D_sofa_17.fbx", "Sofa_17_BaseColor-1K.png"])
  try {
    assert.equal((await resolveModel(dir)).kind, "fbx")
    assert.equal((await resolveModel(join(dir, "3D_sofa_17.fbx"))).file, join(dir, "3D_sofa_17.fbx"))
    await writeFile(join(dir, "bed.OBJ"), "x")
    await assert.rejects(resolveModel(dir), /more than one model/)
    assert.equal((await resolveModel(join(dir, "bed.OBJ"))).kind, "obj")
    await assert.rejects(resolveModel(join(dir, "Sofa_17_BaseColor-1K.png")), /must be/)
    await assert.rejects(resolveModel(join(dir, "missing.glb")), /no such file/)
    const empty = await tempDir(["readme.txt"])
    await assert.rejects(resolveModel(empty), /holds no/)
    await rm(empty, {recursive: true})
  } finally {
    await rm(dir, {recursive: true})
  }
})

test("--dims W,D,H (comma form, cm by default, unit suffix allowed)", () => {
  assert.deepEqual(dims(parseDimsFlag("220,90,85")), {width: 220, depth: 90, height: 85})
  assert.deepEqual(dims(parseDimsFlag("180.5, 81.8, 70.9")), {width: 180.5, depth: 81.8, height: 70.9})
  assert.deepEqual(dims(parseDimsFlag("2200,900,850mm")), {width: 220, depth: 90, height: 85})
  assert.equal(parseDimsFlag("220,90"), null)
})

// --- 3. FBX textures ----------------------------------------------------------------------------

test("texture keywords: basecolor/albedo, normal, roughness, metallic, AO; height ignored", () => {
  assert.equal(classifyTexture("3D_armchair_16_basecolor-1K.png"), "baseColor")
  assert.equal(classifyTexture("Sofa_4_ Basecolor-1K.png"), "baseColor")
  assert.equal(classifyTexture("wood_albedo.jpg"), "baseColor")
  assert.equal(classifyTexture("Sofa_17_Normal-1K.png"), "normal")
  assert.equal(classifyTexture("Table_3_roughness-1K.png"), "roughness")
  assert.equal(classifyTexture("Table_3_metallic-1K.png"), "metallic")
  assert.equal(classifyTexture("Sofa_4_ AO-1K .png"), "occlusion")
  assert.equal(classifyTexture("3D_sofa_22_height-1K.png"), "ignore")
  assert.equal(classifyTexture("Sofa_17_Height-1K.png"), "ignore")
  assert.equal(classifyTexture("preview.png"), null)
  assert.equal(classifyTexture("3D_sofa_17.fbx"), null)
  const {set, ignored} = pickTextures(["a_AO-1K.png", "a_basecolor-1K.png", "a_height-1K.png", "a_normal-1K.png", "a.fbx"], "/m")
  assert.deepEqual(Object.keys(set).sort(), ["baseColor", "normal", "occlusion"])
  assert.deepEqual(ignored, ["a_height-1K.png"])
})

test("texture maps go onto every material; AO/roughness/metallic are packed into R/G/B", async () => {
  const dir = await tempDir([])
  try {
    const grey = (v) => sharp({create: {width: 4, height: 4, channels: 3, background: {r: v, g: v, b: v}}}).png().toBuffer()
    await writeFile(join(dir, "x_basecolor.png"), await grey(200))
    await writeFile(join(dir, "x_normal.png"), await grey(128))
    await writeFile(join(dir, "x_ao.png"), await grey(30))
    await writeFile(join(dir, "x_roughness.png"), await grey(90))
    await writeFile(join(dir, "x_metallic.png"), await grey(250))
    const doc = new Document()
    const a = doc.createMaterial("a")
    const b = doc.createMaterial("b")
    const {set} = pickTextures(["x_basecolor.png", "x_normal.png", "x_ao.png", "x_roughness.png", "x_metallic.png"], dir)
    assert.deepEqual(await applyTextures(doc, set), [])
    for (const m of [a, b]) {
      assert.ok(m.getBaseColorTexture() && m.getNormalTexture() && m.getMetallicRoughnessTexture() && m.getOcclusionTexture())
      assert.equal(m.getMetallicRoughnessTexture(), m.getOcclusionTexture())
      assert.equal(m.getMetallicFactor(), 1)
    }
    const {data} = await sharp(Buffer.from(a.getOcclusionTexture().getImage())).raw().toBuffer({resolveWithObject: true})
    assert.deepEqual([data[0], data[1], data[2]], [30, 90, 250])
  } finally {
    await rm(dir, {recursive: true})
  }
})

// --- 4/5. units, ranges, orientation --------------------------------------------------------------

test("plausible ranges accept the brief's pieces and refuse implausible ones", () => {
  assert.deepEqual(checkPlausible("sofa", {width: 220, depth: 90, height: 85}), [])
  assert.deepEqual(checkPlausible("chair", {width: 84.8, depth: 76.6, height: 106.5}), [])
  assert.deepEqual(checkPlausible("table", {width: 160, depth: 90, height: 75}), [])
  assert.deepEqual(checkPlausible("bed", {width: 160, depth: 200, height: 55}), [])
  assert.deepEqual(checkPlausible("sofa", {width: 140, depth: 70, height: 110}), [], "range ends are inclusive")
  assert.match(checkPlausible("sofa", {width: 2200, depth: 900, height: 850}).join(), /width 2200 cm is outside 140-300/)
  assert.equal(checkPlausible("chair", {width: 43.2, depth: 54, height: 95.6}).length, 1, "chair sides 50-110")
  assert.deepEqual(checkPlausible("bed", {width: 200, depth: 160, height: 55}), ["depth 160 cm is outside 180-230 cm"])
  assert.equal(checkPlausible("lamp", {width: 1, depth: 1, height: 1}), null, "no range for unknown categories")
})

test("bed with its long side on X gets yawDeg 90 instead of being refused", () => {
  const o = orient("bed", {x: 205.3, y: 87.4, z: 91.8})
  assert.equal(o.yawDeg, 90)
  assert.deepEqual(o.dims, {width: 91.8, depth: 205.3, height: 87.4})
  assert.deepEqual(checkPlausible("bed", o.dims), [])
  assert.equal(orient("bed", {x: 168.6, y: 110.8, z: 216.4}).yawDeg, 0)
  assert.equal(orient("sofa", {x: 240, y: 80, z: 90}).yawDeg, 0, "sofas are long on X")
  assert.deepEqual(orient("sofa", {x: 90, y: 80, z: 240}, 90).dims, {width: 240, depth: 90, height: 80}, "--yaw 90 swaps W and D")
  assert.equal(orient("bed", {x: 205, y: 80, z: 90}, 0).yawDeg, 0, "--yaw wins over the bed rule")
})

test("OBJ units: guessed from size + category; none or several fitting units are reported", () => {
  assert.deepEqual(guessObjUnits("bed", {x: 168.6, y: 110.8, z: 216.4}).map((f) => f.unit), ["cm"])
  const kid = guessObjUnits("bed", {x: 205.3, y: 87.4, z: 91.8})
  assert.deepEqual(kid.map((f) => [f.unit, f.yawDeg]), [["cm", 90]])
  assert.deepEqual(guessObjUnits("table", {x: 1200, y: 750, z: 800}).map((f) => f.unit), ["mm"])
  assert.deepEqual(guessObjUnits("sofa", {x: 2.2, y: 0.85, z: 0.9}).map((f) => f.unit), ["m"])
  assert.deepEqual(guessObjUnits("chair", {x: 5, y: 5, z: 5}), [])
  // The brief's ranges are each narrower than 10x on some axis, so two units never both fit;
  // a wide range table shows that every fitting unit is returned, so the caller can refuse.
  const wide = {thing: {width: [1, 10000], depth: [1, 10000], height: [1, 10000]}}
  assert.deepEqual(guessObjUnits("thing", {x: 20, y: 20, z: 20}, null, wide).map((f) => f.unit), ["mm", "cm", "m"])
  assert.ok(RANGES.bed.longSide === "depth")
})

test("fitToSize scales the model to the catalog box with the pivot at the bottom centre", () => {
  const doc = new Document()
  const buf = doc.createBuffer()
  const pos = doc
    .createAccessor()
    .setType("VEC3")
    .setBuffer(buf)
    .setArray(new Float32Array([10, 5, -3, 12, 5.8, -3, 10, 5, -2.1, 12, 5.8, -2.1]))
  const prim = doc.createPrimitive().setAttribute("POSITION", pos)
  const node = doc.createNode("m").setMesh(doc.createMesh().addPrimitive(prim))
  doc.createScene().addChild(node)
  fitToSize(doc, {x: 2.2, y: 0.85, z: 0.9})
  const b = sceneBox(doc)
  for (const [got, want] of [[b.x, 2.2], [b.y, 0.85], [b.z, 0.9], [b.min[1], 0], [(b.min[0] + b.max[0]) / 2, 0], [(b.min[2] + b.max[2]) / 2, 0]]) {
    assert.ok(Math.abs(got - want) < 1e-5, `${got} vs ${want}`)
  }
})

// --- 6. triangle budget --------------------------------------------------------------------------

/** Fake simplifier: each call reaches max(target, floor[i]); records its calls. */
function fakeMesh(start, floors) {
  const doc = {tris: start, calls: []}
  const simplifyFn = async (d, target, error) => {
    d.calls.push([target, error])
    d.tris = Math.min(d.tris, Math.max(target, floors[d.calls.length - 1] ?? 0))
  }
  return {doc, simplifyFn, count: (d) => d.tris}
}

test("triangle budget: no simplification when already under --max-triangles", async () => {
  const m = fakeMesh(9000, [])
  assert.deepEqual(await reduceTriangles(m.doc, 15000, m.simplifyFn, m.count), {ok: true, before: 9000, after: 9000})
  assert.equal(m.doc.calls.length, 0)
})

test("triangle budget: simplifies to the limit", async () => {
  const m = fakeMesh(448320, [0])
  const r = await reduceTriangles(m.doc, 15000, m.simplifyFn, m.count)
  assert.deepEqual([r.ok, r.before, r.after, r.warning], [true, 448320, 15000, undefined])
  assert.deepEqual(m.doc.calls, [[15000, 0.01]])
})

test("triangle budget: retries once at double the limit and keeps the result with a warning", async () => {
  const m = fakeMesh(120972, [25550, 25550])
  const r = await reduceTriangles(m.doc, 15000, m.simplifyFn, m.count)
  assert.equal(r.ok, true)
  assert.equal(r.after, 25550)
  assert.match(r.warning, /above --max-triangles 15000; kept after the retry at 30000/)
  assert.deepEqual(m.doc.calls.map((c) => c[0]), [15000, 30000])
  assert.ok(m.doc.calls[1][1] > m.doc.calls[0][1], "retry allows a larger error")
})

test("triangle budget: skips the piece when the retry cannot get under double the limit", async () => {
  const m = fakeMesh(500000, [80000, 70000])
  const r = await reduceTriangles(m.doc, 15000, m.simplifyFn, m.count)
  assert.equal(r.ok, false)
  assert.match(r.reason, /still 70000 triangles after simplifying to 15000 and retrying at 30000/)
})

test("triangle budget: never above 60000, whatever --max-triangles says", async () => {
  const high = fakeMesh(200000, [0])
  const r1 = await reduceTriangles(high.doc, 100000, high.simplifyFn, high.count)
  assert.equal(r1.after, HARD_TRIANGLE_CAP)
  const m = fakeMesh(200000, [65000, 61000])
  const r2 = await reduceTriangles(m.doc, 40000, m.simplifyFn, m.count)
  assert.deepEqual(m.doc.calls.map((c) => c[0]), [40000, HARD_TRIANGLE_CAP], "retry target capped at 60000")
  assert.equal(r2.ok, false)
})

// --- 7. thumbnails ---------------------------------------------------------------------------------

test("thumbnail failure leaves the field empty and never throws", async () => {
  const failing = async () => {
    throw new Error("no WebGL\nstack…")
  }
  assert.deepEqual(await tryThumbnail("a.glb", "a.png", "Models/thumbs/a.png", failing), {
    thumbnail: "",
    warning: "thumbnail not rendered: no WebGL",
  })
  const ok = await tryThumbnail("a.glb", "a.png", "Models/thumbs/a.png", async () => {})
  assert.deepEqual(ok, {thumbnail: "Models/thumbs/a.png", warning: null})
})

// --- 10. report -------------------------------------------------------------------------------------

test("report table: name, category, size, triangles before/after, texture, thumbnail, warnings", () => {
  const out = formatReport([
    {name: "Sofa 4", category: "sofa", dims: {width: 234.1, depth: 101.2, height: 88.9}, before: 448320, after: 14699, texture: "1024×1024", thumbnail: "Models/thumbs/sofa_4.png", warnings: []},
    {name: "Huge", category: "bed", dims: {width: 160, depth: 200, height: 50}, before: 900000, after: 70000, thumbnail: "", warnings: ["w1"], skipped: "too many triangles"},
  ])
  const lines = out.split("\n")
  assert.match(lines[0], /^Name +\| Category \| W × D × H cm +\| Triangles before → after \| Texture +\| Thumbnail \| Warnings$/)
  assert.match(lines[2], /^Sofa 4 \| sofa +\| 234\.1 × 101\.2 × 88\.9 \| 448,320 → 14,699 +\| 1024×1024 \| yes +\| -$/)
  assert.match(lines[3], /900,000 → not written .*\| no +\| SKIPPED: too many triangles; w1$/)
})
