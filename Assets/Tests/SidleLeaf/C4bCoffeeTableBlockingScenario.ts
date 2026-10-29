/**
 * Done criterion 4 (coffee table + solidity) — clearance to the coffee table
 * (100 x 50 x 45, far corner), and the piece can't be dragged/placed through walls
 * or the coffee table and stays on the floor.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {dragPiece, expectEdges, local, log, obj, placementValid, resetState} from "./SidleTestHelpers"

@component
export class C4bCoffeeTableBlockingScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C4bInteractor")

    // Coffee table geometry as built
    const ct = local("CoffeeTable")
    log(`CoffeeTable at ${ct}`)
    expect(ct.x, "coffee table x").toBeCloseTo(150, 1)
    expect(ct.z, "coffee table z (against far wall: -470 + 25)").toBeCloseTo(-445, 1)
    const R = c.roomSpec
    expect(ct.x + 50, "coffee table touches right wall (corner)").toBeCloseTo(R.maxX, 1)
    expect(ct.z - 25, "coffee table touches far wall (corner)").toBeCloseTo(R.minZ, 1)

    // ---- Clearance to the coffee table (API positioning, exact numbers) ----
    // Sofa A at (0,-340): back edge -385, right edge 110 overlaps the table's x-range 100..200,
    // table front at -420 -> 35 cm; far wall 85, side walls 90.
    c.setPiecePosition(0, -340)
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
    expect(gl.z <= -385 + 0.5 && gl.z >= -420 - 0.5, `between sofa back edge and table front (z ${gl.z})`).toBe(true)
    expect(gl.x >= 99.5 && gl.x <= 110.5, `in the overlapping x band (x ${gl.x})`).toBe(true)

    // Back to >= 80 from the table -> green
    c.setPiecePosition(0, -295) // table gap 80, far wall 130
    await sleep(50)
    expect(c.nearestGapCm >= 80 - 0.01, `table gap back to 80 (got ${c.nearestGapCm})`).toBe(true)
    expectEdges(c, ["green", "green", "green", "green"], "80 from coffee table")
    await sleep(1300)

    // ---- Real drag into the coffee table: must stop at it, never overlap ----
    c.setPiecePosition(80, -300) // API setup: sofa spans x -30..190 (10 cm off the right wall), over the table x-range
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
    expect(pz.z < -330, `drag actually moved toward the table (z ${pz.z})`).toBe(true)
    expect(pz.z - 45 >= -420 - 0.6, `back edge stopped at table front (back edge ${pz.z - 45})`).toBe(true)
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
    log(`after drag into right wall: ${JSON.stringify(pw)} gap ${c.gapLabelText} GapLabel at ${local("GapLabel")} (right wall line x=200, wall box 200..210)`)
    expect(pw.x + 110, "right edge stops at the wall line").toBeCloseTo(200, 0)
    expect(placementValid(pw.x, pw.z, 220, 90, c.rotationDeg), "inside room").toBe(true)
    const glw = local("GapLabel")
    expect(obj("GapLabel").enabled, "gap label shown when flush").toBe(true)
    expect(glw.x < 200, `flush gap label inside the room, not behind the wall (x ${glw.x})`).toBe(true)
    expect(glw.y > 85, `flush gap label lifted above the sofa top (y ${glw.y})`).toBe(true)

    // ---- Direct placement inside obstacles / outside the room is resolved (API) ----
    const tries: [number, number][] = [
      [150, -445], // inside the coffee table
      [1000, 0], // far outside right/doorway
      [-1000, -1000], // far outside left/far
      [150, -400], // overlapping the table corner
    ]
    for (const [x, z] of tries) {
      c.setPiecePosition(x, z)
      await sleep(30)
      const p = c.piecePosition
      log(`setPiecePosition(${x}, ${z}) -> ${JSON.stringify(p)}`)
      expect(placementValid(p.x, p.z, 220, 90, c.rotationDeg), `resolved spot valid for (${x}, ${z}) -> ${JSON.stringify(p)}`).toBe(true)
    }
    c.setPiecePosition(1000, 0)
    expect(c.piecePosition.x, "clamped x to right wall").toBeCloseTo(90, 1)
    expect(c.piecePosition.z, "clamped z to doorway wall").toBeCloseTo(-15, 1)

    c.setPiecePosition(0, -220)
    await sleep(1300)
    log("C4b done")
  }
}
