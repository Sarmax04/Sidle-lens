/**
 * Shared helpers for the Sidle LEAF scenarios (test-only; never shipped behaviour).
 * Reads SidleController state through its public getters and drives the real
 * UIKit buttons / PieceGrab Interactable through LEAF interactors.
 */
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep, withTimeout} from "Leaf.lspkg/Utils/common/Utils"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {SidleController} from "../../Scripts/SidleController"
import {ROOM_DEPTH_CM, ROOM_WIDTH_CM} from "../../Scripts/SidleGeometry"

/** Doorway wall line is 30 cm behind the start position (SidleController.startInsetCm). */
const START_INSET = 30
export const ROOM = {minX: -ROOM_WIDTH_CM / 2, maxX: ROOM_WIDTH_CM / 2, minZ: START_INSET - ROOM_DEPTH_CM, maxZ: START_INSET}
/** 100 x 50 coffee table in the far right corner. */
export const COFFEE = {minX: ROOM.maxX - 100, maxX: ROOM.maxX, minZ: ROOM.minZ, maxZ: ROOM.minZ + 50}
export const START = {x: 0, z: -220}
/** Sofa A footprint half-extents at 0°. */
export const SOFA_A_HALF = {w: 110, d: 45}

export function log(msg: string): void {
  print(`[SidleLeaf] ${msg}`)
}

export function obj(name: string): SceneObject {
  const so = findSceneObjectByName(name)
  if (!so) throw new Error(`Scene object "${name}" not found`)
  return so
}

export function controller(): SidleController {
  const c = obj("SidleController").getComponent(SidleController.getTypeName()) as SidleController
  if (!c) throw new Error("SidleController component not found")
  return c
}

export function interactable(name: string): Interactable {
  const i = findInteractableByName(name)
  if (!i) throw new Error(`Interactable "${name}" not found`)
  return i
}

/** Pinch a panel button with the scripted SIK interactor (real UI path). */
export async function tap(it: DefaultLeafInteractor, buttonName: string): Promise<void> {
  const b = findInteractableByName(buttonName, undefined, true)
  if (!b) throw new Error(`Button "${buttonName}" not found or not enabled`)
  await it.trigger(b)
  await sleep(250)
}

/**
 * Compare is greyed out (UIKit Button.inactive, interactable disabled), a real
 * pinch with a separate interactor does not register, and compare() is a no-op.
 */
export async function expectGreyedCompare(c: SidleController, ctx: string): Promise<void> {
  const cmpBtn = obj("CompareButton").getComponent(Button.getTypeName()) as Button
  expect(c.compareEnabled, `${ctx}: compareEnabled`).toBe(false)
  expect(cmpBtn.inactive, `${ctx}: CompareButton.inactive (greyed out)`).toBe(true)
  const inter = interactable("CompareButton")
  expect(inter.enabled, `${ctx}: Compare interactable disabled`).toBe(false)
  const key = c.currentPieceKey
  const before = JSON.stringify([c.currentPieceKey, c.piecePosition, c.rotationDeg])
  // Attempt a real pinch with a separate interactor: it can't even hover a disabled target.
  const probe = new DefaultLeafInteractor(`Probe_${ctx}_${Date.now()}`)
  let pinchLanded = true
  try {
    await withTimeout(probe.trigger(inter), 1500, "no hover")
  } catch (e) {
    pinchLanded = false
    // Drop the probe's pending target so it can't fire later when Compare re-activates.
    ;(probe as unknown as {overrideInteractable?: unknown}).overrideInteractable = undefined
  }
  await sleep(200)
  log(`${ctx}: pinch on greyed Compare landed=${pinchLanded}`)
  expect(pinchLanded, `${ctx}: pinch on greyed-out Compare does not register`).toBe(false)
  expect(JSON.stringify([c.currentPieceKey, c.piecePosition, c.rotationDeg]), `${ctx}: unchanged after pinch`).toBe(before)
  c.compare() // API path must also be a no-op
  expect(c.currentPieceKey, `${ctx}: compare() API no-op`).toBe(key)
}

/** Built-in pieces from the brief, in their fixed order, with type and size (W × D × H cm). */
export const BUILT_INS = [
  {key: "SofaA", name: "Sofa A", type: "sofa", w: 220, d: 90, h: 85},
  {key: "SofaB", name: "Sofa B", type: "sofa", w: 180, d: 85, h: 85},
  {key: "Bed", name: "Bed", type: "bed", w: 160, d: 200, h: 55},
  {key: "DiningTable", name: "Dining table", type: "table", w: 160, d: 90, h: 75},
]
export const BUILT_IN_KEYS = BUILT_INS.map((b) => b.key)

export interface ExpectedVariant {
  key: string
  name: string
  w: number
  d: number
  h: number
  imported: boolean
}
export interface ExpectedType {
  type: string
  variants: ExpectedVariant[]
}

/**
 * Update 2 order, worked out independently of SidleController: types sofa,
 * chair, table, bed, then unknown categories in catalog order; within a type,
 * built-ins first (when offered), then imported pieces in catalog order;
 * types with no variant are left out. `catalog` holds enabled entries only.
 */
export function expectedOffer(catalog: any[], placeholders: boolean): ExpectedType[] {
  const all: (ExpectedVariant & {type: string})[] = []
  if (placeholders) for (const b of BUILT_INS) all.push({...b, imported: false})
  for (const e of catalog) {
    all.push({
      key: `Imported_${e.id}`,
      name: e.name,
      type: String(e.category).trim().toLowerCase() || "other",
      w: e.widthCm,
      d: e.depthCm,
      h: e.heightCm,
      imported: true,
    })
  }
  const order = ["sofa", "chair", "table", "bed"]
  for (const v of all) if (order.indexOf(v.type) < 0) order.push(v.type)
  return order
    .map((type) => ({type, variants: all.filter((v) => v.type === type).map(({type: _t, ...v}) => v)}))
    .filter((t) => t.variants.length > 0)
}

/** Type of `key` in an expected offer, or "" if it is not offered. */
export function typeOfKey(offer: ExpectedType[], key: string): string {
  for (const t of offer) if (t.variants.some((v) => v.key === key)) return t.type
  return ""
}

/** All offered keys flattened in Next/Compare order. */
export function offeredKeys(offer: ExpectedType[]): string[] {
  const out: string[] = []
  for (const t of offer) for (const v of t.variants) out.push(v.key)
  return out
}

/**
 * Reach `key` with real button pinches only: Next until its type shows (each
 * Next must land on that type's first variant), then Compare until it shows.
 */
export async function goTo(it: DefaultLeafInteractor, c: SidleController, offer: ExpectedType[], key: string): Promise<void> {
  const type = typeOfKey(offer, key)
  if (!type) throw new Error(`goTo: "${key}" is not offered`)
  let guard = 0
  while (typeOfKey(offer, c.currentPieceKey) !== type) {
    if (guard++ > offer.length) throw new Error(`goTo: Next never reached type "${type}"`)
    await tap(it, "NextButton")
    const t = offer.find((o) => o.type === typeOfKey(offer, c.currentPieceKey))
    expect(!!t && c.currentPieceKey === t.variants[0].key, `goTo: Next shows the first variant of its type (got ${c.currentPieceKey})`).toBe(true)
  }
  const variants = offer.find((o) => o.type === type)!.variants
  guard = 0
  while (c.currentPieceKey !== key) {
    if (guard++ > variants.length) throw new Error(`goTo: Compare never reached "${key}"`)
    await tap(it, "CompareButton")
  }
}

/** AABB of every RenderMeshVisual under `root` (enabled or not), in `frame`'s local space. */
export function meshBounds(root: SceneObject, frame: SceneObject): {min: vec3; max: vec3} | null {
  const inv = frame.getTransform().getInvertedWorldTransform()
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  let n = 0
  const stack = [root]
  while (stack.length) {
    const so = stack.pop()!
    for (const v of so.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]) {
      if (!v.mesh) continue
      const a = v.localAabbMin()
      const b = v.localAabbMax()
      const m = inv.mult(so.getTransform().getWorldTransform())
      for (const x of [a.x, b.x])
        for (const y of [a.y, b.y])
          for (const z of [a.z, b.z]) {
            const p = m.multiplyPoint(new vec3(x, y, z))
            const q = [p.x, p.y, p.z]
            for (let i = 0; i < 3; i++) {
              lo[i] = Math.min(lo[i], q[i])
              hi[i] = Math.max(hi[i], q[i])
            }
            n++
          }
    }
    for (let i = 0; i < so.getChildrenCount(); i++) stack.push(so.getChild(i))
  }
  return n ? {min: new vec3(lo[0], lo[1], lo[2]), max: new vec3(hi[0], hi[1], hi[2])} : null
}

/** The bundled catalog, read independently of SidleController (enabled entries only). */
export function bundledCatalog(): any[] {
  const asset = requireAsset("../../Models/catalog.json") as JsonAsset
  return (JSON.parse(asset.getString()) as any[]).filter((e) => e.enabled !== false)
}

export function panelText(name: string): string {
  const t = obj(name).getComponent("Component.Text") as Text
  return t ? t.text : ""
}

/** Grab PieceGrab and drag it; dragVector is world cm added per drag-update frame. */
export async function dragPiece(it: DefaultLeafInteractor, perFrame: vec3, ms: number): Promise<void> {
  await it.drag(interactable("PieceGrab"), perFrame, ms)
  await sleep(150)
}

/** Yaw (rad) of a transform's local rotation about +Y, matching quat.angleAxis(yaw, up). */
export function yawOf(t: Transform): number {
  const r = t.getLocalRotation().multiplyVec3(new vec3(1, 0, 0)) // (cos, 0, -sin)
  return Math.atan2(-r.z, r.x)
}

export function angDiffDeg(a: number, b: number): number {
  let d = (((a - b) % 360) + 540) % 360 - 180
  return Math.abs(d)
}

export function local(name: string): vec3 {
  return obj(name).getTransform().getLocalPosition()
}

export function textOf(labelName: string): string {
  // WidthLabel/DepthLabel/HeightLabel > Panel > Content(Text)
  const root = obj(labelName)
  const panel = root.getChild(0)
  const content = panel.getChild(panel.getChildrenCount() - 1)
  const t = content.getComponent("Component.Text") as Text
  if (t) return t.text
  // fall back to a search of the subtree
  const stack: SceneObject[] = [root]
  while (stack.length) {
    const s = stack.pop()!
    const tt = s.getComponent("Component.Text") as Text
    if (tt) return tt.text
    for (let i = 0; i < s.getChildrenCount(); i++) stack.push(s.getChild(i))
  }
  return ""
}

export function edgeColor(edgeName: string): vec4 {
  const rmv = obj(edgeName).getComponent("Component.RenderMeshVisual") as RenderMeshVisual
  return rmv.mainMaterial.mainPass.baseColor
}

export function isGreen(c: vec4): boolean {
  return c.y > 0.6 && c.x < 0.6
}
export function isRed(c: vec4): boolean {
  return c.x > 0.8 && c.y < 0.5
}

/** Footprint overlap test vs the coffee table for rotation 0/180 (axis aligned). */
export function overlapsCoffee(x: number, z: number, w: number, d: number): boolean {
  const ox = Math.min(x + w / 2, COFFEE.maxX) - Math.max(x - w / 2, COFFEE.minX)
  const oz = Math.min(z + d / 2, COFFEE.maxZ) - Math.max(z - d / 2, COFFEE.minZ)
  return ox > 0.5 && oz > 0.5
}

export function insideRoom(x: number, z: number, w: number, d: number): boolean {
  const e = 0.5
  return x - w / 2 >= ROOM.minX - e && x + w / 2 <= ROOM.maxX + e && z - d / 2 >= ROOM.minZ - e && z + d / 2 <= ROOM.maxZ + e
}

export function expectEdges(c: SidleController, expected: string[], ctx: string): void {
  expect(c.outlineEdgeColors.join(","), `${ctx}: outlineEdgeColors [front,right,back,left]`).toBe(expected.join(","))
  const names = ["Edge_Front", "Edge_Right", "Edge_Back", "Edge_Left"]
  for (let i = 0; i < 4; i++) {
    const col = edgeColor(names[i])
    const ok = expected[i] === "red" ? isRed(col) : isGreen(col)
    expect(ok, `${ctx}: ${names[i]} rendered material should be ${expected[i]} (got ${col})`).toBe(true)
  }
}

/**
 * Put the Lens back into a known state via the controller API (test setup only):
 * placeholder pieces on, Sofa A, 0°, Measure off, not dragging, at the start spot;
 * waits out any gap fade.
 */
export async function resetState(): Promise<SidleController> {
  const c = controller()
  if (c.isDragging) c.endDrag()
  if (!c.showPlaceholderPieces) c.setShowPlaceholderPieces(true)
  let guard = 0
  while (c.currentPieceKey !== "SofaA" && guard++ < 10 + c.importedPieceKeys.length) {
    if (c.currentPieceType === "sofa") c.compare()
    else c.nextPiece()
  }
  guard = 0
  while (c.rotationDeg > 0.01 && c.rotationDeg < 359.99 && guard++ < 30) c.rotateLeft()
  if (c.measureOn) c.toggleMeasure()
  c.setPiecePosition(START.x, START.z)
  await sleep(1400)
  expect(c.currentPieceKey, "reset: piece").toBe("SofaA")
  expect(c.isClear, "reset: clear").toBe(true)
  return c
}

/** Independent footprint corners (same yaw convention as quat.angleAxis(yaw, up)). */
export function footprint(x: number, z: number, w: number, d: number, yawDeg: number): {x: number; z: number}[] {
  const y = (yawDeg * Math.PI) / 180
  const c = Math.cos(y)
  const s = Math.sin(y)
  return [
    [w / 2, d / 2],
    [w / 2, -d / 2],
    [-w / 2, -d / 2],
    [-w / 2, d / 2],
  ].map(([lx, lz]) => ({x: x + lx * c + lz * s, z: z - lx * s + lz * c}))
}

/** Independent check: rotated footprint fully inside the room and not overlapping the coffee table (SAT). */
export function placementValid(x: number, z: number, w: number, d: number, yawDeg: number): boolean {
  const poly = footprint(x, z, w, d, yawDeg)
  const e = 0.5
  for (const p of poly) {
    if (p.x < ROOM.minX - e || p.x > ROOM.maxX + e || p.z < ROOM.minZ - e || p.z > ROOM.maxZ + e) return false
  }
  const box = [
    {x: COFFEE.maxX, z: COFFEE.maxZ},
    {x: COFFEE.maxX, z: COFFEE.minZ},
    {x: COFFEE.minX, z: COFFEE.minZ},
    {x: COFFEE.minX, z: COFFEE.maxZ},
  ]
  const axes: {x: number; z: number}[] = []
  for (const P of [poly, box]) {
    for (let i = 0; i < 4; i++) {
      const a = P[i]
      const b = P[(i + 1) % 4]
      const ex = b.x - a.x
      const ez = b.z - a.z
      const l = Math.sqrt(ex * ex + ez * ez)
      axes.push({x: -ez / l, z: ex / l})
    }
  }
  for (const ax of axes) {
    const pa = poly.map((p) => p.x * ax.x + p.z * ax.z)
    const pb = box.map((p) => p.x * ax.x + p.z * ax.z)
    const ov = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb))
    if (ov <= e) return true // separated (touching allowed)
  }
  return false
}
