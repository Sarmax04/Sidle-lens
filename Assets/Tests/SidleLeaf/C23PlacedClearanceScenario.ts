/**
 * Done criterion 20 (Update 6) — the current piece cannot overlap a placed
 * piece, and the clearance indicator measures against placed pieces: under
 * 80 cm the edge facing the placed piece turns red and a live gap number shows
 * on the floor between them; at 80 cm or more the outline is green and the
 * number fades. Placed pieces count with their rotation (oriented rectangles):
 * a spot inside a turned piece's axis-aligned box but clear of the piece itself
 * is allowed, and gaps match an independent polygon distance.
 * Sizes come from the bundled catalog; geometry is checked independently.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {nextFrame, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {
  bundledCatalog,
  COFFEE,
  currentFootprint,
  expectedOffer,
  ExpectedType,
  expectEdges,
  expectNoOverlaps,
  footprint,
  footprintGap,
  footprintsOverlap,
  interactable,
  local,
  log,
  obj,
  placedFootprint,
  placementValid,
  resetState,
  ROOM,
  START,
  tap,
  variantOf,
} from "./SidleTestHelpers"

const COFFEE_POLY = [
  {x: COFFEE.maxX, z: COFFEE.maxZ},
  {x: COFFEE.maxX, z: COFFEE.minZ},
  {x: COFFEE.minX, z: COFFEE.minZ},
  {x: COFFEE.minX, z: COFFEE.maxZ},
]

/** Independent gaps from a footprint to the four wall lines and the coffee table. */
function roomGaps(fp: {x: number; z: number}[]): number {
  const xs = fp.map((p) => p.x)
  const zs = fp.map((p) => p.z)
  return Math.min(Math.min(...xs) - ROOM.minX, ROOM.maxX - Math.max(...xs), Math.min(...zs) - ROOM.minZ, ROOM.maxZ - Math.max(...zs), footprintGap(fp, COFFEE_POLY))
}

function placedEntry(c: SidleController, id: number): {gap: number; edge: string} | null {
  return c.clearances.find((h) => h.obstacle === `Placed_${id}`) ?? null
}

@component
export class C23PlacedClearanceScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const offer = expectedOffer(bundledCatalog(), true)
    const it = new DefaultLeafInteractor("C23Interactor")

    // ── A. Axis-aligned placed piece ───────────────────────────────────────────
    let c = await resetState()
    await tap(it, "AddButton")
    const A = c.placedPieces[0]
    const sofa = variantOf(offer, A.key)
    expect(A.x, "premise: placed Sofa A at the start spot").toBeCloseTo(START.x, 2)
    const v = variantOf(offer, c.currentPieceKey)
    log(`placed ${A.key} #${A.id} at (${A.x}, ${A.z}); current ${v.key} ${v.w} x ${v.d}`)
    const sofaBack = A.z - sofa.d / 2
    const x = -40

    // 35 cm behind the placed sofa: front edge faces it.
    const z35 = sofaBack - 35 - v.d / 2
    expect(roomGaps(footprint(x, z35, v.w, v.d, 0)) >= 80, "premise: walls and coffee table >= 80 cm away").toBe(true)
    c.setPiecePosition(x, z35)
    await sleep(50)
    log(`35 cm: pos ${JSON.stringify(c.piecePosition)} clearances ${JSON.stringify(c.clearances)}`)
    expect(c.piecePosition.x, "35 cm: not nudged (x)").toBeCloseTo(x, 2)
    expect(c.piecePosition.z, "35 cm: not nudged (z)").toBeCloseTo(z35, 2)
    expect(c.nearestObstacle, "35 cm: nearest is the placed sofa").toBe(`Placed_${A.id}`)
    expect(c.nearestGapCm, "35 cm: gap").toBeCloseTo(35, 1)
    expect(c.gapLabelText, "35 cm: gap number").toBe("35 cm")
    expect(obj("GapLabel").enabled, "35 cm: gap number shown").toBe(true)
    expectEdges(c, ["red", "green", "green", "green"], "35 cm behind placed sofa")
    const gl = local("GapLabel")
    expect(gl.y >= 0 && gl.y < 2, `gap number on the floor (y ${gl.y})`).toBe(true)
    expect(gl.z >= z35 + v.d / 2 - 0.5 && gl.z <= sofaBack + 0.5, `gap number between the two pieces (z ${gl.z})`).toBe(true)

    // 80 cm: green, number fades out.
    const z80 = sofaBack - 80 - v.d / 2
    expect(roomGaps(footprint(x, z80, v.w, v.d, 0)) >= 80, "premise: walls and coffee table >= 80 cm away at 80").toBe(true)
    c.setPiecePosition(x, z80)
    await sleep(50)
    expect(c.nearestGapCm >= 80 - 0.01, `80 cm: gap ${c.nearestGapCm}`).toBe(true)
    expect(placedEntry(c, A.id)!.gap, "80 cm: gap to the placed sofa").toBeCloseTo(80, 1)
    expectEdges(c, ["green", "green", "green", "green"], "80 cm from placed sofa")
    await sleep(1400)
    expect(c.gapLabelVisible, "80 cm: gap number faded out").toBe(false)

    // Real drag toward the placed sofa: live gap number, never overlaps, stops at contact.
    const texts: string[] = []
    let overlapped = false
    let passedThrough = false
    let prevZ = -9999
    for (let n = 0; n < 12 && Math.abs(prevZ - c.piecePosition.z) > 0.01; n++) {
      prevZ = c.piecePosition.z
      let done = false
      const drag = it.drag(interactable("PieceGrab"), new vec3(0, 0, 3), 900).then(() => (done = true))
      while (!done) {
        if (c.gapLabelVisible && texts[texts.length - 1] !== c.gapLabelText) texts.push(c.gapLabelText)
        if (footprintsOverlap(currentFootprint(c, offer), placedFootprint(A, offer))) overlapped = true
        if (c.piecePosition.z + v.d / 2 > sofaBack + 0.5) passedThrough = true
        await nextFrame()
      }
      await drag
      await sleep(150)
    }
    log(`drag toward placed sofa: gap numbers ${texts.join(" | ")}; end ${JSON.stringify(c.piecePosition)} gap ${c.nearestGapCm}`)
    expect(overlapped, "never overlaps the placed sofa while dragged into it").toBe(false)
    expect(passedThrough, "never jumps through to the far side of the placed sofa").toBe(false)
    expect(texts.length >= 3, `gap number updated live while dragging (${texts.length} values)`).toBe(true)
    expect(c.nearestObstacle, "touching the placed sofa").toBe(`Placed_${A.id}`)
    expect(c.nearestGapCm < 1, `gap ~0 at contact (${c.nearestGapCm})`).toBe(true)
    expectEdges(c, ["red", "green", "green", "green"], "pressed against placed sofa")

    // Direct placement into the placed sofa is resolved to a non-overlapping spot.
    c.setPiecePosition(A.x, A.z)
    await sleep(30)
    log(`setPiecePosition into placed sofa -> ${JSON.stringify(c.piecePosition)}`)
    expectNoOverlaps(c, offer, "placed into the sofa")
    expect(JSON.stringify(c.placedPieces[0]), "placed sofa never moved").toBe(JSON.stringify(A))

    // ── B. Rotated placed piece (oriented rectangle) ───────────────────────────
    c = await resetState()
    for (let i = 0; i < 3; i++) c.rotateLeft() // Sofa A at 45°
    expect(c.addPiece(), "addPiece() with Sofa A at 45°").toBe(true)
    for (let i = 0; i < 3; i++) c.rotateRight() // current piece back to 0° (placed sofa stays at 45°)
    const B = c.placedPieces[0]
    expect(B.yawDeg, "placed sofa keeps 45°").toBeCloseTo(45, 2)
    expect(c.rotationDeg % 360, "current at 0°").toBeCloseTo(0, 2)
    const w = variantOf(offer, c.currentPieceKey)
    const sofaPoly = placedFootprint(B, offer)
    const xs = sofaPoly.map((p) => p.x)
    const zs = sofaPoly.map((p) => p.z)
    const aabb = [
      {x: Math.max(...xs), z: Math.max(...zs)},
      {x: Math.max(...xs), z: Math.min(...zs)},
      {x: Math.min(...xs), z: Math.min(...zs)},
      {x: Math.min(...xs), z: Math.max(...zs)},
    ]
    // A spot whose footprint is inside the turned sofa's axis-aligned box but clear of the sofa itself, with
    // the sofa nearer than any wall or the coffee table.
    let spot: {x: number; z: number; gap: number} | null = null
    for (let sx = ROOM.minX; sx <= ROOM.maxX && !spot; sx += 2) {
      for (let sz = ROOM.minZ; sz <= ROOM.maxZ && !spot; sz += 2) {
        const fp = footprint(sx, sz, w.w, w.d, 0)
        if (!placementValid(sx, sz, w.w, w.d, 0) || !footprintsOverlap(fp, aabb) || footprintsOverlap(fp, sofaPoly)) continue
        const g = footprintGap(fp, sofaPoly)
        if (g >= 10 && g <= 60 && roomGaps(fp) > g + 5) spot = {x: sx, z: sz, gap: g}
      }
    }
    expect(spot !== null, `premise: a spot inside the turned sofa's box but clear of it exists for ${w.key}`).toBe(true)
    c.setPiecePosition(spot!.x, spot!.z)
    await sleep(50)
    log(`rotated: spot ${JSON.stringify(spot)} -> ${JSON.stringify(c.piecePosition)}; clearances ${JSON.stringify(c.clearances)}`)
    expect(c.piecePosition.x, "inside the turned sofa's box but clear of it: not pushed (x)").toBeCloseTo(spot!.x, 2)
    expect(c.piecePosition.z, "inside the turned sofa's box but clear of it: not pushed (z)").toBeCloseTo(spot!.z, 2)
    expect(c.nearestObstacle, "rotated: nearest is the placed sofa").toBe(`Placed_${B.id}`)
    expect(Math.abs(c.nearestGapCm - spot!.gap) <= 0.5, `rotated: gap ${c.nearestGapCm.toFixed(2)} vs independent ${spot!.gap.toFixed(2)}`).toBe(true)
    expect(c.gapLabelText, "rotated: gap number").toBe(`${Math.floor(c.nearestGapCm)} cm`)
    expect(c.outlineEdgeColors.filter((e) => e === "red").length, "rotated: one red edge").toBe(1)

    // Into the turned sofa: resolved against its real (rotated) footprint.
    c.setPiecePosition(B.x, B.z)
    await sleep(30)
    log(`into turned sofa -> ${JSON.stringify(c.piecePosition)}`)
    expectNoOverlaps(c, offer, "placed into the turned sofa")
    expect(JSON.stringify(c.placedPieces[0]), "turned sofa never moved").toBe(JSON.stringify(B))

    await resetState()
    log("C23 done")
  }
}
