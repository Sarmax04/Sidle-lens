/**
 * Done criterion 21 (Update 6) — pinching and dragging a placed piece makes it
 * the current piece, and the piece that was current becomes placed exactly
 * where it stands. The same pinch keeps dragging the new current piece without
 * a jump (sampled every frame), the labels show while dragging, and it ends
 * when the pinch is released. Done twice, so the swap works back as well.
 * Sizes come from the bundled catalog.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {nextFrame, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {
  angDiffDeg,
  bundledCatalog,
  expectedOffer,
  ExpectedType,
  expectNoOverlaps,
  interactable,
  local,
  log,
  obj,
  placedRoot,
  resetState,
  roomDir,
  yawOf,
} from "./SidleTestHelpers"

async function grabPlaced(c: SidleController, offer: ExpectedType[], it: DefaultLeafInteractor, ctx: string): Promise<void> {
  const target = c.placedPieces[c.placedPieces.length - 1]
  const prev = {id: c.currentPieceId, key: c.currentPieceKey, x: c.piecePosition.x, z: c.piecePosition.z, yaw: c.rotationDeg}
  const others = c.placedPieces.filter((p) => p.id !== target.id)
  log(`${ctx}: grabbing placed #${target.id} ${target.key} at (${target.x.toFixed(1)}, ${target.z.toFixed(1)}); current #${prev.id} ${prev.key}`)

  // Drag toward the doorway (+Z), sampling the current piece every frame.
  const samples: {id: number; x: number; z: number; dragging: boolean; labels: boolean}[] = []
  let done = false
  const drag = it.drag(interactable(`PlacedGrab_${target.id}`), roomDir(new vec3(0, 0, 3.0)), 1000).then(() => (done = true))
  while (!done) {
    samples.push({id: c.currentPieceId, x: c.piecePosition.x, z: c.piecePosition.z, dragging: c.isDragging, labels: c.labelsVisible})
    await nextFrame()
  }
  await drag
  await sleep(150)

  // Swap: the grabbed piece is current; the previous current piece is placed where it stood (last placed).
  expect(c.currentPieceId, `${ctx}: grabbed piece is current`).toBe(target.id)
  expect(c.currentPieceKey, `${ctx}: grabbed piece's variant is current`).toBe(target.key)
  expect(angDiffDeg(c.rotationDeg, target.yawDeg) < 0.01, `${ctx}: grabbed piece keeps its facing`).toBe(true)
  expect(obj(`Piece_${target.key}`).enabled, `${ctx}: current visual shows the grabbed variant`).toBe(true)
  const placed = c.placedPieces
  expect(placed.length, `${ctx}: same number of placed pieces`).toBe(others.length + 1)
  const now = placed[placed.length - 1]
  log(`${ctx}: previous current now placed ${JSON.stringify(now)}`)
  expect(now.id, `${ctx}: previous current piece is the most recently placed`).toBe(prev.id)
  expect(now.key, `${ctx}: same variant`).toBe(prev.key)
  expect(now.x, `${ctx}: placed where it stood (x)`).toBeCloseTo(prev.x, 3)
  expect(now.z, `${ctx}: placed where it stood (z)`).toBeCloseTo(prev.z, 3)
  expect(angDiffDeg(now.yawDeg, prev.yaw) < 0.01, `${ctx}: same facing`).toBe(true)
  expect(JSON.stringify(placed.slice(0, others.length)), `${ctx}: other placed pieces untouched`).toBe(JSON.stringify(others))
  const root = placedRoot(prev.id)
  expect(root !== null, `${ctx}: PlacedPiece_${prev.id} in the scene`).toBe(true)
  expect(root!.getTransform().getLocalPosition().x, `${ctx}: scene x`).toBeCloseTo(prev.x, 2)
  expect(root!.getTransform().getLocalPosition().z, `${ctx}: scene z`).toBeCloseTo(prev.z, 2)
  expect(angDiffDeg((yawOf(root!.getTransform()) * 180) / Math.PI, prev.yaw) < 0.05, `${ctx}: scene facing`).toBe(true)
  expect(placedRoot(target.id), `${ctx}: grabbed piece no longer shown as placed`).toBe(null)

  // The drag went on smoothly from where the grabbed piece stood.
  const after = samples.filter((s) => s.id === target.id)
  expect(after.length > 5, `${ctx}: swapped early in the pinch (${after.length}/${samples.length} frames after)`).toBe(true)
  const first = after[0]
  const startJump = Math.sqrt((first.x - target.x) ** 2 + (first.z - target.z) ** 2)
  let maxStep = 0
  for (let i = 1; i < after.length; i++) maxStep = Math.max(maxStep, Math.sqrt((after[i].x - after[i - 1].x) ** 2 + (after[i].z - after[i - 1].z) ** 2))
  const end = c.piecePosition
  const moved = end.z - target.z
  log(`${ctx}: start jump ${startJump.toFixed(2)} cm, max step ${maxStep.toFixed(2)} cm/frame, moved ${moved.toFixed(1)} cm in z, end ${JSON.stringify(end)}`)
  expect(startJump < 3, `${ctx}: no jump at the swap (${startJump.toFixed(2)} cm)`).toBe(true)
  expect(maxStep < 5, `${ctx}: no jump during the drag (${maxStep.toFixed(2)} cm/frame)`).toBe(true)
  expect(moved > 15, `${ctx}: the same pinch dragged the new current piece (${moved.toFixed(1)} cm)`).toBe(true)
  // One unbroken drag from the swap until release (LEAF releases a few frames before its promise resolves).
  const released = after.findIndex((s) => !s.dragging)
  const held = released < 0 ? after : after.slice(0, released)
  expect(held.length > 5, `${ctx}: dragging from the swap on (${held.length} frames)`).toBe(true)
  expect(after.slice(held.length).every((s) => !s.dragging), `${ctx}: one continuous drag (no release and re-grab)`).toBe(true)
  expect(held.every((s) => s.labels), `${ctx}: labels shown while dragging`).toBe(true)
  expect(held[held.length - 1].z - target.z > 15, `${ctx}: moved while held`).toBe(true)
  expect(c.isDragging, `${ctx}: drag ended on release`).toBe(false)
  expect(c.labelsVisible, `${ctx}: labels hide on release`).toBe(false)
  expect(local("Piece").x, `${ctx}: current piece root moved with it (x)`).toBeCloseTo(end.x, 2)
  expect(local("Piece").z, `${ctx}: current piece root moved with it (z)`).toBeCloseTo(end.z, 2)
  expectNoOverlaps(c, offer, ctx)
}

@component
export class C24GrabPlacedScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C24Interactor")
    const offer = expectedOffer(bundledCatalog(), true)

    // Sofa A placed at the start spot, turned 15°; the new current piece moved off to the left.
    c.rotateLeft()
    expect(c.addPiece(), "addPiece()").toBe(true)
    c.setPiecePosition(-160, -420)
    await sleep(100)
    expectNoOverlaps(c, offer, "setup")

    await grabPlaced(c, offer, it, "grab placed Sofa A")
    await grabPlaced(c, offer, it, "grab it back")

    await resetState()
    log("C24 done")
  }
}
