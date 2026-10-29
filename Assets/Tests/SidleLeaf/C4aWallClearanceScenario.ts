/**
 * Done criterion 4 (walls) — drag the piece (pinch-drag PieceGrab) toward the right
 * wall until < 80 cm: right edge red, live "NN cm" gap number on the floor between
 * piece and wall; drag back: green again and the number fades out after ~1 s.
 * Also checks the 80 cm threshold boundary and the other walls (API positioning).
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {dragPiece, expectEdges, interactable, local, log, obj, resetState, ROOM} from "./SidleTestHelpers"

function checkGapLabelBetween(c: SidleController, ctx: string, expectGap: number, axis: "x" | "z", pieceEdge: number, wall: number): void {
  expect(c.gapLabelVisible, `${ctx}: gap label visible`).toBe(true)
  expect(obj("GapLabel").enabled, `${ctx}: GapLabel enabled`).toBe(true)
  expect(c.gapLabelText, `${ctx}: gap text`).toBe(`${Math.floor(expectGap)} cm`)
  const gl = local("GapLabel")
  log(`${ctx}: gap ${c.gapLabelText} label at ${gl}`)
  expect(gl.y >= 0 && gl.y < 2, `${ctx}: gap label on the floor (y ${gl.y})`).toBe(true)
  const v = axis === "x" ? gl.x : gl.z
  const lo = Math.min(pieceEdge, wall)
  const hi = Math.max(pieceEdge, wall)
  if (expectGap >= 20) {
    expect(v >= lo - 0.5 && v <= hi + 0.5, `${ctx}: gap label between piece edge ${pieceEdge} and wall ${wall} (got ${v})`).toBe(true)
  } else {
    // narrow gaps: Lens puts it just outside the facing edge (documented in SidleController)
    expect(Math.abs(v - pieceEdge) <= 21, `${ctx}: narrow-gap label next to the facing edge (got ${v})`).toBe(true)
  }
}

@component
export class C4aWallClearanceScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C4aInteractor")
    expectEdges(c, ["green", "green", "green", "green"], "start spot")

    // ---- Real drag toward the right wall ----
    let guard = 0
    while (c.nearestGapCm >= 60 && guard++ < 12) await dragPiece(it, new vec3(1.5, 0, 0), 300)
    const p = c.piecePosition
    const expectGap = ROOM.maxX - (p.x + 110)
    log(`after drag: pos ${JSON.stringify(p)} nearest ${c.nearestObstacle} ${c.nearestGapCm}`)
    expect(p.x > 10, `piece dragged right (x ${p.x})`).toBe(true)
    expect(c.nearestObstacle, "nearest obstacle").toBe("RightWall")
    expect(c.nearestGapCm < 80, `gap < 80 (got ${c.nearestGapCm})`).toBe(true)
    expect(c.nearestGapCm, "gap value = wall - right edge").toBeCloseTo(expectGap, 1)
    expect(c.isClear, "isClear false").toBe(false)
    expectEdges(c, ["green", "red", "green", "green"], "near right wall")
    checkGapLabelBetween(c, "near right wall", expectGap, "x", p.x + 110, ROOM.maxX)
    expect(Math.abs(local("GapLabel").z - p.z) <= 45.5, "gap label alongside the piece in z").toBe(true)
    expect(local("Piece").y, "piece stays on floor while dragged").toBeCloseTo(0, 2)

    // live update while dragging: gap text changes during a drag that is still held
    const before = c.gapLabelText
    const dp = it.drag(interactable("PieceGrab"), new vec3(-0.5, 0, 0), 700)
    await sleep(500)
    const during = c.gapLabelText
    const duringDrag = c.isDragging
    await dp
    await sleep(150)
    log(`live gap: before "${before}" during "${during}" (dragging=${duringDrag}) after "${c.gapLabelText}"`)
    expect(duringDrag, "still dragging when sampled").toBe(true)
    expect(during !== before || !c.gapLabelVisible, `gap number updates live while dragging ("${before}" -> "${during}")`).toBe(true)

    // ---- Drag back until clear again ----
    guard = 0
    while (!c.isClear && guard++ < 25) await dragPiece(it, new vec3(-1.0, 0, 0), 150)
    const tClear = getTime()
    log(`back: pos ${JSON.stringify(c.piecePosition)} nearest ${c.nearestObstacle} ${c.nearestGapCm}`)
    expect(c.isClear, "clear again after dragging back").toBe(true)
    expect(c.nearestGapCm >= 80, `>= 80 after dragging back (got ${c.nearestGapCm})`).toBe(true)
    expectEdges(c, ["green", "green", "green", "green"], "dragged back")
    // fade: still (partly) visible shortly after, gone after ~1 s
    await sleep(300)
    const a1 = c.gapLabelAlpha
    const t1 = getTime() - tClear
    await sleep(1100)
    const t2 = getTime() - tClear
    log(`fade: alpha ${a1.toFixed(2)} at +${t1.toFixed(2)}s, alpha ${c.gapLabelAlpha.toFixed(2)} at +${t2.toFixed(2)}s`)
    expect(a1 > 0 && a1 < 1, `gap number fading (alpha ${a1} at +${t1.toFixed(2)}s)`).toBe(true)
    expect(c.gapLabelVisible, "gap label hidden ~1.2 s after going green").toBe(false)
    expect(obj("GapLabel").enabled, "GapLabel disabled after fade").toBe(false)

    // ---- Threshold boundary + other walls (API positioning; values exact) ----
    c.setPiecePosition(10, -220) // right gap exactly 80
    await sleep(50)
    expect(c.nearestGapCm, "boundary gap").toBeCloseTo(80, 2)
    expect(c.isClear, "80 cm counts as clear").toBe(true)
    expectEdges(c, ["green", "green", "green", "green"], "exactly 80")
    c.setPiecePosition(10.5, -220)
    await sleep(50)
    expect(c.isClear, "79.5 cm is too close").toBe(false)
    expect(c.gapLabelText, "79.5 floors to 79").toBe("79 cm")
    expectEdges(c, ["green", "red", "green", "green"], "79.5 to right wall")

    c.setPiecePosition(-40, -220) // left wall: -150 edge, gap 50
    await sleep(50)
    expect(c.nearestObstacle, "left wall").toBe("LeftWall")
    expectEdges(c, ["green", "green", "green", "red"], "near left wall")
    checkGapLabelBetween(c, "left wall", 50, "x", -150, ROOM.minX)

    c.setPiecePosition(0, -40) // doorway wall line: front edge -40+45=5, gap 25
    await sleep(50)
    expect(c.nearestObstacle, "doorway wall").toBe("DoorwayWall")
    expectEdges(c, ["red", "green", "green", "green"], "near doorway wall")
    checkGapLabelBetween(c, "doorway wall", 25, "z", 5, ROOM.maxZ)

    c.setPiecePosition(-50, -395) // far wall: back edge -440 -> gap 30 (left wall 40, coffee table 40)
    await sleep(50)
    log(`far wall clearances ${JSON.stringify(c.clearances)}`)
    expect(c.nearestObstacle, "far wall").toBe("FarWall")
    expectEdges(c, ["green", "green", "red", "green"], "near far wall")
    checkGapLabelBetween(c, "far wall", 30, "z", -440, ROOM.minZ)

    c.setPiecePosition(0, -220)
    await sleep(1300)
    expect(c.gapLabelVisible, "gap label gone after reset").toBe(false)
    log("C4a done")
  }
}
