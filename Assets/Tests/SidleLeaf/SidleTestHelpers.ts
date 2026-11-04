/**
 * Shared helpers for the Sidle LEAF scenarios (test-only; never shipped behaviour).
 * Reads SidleController state through its public getters and drives the real
 * UIKit buttons / PieceGrab Interactable through LEAF interactors.
 */
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, nextFrame, sleep, withTimeout} from "Leaf.lspkg/Utils/common/Utils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
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
  if (c.galleryOpen) c.closeGallery()
  if (c.isDragging) c.endDrag()
  // Update 6: back to a single piece (a no-op when nothing was placed).
  let removeGuard = 0
  while (c.canRemove && removeGuard++ < 10) c.removePiece()
  if (!c.showPlaceholderPieces) c.setShowPlaceholderPieces(true)
  let guard = 0
  while (c.currentPieceKey !== "SofaA" && guard++ < 10 + c.importedPieceKeys.length) {
    if (c.currentPieceType === "sofa") c.compare()
    else c.nextPiece()
  }
  guard = 0
  while (c.rotationDeg > 0.01 && c.rotationDeg < 359.99 && guard++ < 30) c.rotateLeft()
  if (c.measureOn) c.toggleMeasure()
  if (c.currentColorIndex !== 0) c.setColor(0) // Update 9: back to the original colours
  c.resetPanelOffset()
  c.resetPanelScale()
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

// ── Head + panel (Update 3) ──────────────────────────────────────────────────

export function cameraTransform(): Transform {
  return WorldCameraFinderProvider.getInstance().getTransform()
}

/** Gravity-aligned head frame, worked out independently of SidlePanelOffset. */
export function levelHeadFrame(): {pos: vec3; fwd: vec3; right: vec3; pitchDeg: number} {
  const t = cameraTransform()
  const back = t.back // view direction (camera looks along -Z)
  const flat = new vec3(back.x, 0, back.z).normalize()
  return {
    pos: t.getWorldPosition(),
    fwd: flat,
    right: new vec3(-flat.z, 0, flat.x), // 90° clockwise seen from above
    pitchDeg: (Math.asin(Math.max(-1, Math.min(1, back.y))) * 180) / Math.PI,
  }
}

/** Measured head-space offset of a world point: distance, horizontal (+ right) and vertical (+ up) angle. */
export function headOffsetOf(p: vec3): {distanceCm: number; horizontalDeg: number; verticalDeg: number} {
  const f = levelHeadFrame()
  const rel = p.sub(f.pos)
  const d = rel.length
  return {
    distanceCm: d,
    horizontalDeg: (Math.atan2(rel.dot(f.right), rel.dot(f.fwd)) * 180) / Math.PI,
    verticalDeg: (Math.asin(rel.y / d) * 180) / Math.PI,
  }
}

export function fmtOffset(o: {distanceCm: number; horizontalDeg: number; verticalDeg: number}): string {
  return `${o.distanceCm.toFixed(1)} cm, h ${o.horizontalDeg.toFixed(1)}°, v ${o.verticalDeg.toFixed(1)}°`
}

/** The control panel root (the SidlePanelUI SceneObject; label backings are also called "Panel"). */
export function panelObj(c: SidleController): SceneObject {
  return c.panelUI.getSceneObject()
}

/**
 * Holds the head (camera) at a pose until stop(): the camera's DeviceTracking
 * is switched off meanwhile (so preview navigation can't move it) and the pose
 * is re-applied every frame; stop() turns tracking back on and puts the
 * original pose back.
 */
export class HeadHold {
  private active = true
  private pos: vec3
  private rot: quat
  private readonly origPos: vec3
  private readonly origRot: quat
  private readonly tracking: Component | null
  private readonly trackingWasEnabled: boolean
  constructor(pos: vec3, yawDeg: number) {
    const t = cameraTransform()
    this.origPos = t.getWorldPosition()
    this.origRot = t.getWorldRotation()
    this.tracking = t.getSceneObject().getComponent("Component.DeviceTracking") as Component | null
    this.trackingWasEnabled = !!this.tracking && this.tracking.enabled
    if (this.tracking) this.tracking.enabled = false
    this.pos = pos
    this.rot = quat.angleAxis((-yawDeg * Math.PI) / 180, vec3.up())
    this.apply()
    this.loop()
  }
  /** yawDeg > 0 turns the head to the right (clockwise seen from above). */
  set(pos: vec3, yawDeg: number): void {
    this.pos = pos
    this.rot = quat.angleAxis((-yawDeg * Math.PI) / 180, vec3.up())
    this.apply()
  }
  async stop(): Promise<void> {
    this.active = false
    await nextFrame()
    const t = cameraTransform()
    t.setWorldPosition(this.origPos)
    t.setWorldRotation(this.origRot)
    if (this.tracking) this.tracking.enabled = this.trackingWasEnabled
  }
  private apply(): void {
    const t = cameraTransform()
    t.setWorldPosition(this.pos)
    t.setWorldRotation(this.rot)
  }
  private async loop(): Promise<void> {
    while (this.active) {
      this.apply()
      await nextFrame()
    }
  }
}

/** Head pose at the start: the scene's camera origin, level, facing into the room (-Z). */
export const START_HEAD = {pos: new vec3(0, 0, 0), yawDeg: 0}

/** Names of objects whose visual corners were not finite in the last visualCorners() calls (debug). */
export const skippedVisuals: string[] = []

/** World-space corners of the local AABB of every mesh visual (RenderMeshVisual, Text, Image) under `root`. */
export function visualCorners(root: SceneObject, enabledOnly: boolean = false): vec3[] {
  const out: vec3[] = []
  const stack = [root]
  while (stack.length) {
    const so = stack.pop()!
    if (enabledOnly && !so.isEnabledInHierarchy) continue
    for (const type of ["Component.RenderMeshVisual", "Component.Text", "Component.Image"]) {
      for (const v of so.getComponents(type as any) as any[]) {
        if (!v || typeof v.localAabbMin !== "function") continue
        if (type === "Component.RenderMeshVisual" && !v.mesh) continue
        const a: vec3 = v.localAabbMin()
        const b: vec3 = v.localAabbMax()
        // Empty text etc. reports a non-finite box: it covers nothing.
        if (![a.x, a.y, a.z, b.x, b.y, b.z].every((n) => isFinite(n))) continue
        const m = so.getTransform().getWorldTransform()
        for (const x of [a.x, b.x])
          for (const y of [a.y, b.y])
            for (const z of [a.z, b.z]) {
              const q = m.multiplyPoint(new vec3(x, y, z))
              if (isFinite(q.x) && isFinite(q.y) && isFinite(q.z)) out.push(q)
              else if (skippedVisuals.indexOf(so.name) < 0) skippedVisuals.push(so.name)
            }
      }
    }
    for (let i = 0; i < so.getChildrenCount(); i++) stack.push(so.getChild(i))
  }
  return out
}

/** Angular box (head-level frame, degrees) covered by a set of world points. */
export function angularBox(points: vec3[]): {hMin: number; hMax: number; vMin: number; vMax: number} {
  let hMin = Infinity, hMax = -Infinity, vMin = Infinity, vMax = -Infinity
  for (const p of points) {
    const o = headOffsetOf(p)
    hMin = Math.min(hMin, o.horizontalDeg)
    hMax = Math.max(hMax, o.horizontalDeg)
    vMin = Math.min(vMin, o.verticalDeg)
    vMax = Math.max(vMax, o.verticalDeg)
  }
  return {hMin, hMax, vMin, vMax}
}

export function fmtBox(b: {hMin: number; hMax: number; vMin: number; vMax: number}): string {
  return `h ${b.hMin.toFixed(1)}..${b.hMax.toFixed(1)}°, v ${b.vMin.toFixed(1)}..${b.vMax.toFixed(1)}°`
}

// ── Gallery (Update 4) ───────────────────────────────────────────────────────

export const TILES_PER_PAGE = 6

/** Gallery root SceneObject (the SidleGalleryUI object). */
export function galleryObj(c: SidleController): SceneObject {
  return c.galleryUI.getSceneObject()
}

/** The gallery is showing (its GalleryRoot enabled) and the control panel is hidden. */
export function galleryShown(c: SidleController): boolean {
  const root = galleryObj(c).getChild(0)
  return root.isEnabledInHierarchy && !panelObj(c).isEnabledInHierarchy
}

/** "sofa" -> "Sofa" (tab label). */
export function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

/** What a tile slot shows, read from the scene objects (not from the controller). */
export function tileView(slot: number): {visible: boolean; name: string; thumb: string | null; swatch: boolean} {
  const so = obj(`GalleryTile_${slot + 1}`)
  if (!so.isEnabledInHierarchy) return {visible: false, name: "", thumb: null, swatch: false}
  const face = so.getChild(so.getChildrenCount() - 1).name === "Face" ? so.getChild(so.getChildrenCount() - 1) : findChild(so, "Face")
  const thumb = findChild(face, "Thumb")
  const swatch = findChild(face, "Swatch")
  const name = (findChild(face, "Name").getComponent("Component.Text") as Text).text
  let tex: string | null = null
  if (thumb.enabled) {
    const img = thumb.getComponent("Component.Image") as Image
    const t = img && img.mainMaterial ? img.mainMaterial.mainPass.baseTex : null
    tex = t ? t.name : ""
  }
  return {visible: true, name, thumb: tex, swatch: swatch.enabled}
}

/** Visible tab slots, read from the scene: label text and whether it is marked active. */
export function tabViews(): {label: string; active: boolean}[] {
  const out: {label: string; active: boolean}[] = []
  for (let i = 1; i <= 8; i++) {
    const so = findSceneObjectByName(`GalleryTab_${i}`)
    if (!so || !so.isEnabledInHierarchy) continue
    out.push({label: (findChild(so, "Label").getComponent("Component.Text") as Text).text, active: findChild(so, "Underline").enabled})
  }
  return out
}

export function findChild(root: SceneObject, name: string): SceneObject {
  const stack = [root]
  while (stack.length) {
    const so = stack.pop()!
    if (so !== root && so.name === name) return so
    for (let i = 0; i < so.getChildrenCount(); i++) stack.push(so.getChild(i))
  }
  throw new Error(`"${name}" not found under "${root.name}"`)
}

/**
 * A UIKit button is greyed out (Button.inactive, interactable disabled) and a
 * real pinch with a separate interactor does not register.
 */
export async function expectGreyedButton(name: string, ctx: string): Promise<void> {
  const btn = obj(name).getComponent(Button.getTypeName()) as Button
  expect(btn.inactive, `${ctx}: ${name} greyed out`).toBe(true)
  const inter = interactable(name)
  expect(inter.enabled, `${ctx}: ${name} interactable disabled`).toBe(false)
  const probe = new DefaultLeafInteractor(`Probe_${name}_${Date.now()}`)
  let landed = true
  try {
    await withTimeout(probe.trigger(inter), 1500, "no hover")
  } catch (e) {
    landed = false
    ;(probe as unknown as {overrideInteractable?: unknown}).overrideInteractable = undefined
  }
  await sleep(200)
  expect(landed, `${ctx}: pinch on greyed-out ${name} does not register`).toBe(false)
}

// ── Several pieces (Update 6) ────────────────────────────────────────────────

export const MAX_PIECES_BRIEF = 6
type P2 = {x: number; z: number}

/** Expected variant (catalog / brief sizes) for a key in an expected offer. */
export function variantOf(offer: ExpectedType[], key: string): ExpectedVariant {
  for (const t of offer) for (const v of t.variants) if (v.key === key) return v
  throw new Error(`variantOf: "${key}" not in the expected offer`)
}

/** First variant of the type after `key`'s type, wrapping (what Next piece / Add chooses). */
export function nextTypeFirstKey(offer: ExpectedType[], key: string): string {
  const ti = offer.findIndex((t) => t.variants.some((v) => v.key === key))
  return offer[(ti + 1) % offer.length].variants[0].key
}

/** Independent SAT overlap of two convex footprints (touching, within 0.5 cm, allowed). */
export function footprintsOverlap(a: P2[], b: P2[]): boolean {
  for (const P of [a, b]) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      const q = P[(i + 1) % P.length]
      const l = Math.sqrt((q.x - p.x) ** 2 + (q.z - p.z) ** 2)
      const ax = {x: -(q.z - p.z) / l, z: (q.x - p.x) / l}
      const pa = a.map((v) => v.x * ax.x + v.z * ax.z)
      const pb = b.map((v) => v.x * ax.x + v.z * ax.z)
      const ov = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb))
      if (ov <= 0.5) return false
    }
  }
  return true
}

function segPointDist(p: P2, a: P2, b: P2): number {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const l2 = abx * abx + abz * abz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0
  return Math.sqrt((p.x - a.x - abx * t) ** 2 + (p.z - a.z - abz * t) ** 2)
}

/** Independent shortest distance between two separated convex footprints (cm). */
export function footprintGap(a: P2[], b: P2[]): number {
  let g = Infinity
  for (const [P, Q] of [[a, b], [b, a]]) {
    for (const p of P) for (let i = 0; i < Q.length; i++) g = Math.min(g, segPointDist(p, Q[i], Q[(i + 1) % Q.length]))
  }
  return g
}

/** Current piece footprint from the controller's pose and the expected size of its variant. */
export function currentFootprint(c: SidleController, offer: ExpectedType[]): P2[] {
  const v = variantOf(offer, c.currentPieceKey)
  return footprint(c.piecePosition.x, c.piecePosition.z, v.w, v.d, c.rotationDeg)
}

export function placedFootprint(p: {key: string; x: number; z: number; yawDeg: number}, offer: ExpectedType[]): P2[] {
  const v = variantOf(offer, p.key)
  return footprint(p.x, p.z, v.w, v.d, p.yawDeg)
}

/** The placed piece's root SceneObject ("PlacedPiece_<id>"), or null. */
export function placedRoot(id: number): SceneObject | null {
  return findSceneObjectByName(`PlacedPiece_${id}`) ?? null
}

/** Faint neutral outline colour: light grey, neither green nor red. */
export function isNeutral(col: vec4): boolean {
  return Math.abs(col.x - col.y) < 0.05 && Math.abs(col.y - col.z) < 0.05 && col.x > 0.5 && !isGreen(col) && !isRed(col)
}

/** No piece in the room overlaps another, and every one is inside the room and clear of the coffee table. */
export function expectNoOverlaps(c: SidleController, offer: ExpectedType[], ctx: string): void {
  const all = [{id: c.currentPieceId, key: c.currentPieceKey, x: c.piecePosition.x, z: c.piecePosition.z, yawDeg: c.rotationDeg}].concat(c.placedPieces)
  for (const p of all) {
    const v = variantOf(offer, p.key)
    expect(placementValid(p.x, p.z, v.w, v.d, p.yawDeg), `${ctx}: piece ${p.id} (${p.key}) inside the room, clear of the coffee table`).toBe(true)
  }
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const ov = footprintsOverlap(placedFootprint(all[i], offer), placedFootprint(all[j], offer))
      expect(ov, `${ctx}: pieces ${all[i].id} and ${all[j].id} do not overlap`).toBe(false)
    }
}

/** Transforms of every placed piece's root, read from the scene (for "never moves a placed piece"). */
export function placedSceneSnapshot(c: SidleController): string {
  return JSON.stringify(
    c.placedPieces.map((p) => {
      const t = placedRoot(p.id)!.getTransform()
      const pos = t.getLocalPosition()
      return {id: p.id, x: pos.x.toFixed(3), z: pos.z.toFixed(3), yaw: ((yawOf(t) * 180) / Math.PI).toFixed(3)}
    }),
  )
}

// ── Fabric colours (Update 9) ─────────────────────────────────────────────────

/** The brief's swatch order; colours are read from the strip faces in the tests, not from here. */
export const SWATCH_NAMES = ["original", "light grey", "warm beige", "sage green", "dusty blue", "terracotta"]

export function linC(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
/** WCAG relative luminance of an sRGB colour. */
export function srgbLum(c: {x: number; y: number; z: number}): number {
  return 0.2126 * linC(c.x) + 0.7152 * linC(c.y) + 0.0722 * linC(c.z)
}
/** Luminance of a linear RGB triple (glTF factors are linear). */
export function linLum(c: {x: number; y: number; z: number}): number {
  return 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z
}

/** One material under a piece visual, read from the scene: glTF factors or a flat base colour. */
export interface MatState {
  kind: "gltf" | "flat"
  base: vec4
  emissive: vec3 | null
}

function prop(pass: Pass, name: string): any {
  try {
    return (pass as any)[name]
  } catch (e) {
    return undefined
  }
}

/** Actual material colours of every mesh visual under `root`, in a stable traversal order. */
export function readMaterials(root: SceneObject): MatState[] {
  const out: MatState[] = []
  const walk = (so: SceneObject) => {
    for (const v of so.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]) {
      for (const m of v.materials ?? []) {
        const f = prop(m.mainPass, "baseColorFactor")
        if (f !== undefined && f !== null) {
          const e = prop(m.mainPass, "emissiveFactor")
          out.push({kind: "gltf", base: new vec4(f.x, f.y, f.z, f.w), emissive: e ? new vec3(e.x, e.y, e.z) : new vec3(0, 0, 0)})
          continue
        }
        const c = prop(m.mainPass, "baseColor")
        if (c !== undefined && c !== null) out.push({kind: "flat", base: new vec4(c.x, c.y, c.z, c.w), emissive: null})
      }
    }
    for (let i = 0; i < so.getChildrenCount(); i++) walk(so.getChild(i))
  }
  walk(root)
  return out
}

export function sameMaterials(a: MatState[], b: MatState[]): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-4
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = b[i]
    if (p.kind !== q.kind || !near(p.base.x, q.base.x) || !near(p.base.y, q.base.y) || !near(p.base.z, q.base.z)) return false
    if (p.emissive && q.emissive && (!near(p.emissive.x, q.emissive.x) || !near(p.emissive.y, q.emissive.y) || !near(p.emissive.z, q.emissive.z))) return false
  }
  return true
}

/** Linear colour of a swatch face read from the strip (ColorSwatch_i > SwatchFace). */
export function swatchFaceColor(i: number): vec4 {
  const face = findChild(obj(`ColorSwatch_${i}`), "SwatchFace")
  const rr = face.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
  return rr.backgroundColor
}

/**
 * Independent check that a tinted material is the swatch colour and not
 * darker than the original:
 *  - flat: luminance not lower; the hue's channel order is the swatch's.
 *  - glTF: output is affine in the texel value g (lit part base*g plus
 *    emissive), so checking g = 1 (white texel) and g = 0 (black texel) covers
 *    every neutral texel: neither may be darker than the original; the added
 *    colour has the swatch's channel order.
 * Returns a reason string when it fails, "" when it passes.
 */
export function tintProblem(orig: MatState, now: MatState, swatch: vec4): string {
  const sw = [linC(swatch.x), linC(swatch.y), linC(swatch.z)]
  const order = (v: number[]) => [0, 1, 2].sort((i, j) => v[i] - v[j]).join("")
  const neutral = Math.max(...sw) - Math.min(...sw) < 0.02
  if (now.kind === "flat") {
    const lo = srgbLum(orig.base)
    const ln = srgbLum(now.base)
    if (ln < lo - 0.003) return `flat colour darker (${lo.toFixed(3)} -> ${ln.toFixed(3)})`
    const nv = [linC(now.base.x), linC(now.base.y), linC(now.base.z)]
    if (neutral) return Math.max(...nv) - Math.min(...nv) < 0.03 ? "" : `grey swatch gave a coloured result ${now.base}`
    if (order(nv) !== order(sw)) return `flat hue order ${order(nv)} is not the swatch's ${order(sw)} (${now.base})`
    return ""
  }
  const white0 = linLum(orig.base) + linLum(orig.emissive!)
  const white1 = linLum(now.base) + linLum(now.emissive!)
  if (white1 < white0 - 1e-3) return `white texel darker (${white0.toFixed(3)} -> ${white1.toFixed(3)})`
  if (linLum(now.emissive!) < linLum(orig.emissive!) - 1e-4) return "black texel darker"
  const added = [now.emissive!.x - orig.emissive!.x, now.emissive!.y - orig.emissive!.y, now.emissive!.z - orig.emissive!.z]
  if (Math.max(...added) <= 0) return "no swatch colour added"
  if (!neutral && order(added) !== order(sw)) return `added colour order ${order(added)} is not the swatch's ${order(sw)}`
  if (neutral && Math.max(...added) - Math.min(...added) > 0.02 * Math.max(...added) + 1e-4) return "grey swatch added a colour"
  return ""
}
