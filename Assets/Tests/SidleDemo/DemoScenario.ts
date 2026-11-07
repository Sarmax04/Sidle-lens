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
import {cameraTransform, COFFEE, controller, ROOM, START, START_HEAD} from "../SidleLeaf/SidleTestHelpers"

// ═══ CONFIG: tune everything here (seconds unless noted; positions in room cm) ═══
const CONFIG = {
  /** Target length of each scene; a scene that finishes early holds until its target. */
  target: {1: 14, 2: 26, 3: 30, 4: 15, 5: 20, 6: 25, 7: 15, 8: 0, 9: 8} as Record<number, number>,
  startPiece: "Imported_sofa_01",
  ring: {glide: 0.45, press: 0.25, colour: new vec4(1.0, 0.96, 0.78, 1), sizePerCm: 0.012},
  s1: {hold: 3, walkCm: 100, walk: 7},
  s2: {radiusCm: 150, approach: 4, startDeg: -15, sweepDeg: 90, circle: 13, pause: 3},
  s3: {camera: 2.5, wallGapCm: 40, toWall: 5, hold: 3, back: 4, turn: 2, toTable: 6, tableHold: 3},
  s4: {measureHold: 3, rotations: 4, rotateGap: 1},
  s5: {typePause: 2, comparePause: 2},
  s6: {camera: 2, tabPause: 1.6, drag: 2.5, dragA: new vec3(-140, 0, 40), dragB: new vec3(130, 0, 60), afterAdd: 0.8},
  s7: {bigKey: "Imported_gothicbed_01", fitKey: "Imported_painted_wooden_chair_01", hold: 3},
  s9: {camera: 3},
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

// ── Head (preview camera) ─────────────────────────────────────────────────────

interface Pose {
  x: number
  z: number
  look: vec3 // room-local point the head looks at
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

  constructor(eyeY: number, pose: Pose) {
    const t = cameraTransform()
    this.origPos = t.getWorldPosition()
    this.origRot = t.getWorldRotation()
    this.tracking = t.getSceneObject().getComponent("Component.DeviceTracking") as Component | null
    this.trackingWasEnabled = !!this.tracking && this.tracking.enabled
    if (this.tracking) this.tracking.enabled = false
    this.eyeY = eyeY
    this.pose = pose
    this.apply()
    this.loop()
  }

  set(p: Pose): void {
    this.pose = p
    this.apply()
  }

  /** Eased glide (position and gaze target) to `to` over `sec`. */
  async glide(to: Pose, sec: number): Promise<void> {
    const from = this.pose
    await animate(sec, (e) => this.set({x: from.x + (to.x - from.x) * e, z: from.z + (to.z - from.z) * e, look: lerp3(from.look, to.look, e)}))
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
    const pos = roomToWorld(new vec3(this.pose.x, this.eyeY, this.pose.z))
    const d = roomToWorld(this.pose.look).sub(pos)
    const yaw = Math.atan2(d.x, -d.z) // > 0 turns right
    const pitch = Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z))
    const rot = quat.angleAxis(-yaw, vec3.up()).multiply(quat.angleAxis(pitch, vec3.right()))
    const t = cameraTransform()
    t.setWorldPosition(pos)
    t.setWorldRotation(rot)
  }

  private async loop(): Promise<void> {
    while (this.active) {
      this.apply()
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

// ── Scenario ──────────────────────────────────────────────────────────────────

interface SceneRecord {
  n: number
  start: number
  end: number
  frames: number
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

  async run(config?: ScenarioConfig): Promise<void> {
    const raw = (config?.get("scene") ?? "all").trim().toLowerCase()
    const only = raw === "all" || raw === "" || raw === "0" ? 0 : Number(raw)
    const scenes = only >= 1 && only <= 9 ? [only] : [1, 2, 3, 4, 5, 6, 7, 8, 9]
    log(`DEMO start, scene=${raw} -> ${scenes.join(",")}`)

    await this.setup()
    const frameEvt = this.createEvent("UpdateEvent")
    frameEvt.bind(() => this.frames++)
    const records: SceneRecord[] = []
    try {
      if (scenes.length === 1) await this.prepAlone(scenes[0])
      this.T0 = getTime()
      this.frames = 0
      for (const n of scenes) records.push(await this.playScene(n))
    } catch (e) {
      log(`ERROR (demo stopped early): ${e}`)
    } finally {
      frameEvt.enabled = false
      this.summary(records)
      this.ring.destroy()
      await this.head.stop()
      log("DEMO done (pointer ring removed, camera tracking restored)")
    }
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  private async setup(): Promise<void> {
    const c = (this.c = controller())
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
    c.setPiecePosition(START.x, START.z)

    // Camera at the normal start (room-local (0, 0), about 1 m inside the doorway), facing the sofa.
    const inv = roomT.getInvertedWorldTransform()
    const camRoom = inv.multiplyPoint(START_HEAD.pos)
    this.startPose = {x: camRoom.x, z: camRoom.z, look: this.sofaLook()}
    this.head = new DemoHead(camRoom.y, this.startPose)
    await nextFrame()
    c.resetPanelOffset()
    c.resetPanelScale()

    this.it = new DemoInteractor("DemoInteractor")
    const edge = findSceneObjectByName("Edge_Front")!.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.ring = new PointerRing(edge, CONFIG.ring.colour)
    await sleep(1400) // let any gap label fade, panel settle
    log(`setup: piece ${c.currentPieceKey} at ${JSON.stringify(c.piecePosition)}, placeholders ${c.showPlaceholderPieces}, panel ${c.panelScale * 100}%, eye ${camRoom.y.toFixed(1)} cm, cam room (${camRoom.x.toFixed(1)}, ${camRoom.z.toFixed(1)})`)
  }

  /** Puts the state a scene expects when it runs alone. */
  private async prepAlone(n: number): Promise<void> {
    if (n === 2) {
      const p = this.startPose
      this.head.set({x: p.x, z: p.z - CONFIG.s1.walkCm, look: this.sofaLook()})
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
    const f0 = this.frames
    const start = this.sceneStart - this.T0
    log(`S${n} ${SCENE_NAMES[n]} START ${start.toFixed(2)} s (target ${target} s)`)
    try {
      await (this as any)[`s${n}`]()
    } catch (e) {
      log(`S${n} problem (continuing): ${e}`)
    }
    const used = getTime() - this.sceneStart
    if (used < target) await sleep((target - used) * 1000)
    else if (used > target + 0.05) log(`S${n} NEEDED MORE TIME: ${used.toFixed(2)} s for a ${target} s target (+${(used - target).toFixed(2)} s)`)
    const end = getTime() - this.T0
    log(`S${n} ${SCENE_NAMES[n]} END ${end.toFixed(2)} s (choreography ${used.toFixed(2)} s)`)
    return {n, start, end, frames: this.frames - f0}
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
  }

  // ── Pinch helpers ──────────────────────────────────────────────────────────

  private async pinch(name: string): Promise<void> {
    const inter = findInteractableByName(name, undefined, true)
    if (!inter) {
      log(`pinch: "${name}" not found or not enabled, skipped`)
      return
    }
    await this.ring.glideTo(() => inter.getSceneObject().getTransform().getWorldPosition(), CONFIG.ring.glide)
    const press = this.ring.press(CONFIG.ring.press)
    try {
      await withTimeout(this.it.trigger(inter), 3000, "trigger timeout")
    } catch (e) {
      log(`pinch: "${name}" did not complete (${e})`)
    }
    await press
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
    const k = CONFIG.s1
    await this.at(k.hold)
    const p = this.head.pose
    await this.head.glide({x: p.x, z: p.z - k.walkCm, look: this.sofaLook()}, k.walk)
  }

  /** S2 Walk-around: to ~1.5 m from the sofa, a quarter turn around it, pause on the green outline. */
  private async s2(): Promise<void> {
    const k = CONFIG.s2
    const s = this.c.piecePosition
    const look = this.sofaLook()
    const onCircle = (deg: number): Pose => {
      const a = (deg * Math.PI) / 180
      return {x: s.x + k.radiusCm * Math.sin(a), z: s.z + k.radiusCm * Math.cos(a), look}
    }
    // Stay >= 60 cm inside the walls (the camera must never pass through one).
    const r = k.radiusCm
    const margin = Math.min(ROOM.maxX - (s.x + r), s.x - r - ROOM.minX, ROOM.maxZ - (s.z + r), s.z - r - ROOM.minZ)
    log(`S2 circle radius ${r} cm around (${s.x.toFixed(0)}, ${s.z.toFixed(0)}); worst-case wall margin ${margin.toFixed(0)} cm`)
    await this.head.glide(onCircle(k.startDeg), k.approach)
    await animate(k.circle, (e) => this.head.set(onCircle(k.startDeg + k.sweepDeg * e)))
    const end = this.head.pose
    const minWall = Math.min(ROOM.maxX - end.x, end.x - ROOM.minX, ROOM.maxZ - end.z, end.z - ROOM.minZ)
    log(`S2 end camera (${end.x.toFixed(0)}, ${end.z.toFixed(0)}), ${minWall.toFixed(0)} cm from the nearest wall; outline ${this.c.outlineEdgeColors.join(",")}`)
    await sleep(k.pause * 1000)
  }

  /** S3 Clearance: toward a wall (red + gap number), back to open floor (green), toward the coffee table. */
  private async s3(): Promise<void> {
    const k = CONFIG.s3
    const c = this.c
    await this.head.glide({x: -40, z: -10, look: new vec3(60, 30, START.z - 30)}, k.camera)
    const halfW = c.currentDims.w / 2
    const toX = ROOM.maxX - halfW - k.wallGapCm
    await this.dragPiece(new vec3(toX - c.piecePosition.x, 0, 0), k.toWall)
    log(`S3 at wall: edges ${c.outlineEdgeColors.join(",")}, gap "${c.gapLabelText}" visible=${c.gapLabelVisible}`)
    await sleep(k.hold * 1000)
    await this.dragPiece(new vec3(-c.piecePosition.x, 0, 0), k.back)
    log(`S3 open floor: clear=${c.isClear}, edges ${c.outlineEdgeColors.join(",")}`)
    await this.head.glide({x: -40, z: -10, look: new vec3(110, 30, START.z - 180)}, k.turn)
    const goal = new vec3(COFFEE.minX + 20, 0, COFFEE.maxZ + 20)
    await this.dragPiece(new vec3(goal.x - c.piecePosition.x, 0, goal.z - c.piecePosition.z), k.toTable)
    log(`S3 stopped at ${JSON.stringify(c.piecePosition)}: nearest ${c.nearestObstacle} ${c.nearestGapCm.toFixed(1)} cm`)
    await sleep(k.tableHold * 1000)
  }

  /** S4 Measure, rotate right 4 times, Measure off. */
  private async s4(): Promise<void> {
    const k = CONFIG.s4
    await this.pinch("MeasureButton")
    await sleep(k.measureHold * 1000)
    for (let i = 0; i < k.rotations; i++) {
      const t = getTime()
      await this.pinch("RotateRightButton")
      const rest = k.rotateGap - (getTime() - t)
      if (rest > 0) await sleep(rest * 1000)
    }
    log(`S4 rotation ${this.c.rotationDeg.toFixed(0)}°`)
    await this.pinch("MeasureButton")
  }

  /** S5 Next through every type, then Compare twice on a type with variants. */
  private async s5(): Promise<void> {
    const k = CONFIG.s5
    const c = this.c
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
  }

  /** S6 Gallery (two tabs, a tile), Add and move, place 3 pieces, Remove once. */
  private async s6(): Promise<void> {
    const k = CONFIG.s6
    const c = this.c
    await this.head.glide({x: 0, z: 0, look: new vec3(0, 20, START.z - 60)}, k.camera)
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
    for (const key of [k.bigKey, k.fitKey]) {
      await this.pickFromGallery(key)
      const label = findSceneObjectByName("DoorFitLabel")
      if (label) await this.ring.glideTo(() => label.getTransform().getWorldPosition(), CONFIG.ring.glide)
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
    await this.head.glide({x: 0, z: 10, look: new vec3(0, 40, START.z - 80)}, CONFIG.s9.camera)
  }
}
