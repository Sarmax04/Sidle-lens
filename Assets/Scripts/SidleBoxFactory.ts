/**
 * SidleBoxFactory — plain, obviously-fake box geometry for the virtual room
 * and the furniture pieces.
 *
 * Owns: one shared unit-cube RenderMesh (MeshBuilder, with normals + UVs) and a
 * per-color material cache cloned from a template material. Boxes are leaf
 * visual SceneObjects scaled to their size in cm (no colliders on scaled nodes).
 *
 * Must not: hold experience state or create UI/text.
 */

let unitCube: RenderMesh | null = null

function buildUnitCube(): RenderMesh {
  const mb = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3, normalized: true},
    {name: "texture0", components: 2},
  ])
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16

  // [normal, u-axis, v-axis] per face; face center = normal * 0.5
  const faces: number[][][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ]
  const verts: number[] = []
  const idx: number[] = []
  let base = 0
  for (const [n, u, v] of faces) {
    const corners = [
      [-0.5, -0.5, 0, 0],
      [0.5, -0.5, 1, 0],
      [0.5, 0.5, 1, 1],
      [-0.5, 0.5, 0, 1],
    ]
    for (const [a, b, tu, tv] of corners) {
      verts.push(
        n[0] * 0.5 + u[0] * a + v[0] * b,
        n[1] * 0.5 + u[1] * a + v[1] * b,
        n[2] * 0.5 + u[2] * a + v[2] * b,
        n[0],
        n[1],
        n[2],
        tu,
        tv,
      )
    }
    // u x v == n, so (0,1,2) is counter-clockwise seen from outside
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    base += 4
  }
  mb.appendVerticesInterleaved(verts)
  mb.appendIndices(idx)
  mb.updateMesh()
  return mb.getMesh()
}

export function getUnitCube(): RenderMesh {
  if (!unitCube) unitCube = buildUnitCube()
  return unitCube
}

export class MaterialCache {
  private cache: {[key: string]: Material} = {}
  constructor(private template: Material) {}

  get(color: vec4): Material {
    const key = `${color.x.toFixed(3)},${color.y.toFixed(3)},${color.z.toFixed(3)},${color.w.toFixed(3)}`
    let m = this.cache[key]
    if (!m) {
      m = this.template.clone()
      m.mainPass.baseColor = color
      this.cache[key] = m
    }
    return m
  }
}

/**
 * Create a box visual. `center` and `size` are in the parent's local cm.
 * Returns the leaf SceneObject (scaled; carries only a RenderMeshVisual).
 */
export function makeBox(
  parent: SceneObject,
  name: string,
  center: vec3,
  size: vec3,
  material: Material,
): SceneObject {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  const t = so.getTransform()
  t.setLocalPosition(center)
  t.setLocalScale(size)
  const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = getUnitCube()
  rmv.mainMaterial = material
  return so
}
