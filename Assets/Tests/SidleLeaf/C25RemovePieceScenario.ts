/**
 * Done criterion 22 (Update 6) — Remove deletes the current piece and makes the
 * most recently placed piece current where it stands (same variant, spot and
 * facing); Remove is greyed out when only one piece is left (a real pinch on it
 * does nothing). "Most recently placed" follows swaps too (criterion 21).
 * Expected variants come from the bundled catalog.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {SidleController, PlacedPiece} from "../../Scripts/SidleController"
import {
  angDiffDeg,
  bundledCatalog,
  expectedOffer,
  expectGreyedButton,
  expectNoOverlaps,
  interactable,
  log,
  obj,
  placedRoot,
  resetState,
  tap,
} from "./SidleTestHelpers"

function expectBecameCurrent(c: SidleController, p: PlacedPiece, ctx: string): void {
  expect(c.currentPieceId, `${ctx}: current id`).toBe(p.id)
  expect(c.currentPieceKey, `${ctx}: current variant`).toBe(p.key)
  expect(c.piecePosition.x, `${ctx}: where it stood (x)`).toBeCloseTo(p.x, 3)
  expect(c.piecePosition.z, `${ctx}: where it stood (z)`).toBeCloseTo(p.z, 3)
  expect(angDiffDeg(c.rotationDeg, p.yawDeg) < 0.01, `${ctx}: same facing`).toBe(true)
  expect(obj(`Piece_${p.key}`).enabled, `${ctx}: its visual shows as the current piece`).toBe(true)
  expect(placedRoot(p.id), `${ctx}: no longer shown as placed`).toBe(null)
}

@component
export class C25RemovePieceScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C25Interactor")
    const offer = expectedOffer(bundledCatalog(), true)

    // One piece: Remove greyed out; pinch and API do nothing.
    expect(c.canRemove, "one piece: canRemove").toBe(false)
    const snap0 = JSON.stringify({id: c.currentPieceId, k: c.currentPieceKey, p: c.piecePosition})
    await expectGreyedButton("RemoveButton", "one piece")
    expect(c.removePiece(), "removePiece() with one piece").toBe(false)
    expect(JSON.stringify({id: c.currentPieceId, k: c.currentPieceKey, p: c.piecePosition}), "one piece: nothing changed").toBe(snap0)

    // Three pieces with different facings.
    await tap(it, "RotateLeftButton")
    await tap(it, "AddButton") // Sofa A placed at 15°
    await tap(it, "RotateLeftButton")
    await tap(it, "AddButton") // next type placed at 30°
    expect(c.pieceCount, "three pieces").toBe(3)
    const removeBtn = obj("RemoveButton").getComponent(Button.getTypeName()) as Button
    expect(removeBtn.inactive, "Remove live with three pieces").toBe(false)
    expect(interactable("RemoveButton").enabled, "Remove interactable enabled").toBe(true)
    const [p1, p2] = c.placedPieces
    const removed = c.currentPieceId
    log(`placed ${JSON.stringify(c.placedPieces)}, current #${removed} ${c.currentPieceKey}`)

    // Remove: current deleted, the most recently placed (p2) is current where it stands.
    await tap(it, "RemoveButton")
    expectBecameCurrent(c, p2, "Remove #1")
    expect(c.pieceCount, "Remove #1: two pieces").toBe(2)
    expect(JSON.stringify(c.placedPieces), "Remove #1: the earlier placed piece untouched").toBe(JSON.stringify([p1]))
    expect(c.placedPieces.concat([]).every((p) => p.id !== removed) && c.currentPieceId !== removed, "Remove #1: the removed piece is gone").toBe(true)
    expectNoOverlaps(c, offer, "Remove #1")

    // Order follows swaps: add again, grab p1 (it becomes current, p2 becomes the last placed), then Remove.
    await tap(it, "AddButton")
    const p2now = c.placedPieces.find((p) => p.id === p2.id)!
    await it.drag(interactable(`PlacedGrab_${p1.id}`), new vec3(0, 0, 0.3), 200)
    await sleep(150)
    expect(c.currentPieceId, "swap: p1 current").toBe(p1.id)
    const last = c.placedPieces[c.placedPieces.length - 1]
    log(`after swap placed ${JSON.stringify(c.placedPieces)}`)
    await tap(it, "RemoveButton")
    expectBecameCurrent(c, last, "Remove after swap")
    expect(c.placedPieces.some((p) => p.id === p2now.id) || c.currentPieceId === p2now.id, "p2 still in the room").toBe(true)

    // Down to one piece: Remove greyed again.
    while (c.canRemove) await tap(it, "RemoveButton")
    expect(c.pieceCount, "one piece left").toBe(1)
    expect(c.placedPieces.length, "nothing placed").toBe(0)
    await sleep(100)
    await expectGreyedButton("RemoveButton", "one piece again")
    for (const id of [p1.id, p2.id, removed]) if (id !== c.currentPieceId) expect(placedRoot(id), `PlacedPiece_${id} destroyed`).toBe(null)

    await resetState()
    log("C25 done")
  }
}
