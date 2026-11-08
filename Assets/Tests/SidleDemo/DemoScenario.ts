/**
 * DEMO — scripted walkthrough for recording the hackathon video (test/demo tooling only).
 *
 * No aborting assertions: it plays a choreographed walkthrough through the real
 * UI (LEAF interactor pinches on the panel buttons, a real PieceGrab drag) and
 * logs when each scene starts and ends, then a summary with the average fps.
 *
 * Parameter `scene`: "all" (default) or 1..9 to run one scene alone.
 * Every duration lives in CONFIG below.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {awaitEventOnce, findSceneObjectByName, nextFrame, sleep, withTimeout} from "Leaf.lspkg/Utils/common/Utils"
import {InteractorTriggerType} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {SidleController} from "../../Scripts/SidleController"
import {BACKDROP_OBSTACLES, BACKDROP_START, Obstacle} from "../../Scripts/SidleGeometry"
import {BUILT_INS, bundledCatalog, cameraTransform, COFFEE, controller, footprint, levelHeadFrame, panelObj, ROOM, START, START_HEAD, visualCorners} from "../SidleLeaf/SidleTestHelpers"

// ═══ CONFIG: tune everything here (seconds unless noted; positions in room cm) ═══
const CONFIG = {
  /** Target length of each scene; a scene that finishes early holds until its target. */
  target: {1: 14, 2: 26, 3: 30, 4: 15, 5: 20, 6: 25, 7: 15, 8: 0, 9: 8} as Record<number, number>,
  startPiece: "Imported_sofa_01",
  ring: {glide: 0.45, press: 0.25, colour: new vec4(1.0, 0.96, 0.78, 1), sizePerCm: 0.012},
  s1: {hold: 3, walkCm: 30, walk: 7},
  s2: {radiusCm: 300, approach: 4, startDeg: -15, sweepDeg: 90, circle: 13, pause: 3},
  s3: {camera: 2.5, wallGapCm: 40, toWall: 5, hold: 3, back: 4, turn: 2, toTable: 6, tableHold: 3, settle: 0.5, wallAzDeg: 60, tableAzDeg: 40, tableSubjectYPct: 40},
  /** panelRaiseDeg: panel offset from after the Measure-on labels until the end of S5 (buttons on screen at the far shot), then back to panel.verticalDeg. */
  s4: {measureHold: 3, rotations: 4, rotateGap: 1, camera: 1.5, azDeg: 35, distCm: 780, panelRaiseDeg: -23},
  s5: {typePause: 2, comparePause: 2},
  /** backCm: extra distance from the pieces' centroid vs the old (0, 0) spot; aimFollow: per-frame easing of the gaze toward the moving centroid. */
  s6: {camera: 2, tabPause: 1.6, drag: 2.5, dragA: new vec3(-140, 0, 40), dragB: new vec3(130, 0, 60), afterAdd: 0.8, backCm: 125, aimFollow: 0.12},
  s7: {bigKey: "Imported_gothicbed_01", fitKey: "Imported_painted_wooden_chair_01", hold: 3, camera: 0.8, startCamera: 1},
  s9: {camera: 3},
  /** Panel during the DEMO only (restored at the end): one size step down (75%), then lowered to verticalDeg (limit -50). */
  panel: {scaleDownSteps: 1, verticalDeg: -40},
  /** Framing: shot pitch for the clearance holds, camera kept >= wallMarginCm from walls (rule: >= 40), labels checked against the central 70%. */
  frame: {pitchDeg: 27.5, subjectYPct: 32, wallMarginCm: 60, wallRuleCm: 40, centralPct: 70, sampleEveryFrames: 3},
}

/**
 * Backdrop room mode (Colorful Home living room, 520.5 x 501.9 cm, room-local: start at (0, 0),
 * open side to the hall at +Z). Only the values that differ from CONFIG; the stand-in DEMO
 * uses CONFIG alone. Same scenes, order and durations.
 */
const BD = {
  /** The open side to the hall (room-local x range at the near line); the camera may step up to intoOpeningCm into the hall (its walls stay >= 60 cm away there). */
  opening: {minX: -166.8, maxX: 168.8, intoOpeningCm: 380},
  /**
   * The camera walks continuously like a person (BdWalker): one leg per scene, from where the last
   * one left off (smooth Hermite path, or an arc around the sofa in S2), plus a slow 6 cm sway so it
   * never stands still; it eases to a stop only for a pinch (and the grab-bar panel moves). Legs are
   * room-local cm; the time is motion time (it pauses while stopped for a pinch). Peak speed of a leg
   * is about 1.5 x length / time, kept <= 14 cm/s; the gaze turns at most maxYawDegPerSec.
   */
  walk: {
    s1From: {x: 95, z: 140}, // in the hall, about 1.2 m behind the open side ("walking in through the doorway")
    s1: {x: 90, z: 0, sec: 14},
    s2: {toDeg: -8, radiusCm: 400, sec: 25.5}, // arc around the sofa, widening, ending in the opening (>= 86 cm off its edge)
    s3: {x: -55, z: 290, sec: 30}, // back out into the hall while the piece is dragged
    s4: {x: -105, z: 404, sec: 15},
    s5: {x: 40, z: 390, sec: 20},
    s6: {x: -45, z: 404, sec: 25}, // closer than the old 744 cm (hovering the far piece was slow), wide enough for all pieces
    s7: {x: -105, z: 330, sec: 12},
    s9: {x: -22, z: 372, sec: 8},
    swayCm: 4,
    swayPeriodSec: 10,
    maxYawDegPerSec: 8,
    lookTauSec: 0.5,
    brakeSec: 0.4,
    /** walking rate kept while the panel is dragged by its grab bar (0..1) */
    panelCrawl: 0.3,
  },
  /**
   * S3 from the hall, looking into the living room through its open side (the room is too small
   * for the narrow view): overview, the right-wall hold, and the pillar hold (it takes the coffee
   * table's part). The glide in from the S2 end passes the wall stub at 56 cm.
   */
  s3: {
    overview: {x: -40, z: 250, look: new vec3(25, 30, -310)},
    wall: {x: -40, z: 200, look: new vec3(80, 25, -300)},
    turnLook: new vec3(45, 30, -360),
    pillar: {x: -20, z: 200, look: new vec3(90, 25, -420)},
    /** walking camera: how far the gaze leans from the piece toward the wall / the pillar */
    wallLean: 0.25,
    pillarLean: 0.5,
  },
  /** Shot pitch for the clearance holds: flatter than the stand-in (eye 135 cm instead of 160) so the shots sit as far back. */
  pitchDeg: 19,
  s4: {azDeg: 12, distCm: 750},
  s1: {walkCm: 15},
  /** S6 pieces spread less (smaller room); the camera stands still at camX (the pieces' final centroid; a moving head drags the panel off the pinch), the gaze follows the centroid. Shorter beats: hovering the far piece before each drag takes 2-7 s at this distance, so S6 still ends on time. */
  s6: {dragA: new vec3(-45, 0, 40), dragB: new vec3(100, 0, 60), camX: -40, tabPause: 1.2, drag: 1.8, afterAdd: 0.4},
  /**
   * S7: the panel stays raised (-23°) until the end of S7 so the 153 cm tall bed and the panel's
   * door line fit in one view: camera distCm back toward the hall, gaze pitchDeg down, centred on the piece.
   */
  s7: {distCm: 620, xOffsetCm: -40, pitchDeg: 15.8},
  /** S9: wide closing view from deep in the opening, looking at the pieces. */
  s9: {z: 404},
}

/** Clearance-hold pitch for the current room mode. */
function holdPitch(): number {
  return backdrop ? BD.pitchDeg : CONFIG.frame.pitchDeg
}

const SCENE_NAMES: Record<number, string> = {
  1: "Hook",
  2: "Walk-around",
  3: "Clearance",
  4: "Measure+Rotate",
  5: "Types+Variants",
  6: "Gallery+Multi",
  7: "Door check",
  8: "VS Code (not driven)",
  9: "Closing hold",
}

function log(msg: string): void {
  print(`[SidleDemo] ${msg}`)
}

/** Ease in/out (sine): 0..1 -> 0..1. */
function ease(u: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)))
}

/** Calls fn(eased progress) every frame for `sec` seconds of wall time (frame-rate independent). */
async function animate(sec: number, fn: (e: number) => void): Promise<void> {
  const t0 = getTime()
  while (true) {
    const u = sec > 0 ? (getTime() - t0) / sec : 1
    fn(ease(u))
    if (u >= 1) return
    await nextFrame()
  }
}

function lerp3(a: vec3, b: vec3, t: number): vec3 {
  return a.add(b.sub(a).uniformScale(t))
}

// ── Room frame ────────────────────────────────────────────────────────────────

let roomT: Transform

function roomToWorld(p: vec3): vec3 {
  return roomT.getWorldTransform().multiplyPoint(p)
}
function roomDirToWorld(d: vec3): vec3 {
  return roomT.getWorldTransform().multiplyDirection(d)
}

function worldToRoom(p: vec3): vec3 {
  return roomT.getInvertedWorldTransform().multiplyPoint(p)
}

// ── Screen-space checks (viewport %, (0,0) top-left, (100,100) bottom-right) ──

const DEG = Math.PI / 180

interface ScreenBox {
  x0: number
  x1: number
  y0: number
  y1: number
  /** every point in front of the camera */
  front: boolean
  n: number
}

function cameraComp(): Camera {
  return cameraTransform().getSceneObject().getComponent("Component.Camera") as Camera
}

/** Viewport % of a world point and whether it is in front of the camera. */
function toScreen(p: vec3): {x: number; y: number; front: boolean} {
  const t = cameraTransform()
  const s = cameraComp().worldSpaceToScreenSpace(p)
  return {x: s.x * 100, y: s.y * 100, front: p.sub(t.getWorldPosition()).dot(t.back) > 0}
}

function screenBox(points: vec3[]): ScreenBox | null {
  if (!points.length) return null
  const b: ScreenBox = {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, front: true, n: points.length}
  for (const p of points) {
    const s = toScreen(p)
    b.front = b.front && s.front
    b.x0 = Math.min(b.x0, s.x)
    b.x1 = Math.max(b.x1, s.x)
    b.y0 = Math.min(b.y0, s.y)
    b.y1 = Math.max(b.y1, s.y)
  }
  return b
}

/** Box fully inside [lo, hi] % on both axes (and in front of the camera). */
function boxInside(b: ScreenBox | null, lo: number, hi: number): boolean {
  return !!b && b.front && b.x0 >= lo && b.x1 <= hi && b.y0 >= lo && b.y1 <= hi
}

/** How far (in viewport %) a box sticks out of [lo, hi]; 0 when inside. */
function boxOverflow(b: ScreenBox | null, lo: number, hi: number): number {
  if (!b) return NaN
  return Math.max(0, lo - b.x0, b.x1 - hi, lo - b.y0, b.y1 - hi)
}

function boxesOverlap(a: ScreenBox | null, b: ScreenBox | null): boolean {
  if (!a || !b || !a.front || !b.front) return false
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

/** Share (%) of box `b` covered by box `a`, on screen. */
function coverPct(a: ScreenBox | null, b: ScreenBox | null): number {
  if (!a || !b || !a.front || !b.front) return 0
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
  const area = Math.max(1e-6, (b.x1 - b.x0) * (b.y1 - b.y0))
  return (100 * w * h) / area
}

function fmtBox(b: ScreenBox | null): string {
  if (!b) return "none"
  return `x ${b.x0.toFixed(1)}..${b.x1.toFixed(1)}%, y ${b.y0.toFixed(1)}..${b.y1.toFixed(1)}%${b.front ? "" : " (partly behind camera)"}`
}

/** Visual corners of a named object (enabled parts only); [] if missing or hidden. */
function cornersOf(name: string): vec3[] {
  const so = findSceneObjectByName(name)
  if (!so || !so.isEnabledInHierarchy) return []
  return visualCorners(so, true)
}

function centralLo(): number {
  return (100 - CONFIG.frame.centralPct) / 2
}
function centralHi(): number {
  return 100 - centralLo()
}

// ── Head (preview camera) ─────────────────────────────────────────────────────

interface Pose {
  x: number
  z: number
  look: vec3 // room-local point the head looks at (the subject)
  /** true: subject at the viewport centre; otherwise it sits at subjectYPct (default CONFIG.frame.subjectYPct) from the top (panel below it). */
  center?: boolean
  subjectYPct?: number
}

/** Extra downward tilt (deg) that puts a looked-at subject at `pct` (default CONFIG.frame.subjectYPct) from the top of the viewport. */
function subjectTiltDeg(pct: number = CONFIG.frame.subjectYPct): number {
  const halfFov = cameraComp().fov / 2
  return Math.atan(((50 - pct) / 50) * Math.tan(halfFov)) / DEG
}

/** Holds the camera at a room-local pose (tracking off, pose re-applied every frame); stop() restores it. */
class DemoHead {
  pose: Pose
  eyeY: number
  private active = true
  private readonly origPos: vec3
  private readonly origRot: quat
  private readonly tracking: Component | null
  private readonly trackingWasEnabled: boolean

  /** true: the preview head drives the camera (backdrop replay); this only reads the pose, never sets the camera. */
  readonly external: boolean

  constructor(eyeY: number, pose: Pose, external: boolean = false) {
    const t = cameraTransform()
    this.origPos = t.getWorldPosition()
    this.origRot = t.getWorldRotation()
    this.tracking = t.getSceneObject().getComponent("Component.DeviceTracking") as Component | null
    this.trackingWasEnabled = !!this.tracking && this.tracking.enabled
    this.external = external
    if (this.tracking && !external) this.tracking.enabled = false
    this.eyeY = eyeY
    this.pose = pose
    if (external) this.readPose()
    else this.apply()
    this.loop()
  }

  /** External mode: the pose (room-local) from the actual camera, looking 300 cm ahead. */
  private readPose(): void {
    const t = cameraTransform()
    const pos = worldToRoom(t.getWorldPosition())
    const look = worldToRoom(t.getWorldPosition().add(t.back.uniformScale(300)))
    this.pose = {x: pos.x, z: pos.z, look}
  }

  set(p: Pose): void {
    if (this.external) return
    this.pose = p
    if (!this.gliding) this.tiltMix = p.center ? 0 : 1
    this.apply()
  }

  private gliding = false

  /** Eased glide (position and gaze target) to `to` over `sec`. */
  async glide(to: Pose, sec: number): Promise<void> {
    if (this.external) {
      await sleep(sec * 1000)
      return
    }
    const from = this.pose
    // The subject's screen height eases from the old framing to the new one with the move.
    const t0 = from.center ? 0 : 1
    const t1 = to.center ? 0 : 1
    this.gliding = true
    try {
      await animate(sec, (e) => {
        this.tiltMix = t0 + (t1 - t0) * e
        this.set({x: from.x + (to.x - from.x) * e, z: from.z + (to.z - from.z) * e, look: lerp3(from.look, to.look, e), center: to.center, subjectYPct: to.subjectYPct})
      })
    } finally {
      this.gliding = false
    }
    this.tiltMix = t1
  }

  /** 1 = subject at CONFIG.frame.subjectYPct, 0 = centred; eased during glides. */
  private tiltMix = 1

  /** Current downward gaze angle (deg) of the camera. */
  pitchDownDeg(): number {
    const b = cameraTransform().back
    return Math.asin(Math.max(-1, Math.min(1, -b.y))) / DEG
  }

  async stop(): Promise<void> {
    this.active = false
    await nextFrame()
    if (this.external) return
    const t = cameraTransform()
    t.setWorldPosition(this.origPos)
    t.setWorldRotation(this.origRot)
    if (this.tracking) this.tracking.enabled = this.trackingWasEnabled
  }

  private apply(): void {
    const pos = roomToWorld(new vec3(this.pose.x, this.eyeY, this.pose.z))
    const d = roomToWorld(this.pose.look).sub(pos)
    const yaw = Math.atan2(d.x, -d.z) // > 0 turns right
    // Look a little below the subject so it sits above centre and the panel has the lower part of the view.
    const pitch = Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z)) - subjectTiltDeg(this.pose.subjectYPct) * DEG * this.tiltMix
    const rot = quat.angleAxis(-yaw, vec3.up()).multiply(quat.angleAxis(pitch, vec3.right()))
    const t = cameraTransform()
    t.setWorldPosition(pos)
    t.setWorldRotation(rot)
  }

  private async loop(): Promise<void> {
    while (this.active) {
      if (this.external) this.readPose()
      else this.apply()
      await nextFrame()
    }
  }
}

// ── Visible pointer ring ──────────────────────────────────────────────────────

class PointerRing {
  private so: SceneObject
  private pos: vec3
  private target: (() => vec3) | null = null
  private pressScale = 1
  private active = true

  constructor(template: RenderMeshVisual, colour: vec4) {
    this.so = global.scene.createSceneObject("DemoPointerRing")
    this.so.layer = template.getSceneObject().layer
    const rmv = this.so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = PointerRing.annulus(0.72, 1.0, 48)
    const mat = template.mainMaterial.clone()
    mat.mainPass.baseColor = colour
    try {
      mat.mainPass.depthTest = false
      mat.mainPass.twoSided = true
    } catch (e) {
      // not every material exposes these; the ring is still drawn
    }
    rmv.mainMaterial = mat
    const cam = cameraTransform()
    this.pos = cam.getWorldPosition().add(cam.back.uniformScale(45)).add(cam.down.uniformScale(12))
    this.loop()
  }

  /** Glide to a (possibly moving) point, then stay on it. */
  async glideTo(getTarget: () => vec3, sec: number): Promise<void> {
    this.target = null
    const from = this.pos
    await animate(sec, (e) => {
      this.pos = lerp3(from, getTarget(), e)
    })
    this.target = getTarget
  }

  /** Shrink briefly (the "press"); runs alongside the pinch. */
  async press(sec: number): Promise<void> {
    await animate(sec, (e) => {
      this.pressScale = 1 - 0.45 * Math.sin(Math.PI * e)
    })
    this.pressScale = 1
  }

  destroy(): void {
    this.active = false
    if (this.so) this.so.destroy()
  }

  private async loop(): Promise<void> {
    while (this.active) {
      if (this.target) this.pos = this.target()
      const camPos = cameraTransform().getWorldPosition()
      const toCam = camPos.sub(this.pos)
      const dist = Math.max(10, toCam.length)
      const t = this.so.getTransform()
      // 1 cm toward the camera so it sits in front of the button / piece.
      t.setWorldPosition(this.pos.add(toCam.normalize().uniformScale(1)))
      t.setWorldRotation(quat.lookAt(toCam.normalize(), vec3.up()))
      const s = dist * CONFIG.ring.sizePerCm * this.pressScale
      t.setWorldScale(new vec3(s, s, s))
      await nextFrame()
    }
  }

  /** Flat ring in the XY plane, both windings so it shows from either side. */
  private static annulus(rIn: number, rOut: number, seg: number): RenderMesh {
    const mb = new MeshBuilder([
      {name: "position", components: 3},
      {name: "normal", components: 3},
      {name: "texture0", components: 2},
    ])
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    const v: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      v.push(c * rIn, s * rIn, 0, 0, 0, 1, i / seg, 0)
      v.push(c * rOut, s * rOut, 0, 0, 0, 1, i / seg, 1)
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3)
      idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
    }
    mb.appendVerticesInterleaved(v)
    mb.appendIndices(idx)
    mb.updateMesh()
    return mb.getMesh()
  }
}

// ── Interactor with a time-based eased drag ──────────────────────────────────

class DemoInteractor extends DefaultLeafInteractor {
  /**
   * Pinch `target` and move the pinch ray by `worldOffset` along an eased,
   * time-based path over `sec` (the stock LEAF drag adds a fixed vector per frame).
   */
  async dragEased(target: Interactable, worldOffset: vec3, sec: number): Promise<void> {
    await this.enterHover(target)
    await nextFrame()
    const s0 = this.startPoint
    const e0 = this.endPoint
    const started = awaitEventOnce(target.onTriggerStart)
    this.setTriggerType(InteractorTriggerType.Select)
    await withTimeout(started, 2000, "drag: no trigger start")
    let prev = vec3.zero()
    await animate(sec, (e) => {
      const o = worldOffset.uniformScale(e)
      this.startPoint = s0.add(o)
      this.endPoint = e0.add(o)
      this.overrideDragVector = o.sub(prev)
      prev = o
    })
    await nextFrame()
    this.setTriggerType(InteractorTriggerType.None)
    await nextFrame()
    await nextFrame()
    this.overrideDragVector = undefined
    this.resetStartEndPoint()
    await this.exitHover()
  }
}

// ── Room mode helpers ─────────────────────────────────────────────────────────

interface Box {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function boxOf(o: Obstacle): Box {
  return {minX: o.cx - o.w / 2, maxX: o.cx + o.w / 2, minZ: o.cz - o.d / 2, maxZ: o.cz + o.d / 2}
}

/** Horizontal distance from (x, z) to a box (0 inside). */
function boxDist(x: number, z: number, b: Box): number {
  const dx = Math.max(0, b.minX - x, x - b.maxX)
  const dz = Math.max(0, b.minZ - z, z - b.maxZ)
  return Math.sqrt(dx * dx + dz * dz)
}

let backdrop = false
/**
 * Backdrop replay (DEMO parameter head = "preview"): the PREVIEW head is driven by the editor
 * replay script (tools/demo/play_demo.ts) along Assets/Tests/SidleDemo/DemoPath.json, so the
 * Colorful Home backdrop moves with it; the Lens only reads the camera pose. The walker still runs
 * as a timing shadow so pinches happen at the same moments as in the recording.
 */
let previewHead = false
/** DEMO parameter record = "1": log the camera's world pose every frame ([SidlePath] lines) for the path file. */
let recordPath = false

/** Post a message to the Lens Studio editor (the replay script listens); no-op outside the editor. */
function postEditor(msg: any): void {
  try {
    // @ts-ignore Editor exists only when running inside Lens Studio
    if (typeof Editor !== "undefined" && Editor.context) Editor.context.postMessage(msg)
  } catch (e) {
    // not in the editor
  }
}

/** The obstacle box the S3 second hold drives into: the coffee table (stand-in) or the pillar, clipped to the room (backdrop). */
function holdBox(): Box {
  if (!backdrop) return {minX: COFFEE.minX, maxX: COFFEE.maxX, minZ: COFFEE.minZ, maxZ: COFFEE.maxZ}
  const b = boxOf(BACKDROP_OBSTACLES[0])
  return {minX: b.minX, maxX: Math.min(b.maxX, ROOM.maxX), minZ: Math.max(b.minZ, ROOM.minZ), maxZ: b.maxZ}
}
function holdName(): "CoffeeTable" | "Pillar" {
  return backdrop ? "Pillar" : "CoffeeTable"
}

/**
 * Camera distance (room-local cm) to the nearest wall. Stand-in: the four wall lines.
 * Backdrop: the living-room walls, the pillar and the wall stub; at the open side only
 * the opening's edges count (the camera may step into the opening).
 */
function cameraWallCm(x: number, z: number): number {
  if (!backdrop) return Math.min(x - ROOM.minX, ROOM.maxX - x, z - ROOM.minZ, ROOM.maxZ - z)
  let d = z <= ROOM.maxZ ? Math.min(x - ROOM.minX, ROOM.maxX - x, z - ROOM.minZ) : Math.min(x - BD.opening.minX, BD.opening.maxX - x)
  for (const o of BACKDROP_OBSTACLES) d = Math.min(d, boxDist(x, z, boxOf(o)))
  return d
}

/** Keeps a camera position `m` cm off every wall (backdrop: may step into the opening, pushed off the pillar and stub). */
function clampCamera(x: number, z: number, m: number): {x: number; z: number} {
  x = Math.min(ROOM.maxX - m, Math.max(ROOM.minX + m, x))
  if (!backdrop) return {x, z: Math.min(ROOM.maxZ - m, Math.max(ROOM.minZ + m, z))}
  const inOpening = x >= BD.opening.minX + m && x <= BD.opening.maxX - m
  z = Math.min(inOpening ? ROOM.maxZ + BD.opening.intoOpeningCm : ROOM.maxZ - m, Math.max(ROOM.minZ + m, z))
  for (const o of BACKDROP_OBSTACLES) {
    const b = boxOf(o)
    if (boxDist(x, z, b) >= m) continue
    // Push out along the cheaper axis.
    const px = x < (b.minX + b.maxX) / 2 ? b.minX - m - x : b.maxX + m - x
    const pz = z < (b.minZ + b.maxZ) / 2 ? b.minZ - m - z : b.maxZ + m - z
    if (Math.abs(px) < Math.abs(pz)) x += px
    else z += pz
  }
  return {x, z}
}

// ── Backdrop walking camera ───────────────────────────────────────────────────

interface P2 {
  x: number
  z: number
}

function smooth01(u: number): number {
  const t = Math.max(0, Math.min(1, u))
  return t * t * (3 - 2 * t)
}

/**
 * Backdrop DEMO camera: walks one leg at a time like a person (no flying), with a slow sway so it
 * never stands still, and a motion clock that eases to a stop for a pinch (brake/resume). The gaze
 * eases toward its target, turning at most BD.walk.maxYawDegPerSec.
 */
class BdWalker {
  /** motion time (s): advances with the walking rate */
  tau = 0
  private rate = 1
  private rateTarget = 1
  private kind: "line" | "arc" | "steady" = "line"
  private t0 = 0
  private dur = 0
  private p0: P2
  private v0: P2 = {x: 0, z: 0}
  private p1: P2
  private c: P2 = {x: 0, z: 0}
  private a0 = 0
  private a1 = 0
  private r0 = 0
  private r1 = 0
  cam: P2
  look: vec3
  private desired: vec3
  private lookFn: (() => vec3) | null = null

  constructor(start: P2, look: vec3) {
    this.p0 = {...start}
    this.p1 = {...start}
    this.cam = {...start}
    this.look = look
    this.desired = look
  }

  private base(t: number): P2 {
    const u = this.dur > 0 ? Math.max(0, Math.min(1, (t - this.t0) / this.dur)) : 1
    if (this.kind === "arc") {
      const e = smooth01(u)
      const a = this.a0 + (this.a1 - this.a0) * e
      const r = this.r0 + (this.r1 - this.r0) * e
      return {x: this.c.x + r * Math.sin(a), z: this.c.z + r * Math.cos(a)}
    }
    if (this.kind === "steady") {
      // Ramp up, steady speed, ramp down (ramps of R s): peak speed = length / (dur - R).
      const D = this.dur
      const R = Math.min(1.5, D / 8)
      const t1 = u * D
      const vp = 1 / (D - R)
      let f: number
      if (t1 < R) f = (vp * t1 * t1) / (2 * R)
      else if (t1 > D - R) f = 1 - (vp * (D - t1) * (D - t1)) / (2 * R)
      else f = vp * (t1 - R / 2)
      return {x: this.p0.x + (this.p1.x - this.p0.x) * f, z: this.p0.z + (this.p1.z - this.p0.z) * f}
    }
    const h00 = 2 * u * u * u - 3 * u * u + 1
    const h10 = u * u * u - 2 * u * u + u
    const h01 = -2 * u * u * u + 3 * u * u
    const D = this.dur
    return {x: h00 * this.p0.x + h10 * D * this.v0.x + h01 * this.p1.x, z: h00 * this.p0.z + h10 * D * this.v0.z + h01 * this.p1.z}
  }

  private baseVel(t: number): P2 {
    const a = this.base(t - 0.02)
    const b = this.base(t + 0.02)
    if (t - 0.02 < this.t0 || t + 0.02 > this.t0 + this.dur) return {x: 0, z: 0}
    return {x: (b.x - a.x) / 0.04, z: (b.z - a.z) / 0.04}
  }

  /**
   * Walk to (x, z) over `sec` of motion time from the current position: a steady walk (ramp up, steady,
   * ramp down) when starting from rest or `steady`, else a smooth curve that continues the current velocity.
   */
  walkTo(x: number, z: number, sec: number, steady: boolean = false): void {
    const p = this.base(this.tau)
    this.v0 = this.baseVel(this.tau)
    this.kind = steady || Math.sqrt(this.v0.x * this.v0.x + this.v0.z * this.v0.z) < 1 ? "steady" : "line"
    this.p0 = p
    this.p1 = {x, z}
    this.t0 = this.tau
    this.dur = sec
  }

  /** Arc around (cx, cz) to azimuth toDeg (0 = +Z side) at radius r over `sec` of motion time. */
  arcAround(cx: number, cz: number, toDeg: number, r: number, sec: number): void {
    const p = this.base(this.tau)
    this.kind = "arc"
    this.c = {x: cx, z: cz}
    this.a0 = Math.atan2(p.x - cx, p.z - cz)
    this.r0 = Math.sqrt((p.x - cx) ** 2 + (p.z - cz) ** 2)
    this.a1 = toDeg * DEG
    this.r1 = r
    this.t0 = this.tau
    this.dur = sec
  }

  lookAt(v: vec3): void {
    this.lookFn = null
    this.desired = v
  }

  follow(fn: () => vec3): void {
    this.lookFn = fn
  }

  /** Ease down to `to` (0 = stop) over about BD.walk.brakeSec; resolves once there. */
  async brake(to: number = 0): Promise<void> {
    this.rateTarget = to
    const t0 = getTime()
    while (this.rate > to && getTime() - t0 < 1.0) await nextFrame()
  }

  resume(): void {
    this.rateTarget = 1
  }

  /** Advance one frame; returns the camera position (room-local) and the eased look target. */
  update(dt: number): {x: number; z: number; look: vec3} {
    const k = BD.walk
    const step = dt / k.brakeSec
    this.rate = Math.max(0, Math.min(1, this.rate + Math.max(-step, Math.min(step, this.rateTarget - this.rate))))
    const e = smooth01(this.rate)
    this.tau += dt * e
    const b = this.base(this.tau)
    const w = (2 * Math.PI) / k.swayPeriodSec
    const x = b.x + k.swayCm * Math.sin(w * this.tau)
    const z = b.z + k.swayCm * (1 - Math.cos(w * this.tau))
    this.cam = {x, z}
    const want = this.lookFn ? this.lookFn() : this.desired
    const eye = new vec3(x, 0, z)
    const d0 = this.look.sub(eye).normalize()
    const d1 = want.sub(eye).normalize()
    const ang = Math.acos(Math.max(-1, Math.min(1, d0.dot(d1)))) / DEG
    if (ang > 1e-4) {
      const f = Math.min(1, (dt * e) / k.lookTauSec, (k.maxYawDegPerSec * dt * e) / ang)
      this.look = lerp3(this.look, want, f)
    } else this.look = want
    return {x, z, look: this.look}
  }
}

// ── Scenario ──────────────────────────────────────────────────────────────────

interface SceneRecord {
  n: number
  start: number
  end: number
  frames: number
  /** closest the camera came to any wall during the scene (cm, room-local) */
  minWallCm: number
  /** sampled frames with the whole current piece inside the viewport / all samples */
  pieceIn: number
  samples: number
  /** sampled frames with every placed piece and the current piece fully in the viewport */
  allIn: number
  /** largest share of the current piece box covered by the panel box (sampled, %) */
  maxCover: number
  /** pinch/drag ring positions in the viewport this scene (%) */
  ring: {x0: number; x1: number; y0: number; y1: number; n: number}
  /** backdrop walking camera: travel (cm), total yaw change (deg), longest still period (s), peak speed (cm/s), peak turn rate (deg/s) */
  motion: {travel: number; yaw: number; still: number; maxSpeed: number; maxYawRate: number}
}

@component
export class DemoScenario extends Scenario {
  private c: SidleController
  private it: DemoInteractor
  private head: DemoHead
  private ring: PointerRing
  private T0 = 0
  private frames = 0
  private sceneStart = 0
  private startPose: Pose
  private minWall = Infinity
  private pieceIn = 0
  private samples = 0
  private allIn = 0
  private maxCover = 0
  private ringExt = {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, n: 0}
  private walker: BdWalker | null = null
  /** Backdrop: running pinch number (recording and replay count the same pinches). */
  private pinchIdx = 0
  private mot = {travel: 0, yaw: 0, still: 0, stillCur: 0, maxSpeed: 0, maxYawRate: 0}
  private lastCam: {x: number; z: number; yaw: number} | null = null
  private sceneN = 0
  private followCentroid = false
  /** Backdrop S5: the gaze eases toward the current piece (types and variants differ in size and get nudged). */
  private followPiece = false
  private dimsByKey: {[key: string]: {w: number; d: number; h: number}} = {}

  async run(config?: ScenarioConfig): Promise<void> {
    const raw = (config?.get("scene") ?? "all").trim().toLowerCase()
    const only = raw === "all" || raw === "" || raw === "0" ? 0 : Number(raw)
    const scenes = only >= 1 && only <= 9 ? [only] : [1, 2, 3, 4, 5, 6, 7, 8, 9]
    log(`DEMO start, scene=${raw} -> ${scenes.join(",")}`)
    previewHead = (config?.get("head") ?? "walker").trim().toLowerCase() === "preview"
    recordPath = (config?.get("record") ?? "0").trim() === "1"

    await this.setup()
    if (!backdrop) previewHead = false // the stand-in DEMO always drives the camera itself
    log(`head driver: ${previewHead ? "preview head (editor replay)" : "Lens camera (walker)"}${recordPath ? ", recording the path" : ""}`)
    const frameEvt = this.createEvent("UpdateEvent")
    frameEvt.bind(() => this.onFrame())
    const records: SceneRecord[] = []
    try {
      if (scenes.length === 1) await this.prepAlone(scenes[0])
      this.T0 = getTime()
      this.frames = 0
      postEditor({type: "SidleDemoStart"})
      for (const n of scenes) records.push(await this.playScene(n))
    } catch (e) {
      log(`ERROR (demo stopped early): ${e}`)
    } finally {
      frameEvt.enabled = false
      this.summary(records)
      this.ring.destroy()
      await this.head.stop()
      this.c.resetPanelScale()
      this.c.resetPanelOffset()
      log(`DEMO done (pointer ring removed, camera tracking restored, panel back to ${this.c.panelScale * 100}% at ${this.fmtOffset()})`)
    }
  }

  /** Per frame: frame count, closest wall distance of the camera, and (sampled) whether the whole piece is in view. */
  private onFrame(): void {
    this.frames++
    if (!this.head) return
    if (backdrop && this.walker) this.walkFrame()
    const p = this.head.pose
    const wall = cameraWallCm(p.x, p.z)
    this.minWall = Math.min(this.minWall, wall)
    if (this.followCentroid && !backdrop) {
      const cen = this.centroid()
      this.head.set({...p, look: lerp3(p.look, cen, CONFIG.s6.aimFollow)})
    }
    if (this.followPiece && !backdrop) {
      const q = this.c.piecePosition
      this.head.set({...p, look: lerp3(p.look, new vec3(q.x, this.c.currentDims.h / 2, q.z), CONFIG.s6.aimFollow)})
    }
    if (this.frames % CONFIG.frame.sampleEveryFrames === 0) {
      this.samples++
      const piece = screenBox(this.pieceCorners())
      if (boxInside(piece, 0, 100)) this.pieceIn++
      if ((this.sceneN === 6 || (backdrop && this.sceneN === 9)) && this.allPiecesCorners().every((pts) => boxInside(screenBox(pts), 0, 100))) this.allIn++
      if (this.sceneN === 4 || this.sceneN === 5) this.maxCover = Math.max(this.maxCover, coverPct(screenBox(visualCorners(panelObj(this.c), true)), piece))
    }
  }

  /** Backdrop: one walker step (head pose) and the motion metrics (travel, yaw, still periods, peak speed and turn rate). */
  private walkFrame(): void {
    const dt = Math.max(1e-4, getDeltaTime())
    const wk = this.walker!.update(dt)
    if (!previewHead) this.head.set({x: wk.x, z: wk.z, look: wk.look})
    // Metrics from the actual camera (in replay the preview head moves it, not the walker).
    const t = cameraTransform()
    const cp = worldToRoom(t.getWorldPosition())
    const cf = worldToRoom(t.getWorldPosition().add(t.back.uniformScale(100))).sub(cp)
    const w = {x: cp.x, z: cp.z}
    const yaw = Math.atan2(cf.x, -cf.z) / DEG
    if (recordPath && this.T0 > 0) {
      const wp = t.getWorldPosition()
      const f = t.back
      const wyaw = Math.atan2(-f.x, -f.z) / DEG
      const wpitch = Math.asin(Math.max(-1, Math.min(1, f.y))) / DEG
      print(`[SidlePath] ${(getTime() - this.T0).toFixed(3)} ${wp.x.toFixed(2)} ${wp.y.toFixed(2)} ${wp.z.toFixed(2)} ${wyaw.toFixed(3)} ${wpitch.toFixed(3)} ${this.sceneN} ${this.walker!.tau.toFixed(4)}`)
    }

    if (this.sceneN > 0 && this.lastCam) {
      const d = Math.sqrt((w.x - this.lastCam.x) ** 2 + (w.z - this.lastCam.z) ** 2)
      let dy = yaw - this.lastCam.yaw
      dy = ((dy + 540) % 360) - 180
      const m = this.mot
      m.travel += d
      m.yaw += Math.abs(dy)
      const v = d / dt
      const yr = Math.abs(dy) / dt
      if (dt < 0.2) {
        m.maxSpeed = Math.max(m.maxSpeed, v)
        m.maxYawRate = Math.max(m.maxYawRate, yr)
      }
      if (dt > 0.25) {
        // a frame hitch (e.g. a model loading), not the camera standing still
      } else if (v < 1 && yr < 1) {
        m.stillCur += dt
        m.still = Math.max(m.still, m.stillCur)
      } else m.stillCur = 0
    }
    this.lastCam = {x: w.x, z: w.z, yaw}
  }

  /** Corner sets of every placed piece and the current piece (catalog sizes, current yaws). */
  private allPiecesCorners(): vec3[][] {
    const out: vec3[][] = [this.pieceCorners()]
    for (const pp of this.c.placedPieces) {
      const dims = this.dimsByKey[pp.key]
      if (!dims) continue
      const pts: vec3[] = []
      for (const q of footprint(pp.x, pp.z, dims.w, dims.d, pp.yawDeg)) pts.push(roomToWorld(new vec3(q.x, 0, q.z)), roomToWorld(new vec3(q.x, dims.h, q.z)))
      out.push(pts)
    }
    return out
  }

  /** Room-local centroid (at 40 cm) of every placed piece and the current one. */
  private centroid(): vec3 {
    const c = this.c
    let x = c.piecePosition.x
    let z = c.piecePosition.z
    for (const pp of c.placedPieces) {
      x += pp.x
      z += pp.z
    }
    const n = 1 + c.placedPieces.length
    return new vec3(x / n, 40, z / n)
  }

  /** World corners of the current piece's box: its footprint (catalog W x D, current yaw) from the floor to its height. */
  private pieceCorners(): vec3[] {
    const c = this.c
    const p = c.piecePosition
    const dims = c.currentDims
    const out: vec3[] = []
    for (const q of footprint(p.x, p.z, dims.w, dims.d, c.rotationDeg)) {
      out.push(roomToWorld(new vec3(q.x, 0, q.z)), roomToWorld(new vec3(q.x, dims.h, q.z)))
    }
    return out
  }

  private fmtOffset(): string {
    const o = this.c.panelOffset
    return `${o.distanceCm.toFixed(1)} cm, h ${o.horizontalDeg.toFixed(1)}°, v ${o.verticalDeg.toFixed(1)}°`
  }

  /**
   * Screen-space report: current piece (fully in viewport?), footprint outline, gap
   * number and panel boxes in viewport %, and whether the panel overlaps any of them.
   */
  private report(tag: string): void {
    const piece = screenBox(this.pieceCorners())
    const outline = screenBox(cornersOf("FloorOutline"))
    const gap = screenBox(cornersOf("GapLabel"))
    const panel = screenBox(visualCorners(panelObj(this.c), true))
    log(`${tag}: piece ${fmtBox(piece)} fully in viewport=${boxInside(piece, 0, 100)}`)
    log(`${tag}: outline ${fmtBox(outline)}; gap number ${fmtBox(gap)}; panel ${fmtBox(panel)}`)
    log(`${tag}: panel overlaps piece=${boxesOverlap(panel, piece)} outline=${boxesOverlap(panel, outline)} gap number=${boxesOverlap(panel, gap)}`)
  }

  /** One label's box and whether it is inside the central CONFIG.frame.centralPct % (logs the overflow if not). */
  private labelCheck(tag: string, name: string): void {
    const b = screenBox(cornersOf(name))
    const lo = centralLo()
    const hi = centralHi()
    const inside = boxInside(b, lo, hi)
    const c = b ? `centre (${((b.x0 + b.x1) / 2).toFixed(1)}%, ${((b.y0 + b.y1) / 2).toFixed(1)}%)` : "not shown"
    log(`${tag}: ${name} ${c}, box ${fmtBox(b)}, inside central ${CONFIG.frame.centralPct}%=${inside}${inside || !b ? "" : ` (out by ${boxOverflow(b, lo, hi).toFixed(1)}%)`}`)
  }

  /**
   * Room-local pose whose gaze points pitchDeg below level, with `aim` at CONFIG.frame.subjectYPct
   * from the top of the view, coming from azimuth azDeg (0 = from +Z, 90 = from -X), kept off the walls.
   */
  private shotPose(aim: vec3, azDeg: number, pitchDeg: number, subjectYPct?: number): Pose {
    const elev = pitchDeg - subjectTiltDeg(subjectYPct) // angle down from the eye to the subject itself
    const pose = this.poseAt(aim, azDeg, (this.head.eyeY - aim.y) / Math.tan(elev * DEG))
    pose.subjectYPct = subjectYPct
    return pose
  }

  /** Room-local pose `d` cm (horizontal) from `aim` at azimuth azDeg, looking at it, kept off the walls. */
  private poseAt(aim: vec3, azDeg: number, d: number): Pose {
    const m = CONFIG.frame.wallMarginCm
    const x0 = aim.x - d * Math.sin(azDeg * DEG)
    const z0 = aim.z + d * Math.cos(azDeg * DEG)
    const {x, z} = clampCamera(x0, z0, m)
    if (x !== x0 || z !== z0) log(`shot: camera clamped from (${x0.toFixed(0)}, ${z0.toFixed(0)}) to (${x.toFixed(0)}, ${z.toFixed(0)}) to stay ${m} cm off the walls`)
    return {x, z, look: aim}
  }

  /** The gap number's room-local position, or null if it is not shown. */
  private gapLabelRoom(): vec3 | null {
    const so = findSceneObjectByName("GapLabel")
    if (!so || !so.isEnabledInHierarchy) return null
    return worldToRoom(so.getTransform().getWorldPosition())
  }

  /**
   * Re-aim the shot at the middle of the actual gap number and the given room-local points
   * (facing edge, obstacle), same pitch and azimuth.
   */
  private async settleOnGap(azDeg: number, sec: number, extra: vec3[] = [], subjectYPct?: number): Promise<void> {
    const L = this.gapLabelRoom()
    if (!L) {
      log("settle: gap number not shown, shot kept")
      return
    }
    const pts = [L].concat(extra)
    let aim = vec3.zero()
    for (const q of pts) aim = aim.add(q)
    aim = aim.uniformScale(1 / pts.length)
    // Height: midway between the floor and the highest point (the gap number may be lifted).
    aim = new vec3(aim.x, Math.max(...pts.map((q) => q.y)) / 2, aim.z)
    await this.head.glide(this.shotPose(aim, azDeg, holdPitch(), subjectYPct), sec)
  }

  /** Room-local points of the facing edge and the obstacle face at a clearance hold (piece at 0° in S3). */
  private facingPoints(obstacle: "RightWall" | "CoffeeTable" | "Pillar"): {edge: vec3[]; face: vec3[]} {
    const pos = this.c.piecePosition
    const w = this.c.currentDims.w / 2
    const d = this.c.currentDims.d / 2
    if (obstacle === "RightWall") {
      return {
        edge: [new vec3(pos.x + w, 0, pos.z - d), new vec3(pos.x + w, 0, pos.z + d)],
        face: [new vec3(ROOM.maxX, 0, pos.z - d), new vec3(ROOM.maxX, 0, pos.z + d), new vec3(ROOM.maxX, 45, pos.z)],
      }
    }
    // The part of the back edge that faces the table (pillar), and its front over the same x-range.
    const B = holdBox()
    const x0 = Math.max(B.minX, pos.x - w)
    const x1 = Math.min(B.maxX, pos.x + w)
    return {
      edge: [new vec3(x0, 0, pos.z - d), new vec3(x1, 0, pos.z - d)],
      face: [new vec3(x0, 0, B.maxZ), new vec3(x1, 0, B.maxZ), new vec3((x0 + x1) / 2, 45, B.maxZ)],
    }
  }

  /** Move the panel through its grab bar (real drag) to about `targetDeg` (vertical offset), up or down. */
  private async movePanelTo(targetDeg: number): Promise<void> {
    const bar = findInteractableByName("PanelGrabBar")
    if (!bar) {
      log("panel: PanelGrabBar not found, offset kept")
      return
    }
    if (backdrop && this.walker) {
      // A slow crawl, not a stop, while the grab bar is dragged (a few cm over the move).
      await this.walker.brake(BD.walk.panelCrawl)
      try {
        await this.movePanelSteps(bar, targetDeg)
      } finally {
        this.walker.resume()
      }
      return
    }
    await this.movePanelSteps(bar, targetDeg)
  }

  private async movePanelSteps(bar: Interactable, targetDeg: number): Promise<void> {
    for (let i = 0; i < 8 && Math.abs(this.c.panelOffset.verticalDeg - targetDeg) > 0.5; i++) {
      const o = this.c.panelOffset
      // Move the held point along the sphere around the head (same distance, lower angle).
      const D = o.distanceCm
      const f = levelHeadFrame()
      const v = f.fwd
        .uniformScale(D * (Math.cos(targetDeg * DEG) - Math.cos(o.verticalDeg * DEG)))
        .add(vec3.up().uniformScale(D * (Math.sin(targetDeg * DEG) - Math.sin(o.verticalDeg * DEG))))
      try {
        await this.it.dragEased(bar, v, 0.4)
      } catch (e) {
        log(`panel: drag did not complete (${e})`)
        break
      }
      await nextFrame()
    }
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  private async setup(): Promise<void> {
    const c = (this.c = controller())
    backdrop = c.mode === "backdrop"
    roomT = findSceneObjectByName("VirtualRoom")!.getTransform()
    if (c.galleryOpen) c.closeGallery()
    if (c.isDragging) c.endDrag()
    let g = 0
    while (c.canRemove && g++ < 10) c.removePiece()
    c.setShowPlaceholderPieces(false)
    if (c.currentPieceKey !== CONFIG.startPiece) {
      c.openGallery()
      if (!c.selectFromGallery(CONFIG.startPiece)) log(`setup: ${CONFIG.startPiece} not offered, keeping ${c.currentPieceKey}`)
    }
    g = 0
    while (c.rotationDeg > 0.01 && c.rotationDeg < 359.99 && g++ < 30) c.rotateLeft()
    if (c.measureOn) c.toggleMeasure()
    if (c.currentColorIndex !== 0) c.setColor(0)
    // The Lens's own start spot: the room centre (stand-in), about 300 cm ahead (backdrop).
    if (backdrop) c.setPiecePosition(BACKDROP_START.x, BACKDROP_START.z)
    else c.setPiecePosition(START.x, START.z)

    // Camera at the normal start (room-local (0, 0), about 1 m inside the doorway), facing the sofa.
    const inv = roomT.getInvertedWorldTransform()
    const camRoom = inv.multiplyPoint(START_HEAD.pos)
    this.startPose = backdrop ? {x: BD.walk.s1From.x, z: BD.walk.s1From.z, look: this.sofaLook()} : {x: camRoom.x, z: camRoom.z, look: this.sofaLook()}
    this.head = new DemoHead(camRoom.y, this.startPose, backdrop && previewHead)
    if (backdrop) {
      this.walker = new BdWalker({x: this.startPose.x, z: this.startPose.z}, this.sofaLook())
      log(`setup: DEMO head starts in the hall at (${this.startPose.x}, ${this.startPose.z}), ${Math.sqrt((this.startPose.x - c.piecePosition.x) ** 2 + (this.startPose.z - c.piecePosition.z) ** 2).toFixed(0)} cm from the sofa`)
    }
    await nextFrame()
    c.resetPanelOffset()
    c.resetPanelScale()

    for (const b of BUILT_INS) this.dimsByKey[b.key] = {w: b.w, d: b.d, h: b.h}
    for (const e of bundledCatalog()) this.dimsByKey[`Imported_${e.id}`] = {w: e.widthCm, d: e.depthCm, h: e.heightCm}

    this.it = new DemoInteractor("DemoInteractor")
    const edge = findSceneObjectByName("Edge_Front")!.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.ring = new PointerRing(edge, CONFIG.ring.colour)

    // Panel for the DEMO: smaller and lower (existing size steps and grab-bar offset, inside the limits).
    for (let i = 0; i < CONFIG.panel.scaleDownSteps; i++) c.panelScaleDown()
    await sleep(200)
    await this.movePanelTo(CONFIG.panel.verticalDeg)
    log(`setup: panel ${c.panelScale * 100}% at ${this.fmtOffset()}; viewport aspect ${cameraComp().aspect.toFixed(3)}, vertical fov ${(cameraComp().fov / DEG).toFixed(1)}°`)
    await sleep(1400) // let any gap label fade, panel settle
    log(`setup: room mode ${c.mode}`)
    log(`setup: piece ${c.currentPieceKey} at ${JSON.stringify(c.piecePosition)}, placeholders ${c.showPlaceholderPieces}, panel ${c.panelScale * 100}%, eye ${camRoom.y.toFixed(1)} cm, cam room (${camRoom.x.toFixed(1)}, ${camRoom.z.toFixed(1)})`)
  }

  /** Puts the state a scene expects when it runs alone. */
  private async prepAlone(n: number): Promise<void> {
    if (n === 5) {
      // S5 starts where S4 leaves it: piece at the S3 coffee-table stop, turned 4 x 15° right, far measure shot, panel raised.
      this.c.setPiecePosition(holdBox().minX + 20, holdBox().maxZ + 20)
      for (let i = 0; i < CONFIG.s4.rotations; i++) this.c.rotateRight()
      log(`prep S5: piece at ${JSON.stringify(this.c.piecePosition)}, ${this.c.rotationDeg.toFixed(0)}°`)
      const p = this.c.piecePosition
      const k4 = backdrop ? {...CONFIG.s4, ...BD.s4} : CONFIG.s4
      this.head.set(this.poseAt(new vec3(p.x, this.c.currentDims.h / 2, p.z), k4.azDeg, k4.distCm))
      await this.movePanelTo(CONFIG.s4.panelRaiseDeg)
      await sleep(500)
      log(`prep S5: panel at ${this.fmtOffset()}`)
    }
    if (n === 2) {
      const p = this.startPose
      this.head.set({x: p.x, z: p.z - (backdrop ? BD.s1.walkCm : CONFIG.s1.walkCm), look: this.sofaLook()})
      await sleep(500)
      this.c.resetPanelOffset()
    }
  }

  private sofaLook(): vec3 {
    const p = this.c.piecePosition
    return new vec3(p.x, 40, p.z)
  }

  // ── Scene runner ──────────────────────────────────────────────────────────

  private async playScene(n: number): Promise<SceneRecord> {
    const target = CONFIG.target[n]
    this.sceneStart = getTime()
    this.minWall = Infinity
    this.pieceIn = 0
    this.samples = 0
    this.allIn = 0
    this.maxCover = 0
    this.ringExt = {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, n: 0}
    this.mot = {travel: 0, yaw: 0, still: 0, stillCur: 0, maxSpeed: 0, maxYawRate: 0}
    this.sceneN = n
    const f0 = this.frames
    const start = this.sceneStart - this.T0
    log(`S${n} ${SCENE_NAMES[n]} START ${start.toFixed(2)} s (target ${target} s)`)
    postEditor({type: "SidleDemoScene", n, t: start})
    try {
      await (this as any)[`s${n}`]()
    } catch (e) {
      log(`S${n} problem (continuing): ${e}`)
    }
    const used = getTime() - this.sceneStart
    if (used < target) await sleep((target - used) * 1000)
    else if (used > target + 0.05) log(`S${n} NEEDED MORE TIME: ${used.toFixed(2)} s for a ${target} s target (+${(used - target).toFixed(2)} s)`)
    const end = getTime() - this.T0
    this.report(`S${n} end`)
    log(`S${n} ${SCENE_NAMES[n]} END ${end.toFixed(2)} s (choreography ${used.toFixed(2)} s)`)
    this.sceneN = 0
    return {n, start, end, frames: this.frames - f0, minWallCm: this.minWall, pieceIn: this.pieceIn, samples: this.samples, allIn: this.allIn, maxCover: this.maxCover, ring: this.ringExt, motion: {travel: this.mot.travel, yaw: this.mot.yaw, still: this.mot.still, maxSpeed: this.mot.maxSpeed, maxYawRate: this.mot.maxYawRate}}
  }

  /** Waits until `sec` after the scene started (no-op if already past). */
  private async at(sec: number): Promise<void> {
    const wait = this.sceneStart + sec - getTime()
    if (wait > 0) await sleep(wait * 1000)
  }

  private summary(records: SceneRecord[]): void {
    log("──────── SUMMARY ────────")
    log("scene | start s | end s | duration s | target s | avg fps")
    let total = 0
    for (const r of records) {
      const d = r.end - r.start
      total += d
      log(`S${r.n} ${SCENE_NAMES[r.n]} | ${r.start.toFixed(2)} | ${r.end.toFixed(2)} | ${d.toFixed(2)} | ${CONFIG.target[r.n]} | ${d > 0 ? (r.frames / d).toFixed(1) : "-"}`)
    }
    const wall = records.length ? records[records.length - 1].end : 0
    log(`TOTAL ${total.toFixed(2)} s, ${this.frames} frames, measured average ${wall > 0 ? (this.frames / wall).toFixed(1) : "-"} fps`)
    log(`scene | min camera-wall cm (rule >= ${CONFIG.frame.wallRuleCm}) | piece fully in viewport (sampled frames) | S6: all pieces fully in viewport | S4/S5: max panel cover of piece box | pinch/drag rings x, y range (%)`)
    for (const r of records) {
      const ok = r.minWallCm >= CONFIG.frame.wallRuleCm ? "ok" : "TOO CLOSE"
      const pct = (k: number) => (r.samples ? ((100 * k) / r.samples).toFixed(1) : "-")
      const all = r.n === 6 || (backdrop && r.n === 9) ? `${r.allIn}/${r.samples} (${pct(r.allIn)}%)` : "-"
      const cover = r.n === 4 || r.n === 5 ? `${r.maxCover.toFixed(1)}%` : "-"
      const g = r.ring
      const inBand = g.x0 >= 10 && g.x1 <= 90 && g.y0 >= 10 && g.y1 <= 90
      const rings = g.n ? `${g.n} rings, x ${g.x0.toFixed(1)}..${g.x1.toFixed(1)}, y ${g.y0.toFixed(1)}..${g.y1.toFixed(1)}${inBand ? " ok" : " OUTSIDE 10-90"}` : "-"
      log(`S${r.n} ${SCENE_NAMES[r.n]} | ${r.minWallCm.toFixed(1)} ${ok} | ${r.pieceIn}/${r.samples} (${pct(r.pieceIn)}%) | ${all} | ${cover} | ${rings}`)
    }
    if (backdrop) {
      log("scene | camera travel cm (>= 80) | yaw change deg | longest still s (<= 1.5) | peak speed cm/s (<= 15) | peak turn deg/s (<= 10)")
      for (const r of records) {
        const m = r.motion
        log(`S${r.n} ${SCENE_NAMES[r.n]} | ${m.travel.toFixed(0)} | ${m.yaw.toFixed(1)} | ${m.still.toFixed(2)} | ${m.maxSpeed.toFixed(1)} | ${m.maxYawRate.toFixed(1)}`)
      }
    }
  }

  // ── Pinch helpers ──────────────────────────────────────────────────────────

  /** Replay: wait (at most `maxSec`) until the preview-driven camera has been still for 3 frames. */
  private async waitHeadStill(maxSec: number): Promise<void> {
    const t = cameraTransform()
    let last = t.getWorldPosition()
    let lastF = t.back
    let still = 0
    const t0 = getTime()
    while (still < 3 && getTime() - t0 < maxSec) {
      await nextFrame()
      const p = t.getWorldPosition()
      const f = t.back
      if (p.distance(last) < 0.2 && f.dot(lastF) > 0.999998) still++
      else still = 0
      last = p
      lastF = f
    }
    if (still < 3) log(`pinch: head still moving after ${maxSec} s (replay out of step), pinching anyway`)
  }

  /** Remember where a pinch/drag ring landed on screen (for the 10-90% check). */
  private noteRing(s: {x: number; y: number}): void {
    const r = this.ringExt
    r.x0 = Math.min(r.x0, s.x)
    r.x1 = Math.max(r.x1, s.x)
    r.y0 = Math.min(r.y0, s.y)
    r.y1 = Math.max(r.y1, s.y)
    r.n++
  }

  private async pinch(name: string): Promise<void> {
    const inter = findInteractableByName(name, undefined, true)
    if (!inter) {
      log(`pinch: "${name}" not found or not enabled, skipped`)
      return
    }
    // Backdrop: the walk eases to a stop while the ring glides in (the panel follows the head), resumes after the pinch.
    const stop = backdrop && this.walker ? this.walker.brake() : Promise.resolve()
    await Promise.all([this.ring.glideTo(() => inter.getSceneObject().getTransform().getWorldPosition(), CONFIG.ring.glide), stop])
    if (backdrop && this.T0 > 0) {
      // Pinch markers: the recording logs when each pinch's stop is reached; in the replay the editor
      // lines its path time up with that recorded stop (the head is still there, so nothing jumps).
      const k = this.pinchIdx++
      if (recordPath) print(`[SidlePinch] ${k} ${(getTime() - this.T0).toFixed(3)}`)
      if (previewHead) {
        postEditor({type: "SidleDemoPinch", k})
        await this.waitHeadStill(0.6)
      }
    }
    const s = toScreen(inter.getSceneObject().getTransform().getWorldPosition())
    this.noteRing(s)
    const inView = s.front && s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100
    const press = this.ring.press(CONFIG.ring.press)
    let ok = true
    try {
      await withTimeout(this.it.trigger(inter), 3000, "trigger timeout")
    } catch (e) {
      ok = false
      log(`pinch: "${name}" did not complete (${e})`)
    }
    if (backdrop && this.walker) this.walker.resume()
    await press
    log(`pinch ${name}: ring at (${s.x.toFixed(1)}%, ${s.y.toFixed(1)}%) in viewport=${inView}, completed=${ok}`)
  }

  /** Grab the current piece and drag it by a room-local offset along an eased, time-based path. */
  private async dragPiece(roomOffset: vec3, sec: number): Promise<void> {
    const grab = findInteractableByName("PieceGrab")
    if (!grab) {
      log("drag: PieceGrab not found, skipped")
      return
    }
    const at = () => grab.getSceneObject().getTransform().getWorldPosition()
    await this.ring.glideTo(at, CONFIG.ring.glide)
    const sg = toScreen(at())
    this.noteRing(sg)
    log(`drag ring at (${sg.x.toFixed(1)}%, ${sg.y.toFixed(1)}%)`)
    const press = this.ring.press(CONFIG.ring.press)
    try {
      await this.it.dragEased(grab, roomDirToWorld(roomOffset), sec)
    } catch (e) {
      log(`drag: did not complete (${e})`)
    }
    await press
    if (this.c.isDragging) log("drag: controller still reports dragging after release")
  }

  private tabFor(key: string): {tab: number; page: number; tile: number} {
    const c = this.c
    const type = c.availableTypes.find((t) => c.variantKeys(t).indexOf(key) >= 0) ?? ""
    const vi = c.variantKeys(type).indexOf(key)
    return {tab: c.availableTypes.indexOf(type) + 1, page: Math.floor(vi / 6), tile: (vi % 6) + 1}
  }

  /** Gallery -> tab -> page -> tile with real pinches. */
  private async pickFromGallery(key: string): Promise<void> {
    const p = this.tabFor(key)
    if (p.tab < 1) {
      log(`gallery: ${key} not offered, skipped`)
      return
    }
    await this.pinch("GalleryButton")
    await this.pinch(`GalleryTab_${p.tab}`)
    for (let i = 0; i < p.page; i++) await this.pinch("GalleryNextButton")
    await this.pinch(`GalleryTile_${p.tile}`)
    log(`gallery: picked ${this.c.currentPieceKey} (${this.c.doorFitText})`)
  }

  // ── Scenes ────────────────────────────────────────────────────────────────

  /** S1 Hook: hold at the start, then walk forward about 1 m. */
  private async s1(): Promise<void> {
    if (backdrop) {
      // Walk in from the hall through the open side, toward the sofa.
      const w = this.walker!
      w.lookAt(this.sofaLook())
      w.walkTo(BD.walk.s1.x, BD.walk.s1.z, BD.walk.s1.sec)
      return
    }
    const k = backdrop ? {...CONFIG.s1, ...BD.s1} : CONFIG.s1
    await this.at(k.hold)
    const p = this.head.pose
    await this.head.glide({x: p.x, z: p.z - k.walkCm, look: this.sofaLook()}, k.walk)
  }

  /** S2 Walk-around: to ~1.5 m from the sofa, a quarter turn around it, pause on the green outline. */
  private async s2(): Promise<void> {
    if (backdrop) {
      const s = this.c.piecePosition
      const a = BD.walk.s2
      this.walker!.lookAt(this.sofaLook())
      this.walker!.arcAround(s.x, s.z, a.toDeg, a.radiusCm, a.sec)
      log(`S2 arc around (${s.x.toFixed(0)}, ${s.z.toFixed(0)}) to ${a.toDeg} deg at ${a.radiusCm} cm over ${a.sec} s`)
      return
    }
    const k = CONFIG.s2
    const s = this.c.piecePosition
    const look = this.sofaLook()
    const onCircle = (deg: number): Pose => {
      const a = (deg * Math.PI) / 180
      return {x: s.x + k.radiusCm * Math.sin(a), z: s.z + k.radiusCm * Math.cos(a), look}
    }
    // Stay >= 60 cm inside the walls (the camera must never pass through one).
    const r = k.radiusCm
    let margin = Infinity
    for (let i = 0; i <= 20; i++) {
      const q = onCircle(k.startDeg + (k.sweepDeg * i) / 20)
      margin = Math.min(margin, cameraWallCm(q.x, q.z))
    }
    log(`S2 circle radius ${r} cm around (${s.x.toFixed(0)}, ${s.z.toFixed(0)}), ${k.startDeg} to ${k.startDeg + k.sweepDeg} deg; closest wall on the arc ${margin.toFixed(0)} cm`)
    await this.head.glide(onCircle(k.startDeg), k.approach)
    await animate(k.circle, (e) => this.head.set(onCircle(k.startDeg + k.sweepDeg * e)))
    const end = this.head.pose
    const minWall = cameraWallCm(end.x, end.z)
    log(`S2 end camera (${end.x.toFixed(0)}, ${end.z.toFixed(0)}), ${minWall.toFixed(0)} cm from the nearest wall; outline ${this.c.outlineEdgeColors.join(",")}`)
    await sleep(k.pause * 1000)
  }

  /** S3 Clearance: toward a wall (red + gap number), back to open floor (green), toward the coffee table. */
  private async s3(): Promise<void> {
    if (backdrop) return this.s3Backdrop()
    const k = CONFIG.s3
    const c = this.c
    const overview: Pose = backdrop ? {...BD.s3.overview} : {x: -40, z: -10, look: new vec3(60, 30, START.z - 30)}
    await this.head.glide(overview, k.camera)
    const halfW = c.currentDims.w / 2
    const toX = ROOM.maxX - halfW - k.wallGapCm
    const pz = c.piecePosition.z
    // While the piece nears the wall, the camera moves to a shot looking down CONFIG.frame.pitchDeg at the planned gap number.
    const wallAim = new vec3(ROOM.maxX - k.wallGapCm / 2, 0, pz)
    await Promise.all([
      this.dragPiece(new vec3(toX - c.piecePosition.x, 0, 0), k.toWall),
      this.head.glide(this.shotPose(wallAim, k.wallAzDeg, holdPitch()), k.toWall),
    ])
    await this.settleOnGap(k.wallAzDeg, k.settle)
    log(`S3 at wall: edges ${c.outlineEdgeColors.join(",")}, gap "${c.gapLabelText}" visible=${c.gapLabelVisible}`)
    this.holdReport("S3 wall hold", "RightWall")
    await sleep(k.hold * 1000)
    await Promise.all([this.dragPiece(new vec3(-c.piecePosition.x, 0, 0), k.back), this.head.glide(overview, k.back)])
    log(`S3 open floor: clear=${c.isClear}, edges ${c.outlineEdgeColors.join(",")}`)
    await this.head.glide(backdrop ? {x: overview.x, z: overview.z, look: BD.s3.turnLook} : {x: -40, z: -10, look: new vec3(110, 30, START.z - 180)}, k.turn)
    const B = holdBox()
    const goal = new vec3(B.minX + 20, 0, B.maxZ + 20)
    // Planned contact: back edge on the table (pillar) front, gap number over the shared x-range.
    const gx = Math.min(goal.x, ROOM.maxX - halfW) // where the room lets the piece end up
    const lo = Math.max(gx - halfW, B.minX)
    const hi = Math.min(gx + halfW, B.maxX)
    const tableAim = new vec3((lo + hi) / 2, 20, B.maxZ)
    await Promise.all([
      this.dragPiece(new vec3(goal.x - c.piecePosition.x, 0, goal.z - c.piecePosition.z), k.toTable),
      this.head.glide(this.shotPose(tableAim, k.tableAzDeg, holdPitch()), k.toTable),
    ])
    const tf = this.facingPoints(holdName())
    await this.settleOnGap(k.tableAzDeg, k.settle, [tf.edge[0].add(tf.edge[1]).uniformScale(0.5), tf.face[2]], k.tableSubjectYPct)
    log(`S3 stopped at ${JSON.stringify(c.piecePosition)}: nearest ${c.nearestObstacle} ${c.nearestGapCm.toFixed(1)} cm`)
    this.holdReport(backdrop ? "S3 pillar hold" : "S3 table hold", holdName())
    await sleep(k.tableHold * 1000)
  }

  /** S3 in the Colorful Home living room: same beats and timing as the stand-in S3, shot from the hall. */
  private async s3Backdrop(): Promise<void> {
    const k = CONFIG.s3
    const c = this.c
    const b = BD.s3
    const w = this.walker!
    w.walkTo(BD.walk.s3.x, BD.walk.s3.z, BD.walk.s3.sec)
    // The gaze follows the piece, leaning toward the wall (and later the pillar) so both stay in view.
    const pieceAt = (): vec3 => {
      const q = c.piecePosition
      return new vec3(q.x, 30, q.z)
    }
    w.follow(pieceAt)
    await sleep(k.camera * 1000)
    const halfW = c.currentDims.w / 2
    const toX = ROOM.maxX - halfW - k.wallGapCm
    w.follow(() => lerp3(pieceAt(), new vec3(ROOM.maxX, 25, c.piecePosition.z), BD.s3.wallLean))
    await this.dragPiece(new vec3(toX - c.piecePosition.x, 0, 0), k.toWall)
    await sleep(k.settle * 1000)
    log(`S3 at wall: edges ${c.outlineEdgeColors.join(",")}, gap "${c.gapLabelText}" visible=${c.gapLabelVisible}`)
    this.holdReport("S3 wall hold", "RightWall")
    await sleep(k.hold * 1000)
    w.follow(pieceAt)
    await this.dragPiece(new vec3(-c.piecePosition.x, 0, 0), k.back)
    log(`S3 open floor: clear=${c.isClear}, edges ${c.outlineEdgeColors.join(",")}`)
    w.follow(() => lerp3(pieceAt(), b.pillar.look, BD.s3.pillarLean))
    await sleep(k.turn * 1000)
    const B = holdBox()
    const goal = new vec3(B.minX + 20, 0, B.maxZ + 20)
    await this.dragPiece(new vec3(goal.x - c.piecePosition.x, 0, goal.z - c.piecePosition.z), k.toTable)
    await sleep(k.settle * 1000)
    log(`S3 stopped at ${JSON.stringify(c.piecePosition)}: nearest ${c.nearestObstacle} ${c.nearestGapCm.toFixed(1)} cm`)
    this.holdReport("S3 pillar hold", "Pillar")
    await sleep(k.tableHold * 1000)
  }

  /** Room-local positions of every piece (backdrop tuning log). */
  private logPieces(tag: string): void {
    const c = this.c
    const cur = c.piecePosition
    const placed = c.placedPieces.map((pp) => `${pp.key} (${pp.x.toFixed(0)}, ${pp.z.toFixed(0)}) ${pp.yawDeg.toFixed(0)}°`).join("; ")
    log(`${tag}: current ${c.currentPieceKey} (${cur.x.toFixed(0)}, ${cur.z.toFixed(0)}) ${c.rotationDeg.toFixed(0)}°; placed: ${placed || "none"}; camera (${this.head.pose.x.toFixed(0)}, ${this.head.pose.z.toFixed(0)}) looking down ${this.head.pitchDownDeg().toFixed(1)}°`)
  }

  /**
   * At a clearance hold: camera pitch, gap number position (viewport %), and whether
   * the gap number, the footprint edge facing the obstacle and the obstacle are inside the central 70%.
   */
  private holdReport(tag: string, obstacle: "RightWall" | "CoffeeTable" | "Pillar"): void {
    const c = this.c
    const p = this.head.pose
    const pitch = this.head.pitchDownDeg()
    const lo = centralLo()
    const hi = centralHi()
    const L = findSceneObjectByName("GapLabel")
    const gs = L && L.isEnabledInHierarchy ? toScreen(L.getTransform().getWorldPosition()) : null
    log(`${tag}: camera (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) looking down ${pitch.toFixed(1)}°; gap number "${c.gapLabelText}" at ${gs ? `(${gs.x.toFixed(1)}%, ${gs.y.toFixed(1)}%)` : "not shown"}`)
    this.labelCheck(tag, "GapLabel")
    // Footprint edge facing the obstacle and the obstacle face opposite it (floor, plus 45 cm up on the obstacle).
    const {edge, face} = this.facingPoints(obstacle)
    const panel = screenBox(visualCorners(panelObj(c), true))
    for (const [name, pts] of [["footprint edge (facing part)", edge], [obstacle === "RightWall" ? "wall" : obstacle === "Pillar" ? "pillar front" : "coffee table front", face]] as [string, vec3[]][]) {
      const b = screenBox(pts.map(roomToWorld))
      const inside = boxInside(b, lo, hi)
      log(`${tag}: ${name} ${fmtBox(b)} inside central ${CONFIG.frame.centralPct}%=${inside}${inside ? "" : ` (out by ${boxOverflow(b, lo, hi).toFixed(1)}%)`}; panel overlaps it=${boxesOverlap(panel, b)}`)
    }
    this.report(tag)
  }

  /** S4 Measure, rotate right 4 times, Measure off. */
  private async s4(): Promise<void> {
    if (backdrop) return this.s4Backdrop()
    const k = backdrop ? {...CONFIG.s4, ...BD.s4} : CONFIG.s4
    // Frame the piece (and its W/D/H labels) while Measure is pinched.
    const p = this.c.piecePosition
    const aim = new vec3(p.x, this.c.currentDims.h / 2, p.z)
    await Promise.all([this.pinch("MeasureButton"), this.head.glide(this.poseAt(aim, k.azDeg, k.distCm), k.camera)])
    await sleep(500)
    for (const n of ["WidthLabel", "DepthLabel", "HeightLabel"]) this.labelCheck("S4 measure on", n)
    // Raise the panel (real grab-bar drag) so its buttons are on screen at this far shot; lowered again after S5.
    const t0 = getTime()
    await this.movePanelTo(k.panelRaiseDeg)
    log(`S4 panel raised to ${this.fmtOffset()}`)
    await sleep(Math.max(0, k.measureHold - 0.5 - (getTime() - t0)) * 1000)
    for (let i = 0; i < k.rotations; i++) {
      const t = getTime()
      await this.pinch("RotateRightButton")
      const rest = k.rotateGap - (getTime() - t)
      if (rest > 0) await sleep(rest * 1000)
    }
    log(`S4 rotation ${this.c.rotationDeg.toFixed(0)}°`)
    for (const n of ["WidthLabel", "DepthLabel", "HeightLabel"]) this.labelCheck("S4 after rotations", n)
    this.report("S4 after rotations")
    await this.pinch("MeasureButton")
  }

  /** S4 in the living room: far shot from the hall; the panel is raised first so the Measure button is on screen at this distance. */
  private async s4Backdrop(): Promise<void> {
    const k = {...CONFIG.s4, ...BD.s4}
    const w = this.walker!
    w.walkTo(BD.walk.s4.x, BD.walk.s4.z, BD.walk.s4.sec)
    w.follow(() => {
      const q = this.c.piecePosition
      return new vec3(q.x, this.c.currentDims.h / 2, q.z)
    })
    await sleep(k.camera * 1000)
    await this.movePanelTo(k.panelRaiseDeg)
    log(`S4 panel raised to ${this.fmtOffset()}`)
    await this.pinch("MeasureButton")
    await sleep(500)
    for (const n of ["WidthLabel", "DepthLabel", "HeightLabel"]) this.labelCheck("S4 measure on", n)
    await this.at(CONFIG.s4.camera + k.measureHold + 2)
    for (let i = 0; i < k.rotations; i++) {
      const t = getTime()
      await this.pinch("RotateRightButton")
      const rest = k.rotateGap - (getTime() - t)
      if (rest > 0) await sleep(rest * 1000)
    }
    log(`S4 rotation ${this.c.rotationDeg.toFixed(0)}°`)
    for (const n of ["WidthLabel", "DepthLabel", "HeightLabel"]) this.labelCheck("S4 after rotations", n)
    this.report("S4 after rotations")
    await this.pinch("MeasureButton")
  }

  /** S5 Next through every type, then Compare twice on a type with variants. */
  private async s5(): Promise<void> {
    const k = CONFIG.s5
    const c = this.c
    if (backdrop) {
      const w = this.walker!
      w.walkTo(BD.walk.s5.x, BD.walk.s5.z, BD.walk.s5.sec)
      w.follow(() => {
        const q = this.c.piecePosition
        return new vec3(q.x, this.c.currentDims.h / 2, q.z)
      })
    }
    try {
      await this.s5Body(k, c)
    } finally {
      this.followPiece = false
    }
  }

  private async s5Body(k: typeof CONFIG.s5, c: SidleController): Promise<void> {
    const n = c.availableTypes.length
    for (let i = 0; i < n; i++) {
      await this.pinch("NextButton")
      log(`S5 type ${c.currentPieceType}: ${c.currentPieceKey}`)
      await sleep(k.typePause * 1000)
    }
    let g = 0
    while (c.variantKeys(c.currentPieceType).length < 2 && g++ < n) await this.pinch("NextButton")
    for (let i = 0; i < 2; i++) {
      await this.pinch("CompareButton")
      log(`S5 compare: ${c.currentPieceKey}`)
      await sleep(k.comparePause * 1000)
    }
    if (backdrop) return // backdrop: the panel stays raised through S6 (lowered at the end of S6)
    this.report("S5 before panel back")
    await this.movePanelTo(CONFIG.panel.verticalDeg)
    log(`S5 panel back to ${this.fmtOffset()}`)
  }

  /** S6 Gallery (two tabs, a tile), Add and move, place 3 pieces, Remove once. */
  private async s6(): Promise<void> {
    const k = CONFIG.s6
    const c = this.c
    // Back off along the line from the pieces' centroid through the old (0, 0) spot, k.backCm further,
    // sliding along the wall margin if the line runs into it; then keep the gaze on the centroid.
    const C = this.centroid()
    if (backdrop) {
      // Living room: straight back from the pieces' centroid toward the open side, into the opening.
      const w = this.walker!
      const to = BD.walk.s6
      log(`S6 walk to (${to.x}, ${to.z}), ${Math.sqrt((to.x - C.x) ** 2 + (to.z - C.z) ** 2).toFixed(0)} cm from the centroid (${C.x.toFixed(0)}, ${C.z.toFixed(0)})`)
      w.walkTo(to.x, to.z, to.sec)
      w.follow(() => this.centroid())
      await this.s6Body({...k, ...BD.s6}, c)
      this.logPieces("S6 end")
      return // backdrop: the panel stays raised through S7 (lowered at the end of S7)
    }
    const D0 = Math.sqrt(C.x * C.x + C.z * C.z)
    const D = D0 + k.backCm
    const m = CONFIG.frame.wallMarginCm
    const ux = -C.x / Math.max(1e-6, D0)
    const uz = -C.z / Math.max(1e-6, D0)
    let cx = C.x + ux * D
    let cz = C.z + uz * D
    if (cz > ROOM.maxZ - m) {
      cz = ROOM.maxZ - m
      cx = C.x + (ux > 0 ? 1 : -1) * Math.sqrt(Math.max(0, D * D - (cz - C.z) ** 2))
    }
    cx = Math.min(ROOM.maxX - m, Math.max(ROOM.minX + m, cx))
    log(`S6 camera (${cx.toFixed(0)}, ${cz.toFixed(0)}), ${Math.sqrt((cx - C.x) ** 2 + (cz - C.z) ** 2).toFixed(0)} cm from the centroid (${C.x.toFixed(0)}, ${C.z.toFixed(0)}); old spot (0, 0) was ${D0.toFixed(0)} cm`)
    await this.head.glide({x: cx, z: cz, look: C}, k.camera)
    this.followCentroid = true
    try {
      await this.s6Body(k, c)
    } finally {
      this.followCentroid = false
    }
  }

  private async s6Body(k: typeof CONFIG.s6, c: SidleController): Promise<void> {
    await this.pinch("GalleryButton")
    const types = c.availableTypes
    const tabA = Math.min(3, types.length)
    const tabB = Math.min(2, types.length)
    await this.pinch(`GalleryTab_${tabA}`)
    await sleep(k.tabPause * 1000)
    await this.pinch(`GalleryTab_${tabB}`)
    await sleep(k.tabPause * 1000)
    await this.pinch("GalleryTile_1")
    log(`S6 picked ${c.currentPieceKey}`)
    await this.pinch("AddButton")
    await sleep(k.afterAdd * 1000)
    await this.dragPiece(k.dragA, k.drag)
    await this.pinch("AddButton")
    await sleep(k.afterAdd * 1000)
    await this.dragPiece(k.dragB, k.drag)
    log(`S6 pieces in the room: ${c.pieceCount}`)
    await this.pinch("RemoveButton")
    log(`S6 after Remove: ${c.pieceCount} pieces, current ${c.currentPieceKey}`)
  }

  /** S7 Door check: a piece too big for the door, then a chair that fits. */
  private async s7(): Promise<void> {
    const k = CONFIG.s7
    // Back to the S7 opening view of round 1 (S6 now ends further back, where the gallery is below the view).
    if (backdrop) {
      const w = this.walker!
      w.walkTo(BD.walk.s7.x, BD.walk.s7.z, BD.walk.s7.sec)
      // Gaze pitchDeg down in total (with the subject tilt), aimed at the piece's spot, as the camera walks.
      w.follow(() => {
        const p = this.c.piecePosition
        const dist = Math.sqrt((w.cam.x - p.x) ** 2 + (w.cam.z - p.z) ** 2)
        return new vec3(p.x, this.head.eyeY - dist * Math.tan((BD.s7.pitchDeg - subjectTiltDeg()) * DEG), p.z)
      })
      await sleep(k.startCamera * 1000)
      this.logPieces("S7 start")
      for (const key of [k.bigKey, k.fitKey]) {
        await this.pickFromGallery(key)
        this.labelCheck(`S7 ${key}`, "DoorFitLabel")
        this.report(`S7 ${key}`)
        await sleep(k.hold * 1000)
      }
      await this.movePanelTo(CONFIG.panel.verticalDeg)
      log(`S7 panel back to ${this.fmtOffset()}`)
      return
    } else {
      await this.head.glide({x: 0, z: 0, look: new vec3(0, 20, START.z - 60)}, k.startCamera)
    }
    for (const key of [k.bigKey, k.fitKey]) {
      await this.pickFromGallery(key)
      const label = findSceneObjectByName("DoorFitLabel")
      if (label) {
        // Look at the door-fit line on the panel (the panel follows head position and yaw only, so it stays put).
        const at = worldToRoom(label.getTransform().getWorldPosition())
        const pose = this.head.pose
        await Promise.all([
          this.ring.glideTo(() => label.getTransform().getWorldPosition(), CONFIG.ring.glide),
          this.head.glide({x: pose.x, z: pose.z, look: at, center: true}, k.camera),
        ])
        this.labelCheck(`S7 ${key}`, "DoorFitLabel")
      }
      await sleep(k.hold * 1000)
    }
  }

  /** S8 is VS Code footage: nothing to drive. */
  private async s8(): Promise<void> {
    log("S8 not driven (VS Code footage)")
  }

  /** S9 Closing: a clean wide view, held (no pinches). */
  private async s9(): Promise<void> {
    const c = this.c
    if (c.measureOn) await this.pinch("MeasureButton")
    const cam = cameraTransform()
    await this.ring.glideTo(() => cam.getWorldPosition().add(cam.back.uniformScale(40)).add(cam.down.uniformScale(80)), 0.4)
    if (backdrop) {
      const w = this.walker!
      w.walkTo(BD.walk.s9.x, BD.walk.s9.z, BD.walk.s9.sec, true)
      w.follow(() => this.centroid())
      await sleep(CONFIG.s9.camera * 1000)
      this.logPieces("S9")
    } else await this.head.glide({x: 0, z: 10, look: new vec3(0, 40, START.z - 80)}, CONFIG.s9.camera)
  }
}
