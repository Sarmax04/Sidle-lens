/**
 * Done criterion 1 — start state. Must run on a freshly reset Lens (first scenario
 * after a preview refresh); it does not reset state itself.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {controller, expectEdges, insideRoom, local, log, obj} from "./SidleTestHelpers"

@component
export class C1StartStateScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const c = controller()

    // Room stand-in: 4 x 5 m, doorway 90 x 200 in the near short wall
    const R = c.roomSpec
    log(`roomSpec ${JSON.stringify(R)}`)
    expect(R.maxX - R.minX, "room width cm").toBeCloseTo(400, 1)
    expect(R.maxZ - R.minZ, "room depth cm").toBeCloseTo(500, 1)
    const door = obj("Doorway")
    const jl = findSceneObjectByName("Jamb_Left", door)!.getTransform().getLocalPosition()
    const jr = findSceneObjectByName("Jamb_Right", door)!.getTransform().getLocalPosition()
    const head = findSceneObjectByName("Head", door)!.getTransform().getLocalPosition()
    // jambs are 5 cm wide boxes centred 2.5 cm outside the opening
    expect(jr.x - jl.x - 5, "doorway opening width").toBeCloseTo(90, 1)
    expect(head.y - 2.5, "doorway opening height").toBeCloseTo(200, 1)
    expect(local("Doorway").z, "doorway sits on near wall line").toBeCloseTo(R.maxZ, 1)

    // User just inside the doorway, facing into the room
    const roomT = obj("VirtualRoom").getTransform()
    const camW = WorldCameraFinderProvider.getInstance().getTransform().getWorldPosition()
    const cam = roomT.getInvertedWorldTransform().multiplyPoint(camW)
    log(`camera room-local ${cam}`)
    expect(cam.z < R.maxZ && cam.z > R.maxZ - 60, `camera just inside doorway (z=${cam.z})`).toBe(true)
    expect(Math.abs(cam.x) < 45, `camera in line with doorway (x=${cam.x})`).toBe(true)

    // Sofa A, 220 x 90 x 85, light gray
    expect(c.currentPieceKey, "start piece").toBe("SofaA")
    expect(c.currentPieceName, "start piece name").toBe("Sofa A")
    expect(JSON.stringify(c.currentDims), "Sofa A dims").toBe(JSON.stringify({w: 220, d: 90, h: 85}))
    expect(obj("Piece_SofaA").enabled, "Piece_SofaA visible").toBe(true)
    for (const n of ["Piece_SofaB", "Piece_Bed", "Piece_DiningTable"]) expect(obj(n).enabled, `${n} hidden`).toBe(false)
    const base = obj("Piece_SofaA").getChild(0)
    const col = (base.getComponent("Component.RenderMeshVisual") as RenderMeshVisual).mainMaterial.mainPass.baseColor
    log(`Sofa A base color ${col}`)
    expect(col.x > 0.7 && col.y > 0.7 && col.z > 0.7, `light (got ${col})`).toBe(true)
    expect(Math.max(col.x, col.y, col.z) - Math.min(col.x, col.y, col.z) < 0.06, `gray (got ${col})`).toBe(true)

    // On the floor, in the middle of the room, about 2 m ahead
    const pr = local("Piece")
    expect(pr.y, "piece root on floor").toBeCloseTo(0, 2)
    const bl = base.getTransform().getLocalPosition()
    const bs = base.getTransform().getLocalScale()
    expect(bl.y - bs.y / 2, "sofa base bottom at floor").toBeCloseTo(0, 2)
    expect(c.piecePosition.x, "piece centred in X").toBeCloseTo(0, 1)
    expect(c.piecePosition.z, "piece z room-local").toBeCloseTo(-220, 1)
    const horiz = Math.sqrt((cam.x - pr.x) ** 2 + (cam.z - pr.z) ** 2)
    log(`horizontal distance camera->piece centre ${horiz.toFixed(1)} cm`)
    expect(horiz > 180 && horiz < 260, `about 2 m in front (got ${horiz})`).toBe(true)
    expect(pr.z < cam.z, "piece is in front (-Z) of the user").toBe(true)
    expect(insideRoom(pr.x, pr.z, 220, 90), "piece inside room").toBe(true)
    expect(c.rotationDeg, "start rotation").toBeCloseTo(0, 2)

    // >= 80 cm clear everywhere at start; outline green; no labels / gap number
    log(`clearances ${JSON.stringify(c.clearances)}`)
    expect(c.nearestGapCm >= 80, `nearest gap >= 80 (got ${c.nearestGapCm})`).toBe(true)
    expect(c.isClear, "isClear").toBe(true)
    expectEdges(c, ["green", "green", "green", "green"], "start")
    expect(c.measureOn, "Measure off").toBe(false)
    expect(c.labelsVisible, "labelsVisible").toBe(false)
    expect(obj("DimensionLabels").enabled, "DimensionLabels hidden").toBe(false)
    expect(c.gapLabelVisible, "gapLabelVisible").toBe(false)
    expect(obj("GapLabel").enabled, "GapLabel hidden").toBe(false)
    // Outline matches the footprint and sits under the piece
    const fo = local("FloorOutline")
    expect(fo.x, "outline x").toBeCloseTo(pr.x, 1)
    expect(fo.z, "outline z").toBeCloseTo(pr.z, 1)
    expect(obj("Edge_Front").getTransform().getLocalScale().x, "outline width = 220 + 2*(line)").toBeCloseTo(224, 1)
    expect(obj("Edge_Right").getTransform().getLocalScale().z, "outline depth = 90 + 2*(line)").toBeCloseTo(94, 1)
    log("C1 done")
  }
}
