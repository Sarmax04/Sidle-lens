/**
 * Done criterion 3 — pinch NextButton: Sofa A -> Bed -> Dining table -> Sofa A,
 * same spot + facing, on the floor, outline matching each footprint.
 * Also: Sofa B -> Next -> Bed (brief rule), via CompareButton then NextButton.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {angDiffDeg, local, log, obj, placementValid, resetState, tap, yawOf} from "./SidleTestHelpers"

const KEYS = ["SofaA", "SofaB", "Bed", "DiningTable"]

function checkPiece(
  c: SidleController,
  key: string,
  dims: {w: number; d: number; h: number},
  pos: {x: number; z: number},
  rotDeg: number,
): void {
  expect(c.currentPieceKey, "piece key").toBe(key)
  expect(JSON.stringify(c.currentDims), `${key} dims`).toBe(JSON.stringify(dims))
  for (const k of KEYS) expect(obj(`Piece_${k}`).enabled, `Piece_${k} enabled`).toBe(k === key)
  expect(c.piecePosition.x, `${key}: same spot x`).toBeCloseTo(pos.x, 1)
  expect(c.piecePosition.z, `${key}: same spot z`).toBeCloseTo(pos.z, 1)
  expect(c.rotationDeg, `${key}: same facing`).toBeCloseTo(rotDeg, 1)
  const pt = obj("Piece").getTransform()
  expect(pt.getLocalPosition().y, `${key}: on floor`).toBeCloseTo(0, 2)
  expect(angDiffDeg((yawOf(pt) * 180) / Math.PI, rotDeg) < 0.5, `${key}: piece transform yaw`).toBe(true)
  // first child box of each piece is its base/frame/top; lowest part touches the floor
  const root = obj(`Piece_${key}`)
  let minY = Number.MAX_VALUE
  for (let i = 0; i < root.getChildrenCount(); i++) {
    const t = root.getChild(i).getTransform()
    minY = Math.min(minY, t.getLocalPosition().y - t.getLocalScale().y / 2)
  }
  expect(minY, `${key}: lowest part at floor`).toBeCloseTo(0, 2)
  // outline follows + matches footprint (line is 1.5 cm wide, 1.25 cm outside the edge)
  const fo = obj("FloorOutline").getTransform()
  expect(fo.getLocalPosition().x, `${key}: outline x`).toBeCloseTo(pos.x, 1)
  expect(fo.getLocalPosition().z, `${key}: outline z`).toBeCloseTo(pos.z, 1)
  expect(angDiffDeg((yawOf(fo) * 180) / Math.PI, rotDeg) < 0.5, `${key}: outline yaw`).toBe(true)
  const fw = obj("Edge_Front").getTransform().getLocalScale().x
  const fd = obj("Edge_Right").getTransform().getLocalScale().z
  const ff = obj("Edge_Front").getTransform().getLocalPosition().z
  const fr = obj("Edge_Right").getTransform().getLocalPosition().x
  log(`${key}: outline ${fw.toFixed(1)} x ${fd.toFixed(1)}, edges at z=${ff.toFixed(2)} x=${fr.toFixed(2)}`)
  expect(fw, `${key}: outline width`).toBeCloseTo(dims.w + 4, 1)
  expect(fd, `${key}: outline depth`).toBeCloseTo(dims.d + 4, 1)
  expect(ff, `${key}: front edge position`).toBeCloseTo(dims.d / 2 + 1.25, 1)
  expect(fr, `${key}: right edge position`).toBeCloseTo(dims.w / 2 + 1.25, 1)
  expect(c.isClear, `${key}: still clear at this spot`).toBe(true)
}

@component
export class C3NextPieceScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C3Interactor")

    // Turn it 15° first (real button) so "facing the same way" is meaningful.
    await tap(it, "RotateLeftButton")
    const rot = c.rotationDeg
    expect(rot, "rotated 15° before cycling").toBeCloseTo(15, 1)
    const pos = c.piecePosition
    log(`start pos ${JSON.stringify(pos)} rot ${rot}`)

    checkPiece(c, "SofaA", {w: 220, d: 90, h: 85}, pos, rot)
    await tap(it, "NextButton")
    checkPiece(c, "Bed", {w: 160, d: 200, h: 55}, pos, rot)
    expect(obj("PieceNameLabel").getComponent("Component.Text") ? (obj("PieceNameLabel").getComponent("Component.Text") as Text).text : "", "panel name").toBe("Bed")
    await tap(it, "NextButton")
    checkPiece(c, "DiningTable", {w: 160, d: 90, h: 75}, pos, rot)
    await tap(it, "NextButton")
    checkPiece(c, "SofaA", {w: 220, d: 90, h: 85}, pos, rot)

    // Sofa B -> Next -> Bed
    await tap(it, "CompareButton")
    checkPiece(c, "SofaB", {w: 180, d: 85, h: 85}, pos, rot)
    await tap(it, "NextButton")
    checkPiece(c, "Bed", {w: 160, d: 200, h: 55}, pos, rot)
    await tap(it, "NextButton")
    await tap(it, "NextButton")
    checkPiece(c, "SofaA", {w: 220, d: 90, h: 85}, pos, rot)

    // Swap that would overlap: Sofa A near the far wall, then Next -> Bed (200 deep)
    // must be nudged to the nearest valid spot (stays inside the room).
    c.setPiecePosition(0, -400) // API setup
    await sleep(100)
    await tap(it, "NextButton")
    const bp = c.piecePosition
    log(`bed after swap near far wall: ${JSON.stringify(bp)} clearances ${JSON.stringify(c.clearances)}`)
    expect(c.currentPieceKey, "bed after swap").toBe("Bed")
    expect(placementValid(bp.x, bp.z, 160, 200, c.rotationDeg), `bed inside room, not overlapping coffee table (${JSON.stringify(bp)})`).toBe(true)
    expect(c.rotationDeg, "bed keeps facing after swap").toBeCloseTo(rot, 1)
    expect(local("Piece").y, "bed on floor").toBeCloseTo(0, 2)
    log("C3 done")
  }
}
