/**
 * SidleController — the single owner of Sidle state (testable via LEAF).
 *
 * Owns: current piece, its floor position + rotation, Measure toggle, drag
 * state, clearance result, gap-label fade, and the "piece behind you" arrow.
 * Builds the virtual stand-in room (walls, doorway, coffee table) and the four
 * box-shaped pieces under the authored roots it is given, and pushes view state
 * into SidlePanelUI / SidleLabelsUI.
 *
 * Expects @inputs: VirtualRoom, Doorway, CoffeeTable, Piece, FloorOutline
 * SceneObjects; the two UI components; a lit + an unlit template material.
 * All math is VirtualRoom-local (floor at y = 0, doorway wall at +Z).
 *
 * Public API (for tests): nextPiece, compare, toggleMeasure, rotateLeft,
 * rotateRight, setPiecePosition(x, z), beginDrag, endDrag, refresh, plus the
 * read-only getters below.
 *
 * Must not: create text/UIKit directly (labels live in the UI modules).
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorEvent} from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {SidlePanelUI} from "./SidlePanelUI"
import {SidleLabelsUI} from "./SidleLabelsUI"
import {MaterialCache, makeBox} from "./SidleBoxFactory"
import {
  ClearanceHit,
  EDGE_NAMES,
  EdgeName,
  Obstacle,
  RoomSpec,
  measureClearances,
  resolvePlacement,
  rotateLocal,
} from "./SidleGeometry"

export type PieceKey = "SofaA" | "SofaB" | "Bed" | "DiningTable"

interface PieceDef {
  key: PieceKey
  name: string
  w: number
  d: number
  h: number
}

/** Sizes from the design brief (W × D × H, cm). */
const PIECES: PieceDef[] = [
  {key: "SofaA", name: "Sofa A", w: 220, d: 90, h: 85},
  {key: "SofaB", name: "Sofa B", w: 180, d: 85, h: 85},
  {key: "Bed", name: "Bed", w: 160, d: 200, h: 55},
  {key: "DiningTable", name: "Dining table", w: 160, d: 90, h: 75},
]
const COFFEE_TABLE = {w: 100, d: 50, h: 45}

@component
export class SidleController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SidleController – state, clearance, room</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("Root of the virtual stand-in room; its origin is the floor under the start position")
  room!: SceneObject

  @input
  @hint("Doorway root (authored at the near wall line)")
  doorway!: SceneObject

  @input
  @hint("Coffee table root — its local X/Z is the obstacle's footprint center")
  coffeeTable!: SceneObject

  @input
  @hint("Piece root — moved/rotated on the floor; its authored X/Z is the start spot")
  pieceRoot!: SceneObject

  @input
  @hint("Floor outline root (follows the piece)")
  outlineRoot!: SceneObject

  @input
  @hint("Control panel view")
  panelUI!: SidlePanelUI

  @input
  @hint("Dimension + gap label view")
  labelsUI!: SidleLabelsUI

  @input
  @hint("Lit template material for room + furniture boxes (cloned per color)")
  litMaterial!: Material

  @input
  @hint("Unlit template material for the floor outline (cloned per color)")
  unlitMaterial!: Material
  @ui.group_end

  @ui.separator
  @ui.group_start("Room")
  @input
  @hint("Room width (X), cm")
  @widget(new SliderWidget(250, 800, 10))
  roomWidth: number = 400

  @input
  @hint("Room depth (Z), cm")
  @widget(new SliderWidget(250, 800, 10))
  roomDepth: number = 500

  @input
  @hint("Wall height, cm")
  @widget(new SliderWidget(200, 350, 5))
  wallHeight: number = 250

  @input
  @hint("How far the doorway wall line is behind the start position, cm")
  @widget(new SliderWidget(10, 100, 1))
  startInsetCm: number = 30

  @input
  @hint("Doorway opening width, cm")
  @widget(new SliderWidget(60, 140, 1))
  doorWidth: number = 90

  @input
  @hint("Doorway opening height, cm")
  @widget(new SliderWidget(180, 240, 1))
  doorHeight: number = 200

  @input("vec4", "{0.92, 0.91, 0.88, 1.0}")
  @hint("Wall color (light)")
  @widget(new ColorWidget())
  wallColor: vec4 = new vec4(0.92, 0.91, 0.88, 1.0)

  @input("vec4", "{0.72, 0.7, 0.66, 1.0}")
  @hint("Floor color")
  @widget(new ColorWidget())
  floorColor: vec4 = new vec4(0.72, 0.7, 0.66, 1.0)
  @ui.group_end

  @ui.separator
  @ui.group_start("Clearance")
  @input
  @hint("Minimum free space to walls, doorway wall and coffee table, cm")
  @widget(new SliderWidget(30, 150, 1))
  clearanceCm: number = 80

  @input
  @hint("Rotate button step, degrees")
  @widget(new SliderWidget(5, 90, 1))
  rotateStepDeg: number = 15

  @input
  @hint("Gap number fade-out time after going green, seconds")
  @widget(new SliderWidget(0.2, 3, 0.1))
  gapFadeSeconds: number = 1.0

  @input("vec4", "{0.35, 0.85, 0.45, 1.0}")
  @hint("Outline color when clear")
  @widget(new ColorWidget())
  clearColor: vec4 = new vec4(0.35, 0.85, 0.45, 1.0)

  @input("vec4", "{1.0, 0.3, 0.25, 1.0}")
  @hint("Outline edge color when too close")
  @widget(new ColorWidget())
  tooCloseColor: vec4 = new vec4(1.0, 0.3, 0.25, 1.0)

  @input
  @hint("Outline line width, cm (thin + faint)")
  @widget(new SliderWidget(0.5, 5, 0.1))
  outlineWidthCm: number = 1.5
  @ui.group_end

  @ui.separator
  @ui.group_start("Debug")
  @input
  @hint("Wireframe the piece's grab collider")
  debugColliders: boolean = false
  @ui.group_end

  // ── State (single source of truth) ─────────────────────────────────────────
  private pieceIndex = 0
  private yawDeg = 0
  private posX = 0
  private posZ = -220
  private _measureOn = false
  private _dragging = false
  private hits: ClearanceHit[] = []
  private edgeRed: boolean[] = [false, false, false, false]
  private gapAlpha = 0
  private gapFading = false
  private lastGapText = ""
  private lastGapPos = new vec3(0, 0, 0)
  private _behind = false
  private _behindAngle = 0

  // ── Scene handles ──────────────────────────────────────────────────────────
  private litCache!: MaterialCache
  private unlitCache!: MaterialCache
  private pieceVisuals: {[k: string]: SceneObject} = {}
  private hitObj!: SceneObject
  private collider!: ColliderComponent
  private edges: SceneObject[] = []
  private edgeVisuals: RenderMeshVisual[] = []
  private camT: Transform | null = null
  private dragOffset: vec3 | null = null
  private ready = false
  private colliderKey = ""

  onAwake() {
    if (!this.room || !this.pieceRoot || !this.outlineRoot || !this.panelUI || !this.labelsUI) {
      print("SidleController: required @input not wired (room/pieceRoot/outlineRoot/panelUI/labelsUI).")
      return
    }
    if (!this.litMaterial || !this.unlitMaterial) {
      print("SidleController: litMaterial/unlitMaterial not wired.")
      return
    }
    this.litCache = new MaterialCache(this.litMaterial)
    this.unlitCache = new MaterialCache(this.unlitMaterial)

    const start = this.pieceRoot.getTransform().getLocalPosition()
    this.posX = start.x
    this.posZ = start.z

    this.buildRoom()
    this.buildPieces()
    this.buildOutline()
    this.buildGrab()
    // UI components may not be initialized yet during onAwake (hierarchy order),
    // so the first view sync happens in OnStartEvent.

    this.createEvent("OnStartEvent").bind(() => {
      this.camT = WorldCameraFinderProvider.getInstance().getTransform()
      this.panelUI.onNext.add(() => this.nextPiece())
      this.panelUI.onCompare.add(() => this.compare())
      this.panelUI.onMeasure.add(() => this.toggleMeasure())
      this.panelUI.onRotateLeft.add(() => this.rotateLeft())
      this.panelUI.onRotateRight.add(() => this.rotateRight())

      const inter = this.hitObj.getComponent(Interactable.getTypeName()) as Interactable
      inter.onTriggerStart.add((e: InteractorEvent) => this.onGrabStart(e))
      inter.onTriggerUpdate.add((e: InteractorEvent) => this.onGrabUpdate(e))
      inter.onTriggerEnd.add(() => this.endDrag())
      inter.onTriggerEndOutside.add(() => this.endDrag())
      inter.onTriggerCanceled.add(() => this.endDrag())

      this.ready = true
      this.applyAll()
    })
    this.createEvent("UpdateEvent").bind(() => this.tick())
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════════════

  /** Sofa A → Bed → Dining table → Sofa A (Sofa B → Bed). */
  nextPiece(): void {
    const key = this.currentPieceKey
    const next: PieceKey = key === "SofaA" || key === "SofaB" ? "Bed" : key === "Bed" ? "DiningTable" : "SofaA"
    this.showPiece(next)
  }

  /** Sofa A ↔ Sofa B; does nothing for the bed or dining table. */
  compare(): void {
    const key = this.currentPieceKey
    if (key === "SofaA") this.showPiece("SofaB")
    else if (key === "SofaB") this.showPiece("SofaA")
  }

  toggleMeasure(): void {
    this._measureOn = !this._measureOn
    this.applyAll()
  }

  rotateLeft(): void {
    this.rotateBy(this.rotateStepDeg)
  }

  rotateRight(): void {
    this.rotateBy(-this.rotateStepDeg)
  }

  /** Move the piece on the floor (VirtualRoom-local cm). Clamped: no overlap with walls/coffee table. */
  setPiecePosition(x: number, z: number): void {
    const p = this.resolve(x, z, this.yawRad())
    this.posX = p.x
    this.posZ = p.z
    this.applyAll()
  }

  beginDrag(): void {
    this._dragging = true
    this.applyAll()
  }

  endDrag(): void {
    this._dragging = false
    this.dragOffset = null
    this.applyAll()
  }

  /** Re-run clearance + view sync (also runs every frame). */
  refresh(): void {
    this.applyAll()
  }

  // ── Read-only state ────────────────────────────────────────────────────────
  get currentPieceKey(): PieceKey {
    return PIECES[this.pieceIndex].key
  }
  get currentPieceName(): string {
    return PIECES[this.pieceIndex].name
  }
  get currentDims(): {w: number; d: number; h: number} {
    const p = PIECES[this.pieceIndex]
    return {w: p.w, d: p.d, h: p.h}
  }
  get measureOn(): boolean {
    return this._measureOn
  }
  get isDragging(): boolean {
    return this._dragging
  }
  /** Dimension labels show while dragging or when Measure is on. */
  get labelsVisible(): boolean {
    return this._measureOn || this._dragging
  }
  /** Compare is only enabled while a sofa is showing. */
  get compareEnabled(): boolean {
    const k = this.currentPieceKey
    return k === "SofaA" || k === "SofaB"
  }
  /** Rotation in degrees, normalized to [0, 360). Positive = rotated left (counter-clockwise from above). */
  get rotationDeg(): number {
    return ((this.yawDeg % 360) + 360) % 360
  }
  get piecePosition(): {x: number; z: number} {
    return {x: this.posX, z: this.posZ}
  }
  /** Per-edge outline colors, order [front, right, back, left]; front faces the doorway at 0°. */
  get outlineEdgeColors(): string[] {
    return this.edgeRed.map((r) => (r ? "red" : "green"))
  }
  get outlineEdgeColorMap(): {[edge: string]: string} {
    const m: {[edge: string]: string} = {}
    EDGE_NAMES.forEach((n, i) => (m[n] = this.edgeRed[i] ? "red" : "green"))
    return m
  }
  /** True when every gap is >= clearanceCm. */
  get isClear(): boolean {
    return this.hits.length === 0 || this.hits[0].gap >= this.clearanceCm
  }
  /** Gap to the nearest obstacle (any), cm. */
  get nearestGapCm(): number {
    return this.hits.length ? this.hits[0].gap : Number.MAX_VALUE
  }
  get nearestObstacle(): string {
    return this.hits.length ? this.hits[0].obstacle : ""
  }
  /** All gaps, nearest first: [{obstacle, gap, edge}]. */
  get clearances(): {obstacle: string; gap: number; edge: EdgeName}[] {
    return this.hits.map((h) => ({obstacle: h.obstacle, gap: h.gap, edge: h.edge}))
  }
  get gapLabelVisible(): boolean {
    return this.gapAlpha > 0
  }
  get gapLabelText(): string {
    return this.lastGapText
  }
  get gapLabelAlpha(): number {
    return this.gapAlpha
  }
  get behindArrowVisible(): boolean {
    return this._behind
  }
  get behindArrowAngleDeg(): number {
    return this._behindAngle
  }
  get clearanceThresholdCm(): number {
    return this.clearanceCm
  }
  get roomSpec(): RoomSpec {
    return this.room3()
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Internals
  // ════════════════════════════════════════════════════════════════════════════

  private yawRad(): number {
    return (this.yawDeg * Math.PI) / 180
  }

  private room3(): RoomSpec {
    const maxZ = this.startInsetCm
    return {minX: -this.roomWidth / 2, maxX: this.roomWidth / 2, minZ: maxZ - this.roomDepth, maxZ}
  }

  private obstacles(): Obstacle[] {
    const p = this.coffeeTable ? this.coffeeTable.getTransform().getLocalPosition() : new vec3(150, 0, -445)
    return [{name: "CoffeeTable", cx: p.x, cz: p.z, w: COFFEE_TABLE.w, d: COFFEE_TABLE.d}]
  }

  private resolve(x: number, z: number, yaw: number): {x: number; z: number} {
    const p = PIECES[this.pieceIndex]
    return resolvePlacement(x, z, p.w, p.d, yaw, this.room3(), this.obstacles())
  }

  private showPiece(key: PieceKey): void {
    const idx = PIECES.findIndex((p) => p.key === key)
    if (idx < 0 || idx === this.pieceIndex) return
    this.pieceIndex = idx
    // Same spot + facing; nudge to nearest valid spot if it would overlap.
    const p = this.resolve(this.posX, this.posZ, this.yawRad())
    this.posX = p.x
    this.posZ = p.z
    this.applyAll()
  }

  private rotateBy(deg: number): void {
    this.yawDeg = this.yawDeg + deg
    const p = this.resolve(this.posX, this.posZ, this.yawRad())
    this.posX = p.x
    this.posZ = p.z
    this.applyAll()
  }

  private camLocal(): vec3 | null {
    if (!this.camT) return null
    return this.room.getTransform().getInvertedWorldTransform().multiplyPoint(this.camT.getWorldPosition())
  }

  // ── Dragging (SIK Interactable; ray projected onto the floor plane) ────────
  private floorHit(e: InteractorEvent): vec3 | null {
    const it = e.interactor
    if (!it) return null
    const inv = this.room.getTransform().getInvertedWorldTransform()
    const start = it.startPoint
    const dir = it.direction
    if (start && dir) {
      const o = inv.multiplyPoint(start)
      const d = inv.multiplyDirection(dir)
      if (d.y < -0.02) {
        const t = -o.y / d.y
        if (t > 0 && t < 3000) return o.add(d.uniformScale(t))
      }
    }
    const pc = it.planecastPoint ?? it.endPoint ?? start
    if (pc) {
      const l = inv.multiplyPoint(pc)
      return new vec3(l.x, 0, l.z)
    }
    return null
  }

  private onGrabStart(e: InteractorEvent): void {
    const hit = this.floorHit(e)
    this.dragOffset = hit ? new vec3(this.posX - hit.x, 0, this.posZ - hit.z) : new vec3(0, 0, 0)
    this.beginDrag()
  }

  private onGrabUpdate(e: InteractorEvent): void {
    if (!this._dragging || !this.dragOffset) return
    const hit = this.floorHit(e)
    if (!hit) return
    this.setPiecePosition(hit.x + this.dragOffset.x, hit.z + this.dragOffset.z)
  }

  // ── Per-frame view sync ────────────────────────────────────────────────────
  private tick(): void {
    if (!this.ready) return
    if (this.gapFading) {
      this.gapAlpha = Math.max(0, this.gapAlpha - getDeltaTime() / Math.max(0.05, this.gapFadeSeconds))
      if (this.gapAlpha <= 0) this.gapFading = false
    }
    this.applyAll()
  }

  private applyAll(): void {
    if (!this.ready) return
    const def = PIECES[this.pieceIndex]
    const yaw = this.yawRad()

    // Piece transform + visibility
    const pt = this.pieceRoot.getTransform()
    pt.setLocalPosition(new vec3(this.posX, 0, this.posZ))
    pt.setLocalRotation(quat.angleAxis(yaw, vec3.up()))
    for (const p of PIECES) this.pieceVisuals[p.key].enabled = p.key === def.key
    if (this.colliderKey !== def.key) {
      const shape = Shape.createBoxShape()
      shape.size = new vec3(def.w, def.h, def.d)
      this.collider.shape = shape
      this.hitObj.getTransform().setLocalPosition(new vec3(0, def.h / 2, 0))
      this.colliderKey = def.key
    }

    // Clearance
    this.hits = measureClearances(this.posX, this.posZ, def.w, def.d, yaw, this.room3(), this.obstacles())
    const nearest = this.hits[0]
    const tooClose = nearest && nearest.gap < this.clearanceCm
    this.edgeRed = [false, false, false, false]
    if (tooClose) this.edgeRed[EDGE_NAMES.indexOf(nearest.edge)] = true

    // Outline (follows piece; per-edge color)
    const ot = this.outlineRoot.getTransform()
    ot.setLocalPosition(new vec3(this.posX, 0, this.posZ))
    ot.setLocalRotation(quat.angleAxis(yaw, vec3.up()))
    this.layoutOutline(def.w, def.d)

    const cam = this.camLocal()

    // Gap number
    if (tooClose) {
      this.gapAlpha = 1
      this.gapFading = false
      this.lastGapText = `${Math.floor(nearest.gap)} cm`
      let mx = (nearest.piecePoint.x + nearest.obstaclePoint.x) / 2
      let mz = (nearest.piecePoint.z + nearest.obstaclePoint.z) / 2
      let my = 0.6
      if (nearest.gap < 20) {
        // too narrow to fit the number on the floor between them: lift it just above the
        // facing edge (and above the coffee table), pulled back into the room so no wall hides it
        const n = this.edgeNormal(nearest.edge, yaw)
        mx -= n.x * 10
        mz -= n.z * 10
        my = Math.max(def.h, 45) + 2
      }
      this.lastGapPos = new vec3(mx, my, mz)
    } else if (this.gapAlpha > 0 && !this.gapFading) {
      this.gapFading = true
    }
    if (this.gapAlpha > 0) {
      const gyaw = cam ? Math.atan2(cam.x - this.lastGapPos.x, cam.z - this.lastGapPos.z) : 0
      this.labelsUI.setGap(this.lastGapText, this.lastGapPos, gyaw, this.gapAlpha)
      this.labelsUI.setGapVisible(true)
    } else {
      this.labelsUI.setGapVisible(false)
    }

    // Dimension labels
    this.labelsUI.setDimensions(def.w, def.d, def.h)
    this.labelsUI.setDimensionsVisible(this.labelsVisible)
    if (this.labelsVisible) this.placeDimensionLabels(def, yaw, cam)

    // Panel
    this.panelUI.setPieceName(def.name)
    this.panelUI.setCompareEnabled(this.compareEnabled)
    this.panelUI.setMeasureOn(this._measureOn)
    this.updateBehindArrow()
  }

  private edgeNormal(edge: EdgeName, yaw: number): {x: number; z: number} {
    const l = edge === "front" ? [0, 1] : edge === "back" ? [0, -1] : edge === "right" ? [1, 0] : [-1, 0]
    return rotateLocal(l[0], l[1], yaw)
  }

  private placeDimensionLabels(def: PieceDef, yaw: number, cam: vec3 | null): void {
    // Choose the long/short edges nearest the viewer so labels sit on the visible side.
    const c = cam ?? new vec3(0, 160, 0)
    const toCam = toLocal2(c.x - this.posX, c.z - this.posZ, yaw)
    const sz = toCam.z >= 0 ? 1 : -1 // front or back edge carries width
    const sx = toCam.x >= 0 ? 1 : -1 // right or left edge carries depth
    const out = 28
    const y = 14
    const wLocal = rotateLocal(0, sz * (def.d / 2 + out), yaw)
    const dLocal = rotateLocal(sx * (def.w / 2 + out), 0, yaw)
    const hLocal = rotateLocal(-sx * (def.w / 2 + out * 0.7), sz * (def.d / 2 + out * 0.7), yaw)
    const pos = [
      new vec3(this.posX + wLocal.x, y, this.posZ + wLocal.z),
      new vec3(this.posX + dLocal.x, y, this.posZ + dLocal.z),
      new vec3(this.posX + hLocal.x, y + 4, this.posZ + hLocal.z),
    ]
    // keep labels inside the room so they never poke through a wall
    const R = this.room3()
    const m = 32
    for (const p of pos) {
      p.x = Math.max(R.minX + m, Math.min(R.maxX - m, p.x))
      p.z = Math.max(R.minZ + m, Math.min(R.maxZ - m, p.z))
    }
    for (let i = 0; i < 3; i++) {
      const lyaw = Math.atan2(c.x - pos[i].x, c.z - pos[i].z)
      this.labelsUI.placeDimensionLabel(i, pos[i], lyaw)
    }
  }

  private updateBehindArrow(): void {
    if (!this.camT) {
      this._behind = false
      this.panelUI.setBehindArrow(false, 0)
      return
    }
    const camPos = this.camT.getWorldPosition()
    const piecePos = this.pieceRoot.getTransform().getWorldPosition()
    const view = this.camT.back
    const fwd = new vec3(view.x, 0, view.z)
    const toPiece = new vec3(piecePos.x - camPos.x, 0, piecePos.z - camPos.z)
    if (fwd.length < 1e-4 || toPiece.length < 1e-4) {
      this._behind = false
      this.panelUI.setBehindArrow(false, 0)
      return
    }
    const f = fwd.normalize()
    const r = new vec3(-f.z, 0, f.x) // right of view direction (looking down -Z, right = +X)
    const d = toPiece.normalize()
    const fwdComp = d.dot(f)
    const rightComp = d.dot(r)
    this._behind = fwdComp < 0
    this._behindAngle = (Math.atan2(-rightComp, fwdComp) * 180) / Math.PI
    this.panelUI.setBehindArrow(this._behind, this._behindAngle)
  }

  // ── Builders ───────────────────────────────────────────────────────────────
  private lit(r: number, g: number, b: number): Material {
    return this.litCache.get(new vec4(r, g, b, 1))
  }

  private group(parent: SceneObject, name: string): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    return so
  }

  private buildRoom(): void {
    const R = this.room3()
    const W = this.roomWidth
    const D = this.roomDepth
    const H = this.wallHeight
    const T = 10 // wall thickness (outside the wall lines)
    const cz = (R.minZ + R.maxZ) / 2
    const wall = this.litCache.get(this.wallColor)
    const floorMat = this.litCache.get(this.floorColor)

    makeBox(this.room, "Floor", new vec3(0, -1, cz), new vec3(W + 2 * T, 2, D + 2 * T), floorMat)

    const walls = this.group(this.room, "Walls")
    makeBox(walls, "Wall_Left", new vec3(R.minX - T / 2, H / 2, cz), new vec3(T, H, D + 2 * T), wall)
    makeBox(walls, "Wall_Right", new vec3(R.maxX + T / 2, H / 2, cz), new vec3(T, H, D + 2 * T), wall)
    makeBox(walls, "Wall_Far", new vec3(0, H / 2, R.minZ - T / 2), new vec3(W + 2 * T, H, T), wall)
    // Near (doorway) wall: two segments + lintel around a centered opening
    const half = this.doorWidth / 2
    const segW = W / 2 + T - half
    const nz = R.maxZ + T / 2
    makeBox(walls, "Wall_Near_Left", new vec3(-(half + segW / 2), H / 2, nz), new vec3(segW, H, T), wall)
    makeBox(walls, "Wall_Near_Right", new vec3(half + segW / 2, H / 2, nz), new vec3(segW, H, T), wall)
    makeBox(
      walls,
      "Wall_Near_Lintel",
      new vec3(0, (this.doorHeight + H) / 2, nz),
      new vec3(this.doorWidth, H - this.doorHeight, T),
      wall,
    )

    // Doorway trim (mid tone) so the opening reads clearly
    if (this.doorway) {
      this.doorway.getTransform().setLocalPosition(new vec3(0, 0, R.maxZ))
      const trim = this.lit(0.62, 0.56, 0.5)
      makeBox(this.doorway, "Jamb_Left", new vec3(-half - 2.5, this.doorHeight / 2, T / 2), new vec3(5, this.doorHeight, T + 4), trim)
      makeBox(this.doorway, "Jamb_Right", new vec3(half + 2.5, this.doorHeight / 2, T / 2), new vec3(5, this.doorHeight, T + 4), trim)
      makeBox(this.doorway, "Head", new vec3(0, this.doorHeight + 2.5, T / 2), new vec3(this.doorWidth + 10, 5, T + 4), trim)
      makeBox(this.doorway, "Threshold", new vec3(0, 0.3, T / 2), new vec3(this.doorWidth, 0.6, T + 4), trim)
    }

    // Coffee table (fixed obstacle) — top + legs
    if (this.coffeeTable) {
      const ct = this.coffeeTable
      const top = this.lit(0.66, 0.6, 0.54)
      const leg = this.lit(0.55, 0.5, 0.45)
      const {w, d, h} = COFFEE_TABLE
      makeBox(ct, "Top", new vec3(0, h - 2, 0), new vec3(w, 4, d), top)
      const lx = w / 2 - 4
      const lz = d / 2 - 4
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        makeBox(ct, "Leg", new vec3(sx * lx, (h - 4) / 2, sz * lz), new vec3(5, h - 4, 5), leg)
      }
    }
  }

  private buildPieces(): void {
    for (const def of PIECES) {
      const root = this.group(this.pieceRoot, `Piece_${def.key}`)
      this.pieceVisuals[def.key] = root
      if (def.key === "SofaA") this.buildSofa(root, def, [0.82, 0.82, 0.84], [0.9, 0.9, 0.92])
      else if (def.key === "SofaB") this.buildSofa(root, def, [0.86, 0.75, 0.6], [0.93, 0.84, 0.7])
      else if (def.key === "Bed") this.buildBed(root, def)
      else this.buildTable(root, def)
    }
  }

  private buildSofa(root: SceneObject, def: PieceDef, body: number[], cushion: number[]): void {
    const {w, d, h} = def
    const bodyM = this.lit(body[0], body[1], body[2])
    const cushM = this.lit(cushion[0], cushion[1], cushion[2])
    const armW = 18
    const baseH = 40
    const backD = 20
    makeBox(root, "Base", new vec3(0, baseH / 2, 0), new vec3(w, baseH, d), bodyM)
    makeBox(root, "Back", new vec3(0, h / 2, -d / 2 + backD / 2), new vec3(w, h, backD), bodyM)
    makeBox(root, "Arm_L", new vec3(-w / 2 + armW / 2, 31, 0), new vec3(armW, 62, d), bodyM)
    makeBox(root, "Arm_R", new vec3(w / 2 - armW / 2, 31, 0), new vec3(armW, 62, d), bodyM)
    const seatW = w - 2 * armW
    const seats = def.key === "SofaA" ? 3 : 2
    const cw = seatW / seats
    for (let i = 0; i < seats; i++) {
      const x = -seatW / 2 + cw * (i + 0.5)
      makeBox(root, `Seat_${i}`, new vec3(x, baseH + 6, backD / 2), new vec3(cw - 1.5, 12, d - backD - 2), cushM)
    }
  }

  private buildBed(root: SceneObject, def: PieceDef): void {
    const {w, d, h} = def
    const frame = this.lit(0.68, 0.57, 0.45)
    const mattress = this.lit(0.93, 0.93, 0.9)
    const duvet = this.lit(0.62, 0.72, 0.84)
    const pillow = this.lit(0.97, 0.97, 0.95)
    makeBox(root, "Frame", new vec3(0, 15, 0), new vec3(w, 30, d), frame)
    makeBox(root, "Mattress", new vec3(0, 30 + (h - 32) / 2, 0), new vec3(w - 4, h - 32, d - 4), mattress)
    makeBox(root, "Duvet", new vec3(0, h - 1, d * 0.12), new vec3(w - 2, 2, d * 0.7), duvet)
    makeBox(root, "Pillow_L", new vec3(-w / 4, h - 1, -d / 2 + 22), new vec3(w / 2 - 12, 2, 32), pillow)
    makeBox(root, "Pillow_R", new vec3(w / 4, h - 1, -d / 2 + 22), new vec3(w / 2 - 12, 2, 32), pillow)
  }

  private buildTable(root: SceneObject, def: PieceDef): void {
    const {w, d, h} = def
    const top = this.lit(0.86, 0.74, 0.58)
    const leg = this.lit(0.66, 0.55, 0.43)
    makeBox(root, "Top", new vec3(0, h - 2, 0), new vec3(w, 4, d), top)
    const lx = w / 2 - 6
    const lz = d / 2 - 6
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      makeBox(root, "Leg", new vec3(sx * lx, (h - 4) / 2, sz * lz), new vec3(6, h - 4, 6), leg)
    }
  }

  private buildOutline(): void {
    const names = ["Edge_Front", "Edge_Right", "Edge_Back", "Edge_Left"]
    const green = this.unlitCache.get(this.clearColor)
    for (const n of names) {
      const e = makeBox(this.outlineRoot, n, new vec3(0, 0.3, 0), new vec3(1, 0.4, 1), green)
      this.edges.push(e)
      this.edgeVisuals.push(e.getComponent("Component.RenderMeshVisual") as RenderMeshVisual)
    }
  }

  private layoutOutline(w: number, d: number): void {
    const t = this.outlineWidthCm
    const off = t / 2 + 0.5 // sit just outside the footprint so the line stays visible
    const green = this.unlitCache.get(this.clearColor)
    const red = this.unlitCache.get(this.tooCloseColor)
    const specs = [
      {pos: new vec3(0, 0.3, d / 2 + off), size: new vec3(w + 2 * (off + t / 2), 0.4, t)},
      {pos: new vec3(w / 2 + off, 0.3, 0), size: new vec3(t, 0.4, d + 2 * (off + t / 2))},
      {pos: new vec3(0, 0.3, -d / 2 - off), size: new vec3(w + 2 * (off + t / 2), 0.4, t)},
      {pos: new vec3(-w / 2 - off, 0.3, 0), size: new vec3(t, 0.4, d + 2 * (off + t / 2))},
    ]
    for (let i = 0; i < 4; i++) {
      const tr = this.edges[i].getTransform()
      tr.setLocalPosition(specs[i].pos)
      tr.setLocalScale(specs[i].size)
      this.edgeVisuals[i].mainMaterial = this.edgeRed[i] ? red : green
    }
  }

  private buildGrab(): void {
    this.hitObj = this.group(this.pieceRoot, "PieceGrab")
    this.collider = this.hitObj.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(220, 85, 90)
    this.collider.shape = shape
    this.collider.debugDrawEnabled = this.debugColliders
    this.hitObj.createComponent(Interactable.getTypeName())
  }
}

function toLocal2(dx: number, dz: number, yaw: number): {x: number; z: number} {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {x: dx * c - dz * s, z: dx * s + dz * c}
}
