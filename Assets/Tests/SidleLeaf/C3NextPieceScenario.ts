/**
 * Done criterion 3 (Update 2) — pinch NextButton: steps through the available
 * types in order (sofa, chair, table, bed) and wraps back to the first type,
 * showing each type's first variant in the same spot + facing, on the floor,
 * with the outline matching its footprint.
 * Also: from a later variant (Sofa B) Next still goes to the next type's first
 * variant, and a swap that would overlap is nudged to the nearest valid spot.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {
  angDiffDeg,
  bundledCatalog,
  expectedOffer,
  ExpectedVariant,
  local,
  log,
  meshBounds,
  obj,
  offeredKeys,
  panelText,
  placementValid,
  resetState,
  ROOM,
  tap,
  yawOf,
} from "./SidleTestHelpers"

function checkPiece(c: SidleController, v: ExpectedVariant, allKeys: string[], pos: {x: number; z: number}, rotDeg: number): void {
  const key = v.key
  const dims = {w: v.w, d: v.d, h: v.h}
  expect(c.currentPieceKey, "piece key").toBe(key)
  expect(JSON.stringify(c.currentDims), `${key} dims`).toBe(JSON.stringify(dims))
  expect(panelText("PieceNameLabel"), `${key}: panel name`).toBe(v.name)
  for (const k of allKeys) expect(obj(`Piece_${k}`).enabled, `Piece_${k} enabled`).toBe(k === key)
  expect(c.piecePosition.x, `${key}: same spot x`).toBeCloseTo(pos.x, 1)
  expect(c.piecePosition.z, `${key}: same spot z`).toBeCloseTo(pos.z, 1)
  expect(c.rotationDeg, `${key}: same facing`).toBeCloseTo(rotDeg, 1)
  const pt = obj("Piece").getTransform()
  expect(pt.getLocalPosition().y, `${key}: on floor`).toBeCloseTo(0, 2)
  expect(angDiffDeg((yawOf(pt) * 180) / Math.PI, rotDeg) < 0.5, `${key}: piece transform yaw`).toBe(true)
  const root = obj(`Piece_${key}`)
  if (!v.imported) {
    // first child box of each built-in piece is its base/frame/top; lowest part touches the floor
    let minY = Number.MAX_VALUE
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const t = root.getChild(i).getTransform()
      minY = Math.min(minY, t.getLocalPosition().y - t.getLocalScale().y / 2)
    }
    expect(minY, `${key}: lowest part at floor`).toBeCloseTo(0, 2)
  } else {
    const b = meshBounds(root, obj("Piece"))
    expect(b !== null, `${key}: has geometry`).toBe(true)
    expect(Math.abs(b!.min.y) <= 0.5, `${key}: lowest point at floor (min y ${b!.min.y})`).toBe(true)
  }
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
    const offer = expectedOffer(bundledCatalog(), true)
    const allKeys = offeredKeys(offer)
    log(`expected types ${offer.map((t) => `${t.type}[${t.variants.map((v) => v.key).join(",")}]`).join(" -> ")}`)
    expect(offer.map((t) => t.type).join(","), "bundled catalog gives all four types").toBe("sofa,chair,table,bed")
    expect(c.availableTypes.join(","), "controller type order").toBe(offer.map((t) => t.type).join(","))
    const first = offer.map((t) => t.variants[0])

    // Turn it 15° first (real button) so "facing the same way" is meaningful.
    await tap(it, "RotateLeftButton")
    const rot = c.rotationDeg
    expect(rot, "rotated 15° before cycling").toBeCloseTo(15, 1)
    const pos = c.piecePosition
    log(`start pos ${JSON.stringify(pos)} rot ${rot}`)

    // Two full rounds: every type's first variant, then wrap to the first type.
    checkPiece(c, first[0], allKeys, pos, rot)
    expect(first[0].key, "first type's first variant is Sofa A").toBe("SofaA")
    for (let round = 0; round < 2; round++) {
      for (let i = 1; i <= first.length; i++) {
        await tap(it, "NextButton")
        const v = first[i % first.length]
        expect(c.currentPieceType, `Next #${i} (round ${round + 1}) type`).toBe(offer[i % offer.length].type)
        checkPiece(c, v, allKeys, pos, rot)
      }
    }

    // From a later variant (Sofa B) Next still shows the next type's first variant.
    await tap(it, "CompareButton")
    checkPiece(c, offer[0].variants[1], allKeys, pos, rot)
    expect(c.currentPieceKey, "Compare from Sofa A").toBe("SofaB")
    await tap(it, "NextButton")
    checkPiece(c, first[1], allKeys, pos, rot)
    for (let i = 2; i <= first.length; i++) await tap(it, "NextButton")
    checkPiece(c, first[0], allKeys, pos, rot)

    // Swap that would overlap: Sofa A near the far wall, then Next through the types
    // to the bed (200 deep), which must be nudged to the nearest valid spot.
    c.setPiecePosition(0, ROOM.minZ + 60) // API setup: sofa back edge 15 cm off the far wall
    await sleep(100)
    const near = c.piecePosition
    const bedAt = offer.findIndex((t) => t.type === "bed")
    for (let i = 1; i <= bedAt; i++) {
      await tap(it, "NextButton")
      const v = first[i]
      const p = c.piecePosition
      expect(c.currentPieceKey, `Next #${i} near far wall`).toBe(v.key)
      if (i < bedAt) {
        expect(placementValid(near.x, near.z, v.w, v.d, rot), `${v.key} fits at the spot`).toBe(true)
        expect(p.x, `${v.key}: same spot x`).toBeCloseTo(near.x, 1)
        expect(p.z, `${v.key}: same spot z`).toBeCloseTo(near.z, 1)
      }
    }
    const bp = c.piecePosition
    log(`bed after swap near far wall: ${JSON.stringify(bp)} clearances ${JSON.stringify(c.clearances)}`)
    expect(c.currentPieceKey, "bed after swap").toBe("Bed")
    expect(placementValid(near.x, near.z, 160, 200, c.rotationDeg), "bed would overlap at the old spot").toBe(false)
    expect(placementValid(bp.x, bp.z, 160, 200, c.rotationDeg), `bed inside room, not overlapping coffee table (${JSON.stringify(bp)})`).toBe(true)
    expect(c.rotationDeg, "bed keeps facing after swap").toBeCloseTo(rot, 1)
    expect(local("Piece").y, "bed on floor").toBeCloseTo(0, 2)
    await resetState()
    log("C3 done")
  }
}
