/**
 * Done criterion 4 (rotation) — RotateLeftButton / RotateRightButton turn the piece in
 * 15° steps and the outline turns with it; a rotation that would overlap a wall is
 * nudged to the nearest valid spot.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {angDiffDeg, log, obj, placementValid, resetState, tap, yawOf} from "./SidleTestHelpers"

function checkYaw(c: SidleController, deg: number, ctx: string): void {
  expect(angDiffDeg(c.rotationDeg, deg) < 0.01, `${ctx}: rotationDeg ${c.rotationDeg} vs ${deg}`).toBe(true)
  const py = (yawOf(obj("Piece").getTransform()) * 180) / Math.PI
  const oy = (yawOf(obj("FloorOutline").getTransform()) * 180) / Math.PI
  expect(angDiffDeg(py, deg) < 0.5, `${ctx}: piece yaw ${py.toFixed(2)}`).toBe(true)
  expect(angDiffDeg(oy, deg) < 0.5, `${ctx}: outline yaw ${oy.toFixed(2)}`).toBe(true)
  // Front edge line direction in room space must follow the rotation
  const fe = obj("Edge_Front").getTransform()
  const ot = obj("FloorOutline").getTransform()
  const worldDir = ot.getLocalRotation().multiplyVec3(new vec3(1, 0, 0))
  const want = new vec3(Math.cos((deg * Math.PI) / 180), 0, -Math.sin((deg * Math.PI) / 180))
  expect(worldDir.distance(want) < 0.01, `${ctx}: outline long edge direction ${worldDir}`).toBe(true)
  expect(fe.getLocalScale().x, `${ctx}: edge length unchanged`).toBeCloseTo(224, 1)
}

@component
export class C4cRotateScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C4cInteractor")
    const pos0 = c.piecePosition
    checkYaw(c, 0, "start")

    await tap(it, "RotateLeftButton")
    checkYaw(c, 15, "left x1")
    await tap(it, "RotateLeftButton")
    checkYaw(c, 30, "left x2")
    await tap(it, "RotateRightButton")
    checkYaw(c, 15, "right x1")
    await tap(it, "RotateRightButton")
    await tap(it, "RotateRightButton")
    checkYaw(c, 345, "right x3 (-15)")
    expect(c.piecePosition.x, "rotation in place (x)").toBeCloseTo(pos0.x, 1)
    expect(c.piecePosition.z, "rotation in place (z)").toBeCloseTo(pos0.z, 1)
    expect(obj("Piece").getTransform().getLocalPosition().y, "on floor").toBeCloseTo(0, 2)

    // Six more left presses -> 75°, outline turned with it; at the start spot a 75°
    // sofa (world extents ~144 x 236 cm) still fits, so no nudge.
    for (let i = 0; i < 6; i++) await tap(it, "RotateLeftButton")
    checkYaw(c, 75, "left to 75")
    expect(placementValid(c.piecePosition.x, c.piecePosition.z, 220, 90, c.rotationDeg), "valid at 75°").toBe(true)

    // Rotation next to a wall gets nudged: sofa at 0° flush against the right wall,
    // rotate 15° -> its corners would cross the wall unless moved.
    await resetState()
    c.setPiecePosition(90, -220) // API setup: right edge on the wall line
    await sleep(50)
    await tap(it, "RotateLeftButton")
    const p = c.piecePosition
    log(`rotate at wall -> ${JSON.stringify(p)} rot ${c.rotationDeg}`)
    checkYaw(c, 15, "at wall")
    expect(p.x < 90, `nudged away from the wall (x ${p.x})`).toBe(true)
    expect(placementValid(p.x, p.z, 220, 90, c.rotationDeg), "no overlap after rotate at wall").toBe(true)

    await resetState()
    log("C4c done")
  }
}
