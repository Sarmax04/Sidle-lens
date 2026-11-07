/**
 * Done criterion 29 (Update 9) — the colour belongs to the current piece slot:
 * it stays across Next piece, Compare, a gallery choice, Rotate and dragging;
 * Add keeps it on the placed piece and the new current piece starts at
 * "original"; grabbing a placed piece brings its colour back; Remove makes the
 * last placed piece current with its colour. The strip follows the panel: it
 * is part of the panel, scales with every panel size, sits under it, and hides
 * with it while the gallery is open.
 * All actions are real pinches / drags; tints are checked on the actual
 * material colours of the visual that shows each piece.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {
  bundledCatalog,
  dragPiece,
  expectedOffer,
  findChild,
  interactable,
  log,
  MatState,
  meshBounds,
  nextTypeFirstKey,
  obj,
  panelObj,
  placedRoot,
  readMaterials,
  resetState,
  roomDir,
  sameMaterials,
  swatchFaceColor,
  tap,
  TILES_PER_PAGE,
  tintProblem,
} from "./SidleTestHelpers"

const BLUE = 4 // dusty blue
const BEIGE = 2 // warm beige

@component
export class C30ColorPersistScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C30Interactor")
    const offer = expectedOffer(bundledCatalog(), true)

    // Original material colours of every variant's visual, read before anything is tinted.
    const originals: {[key: string]: MatState[]} = {}
    for (const t of offer) for (const v of t.variants) originals[v.key] = readMaterials(obj(`Piece_${v.key}`))

    const expectTinted = (root: SceneObject, key: string, idx: number, ctx: string) => {
      const now = readMaterials(root)
      if (idx === 0) {
        expect(sameMaterials(now, originals[key]), `${ctx}: ${key} shows its original colours`).toBe(true)
        return
      }
      expect(sameMaterials(now, originals[key]), `${ctx}: ${key} is tinted`).toBe(false)
      const face = swatchFaceColor(idx)
      for (let m = 0; m < now.length; m++) expect(tintProblem(originals[key][m], now[m], face), `${ctx}: ${key} material ${m}`).toBe("")
    }
    const expectCurrent = (idx: number, ctx: string) => {
      expect(c.currentColorIndex, `${ctx}: current colour`).toBe(idx)
      expectTinted(obj(`Piece_${c.currentPieceKey}`), c.currentPieceKey, idx, ctx)
      const rings: number[] = []
      for (let i = 0; i < 6; i++) if (findChild(obj(`ColorSwatch_${i}`), "SwatchRing").enabled) rings.push(i)
      expect(JSON.stringify(rings), `${ctx}: ring`).toBe(`[${idx}]`)
    }

    // ── Colour stays across variant changes, rotation and dragging ─────────────
    await tap(it, `ColorSwatch_${BLUE}`)
    expectCurrent(BLUE, "Sofa A dusty blue")
    const k0 = c.currentPieceKey
    await tap(it, "NextButton")
    expect(c.currentPieceKey, "Next went on").toBe(nextTypeFirstKey(offer, k0))
    expectCurrent(BLUE, "after Next piece")
    await resetState()
    await tap(it, `ColorSwatch_${BLUE}`)
    await tap(it, "CompareButton")
    expect(c.currentPieceKey, "Compare went on").toBe(offer[0].variants[1].key)
    expectCurrent(BLUE, "after Compare")
    // Gallery: a piece of another type (its tab, page, tile).
    const target = offer[2].variants[offer[2].variants.length - 1]
    const vi = offer[2].variants.length - 1
    await tap(it, "GalleryButton")
    await tap(it, "GalleryTab_3")
    for (let p = 0; p < Math.floor(vi / TILES_PER_PAGE); p++) await tap(it, "GalleryNextButton")
    await tap(it, `GalleryTile_${(vi % TILES_PER_PAGE) + 1}`)
    expect(c.currentPieceKey, "gallery choice").toBe(target.key)
    expectCurrent(BLUE, "after gallery choice")
    await tap(it, "RotateLeftButton")
    expectCurrent(BLUE, "after Rotate")
    const p0 = c.piecePosition
    await dragPiece(it, new vec3(1.5, 0, 0), 600)
    expect(c.piecePosition.x !== p0.x || c.piecePosition.z !== p0.z, "the drag moved the piece").toBe(true)
    expectCurrent(BLUE, "after dragging")

    // ── Add: the placed piece keeps its colour, the new current piece starts at original ──
    await resetState()
    await tap(it, `ColorSwatch_${BLUE}`)
    await tap(it, "AddButton")
    const A = c.placedPieces[0]
    expect(A.colorIndex, "placed piece keeps dusty blue").toBe(BLUE)
    expectTinted(findChild(placedRoot(A.id)!, `PlacedVisual_${A.key}`), A.key, BLUE, "placed after Add")
    expectCurrent(0, "new current piece after Add")
    // Colour the new current piece, then grab the placed one: colours travel with the pieces.
    await tap(it, `ColorSwatch_${BEIGE}`)
    expectCurrent(BEIGE, "new current beige")
    const B = {id: c.currentPieceId, key: c.currentPieceKey}
    await it.drag(interactable(`PlacedGrab_${A.id}`), roomDir(new vec3(0, 0, 0.5)), 300)
    await sleep(150)
    expect(c.currentPieceId, "grabbed piece is current").toBe(A.id)
    expectCurrent(BLUE, "grabbed placed piece brings its colour")
    const placedB = c.placedPieces.find((p) => p.id === B.id)!
    expect(placedB.colorIndex, "the previous current piece is placed with its beige").toBe(BEIGE)
    expectTinted(findChild(placedRoot(B.id)!, `PlacedVisual_${B.key}`), B.key, BEIGE, "previous current, now placed")
    // Remove: the last placed piece (B, beige) becomes current with its colour.
    await tap(it, "RemoveButton")
    expect(c.currentPieceId, "Remove made B current").toBe(B.id)
    expectCurrent(BEIGE, "after Remove")

    // ── The strip follows the panel ────────────────────────────────────────────
    await resetState()
    const panel = panelObj(c)
    const strip = obj("ColorStrip")
    expect(strip.getParent() === panel, "strip is a child of the panel").toBe(true)
    const stripTopBelowPanel = () => {
      const toPanel = panel.getTransform().getInvertedWorldTransform()
      const sb = meshBounds(strip, panel)!
      const pb = meshBounds(obj("Buttons"), panel)!
      return {gapBelowButtons: pb.min.y - sb.max.y, centreX: (sb.min.x + sb.max.x) / 2}
    }
    for (const step of ["start", "-", "+", "+", "+"]) {
      if (step === "-") await tap(it, "PanelSmallerButton")
      if (step === "+") await tap(it, "PanelBiggerButton")
      const ps = panel.getTransform().getWorldScale().x
      const ss = strip.getTransform().getWorldScale().x
      const g = stripTopBelowPanel()
      log(`panel ${Math.round(c.panelScale * 100)}%: strip scale ${ss.toFixed(3)} (panel ${ps.toFixed(3)}), strip top ${g.gapBelowButtons.toFixed(2)} cm under the buttons (panel units), centre x ${g.centreX.toFixed(2)}`)
      expect(Math.abs(ss - ps) < 1e-4, `${c.panelScale}: strip scales with the panel`).toBe(true)
      expect(g.gapBelowButtons > 0, `${c.panelScale}: strip sits under the panel`).toBe(true)
      expect(Math.abs(g.centreX) < 0.1, `${c.panelScale}: strip centred under the panel`).toBe(true)
      expect(strip.isEnabledInHierarchy, `${c.panelScale}: strip shown`).toBe(true)
    }
    await tap(it, "GalleryButton")
    expect(c.galleryOpen && !strip.isEnabledInHierarchy, "strip hidden while the gallery is open").toBe(true)
    await tap(it, "GalleryCloseButton")
    expect(strip.isEnabledInHierarchy, "strip back with the panel").toBe(true)

    await resetState()
    expect(c.currentColorIndex, "reset to original").toBe(0)
    log("C30 done")
  }
}
