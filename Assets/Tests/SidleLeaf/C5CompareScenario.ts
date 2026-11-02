/**
 * Done criterion 5 (Update 2) — CompareButton steps through the variants of the
 * current type in order (built-ins first, then imported in catalog order) and
 * wraps, in the same spot/facing; outline, labels and clearance update for
 * every variant. A variant that would stick through a wall at that spot is
 * nudged to the nearest spot inside the room, and the following variants start
 * from there (the spot is tracked, not reset). Types and variants come from the
 * bundled catalog; a one-variant type (if the catalog has one) is greyed out
 * (UIKit Button.inactive) and a pinch does nothing — C11 covers that rule with
 * catalogs that are sure to have one.
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
  expectEdges,
  expectedOffer,
  ExpectedVariant,
  expectGreyedCompare,
  log,
  obj,
  offeredKeys,
  overlapsCoffee,
  panelText,
  placementValid,
  resetState,
  ROOM,
  tap,
  textOf,
  yawOf,
} from "./SidleTestHelpers"

function baseColor(key: string): vec4 {
  const base = obj(`Piece_${key}`).getChild(0)
  return (base.getComponent("Component.RenderMeshVisual") as RenderMeshVisual).mainMaterial.mainPass.baseColor
}

/** Same spot/facing, only this variant visible, outline + labels match its size. */
function checkVariant(c: SidleController, v: ExpectedVariant, allKeys: string[], pos: {x: number; z: number}, rot: number): void {
  const key = v.key
  const dims = {w: v.w, d: v.d, h: v.h}
  expect(c.currentPieceKey, "piece").toBe(key)
  expect(JSON.stringify(c.currentDims), `${key} dims`).toBe(JSON.stringify(dims))
  expect(panelText("PieceNameLabel"), `${key} panel name`).toBe(v.name)
  for (const k of allKeys) expect(obj(`Piece_${k}`).enabled, `Piece_${k} visible?`).toBe(k === key)
  if (v.imported) expect(c.modelLoadedFor(key), `${key} shows its model`).toBe(true)
  expect(c.piecePosition.x, `${key} same spot x`).toBeCloseTo(pos.x, 1)
  expect(c.piecePosition.z, `${key} same spot z`).toBeCloseTo(pos.z, 1)
  expect(angDiffDeg(c.rotationDeg, rot) < 0.01, `${key} same facing`).toBe(true)
  expect(angDiffDeg((yawOf(obj("FloorOutline").getTransform()) * 180) / Math.PI, rot) < 0.5, `${key} outline facing`).toBe(true)
  expect(obj("Edge_Front").getTransform().getLocalScale().x, `${key} outline width`).toBeCloseTo(dims.w + 4, 1)
  expect(obj("Edge_Right").getTransform().getLocalScale().z, `${key} outline depth`).toBeCloseTo(dims.d + 4, 1)
  const w = textOf("WidthLabel")
  const d = textOf("DepthLabel")
  const h = textOf("HeightLabel")
  expect(w.includes(`${Math.round(dims.w)}`), `${key} width label "${w}"`).toBe(true)
  expect(d.includes(`${Math.round(dims.d)}`), `${key} depth label "${d}"`).toBe(true)
  expect(h.includes(`${Math.round(dims.h)}`), `${key} height label "${h}"`).toBe(true)
}

/**
 * Where `v` must end up when it replaces the piece at `from` (rotation 0 or 180,
 * so the footprint is axis aligned): the same spot if it fits, else pulled in
 * just far enough to be inside the room. Worked out independently of the controller.
 */
function expectedSpot(v: ExpectedVariant, from: {x: number; z: number}): {x: number; z: number} {
  const clamp = (val: number, lo: number, hi: number) => Math.min(Math.max(val, lo), hi)
  const p = {x: clamp(from.x, ROOM.minX + v.w / 2, ROOM.maxX - v.w / 2), z: clamp(from.z, ROOM.minZ + v.d / 2, ROOM.maxZ - v.d / 2)}
  if (overlapsCoffee(p.x, p.z, v.w, v.d)) throw new Error(`${v.key}: test spot overlaps the coffee table; pick another spot`)
  return p
}

/** Sofas sit near the right wall: the right-wall gap is 250 - x - w/2 for every sofa variant. */
function checkSofaClearance(c: SidleController, v: ExpectedVariant, pos: {x: number; z: number}): void {
  const gap = Math.max(0, Math.round((ROOM.maxX - pos.x - v.w / 2) * 1e4) / 1e4)
  expect(gap < 80, `${v.key}: test spot is too close to the right wall (gap ${gap})`).toBe(true)
  expect(c.nearestObstacle, `${v.key} nearest obstacle`).toBe("RightWall")
  expect(c.nearestGapCm, `${v.key} clearance to right wall`).toBeCloseTo(gap, 1)
  expect(c.gapLabelText, `${v.key} gap text`).toBe(`${Math.floor(gap)} cm`)
  expectEdges(c, ["green", "red", "green", "green"], `${v.key} near right wall`)
  if (v.key === "SofaA") {
    const col = baseColor("SofaA")
    log(`Sofa A base color ${col}`)
    expect(Math.max(col.x, col.y, col.z) - Math.min(col.x, col.y, col.z) < 0.06 && col.x > 0.7, `Sofa A light gray (${col})`).toBe(true)
  } else if (v.key === "SofaB") {
    const col = baseColor("SofaB")
    log(`Sofa B base color ${col}`)
    expect(col.x > 0.75 && col.x > col.y && col.y > col.z && col.x - col.z > 0.15, `Sofa B warm beige (${col})`).toBe(true)
  }
}

@component
export class C5CompareScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C5Interactor")
    const offer = expectedOffer(bundledCatalog(), true)
    const allKeys = offeredKeys(offer)
    const cmpBtn = obj("CompareButton").getComponent(Button.getTypeName()) as Button

    // Setup: Measure on (real button) so labels are inspectable; move (API) so Sofa A
    // is 30 cm from the right wall at 0° for exact clearance numbers.
    await tap(it, "MeasureButton")
    expect(c.measureOn, "Measure on").toBe(true)
    c.setPiecePosition(ROOM.maxX - 140, -220) // Sofa A right edge 30 cm off the wall; Sofa B (180 wide) 50 cm
    await sleep(50)
    let pos = c.piecePosition
    const rot = c.rotationDeg
    expect(pos.x, "sofa spot").toBeCloseTo(110, 1)
    const nudged: string[] = []
    /** Advance the tracked spot for the variant now shown, then check it. */
    const check = (v: ExpectedVariant) => {
      const want = expectedSpot(v, pos)
      if (Math.abs(want.x - pos.x) > 0.01 || Math.abs(want.z - pos.z) > 0.01) nudged.push(`${v.key} ${JSON.stringify(pos)} -> ${JSON.stringify(want)}`)
      pos = want
      checkVariant(c, v, allKeys, pos, rot)
      expect(placementValid(pos.x, pos.z, v.w, v.d, rot), `${v.key} placement valid`).toBe(true)
    }

    for (let ti = 0; ti < offer.length; ti++) {
      const t = offer[ti]
      if (ti > 0) await tap(it, "NextButton")
      expect(c.currentPieceType, "type after Next").toBe(t.type)
      expect(c.variantKeys(t.type).join(","), `${t.type}: controller variant order`).toBe(t.variants.map((v) => v.key).join(","))
      if (t.variants.length === 1) {
        // one variant: greyed out and a pinch does nothing
        check(t.variants[0])
        await expectGreyedCompare(c, t.type)
        continue
      }
      expect(c.compareEnabled, `${t.type}: compare enabled`).toBe(true)
      expect(cmpBtn.inactive, `${t.type}: CompareButton active`).toBe(false)
      // all variants in order, then wrap back to the first
      for (let i = 0; i <= t.variants.length; i++) {
        if (i > 0) await tap(it, "CompareButton")
        const v = t.variants[i % t.variants.length]
        check(v)
        if (t.type === "sofa") checkSofaClearance(c, v, pos)
      }
    }
    log(`one-variant types in the bundled offer: [${offer.filter((t) => t.variants.length === 1).map((t) => t.type).join(",")}]`)
    log(`nudged on swap: ${nudged.length ? nudged.join("; ") : "none"}`)
    expect(offer[0].variants.map((v) => v.key).slice(0, 2).join(","), "Sofa A then Sofa B").toBe("SofaA,SofaB")

    await tap(it, "NextButton") // wraps to the first type
    expect(c.currentPieceKey, "back to Sofa A").toBe("SofaA")
    expect(cmpBtn.inactive, "Compare active again with Sofa A").toBe(false)
    await tap(it, "MeasureButton")
    await resetState()
    log("C5 done")
  }
}
