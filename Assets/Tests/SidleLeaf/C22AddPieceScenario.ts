/**
 * Done criterion 19 (Update 6) — Add leaves the current piece exactly where it
 * is as a placed piece (same variant, spot and facing) with its own model and a
 * faint neutral outline, and starts a new current piece on the next type (as
 * Next piece would choose) at the nearest spot where it overlaps nothing; Add
 * is greyed out at six pieces (a real pinch on it does nothing).
 * Expected variants and sizes come from the bundled catalog; the nearest free
 * spot is found independently by a 2 cm grid search.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {SidleController} from "../../Scripts/SidleController"
import {
  angDiffDeg,
  bundledCatalog,
  expectedOffer,
  interactable,
  obj,
  ExpectedType,
  expectGreyedButton,
  expectNoOverlaps,
  findChild,
  footprint,
  footprintsOverlap,
  isNeutral,
  log,
  MAX_PIECES_BRIEF,
  meshBounds,
  nextTypeFirstKey,
  placedFootprint,
  placedRoot,
  placementValid,
  resetState,
  ROOM,
  tap,
  variantOf,
  yawOf,
} from "./SidleTestHelpers"

/** Independent nearest spot (2 cm grid) to `from` where a w × d piece at yawDeg is valid and clear of the placed pieces. */
function nearestFreeDistance(c: SidleController, offer: ExpectedType[], from: {x: number; z: number}, w: number, d: number, yawDeg: number): number {
  const placed = c.placedPieces.map((p) => placedFootprint(p, offer))
  let best = Infinity
  for (let x = ROOM.minX; x <= ROOM.maxX; x += 2) {
    for (let z = ROOM.minZ; z <= ROOM.maxZ; z += 2) {
      const dist = Math.sqrt((x - from.x) ** 2 + (z - from.z) ** 2)
      if (dist >= best) continue
      if (!placementValid(x, z, w, d, yawDeg)) continue
      const fp = footprint(x, z, w, d, yawDeg)
      if (placed.some((p) => footprintsOverlap(fp, p))) continue
      best = dist
    }
  }
  return best
}

@component
export class C22AddPieceScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C22Interactor")
    const offer = expectedOffer(bundledCatalog(), true)

    // Start: one piece; Add enabled, Remove greyed.
    expect(c.pieceCount, "start: one piece").toBe(1)
    expect(c.placedPieces.length, "start: nothing placed").toBe(0)
    expect(c.canAdd, "start: canAdd").toBe(true)

    // Turn the piece so "same facing" is meaningful.
    await tap(it, "RotateLeftButton")
    await tap(it, "RotateLeftButton")
    let guard = 0
    while (c.pieceCount < MAX_PIECES_BRIEF && guard++ < 10) {
      const n = c.pieceCount
      const prev = {id: c.currentPieceId, key: c.currentPieceKey, pos: c.piecePosition, yaw: c.rotationDeg}
      const before = c.placedPieces
      const ctx = `Add #${n}`
      await tap(it, "AddButton")
      await sleep(100)

      // The previous current piece is placed exactly where it was.
      const placed = c.placedPieces
      expect(c.pieceCount, `${ctx}: piece count`).toBe(n + 1)
      expect(placed.length, `${ctx}: placed count`).toBe(n)
      expect(JSON.stringify(placed.slice(0, n - 1)), `${ctx}: earlier placed pieces unchanged`).toBe(JSON.stringify(before))
      const pp = placed[n - 1]
      log(`${ctx}: placed ${JSON.stringify(pp)} (was current ${JSON.stringify(prev)})`)
      expect(pp.id, `${ctx}: placed piece keeps its id`).toBe(prev.id)
      expect(pp.key, `${ctx}: same variant`).toBe(prev.key)
      expect(pp.x, `${ctx}: same x`).toBeCloseTo(prev.pos.x, 3)
      expect(pp.z, `${ctx}: same z`).toBeCloseTo(prev.pos.z, 3)
      expect(angDiffDeg(pp.yawDeg, prev.yaw) < 0.01, `${ctx}: same facing`).toBe(true)

      // Its scene instance: at the spot, its own model of the catalog size, neutral outline, no labels.
      const root = placedRoot(pp.id)
      expect(root !== null, `${ctx}: PlacedPiece_${pp.id} in the scene`).toBe(true)
      const rt = root!.getTransform()
      expect(rt.getLocalPosition().x, `${ctx}: scene x`).toBeCloseTo(pp.x, 2)
      expect(rt.getLocalPosition().z, `${ctx}: scene z`).toBeCloseTo(pp.z, 2)
      expect(rt.getLocalPosition().y, `${ctx}: on the floor`).toBeCloseTo(0, 2)
      expect(angDiffDeg((yawOf(rt) * 180) / Math.PI, pp.yawDeg) < 0.05, `${ctx}: scene facing`).toBe(true)
      const v = variantOf(offer, pp.key)
      const visual = findChild(root!, `PlacedVisual_${pp.key}`)
      expect(visual.isEnabledInHierarchy, `${ctx}: placed model visible`).toBe(true)
      const b = meshBounds(visual, root!)!
      const size = b.max.sub(b.min)
      log(`${ctx}: placed model ${size.x.toFixed(1)} x ${size.z.toFixed(1)} x ${size.y.toFixed(1)} (catalog ${v.w} x ${v.d} x ${v.h})`)
      expect(Math.abs(size.x - v.w) <= 1 && Math.abs(size.z - v.d) <= 1 && Math.abs(size.y - v.h) <= 1, `${ctx}: placed model is ${v.w} x ${v.d} x ${v.h}`).toBe(true)
      expect(b.min.y >= -0.5, `${ctx}: placed model stands on the floor`).toBe(true)
      for (const e of ["Front", "Right", "Back", "Left"]) {
        const rmv = findChild(root!, `PlacedEdge_${e}`).getComponent("Component.RenderMeshVisual") as RenderMeshVisual
        const col = rmv.mainMaterial.mainPass.baseColor
        expect(isNeutral(col), `${ctx}: PlacedEdge_${e} neutral grey (got ${col})`).toBe(true)
      }
      const outline = findChild(root!, "PlacedOutline")
      const ob = meshBounds(outline, root!)!
      expect(ob.max.x - ob.min.x, `${ctx}: placed outline matches the width`).toBeCloseTo(v.w + 4, 1)
      expect(ob.max.z - ob.min.z, `${ctx}: placed outline matches the depth`).toBeCloseTo(v.d + 4, 1)
      // Outline + labels are only drawn for the current piece.
      expect(c.labelsVisible, `${ctx}: no labels (Measure off)`).toBe(false)

      // New current piece: next type's first variant, a new id, at the nearest non-overlapping spot.
      const want = nextTypeFirstKey(offer, prev.key)
      expect(c.currentPieceKey, `${ctx}: new current piece is the next type's first variant`).toBe(want)
      expect(c.currentPieceId !== prev.id && placed.every((q) => q.id !== c.currentPieceId), `${ctx}: new current piece has a new id`).toBe(true)
      expectNoOverlaps(c, offer, ctx)
      const nv = variantOf(offer, want)
      const moved = Math.sqrt((c.piecePosition.x - prev.pos.x) ** 2 + (c.piecePosition.z - prev.pos.z) ** 2)
      const nearest = nearestFreeDistance(c, offer, prev.pos, nv.w, nv.d, c.rotationDeg)
      log(`${ctx}: new ${want} at ${JSON.stringify(c.piecePosition)} ${c.rotationDeg}°, ${moved.toFixed(1)} cm from the previous piece (nearest free spot ${nearest.toFixed(1)} cm)`)
      // Tolerance: SidleGeometry.resolvePlacement searches in 5 cm rings, this check on a 2 cm grid.
      expect(moved <= nearest + 6, `${ctx}: new piece at the nearest free spot (${moved.toFixed(1)} vs ${nearest.toFixed(1)} cm)`).toBe(true)
      expect(c.isDragging, `${ctx}: not dragging`).toBe(false)

      // After the first Add, put the current piece back to 0° (current only) so six pieces fit.
      if (n === 1) {
        await tap(it, "RotateRightButton")
        await tap(it, "RotateRightButton")
        expect(JSON.stringify(c.placedPieces), "rotate acts on the current piece only").toBe(JSON.stringify(placed))
      }
    }

    // Six pieces: Add greyed out; a real pinch and the API both do nothing.
    expect(c.pieceCount, "six pieces in the room").toBe(MAX_PIECES_BRIEF)
    expect(c.canAdd, "canAdd at six").toBe(false)
    const snap = JSON.stringify({p: c.placedPieces, k: c.currentPieceKey, id: c.currentPieceId, pos: c.piecePosition})
    await expectGreyedButton("AddButton", "six pieces")
    expect(c.addPiece(), "addPiece() at six").toBe(false)
    expect(JSON.stringify({p: c.placedPieces, k: c.currentPieceKey, id: c.currentPieceId, pos: c.piecePosition}), "nothing changed at six").toBe(snap)

    // One fewer: Add is live again.
    expect(c.removePiece(), "removePiece()").toBe(true)
    await sleep(100)
    expect(c.canAdd, "canAdd at five").toBe(true)
    const addBtn = obj("AddButton").getComponent(Button.getTypeName()) as Button
    expect(addBtn.inactive, "AddButton no longer greyed at five").toBe(false)
    expect(interactable("AddButton").enabled, "AddButton interactable enabled at five").toBe(true)

    await resetState()
    expect(c.pieceCount, "reset: one piece").toBe(1)
    log("C22 done")
  }
}
