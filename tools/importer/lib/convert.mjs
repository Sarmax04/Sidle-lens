// Local models: .glb / .gltf / .fbx / .obj (or a folder holding exactly one) → glTF Document.
// FBX goes through the fbx2gltf binary into a temp .glb, OBJ through obj2gltf (reads .mtl + textures).
// glTF and FBX (FBX2glTF converts from the file's unit) are metres; OBJ keeps its raw file units.

import {createRequire} from "node:module"
import {mkdtemp, readdir, rm, stat, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {basename, dirname, extname, join, resolve} from "node:path"
import {readDocument} from "./gltf.mjs"

const require = createRequire(import.meta.url)
export const MODEL_EXTS = [".glb", ".gltf", ".fbx", ".obj"]

/** Resolves --model to one model file. A folder must hold exactly one model file (top level). */
export async function resolveModel(path) {
  const p = resolve(path)
  const s = await stat(p).catch(() => null)
  if (!s) throw new Error(`--model ${path}: no such file or folder`)
  if (s.isFile()) {
    const ext = extname(p).toLowerCase()
    if (!MODEL_EXTS.includes(ext)) throw new Error(`--model must be ${MODEL_EXTS.join(", ")} or a folder holding one; got ${basename(p)}`)
    return {file: p, dir: dirname(p), kind: ext.slice(1)}
  }
  const models = (await readdir(p)).filter((n) => MODEL_EXTS.includes(extname(n).toLowerCase()))
  if (models.length === 0) throw new Error(`--model ${path}: the folder holds no ${MODEL_EXTS.join("/")} file`)
  if (models.length > 1) throw new Error(`--model ${path}: the folder holds more than one model (${models.join(", ")}); pass the file instead`)
  const file = join(p, models[0])
  return {file, dir: p, kind: extname(file).slice(1).toLowerCase()}
}

/**
 * Converts a resolved model to a Document. Returns {doc, rawUnits, warnings}:
 * rawUnits is true for OBJ, whose numbers have no unit.
 */
export async function loadModel({file, kind}) {
  const warnings = []
  if (kind === "glb" || kind === "gltf") return {doc: await readDocument(file), rawUnits: false, warnings}
  const tmp = await mkdtemp(join(tmpdir(), "sidle-import-"))
  try {
    const glb = join(tmp, "model.glb")
    if (kind === "fbx") {
      const fbx2gltf = require("fbx2gltf")
      await fbx2gltf(file, glb, [])
    } else if (kind === "obj") {
      const obj2gltf = require("obj2gltf")
      const buf = await obj2gltf(file, {binary: true, logger: (m) => warnings.push(`obj2gltf: ${m}`)})
      await writeFile(glb, buf)
    } else throw new Error(`unsupported model type .${kind}`)
    return {doc: await readDocument(glb), rawUnits: kind === "obj", warnings}
  } finally {
    await rm(tmp, {recursive: true, force: true})
  }
}
