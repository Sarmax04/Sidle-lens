// glTF helpers: pack .gltf → .glb, measure the bounding box, count triangles.

import {NodeIO, getBounds, Primitive} from "@gltf-transform/core"
import {ALL_EXTENSIONS} from "@gltf-transform/extensions"

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

export async function readDocument(path) {
  return io.read(path)
}

export async function writeDocument(path, doc) {
  await io.write(path, doc)
}

/** Bounding box of the default scene in file units: {x, y, z} sizes plus min/max. */
export function sceneBox(doc) {
  const root = doc.getRoot()
  const {min, max} = getBounds(root.getDefaultScene() || root.listScenes()[0])
  return {x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2], min, max}
}

/** Packs a .gltf (with external .bin/textures resolved relative to it) into one .glb, without altering content. */
export async function packToGlb(gltfPath, glbPath) {
  const doc = await io.read(gltfPath)
  singleBuffer(doc)
  await io.write(glbPath, doc)
}

/** GLB output needs exactly one buffer: moves every accessor onto the first one. */
export function singleBuffer(doc) {
  const root = doc.getRoot()
  const buffers = root.listBuffers()
  if (buffers.length > 1) {
    const [keep, ...rest] = buffers
    for (const acc of root.listAccessors()) acc.setBuffer(keep)
    rest.forEach((b) => b.dispose())
  } else if (!buffers.length) {
    const b = doc.createBuffer()
    for (const acc of root.listAccessors()) acc.setBuffer(b)
  }
}

/**
 * Size of the default scene's world-space bounding box in cm.
 * glTF is metres, Y-up: x = width, y = height, z = depth.
 */
export function measureCm(doc) {
  const root = doc.getRoot()
  const scene = root.getDefaultScene() || root.listScenes()[0]
  const {min, max} = getBounds(scene)
  const r = (v) => Math.round(v * 100 * 10) / 10
  return {width: r(max[0] - min[0]), height: r(max[1] - min[1]), depth: r(max[2] - min[2])}
}

/** Triangles drawn by the default scene (mesh instances counted once per node that uses them). */
export function countTriangles(doc) {
  const root = doc.getRoot()
  const scene = root.getDefaultScene() || root.listScenes()[0]
  let tris = 0
  scene.traverse((node) => {
    const mesh = node.getMesh()
    if (!mesh) return
    for (const prim of mesh.listPrimitives()) {
      const n = prim.getIndices()?.getCount() ?? prim.getAttribute("POSITION")?.getCount() ?? 0
      const mode = prim.getMode()
      if (mode === Primitive.Mode.TRIANGLES) tris += Math.floor(n / 3)
      else if (mode === Primitive.Mode.TRIANGLE_STRIP || mode === Primitive.Mode.TRIANGLE_FAN) tris += Math.max(0, n - 2)
    }
  })
  return tris
}
