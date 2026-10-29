/**
 * Shared helpers for the Sidle LEAF scenarios (test-only; never shipped behaviour).
 * Reads SidleController state through its public getters and drives the real
 * UIKit buttons / PieceGrab Interactable through LEAF interactors.
 */
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {SidleController} from "../../Scripts/SidleController"

export const ROOM = {minX: -200, maxX: 200, minZ: -470, maxZ: 30}
export const COFFEE = {minX: 100, maxX: 200, minZ: -470, maxZ: -420}
export const START = {x: 0, z: -220}

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
 * Sofa A, 0°, Measure off, not dragging, at the start spot; waits out any gap fade.
 */
export async function resetState(): Promise<SidleController> {
  const c = controller()
  if (c.isDragging) c.endDrag()
  let guard = 0
  while (c.currentPieceKey !== "SofaA" && guard++ < 5) {
    if (c.currentPieceKey === "SofaB") c.compare()
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
