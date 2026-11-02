/**
 * Done criterion 15 (Update 4) — pinching a gallery tile shows that piece in
 * the same spot and facing as the current one (nudged to the nearest valid spot
 * if it does not fit there) and closes the gallery; the panel comes back.
 * Cases: a piece of another type after a 15° rotation (fits: same spot); the
 * widest piece next to the right wall at 0° (nudged: expected spot worked out
 * here); a piece on page 2 of its type; the piece already showing. Measure is
 * unchanged by every selection. Expectations come from the bundled catalog.
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
  ExpectedType,
  ExpectedVariant,
  galleryShown,
  log,
  obj,
  overlapsCoffee,
  panelObj,
  placementValid,
  resetState,
  ROOM,
  START,
  tap,
  TILES_PER_PAGE,
} from "./SidleTestHelpers"

/** Open the gallery and reach `v` with real pinches: its tab, then Next page as needed, then its tile. */
async function pick(it: DefaultLeafInteractor, c: SidleController, offer: ExpectedType[], v: ExpectedVariant): Promise<void> {
  const ti = offer.findIndex((t) => t.variants.some((x) => x.key === v.key))
  const vi = offer[ti].variants.findIndex((x) => x.key === v.key)
  await tap(it, "GalleryButton")
  expect(c.galleryOpen, `${v.key}: gallery open`).toBe(true)
  await tap(it, `GalleryTab_${ti + 1}`)
  for (let p = 0; p < Math.floor(vi / TILES_PER_PAGE); p++) await tap(it, "GalleryNextButton")
  const slot = vi % TILES_PER_PAGE
  expect(c.galleryPageKeys[slot], `${v.key}: on its tile`).toBe(v.key)
  await tap(it, `GalleryTile_${slot + 1}`)
}

function expectSelected(c: SidleController, v: ExpectedVariant, pos: {x: number; z: number}, rot: number, measure: boolean, ctx: string): void {
  expect(c.currentPieceKey, `${ctx}: piece`).toBe(v.key)
  expect(obj(`Piece_${v.key}`).enabled, `${ctx}: piece visible`).toBe(true)
  expect(JSON.stringify(c.currentDims), `${ctx}: dims`).toBe(JSON.stringify({w: v.w, d: v.d, h: v.h}))
  expect(c.piecePosition.x, `${ctx}: x`).toBeCloseTo(pos.x, 1)
  expect(c.piecePosition.z, `${ctx}: z`).toBeCloseTo(pos.z, 1)
  expect(angDiffDeg(c.rotationDeg, rot) < 0.01, `${ctx}: same facing`).toBe(true)
  expect(placementValid(c.piecePosition.x, c.piecePosition.z, v.w, v.d, c.rotationDeg), `${ctx}: placement valid`).toBe(true)
  expect(c.galleryOpen, `${ctx}: gallery closed`).toBe(false)
  expect(galleryShown(c), `${ctx}: gallery hidden`).toBe(false)
  expect(panelObj(c).isEnabledInHierarchy, `${ctx}: panel back`).toBe(true)
  expect(c.measureOn, `${ctx}: Measure unchanged`).toBe(measure)
}

@component
export class C18GallerySelectScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C18Interactor")
    const offer = expectedOffer(bundledCatalog(), true)
    const all = offer.reduce((a, t) => a.concat(t.variants), [] as ExpectedVariant[])

    // 1. Rotated 15°, a piece of another type that fits at the spot: same spot, same facing.
    await tap(it, "RotateLeftButton")
    const rot = c.rotationDeg
    const pos = c.piecePosition
    const other = offer[Math.min(2, offer.length - 1)].variants[0]
    expect(placementValid(pos.x, pos.z, other.w, other.d, rot), `${other.key} fits at the start spot at ${rot}°`).toBe(true)
    await pick(it, c, offer, other)
    expectSelected(c, other, pos, rot, false, "rotated, fits")

    // 2. Widest piece next to the right wall at 0°: nudged to the nearest spot inside the room.
    await resetState()
    await tap(it, "MeasureButton") // Measure on: selection must not change it
    const widest = all.reduce((a, b) => (b.w > a.w ? b : a))
    const narrow = all.reduce((a, b) => (b.w < a.w ? b : a))
    c.setPiecePosition(0, START.z)
    await pick(it, c, offer, narrow)
    c.setPiecePosition(ROOM.maxX - narrow.w / 2 - 5, START.z) // API setup: narrow piece 5 cm off the right wall
    await sleep(100)
    const from = c.piecePosition
    const want = {x: Math.min(from.x, ROOM.maxX - widest.w / 2), z: Math.min(Math.max(from.z, ROOM.minZ + widest.d / 2), ROOM.maxZ - widest.d / 2)}
    expect(overlapsCoffee(want.x, want.z, widest.w, widest.d), "test spot clear of the coffee table").toBe(false)
    expect(placementValid(from.x, from.z, widest.w, widest.d, 0), `${widest.key} would overlap at the old spot`).toBe(false)
    log(`nudge: ${narrow.key} at ${JSON.stringify(from)} -> ${widest.key} expected at ${JSON.stringify(want)}`)
    await pick(it, c, offer, widest)
    expectSelected(c, widest, want, 0, true, "nudged next to the wall")
    await tap(it, "MeasureButton")

    // 3. A piece on page 2 of its type.
    await resetState()
    const big = offer.find((t) => t.variants.length > TILES_PER_PAGE)
    expect(!!big, "a type with a second page").toBe(true)
    const p2 = big!.variants[TILES_PER_PAGE]
    const p2pos = c.piecePosition
    expect(placementValid(p2pos.x, p2pos.z, p2.w, p2.d, 0), `${p2.key} fits at the start spot`).toBe(true)
    await pick(it, c, offer, p2)
    expectSelected(c, p2, p2pos, 0, false, "page 2")

    // 4. The piece already showing: stays, gallery closes.
    const cur = all.find((v) => v.key === c.currentPieceKey)!
    await pick(it, c, offer, cur)
    expectSelected(c, cur, p2pos, 0, false, "current piece")

    await resetState()
    log("C18 done")
  }
}
