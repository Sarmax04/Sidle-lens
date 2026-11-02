/**
 * Done criterion 4 (coffee table + solidity) — clearance to the coffee table
 * (100 x 50 x 45, far corner), and the piece can't be dragged/placed through walls
 * or the coffee table and stays on the floor.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {COFFEE, dragPiece, expectEdges, local, log, obj, placementValid, resetState, ROOM, SOFA_A_HALF} from "./SidleTestHelpers"

@component
export class C4bCoffeeTableBlockingScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C4bInteractor")

    // Coffee table geometry as built
    const ct = local("CoffeeTable")
    log(`CoffeeTable at ${ct}`)
    expect(ct.x, "coffee table x (right wall - 50)").toBeCloseTo(ROOM.maxX - 50, 1)
    expect(ct.z, "coffee table z (against far wall: far wall + 25)").toBeCloseTo(ROOM.minZ + 25, 1)
    const R = c.roomSpec
    expect(ct.x + 50, "coffee table touches right wall (corner)").toBeCloseTo(R.maxX, 1)
    expect(ct.z - 25, "coffee table touches far wall (corner)").toBeCloseTo(R.minZ, 1)

    // ---- Clearance to the coffee table (API positioning, exact numbers) ----
    // Sofa A with its right edge 10 cm into the table's x-range and its back edge 35 cm
    // in front of the table front; far wall 85, right wall 90.
    const sx = COFFEE.minX + 10 - SOFA_A_HALF.w
    const backEdge = COFFEE.maxZ + 35
    c.setPiecePosition(sx, backEdge + SOFA_A_HALF.d)
    await sleep(50)
    log(`coffee clearances ${JSON.stringify(c.clearances)}`)
    expect(c.nearestObstacle, "nearest is coffee table").toBe("CoffeeTable")
    expect(c.nearestGapCm, "gap to coffee table").toBeCloseTo(35, 1)
    expect(c.gapLabelText, "coffee gap text").toBe("35 cm")
    expectEdges(c, ["green", "green", "red", "green"], "near coffee table")
    const gl = local("GapLabel")
    log(`coffee gap label at ${gl}`)
    expect(obj("GapLabel").enabled, "gap label shown").toBe(true)
    expect(gl.y >= 0 && gl.y < 2, `on the floor (y ${gl.y})`).toBe(true)
    expect(gl.z <= backEdge + 0.5 && gl.z >= COFFEE.maxZ - 0.5, `between sofa back edge and table front (z ${gl.z})`).toBe(true)
    expect(gl.x >= COFFEE.minX - 0.5 && gl.x <= COFFEE.minX + 10.5, `in the overlapping x band (x ${gl.x})`).toBe(true)

    // Back to >= 80 from the table -> green
    c.setPiecePosition(sx, COFFEE.maxZ + 80 + SOFA_A_HALF.d) // table gap 80, far wall 130
    await sleep(50)
    expect(c.nearestGapCm >= 80 - 0.01, `table gap back to 80 (got ${c.nearestGapCm})`).toBe(true)
    expectEdges(c, ["green", "green", "green", "green"], "80 from coffee table")
    await sleep(1300)

    // ---- Real drag into the coffee table: must stop at it, never overlap ----
    // API setup: sofa 10 cm off the right wall (over the table x-range), 160 cm in front of the table
    c.setPiecePosition(ROOM.maxX - 10 - SOFA_A_HALF.w, COFFEE.maxZ + 160 + SOFA_A_HALF.d)
    const z0 = c.piecePosition.z
    await sleep(50)
    let guard = 0
    let prevZ = 999
    while (guard++ < 10 && Math.abs(prevZ - c.piecePosition.z) > 0.01) {
      prevZ = c.piecePosition.z
      await dragPiece(it, new vec3(0, 0, -3), 300)
      const p = c.piecePosition
      expect(placementValid(p.x, p.z, 220, 90, c.rotationDeg), `no overlap while dragging into table (${JSON.stringify(p)})`).toBe(true)
    }
    const pz = c.piecePosition
    log(`after drag into table: ${JSON.stringify(pz)} clearances ${JSON.stringify(c.clearances)}`)
    expect(pz.z < z0 - 30, `drag actually moved toward the table (z ${pz.z})`).toBe(true)
    expect(pz.z - SOFA_A_HALF.d >= COFFEE.maxZ - 0.6, `back edge stopped at table front (back edge ${pz.z - SOFA_A_HALF.d})`).toBe(true)
    expect(c.nearestObstacle, "touching the coffee table").toBe("CoffeeTable")
    expect(c.nearestGapCm < 1, `gap ~0 at contact (got ${c.nearestGapCm})`).toBe(true)
    expectEdges(c, ["green", "green", "red", "green"], "pressed against table")
    expect(local("Piece").y, "on floor").toBeCloseTo(0, 2)

    // ---- Real drag into the right wall: must stop at the wall ----
    c.setPiecePosition(0, -220)
    await sleep(50)
    guard = 0
    let prevX = -999
    while (guard++ < 10 && Math.abs(prevX - c.piecePosition.x) > 0.01) {
      prevX = c.piecePosition.x
      await dragPiece(it, new vec3(4, 0, 0), 300)
    }
    const pw = c.piecePosition
    log(`after drag into right wall: ${JSON.stringify(pw)} gap ${c.gapLabelText} GapLabel at ${local("GapLabel")} (right wall line x=${ROOM.maxX})`)
    expect(pw.x + SOFA_A_HALF.w, "right edge stops at the wall line").toBeCloseTo(ROOM.maxX, 0)
    expect(placementValid(pw.x, pw.z, 220, 90, c.rotationDeg), "inside room").toBe(true)
    const glw = local("GapLabel")
    expect(obj("GapLabel").enabled, "gap label shown when flush").toBe(true)
    expect(glw.x < ROOM.maxX, `flush gap label inside the room, not behind the wall (x ${glw.x})`).toBe(true)
    expect(glw.y > 85, `flush gap label lifted above the sofa top (y ${glw.y})`).toBe(true)

    // ---- Direct placement inside obstacles / outside the room is resolved (API) ----
    const tries: [number, number][] = [
      [(COFFEE.minX + COFFEE.maxX) / 2, (COFFEE.minZ + COFFEE.maxZ) / 2], // inside the coffee table
      [1000, 0], // far outside right/doorway
      [-1000, -1000], // far outside left/far
      [COFFEE.minX + 50, COFFEE.maxZ + 20], // overlapping the table corner
    ]
    for (const [x, z] of tries) {
      c.setPiecePosition(x, z)
      await sleep(30)
      const p = c.piecePosition
      log(`setPiecePosition(${x}, ${z}) -> ${JSON.stringify(p)}`)
      expect(placementValid(p.x, p.z, 220, 90, c.rotationDeg), `resolved spot valid for (${x}, ${z}) -> ${JSON.stringify(p)}`).toBe(true)
    }
    c.setPiecePosition(1000, 0)
    expect(c.piecePosition.x, "clamped x to right wall").toBeCloseTo(ROOM.maxX - SOFA_A_HALF.w, 1)
    expect(c.piecePosition.z, "clamped z to doorway wall").toBeCloseTo(-15, 1)

    c.setPiecePosition(0, -220)
    await sleep(1300)
    log("C4b done")
  }
}
