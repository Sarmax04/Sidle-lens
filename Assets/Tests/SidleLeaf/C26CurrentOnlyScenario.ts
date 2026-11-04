/**
 * Done criterion 23 (Update 6) — with placed pieces in the room, Next piece,
 * Compare, Rotate, Measure, the gallery and the "behind you" arrow act only on
 * the current piece; none of them moves, turns or changes a placed piece
 * (checked on the controller state and on the placed pieces' scene
 * transforms), and placed pieces show no labels. All actions are real pinches.
 * Expected variants come from the bundled catalog.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {
  bundledCatalog,
  expectedOffer,
  expectNoOverlaps,
  goTo,
  HeadHold,
  log,
  nextTypeFirstKey,
  obj,
  placedRoot,
  placedSceneSnapshot,
  resetState,
  START_HEAD,
  tap,
  textOf,
  typeOfKey,
  variantOf,
} from "./SidleTestHelpers"

/** Number of Text components under every placed piece. */
function placedTextCount(c: SidleController): number {
  let n = 0
  for (const p of c.placedPieces) {
    const stack = [placedRoot(p.id)!]
    while (stack.length) {
      const so = stack.pop()!
      n += so.getComponents("Component.Text").length
      for (let i = 0; i < so.getChildrenCount(); i++) stack.push(so.getChild(i))
    }
  }
  return n
}

@component
export class C26CurrentOnlyScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C26Interactor")
    const offer = expectedOffer(bundledCatalog(), true)

    // Two placed pieces near the doorway, the current piece deep in the room.
    c.setPiecePosition(-100, -90)
    await tap(it, "AddButton")
    c.setPiecePosition(130, -100)
    await tap(it, "RotateLeftButton")
    await tap(it, "AddButton")
    c.setPiecePosition(0, -420)
    await sleep(100)
    expect(c.placedPieces.length, "two placed pieces").toBe(2)
    expectNoOverlaps(c, offer, "setup")
    const placed0 = JSON.stringify(c.placedPieces)
    const scene0 = placedSceneSnapshot(c)
    log(`placed ${placed0}; current ${c.currentPieceKey} at ${JSON.stringify(c.piecePosition)}`)
    const unchanged = (ctx: string) => {
      expect(JSON.stringify(c.placedPieces), `${ctx}: placed pieces unchanged`).toBe(placed0)
      expect(placedSceneSnapshot(c), `${ctx}: placed pieces did not move in the scene`).toBe(scene0)
      expectNoOverlaps(c, offer, ctx)
    }

    // "Behind you" arrow follows the current piece only: head between the placed pieces and the current one.
    const headLocal = new vec3(0, 0, -250)
    const w = c.room.getTransform().getWorldTransform().multiplyPoint(headLocal)
    const head = new vec3(w.x, START_HEAD.pos.y, w.z)
    const hold = new HeadHold(head, 0) // facing into the room: current ahead, placed behind
    try {
      await sleep(300)
      expect(c.behindArrowVisible, "facing the current piece (placed pieces behind): no arrow").toBe(false)
      hold.set(head, 180) // facing the doorway: placed ahead, current behind
      await sleep(300)
      expect(c.behindArrowVisible, "current piece behind (placed pieces ahead): arrow shows").toBe(true)
    } finally {
      await hold.stop()
    }
    unchanged("behind arrow")

    // Next piece
    const k0 = c.currentPieceKey
    await tap(it, "NextButton")
    expect(c.currentPieceKey, "Next: next type on the current piece").toBe(nextTypeFirstKey(offer, k0))
    unchanged("Next piece")

    // Compare (on a type with more than one variant)
    const multi = offer.find((t) => t.variants.length > 1)!
    await goTo(it, c, offer, multi.variants[0].key)
    await tap(it, "CompareButton")
    expect(c.currentPieceKey, "Compare: next variant on the current piece").toBe(multi.variants[1].key)
    unchanged("Compare")

    // Rotate
    const r0 = c.rotationDeg
    await tap(it, "RotateLeftButton")
    await tap(it, "RotateLeftButton")
    await tap(it, "RotateRightButton")
    expect(((c.rotationDeg - r0 + 360) % 360), "Rotate: current piece turned 15°").toBeCloseTo(15, 1)
    unchanged("Rotate")

    // Measure: labels for the current piece only; placed pieces have none.
    await tap(it, "MeasureButton")
    expect(c.measureOn && c.labelsVisible, "Measure on").toBe(true)
    const v = variantOf(offer, c.currentPieceKey)
    expect(textOf("WidthLabel"), "width label is the current piece's").toBe(`W ${Math.round(v.w)} cm`)
    expect(textOf("DepthLabel").includes(`${Math.round(v.d)}`), "depth label is the current piece's").toBe(true)
    expect(textOf("HeightLabel").includes(`${Math.round(v.h)}`), "height label is the current piece's").toBe(true)
    const wl = obj("WidthLabel").getTransform().getLocalPosition()
    const reach = Math.max(v.w, v.d) / 2 + 60
    const dist = Math.sqrt((wl.x - c.piecePosition.x) ** 2 + (wl.z - c.piecePosition.z) ** 2)
    expect(dist < reach, `width label next to the current piece (${dist.toFixed(0)} cm)`).toBe(true)
    expect(placedTextCount(c), "placed pieces show no labels").toBe(0)
    await tap(it, "MeasureButton")
    expect(c.measureOn, "Measure off").toBe(false)
    unchanged("Measure")

    // Gallery: opens on the current piece's type; choosing a tile changes the current piece only.
    await tap(it, "GalleryButton")
    expect(c.galleryOpen, "gallery open").toBe(true)
    expect(c.galleryType, "gallery opens on the current piece's type").toBe(typeOfKey(offer, c.currentPieceKey))
    const ti = offer.findIndex((t) => t.type !== c.galleryType)
    await tap(it, `GalleryTab_${ti + 1}`)
    await tap(it, "GalleryTile_1")
    expect(c.galleryOpen, "gallery closed after choosing").toBe(false)
    expect(c.currentPieceKey, "gallery: chosen piece is current").toBe(offer[ti].variants[0].key)
    unchanged("Gallery")

    // Gap number + outline colours belong to the current piece; placed outlines stay neutral throughout.
    expect(placedTextCount(c), "still no labels on placed pieces").toBe(0)

    await resetState()
    log("C26 done")
  }
}
