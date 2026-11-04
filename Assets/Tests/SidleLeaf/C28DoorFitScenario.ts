/**
 * Done criteria 26 and 27 (Update 8) — "Does it fit through the door?"
 *
 * Unit-style: fitsThroughDoor on hand-worked cases (Sofa A 220x90x85 fits; a
 * 160x200x160 bed does not; boundaries; order of the dimensions; door size
 * arguments), and the doorway built in the room is the same DOOR_WIDTH_CM x
 * DOOR_HEIGHT_CM the rule uses.
 * 26: for every offered piece (built-ins + enabled catalog entries) the panel
 *     line (DoorFitLabel) shows "Fits through the 90 cm door" in light green or
 *     "Too big for the 90 cm door" in light red, exactly as the rule gives it,
 *     worked out here independently from the catalog dimensions.
 * 27: the line updates with real pinches on Next piece, Compare and a gallery
 *     tile; it is plain text (not a button), sits between the name and the
 *     buttons, and the buttons keep their full size.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {SidleController} from "../../Scripts/SidleController"
import {DOOR_HEIGHT_CM, DOOR_WIDTH_CM, fitsThroughDoor} from "../../Scripts/SidleGeometry"
import {
  bundledCatalog,
  expectedOffer,
  ExpectedType,
  ExpectedVariant,
  findChild,
  log,
  meshBounds,
  obj,
  panelObj,
  resetState,
  tap,
  TILES_PER_PAGE,
  visualCorners,
} from "./SidleTestHelpers"

/** The brief's door: 90 cm wide, 200 cm tall. */
const BRIEF_DOOR = {w: 90, h: 200}
const FITS = "Fits through the 90 cm door"
const TOO_BIG = "Too big for the 90 cm door"

/** The brief's rule, worked out here independently of SidleGeometry. */
function briefFits(v: {w: number; d: number; h: number}): boolean {
  const s = [v.w, v.d, v.h].sort((a, b) => a - b)
  return s[0] <= BRIEF_DOOR.w && s[1] <= BRIEF_DOOR.h
}

function isLightGreen(c: vec4): boolean {
  return c.y > 0.8 && c.y > c.x + 0.2 && c.y > c.z + 0.2
}
function isLightRed(c: vec4): boolean {
  return c.x > 0.8 && c.x > c.y + 0.2 && c.x > c.z + 0.2 && c.y > 0.4
}

/** What the panel line shows, read from the scene. */
function shownLine(): {text: string; colour: vec4; visible: boolean} {
  const so = obj("DoorFitLabel")
  const t = so.getComponent("Component.Text") as Text
  return {text: t.text, colour: t.textFill.color, visible: so.isEnabledInHierarchy}
}

function expectLine(c: SidleController, v: ExpectedVariant, ctx: string): boolean {
  const want = briefFits(v)
  const s = shownLine()
  expect(c.currentPieceKey, `${ctx}: piece`).toBe(v.key)
  expect(s.text, `${ctx}: ${v.key} ${v.w} x ${v.d} x ${v.h}`).toBe(want ? FITS : TOO_BIG)
  expect(want ? isLightGreen(s.colour) : isLightRed(s.colour), `${ctx}: ${v.key} line is light ${want ? "green" : "red"} (${s.colour})`).toBe(true)
  expect(c.currentFitsThroughDoor, `${ctx}: controller agrees`).toBe(want)
  return want
}

function variantOfKey(offer: ExpectedType[], key: string): ExpectedVariant {
  for (const t of offer) for (const v of t.variants) if (v.key === key) return v
  throw new Error(`${key} not offered`)
}

function countComponents(root: SceneObject, type: any): number {
  let n = 0
  const stack = [root]
  while (stack.length) {
    const so = stack.pop()!
    n += so.getComponents(type as any).length
    for (let i = 0; i < so.getChildrenCount(); i++) stack.push(so.getChild(i))
  }
  return n
}

@component
export class C28DoorFitScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)

    // ── Unit-style checks on the rule ──────────────────────────────────────────
    expect(DOOR_WIDTH_CM, "door width constant").toBe(BRIEF_DOOR.w)
    expect(DOOR_HEIGHT_CM, "door height constant").toBe(BRIEF_DOOR.h)
    const cases: [number, number, number, boolean, string][] = [
      [220, 90, 85, true, "Sofa A 220x90x85: 85 through 90, 90 through 200"],
      [160, 200, 160, false, "bed 160x200x160: smallest two 160 and 160, 160 > 90"],
      [85, 220, 90, true, "Sofa A dimensions in another order"],
      [90, 200, 300, true, "exactly the opening (90 and 200)"],
      [90.1, 150, 300, false, "just wider than the door"],
      [80, 200.1, 250, false, "second-smallest just taller than the door"],
      [95, 95, 95, false, "cube bigger than the door width"],
      [43.2, 54, 95.6, true, "small chair"],
    ]
    for (const [w, d, h, want, why] of cases) expect(fitsThroughDoor(w, d, h), `fitsThroughDoor(${w}, ${d}, ${h}): ${why}`).toBe(want)
    expect(fitsThroughDoor(100, 250, 300, 100, 250), "door size arguments are used").toBe(true)
    expect(fitsThroughDoor(100, 250, 300), "default door is 90 x 200").toBe(false)

    const c = await resetState()
    const it = new DefaultLeafInteractor("C28Interactor")
    const offer = expectedOffer(bundledCatalog(), true)

    // The doorway built in the room is the opening the rule uses.
    const frame = findChild(obj("Doorway"), "RoomDoorFrame")
    const jl = findChild(frame, "Jamb_Left").getTransform().getLocalPosition()
    const jr = findChild(frame, "Jamb_Right").getTransform().getLocalPosition()
    const head = findChild(frame, "Head").getTransform().getLocalPosition()
    expect(jr.x - jl.x - 5, "built doorway width = DOOR_WIDTH_CM").toBeCloseTo(DOOR_WIDTH_CM, 3)
    expect(head.y - 2.5, "built doorway height = DOOR_HEIGHT_CM").toBeCloseTo(DOOR_HEIGHT_CM, 3)

    // ── 26. Every offered piece ────────────────────────────────────────────────
    const fits: string[] = []
    const tooBig: string[] = []
    for (const t of offer) {
      for (const v of t.variants) {
        if (c.currentPieceKey !== v.key) {
          c.openGallery()
          expect(c.selectFromGallery(v.key), `select ${v.key}`).toBe(true)
        }
        await sleep(50)
        expect(shownLine().visible, `${v.key}: line shown`).toBe(true)
        const ok = expectLine(c, v, "every piece")
        ;(ok ? fits : tooBig).push(`${v.key} (${v.w} x ${v.d} x ${v.h})`)
      }
    }
    log(`REPORT fits through the door (${fits.length}): ${fits.join(", ")}`)
    log(`REPORT too big for the door (${tooBig.length}): ${tooBig.join(", ")}`)
    expect(fits.length > 0 && tooBig.length > 0, "both results occur in the catalog").toBe(true)

    // ── 27. Updates with real pinches ──────────────────────────────────────────
    await resetState()
    expectLine(c, variantOfKey(offer, "SofaA"), "start")
    await tap(it, "NextButton")
    expectLine(c, variantOfKey(offer, c.currentPieceKey), "after Next piece")
    // Compare through every sofa: the line follows each variant (fits and too big).
    await resetState()
    const sofas = offer[0].variants
    const seen = new Set<boolean>()
    for (let i = 1; i <= sofas.length; i++) {
      await tap(it, "CompareButton")
      const v = sofas[i % sofas.length]
      seen.add(expectLine(c, v, `after Compare #${i}`))
    }
    expect(seen.size, "Compare went through sofas that fit and sofas that do not").toBe(2)
    // Gallery: a tile of another type, then one with the opposite result.
    const pickTile = async (v: ExpectedVariant, ctx: string) => {
      const ti = offer.findIndex((t) => t.variants.some((x) => x.key === v.key))
      const vi = offer[ti].variants.findIndex((x) => x.key === v.key)
      await tap(it, "GalleryButton")
      await tap(it, `GalleryTab_${ti + 1}`)
      for (let p = 0; p < Math.floor(vi / TILES_PER_PAGE); p++) await tap(it, "GalleryNextButton")
      await tap(it, `GalleryTile_${(vi % TILES_PER_PAGE) + 1}`)
      expect(c.galleryOpen, `${ctx}: gallery closed`).toBe(false)
      expectLine(c, v, ctx)
    }
    const all = offer.reduce((a, t) => a.concat(t.variants), [] as ExpectedVariant[])
    const before = briefFits(variantOfKey(offer, c.currentPieceKey))
    const opposite = all.find((v) => briefFits(v) !== before && v.key !== c.currentPieceKey)!
    await pickTile(opposite, `gallery -> ${opposite.key}`)
    const back = all.find((v) => briefFits(v) === before && typeOfKeyIdx(offer, v.key) !== typeOfKeyIdx(offer, opposite.key))!
    await pickTile(back, `gallery -> ${back.key}`)

    // Plain text, between the name and the buttons; the buttons keep their size.
    const panel = panelObj(c)
    const label = obj("DoorFitLabel")
    expect(countComponents(label.getParent()!, Interactable.getTypeName()) + countComponents(label.getParent()!, Button.getTypeName()), "the line is not a button").toBe(0)
    const toPanel = panel.getTransform().getInvertedWorldTransform()
    const yRange = (so: SceneObject) => {
      const ys = visualCorners(so).map((p) => toPanel.multiplyPoint(p).y)
      return {min: Math.min(...ys), max: Math.max(...ys)}
    }
    const xRange = (so: SceneObject) => {
      const xs = visualCorners(so).map((p) => toPanel.multiplyPoint(p).x)
      return {min: Math.min(...xs), max: Math.max(...xs)}
    }
    const name = yRange(obj("PieceNameLabel"))
    const line = yRange(label)
    const buttons = yRange(obj("Buttons"))
    log(`panel frame y: name ${name.min.toFixed(2)}..${name.max.toFixed(2)}, door line ${line.min.toFixed(2)}..${line.max.toFixed(2)}, buttons ${buttons.min.toFixed(2)}..${buttons.max.toFixed(2)}`)
    expect(line.max <= name.min + 0.3, "line is under the name").toBe(true)
    expect(line.min >= buttons.max, "line is above the buttons, not over them").toBe(true)
    const plate = meshBounds(panel, panel)!
    const lx = xRange(label)
    expect(lx.min >= plate.min.x && lx.max <= plate.max.x, `line inside the panel width (${lx.min.toFixed(1)}..${lx.max.toFixed(1)} in ${plate.min.x.toFixed(1)}..${plate.max.x.toFixed(1)})`).toBe(true)
    for (const n of ["NextButton", "CompareButton", "MeasureButton", "GalleryButton", "RotateLeftButton", "RotateRightButton", "AddButton", "RemoveButton"]) {
      const so = obj(n)
      const b = meshBounds(so, so)!
      const s = so.getTransform().getWorldScale()
      expect(Math.abs((b.max.x - b.min.x) * s.x - 6.4) < 0.01 && Math.abs((b.max.y - b.min.y) * s.y - 6.0) < 0.01, `${n} keeps its 6.4 x 6 cm size`).toBe(true)
    }

    await resetState()
    log("C28 done")
  }
}

function typeOfKeyIdx(offer: ExpectedType[], key: string): number {
  return offer.findIndex((t) => t.variants.some((v) => v.key === key))
}
