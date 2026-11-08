/**
 * C31 — backdrop room mode (Colorful Home living room). Needs SidleController.roomMode
 * = "backdrop" and Preview: Interactive, source Colorful Home.
 *
 * Checks: the fixed anchor (floor y = -135, yaw +45°), the measured bounds and the two
 * wall obstacles (pillar, wall stub), no stand-in room built, the piece spawning about
 * 300 cm ahead of the start position (green), the 80 cm rule against a wall and the pillar,
 * real drags stopping at the pillar and the wall stub (and the drag math never jumping
 * past either), the 90 x 200 door rule on the panel, and the piece's feet on the floor.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {
  BACKDROP_ANCHOR,
  BACKDROP_OBSTACLES,
  BACKDROP_ROOM,
  fitsThroughDoor,
  isValidPlacement,
  resolveDrag,
} from "../../Scripts/SidleGeometry"
import {controller, dragPiece, log, meshBounds, obj, yawOf} from "./SidleTestHelpers"

const SOFA_A = {w: 220, d: 90, h: 85}
const PILLAR = {minX: 112.2, maxX: 181.3, minZ: -493.7, maxZ: -447.4}
const STUB = {minX: -360.4, maxX: -163.3, minZ: 18.0, maxZ: 24.6}

@component
export class C31BackdropRoomScenario extends Scenario {
  async run(): Promise<void> {
    const c = controller()
    const it = new DefaultLeafInteractor("C31Interactor")
    await sleep(1000)
    expect(c.mode, "roomMode (set the scene to backdrop to run C31)").toBe("backdrop")

    // ── Anchor and room spec ────────────────────────────────────────────────
    const rt = obj("VirtualRoom").getTransform()
    const rp = rt.getWorldPosition()
    log(`VirtualRoom world (${rp.x.toFixed(2)}, ${rp.y.toFixed(2)}, ${rp.z.toFixed(2)}), yaw ${((yawOf(rt) * 180) / Math.PI).toFixed(2)}°`)
    expect(rp.y, "floor y in the Lens frame").toBeCloseTo(-135, 2)
    expect(rp.x, "anchor x").toBeCloseTo(BACKDROP_ANCHOR.x, 2)
    expect(rp.z, "anchor z").toBeCloseTo(BACKDROP_ANCHOR.z, 2)
    expect((yawOf(rt) * 180) / Math.PI, "anchor yaw (house axes)").toBeCloseTo(45, 2)
    const R = c.roomSpec
    expect(R.minX, "minX").toBeCloseTo(-351.7, 3)
    expect(R.maxX, "maxX").toBeCloseTo(168.8, 3)
    expect(R.minZ, "minZ").toBeCloseTo(-477.6, 3)
    expect(R.maxZ, "maxZ").toBeCloseTo(24.3, 3)
    expect(R.maxX - R.minX, "width 520.5").toBeCloseTo(520.5, 3)
    expect(R.maxZ - R.minZ, "depth 501.9").toBeCloseTo(501.9, 3)
    const obs = c.roomObstacles
    log(`room obstacles: ${JSON.stringify(obs)}`)
    expect(obs.map((o) => o.name).join(","), "room obstacles").toBe("Pillar,WallStub")
    for (const [o, b] of [[obs[0], PILLAR], [obs[1], STUB]] as const) {
      expect(o.yaw, `${o.name} is oriented (yaw 0), so drags stop at it`).toBe(0)
      expect(o.cx - o.w / 2, `${o.name} minX`).toBeCloseTo(b.minX, 2)
      expect(o.cx + o.w / 2, `${o.name} maxX`).toBeCloseTo(b.maxX, 2)
      expect(o.cz - o.d / 2, `${o.name} minZ`).toBeCloseTo(b.minZ, 2)
      expect(o.cz + o.d / 2, `${o.name} maxZ`).toBeCloseTo(b.maxZ, 2)
    }
    // No stand-in room: no walls or floor built, coffee table and door frame hidden.
    for (const n of ["Wall_Left", "Wall_Far", "Floor", "RoomDecor", "RoomDoorFrame"]) {
      expect(!findSceneObjectByName(n), `no stand-in ${n}`).toBe(true)
    }
    expect(obj("CoffeeTable").enabled, "coffee table hidden").toBe(false)
    expect(obj("Doorway").enabled, "stand-in doorway hidden").toBe(false)

    // ── Start spot: about 300 cm ahead of the start position, green ──────────
    const p0 = c.piecePosition
    log(`start piece ${c.currentPieceKey} at ${JSON.stringify(p0)}, clear=${c.isClear}, nearest ${c.nearestObstacle} ${c.nearestGapCm.toFixed(1)} cm`)
    const ahead = Math.sqrt(p0.x * p0.x + p0.z * p0.z)
    const offDeg = (Math.atan2(-p0.x, -p0.z) * 180) / Math.PI
    log(`start spot ${ahead.toFixed(1)} cm from the start position, ${offDeg.toFixed(1)}° left of straight ahead`)
    expect(Math.abs(ahead - 300) <= 5, `about 300 cm ahead (${ahead.toFixed(1)})`).toBe(true)
    expect(Math.abs(offDeg) <= 10, `ahead, within 10° (${offDeg.toFixed(1)})`).toBe(true)
    expect(p0.z < R.maxZ && p0.z > R.minZ && p0.x > R.minX && p0.x < R.maxX, "inside the living room").toBe(true)
    expect(c.isClear, "start spot is clear (green)").toBe(true)

    // ── Feet on the backdrop floor ───────────────────────────────────────────
    const piece = obj("Piece")
    expect(piece.getTransform().getWorldPosition().y, "piece root on the floor (y -135)").toBeCloseTo(-135, 2)
    const vis = obj(`Piece_${c.currentPieceKey}`)
    const b = meshBounds(vis, piece)
    expect(b !== null, "piece visual found").toBe(true)
    const feetY = piece.getTransform().getWorldPosition().y + b!.min.y
    log(`feet world y ${feetY.toFixed(2)} (visual min ${b!.min.y.toFixed(2)} cm above the piece root)`)
    expect(Math.abs(feetY - -135) <= 2, `feet within 2 cm of the floor (y ${feetY.toFixed(2)})`).toBe(true)

    // ── Door rule (90 x 200) on the panel ───────────────────────────────────
    const d = c.currentDims
    const fits = fitsThroughDoor(d.w, d.d, d.h)
    log(`door line: "${c.doorFitText}" (rule says fits=${fits})`)
    expect(c.doorFitText, "door-fit line follows the 90 x 200 rule").toBe(fits ? "Fits through the 90 cm door" : "Too big for the 90 cm door")

    // From here on: Sofa A (220 x 90), rotation 0.
    let g = 0
    while (c.currentPieceKey !== "SofaA" && g++ < 40) {
      if (c.currentPieceType === "sofa") c.compare()
      else c.nextPiece()
    }
    expect(c.currentPieceKey, "Sofa A").toBe("SofaA")
    expect(c.doorFitText, "Sofa A fits the 90 x 200 door").toBe("Fits through the 90 cm door")

    // ── 80 cm rule: right wall and pillar ───────────────────────────────────
    const hw = SOFA_A.w / 2
    const hd = SOFA_A.d / 2
    c.setPiecePosition(R.maxX - hw - 80, -250)
    await sleep(50)
    expect(c.nearestObstacle, "nearest: right wall").toBe("RightWall")
    expect(c.nearestGapCm, "80 cm to the right wall").toBeCloseTo(80, 2)
    expect(c.isClear, "80 cm counts as clear").toBe(true)
    c.setPiecePosition(R.maxX - hw - 79.5, -250)
    await sleep(50)
    expect(c.isClear, "79.5 cm to the wall is too close").toBe(false)
    // Diagonal to the pillar's front-left corner: piece right edge 40 cm left of it (right wall 96.6 cm away), back edge dz in front.
    const px = PILLAR.minX - 40 - hw
    const dz80 = Math.sqrt(80 * 80 - 40 * 40)
    c.setPiecePosition(px, PILLAR.maxZ + dz80 + hd)
    await sleep(50)
    log(`pillar 80: nearest ${c.nearestObstacle} ${c.nearestGapCm.toFixed(2)} cm`)
    expect(c.nearestObstacle, "nearest: pillar").toBe("Pillar")
    expect(c.nearestGapCm, "80 cm to the pillar").toBeCloseTo(80, 1)
    expect(c.isClear, "80 cm to the pillar is clear").toBe(true)
    c.setPiecePosition(px, PILLAR.maxZ + dz80 - 1 + hd)
    await sleep(50)
    expect(c.isClear, "1 cm closer to the pillar is too close").toBe(false)
    expect(c.nearestObstacle, "still the pillar").toBe("Pillar")

    // ── Drag math: never jumps past the pillar or the stub ──────────────────
    const solid = BACKDROP_OBSTACLES
    const q1 = resolveDrag(60, -380, 60, -470, SOFA_A.w, SOFA_A.d, 0, BACKDROP_ROOM, solid)
    log(`resolveDrag into the pillar -> ${JSON.stringify(q1)}`)
    expect(q1.z - hd >= PILLAR.maxZ - 0.6, `stops at the pillar front (back edge ${(q1.z - hd).toFixed(2)})`).toBe(true)
    expect(isValidPlacement(q1.x, q1.z, SOFA_A.w, SOFA_A.d, 0, BACKDROP_ROOM, solid), "valid after the pillar drag").toBe(true)
    const q2 = resolveDrag(-240, -60, -240, 40, SOFA_A.w, SOFA_A.d, 0, BACKDROP_ROOM, solid)
    log(`resolveDrag into the stub -> ${JSON.stringify(q2)}`)
    expect(q2.z + hd <= STUB.minZ + 0.6, `stops at the stub (front edge ${(q2.z + hd).toFixed(2)})`).toBe(true)

    // ── Real drags (SIK pinch) into the pillar and the stub ─────────────────
    c.setPiecePosition(40, -330)
    await sleep(300)
    let prevZ = Infinity
    g = 0
    while (g++ < 40 && Math.abs(prevZ - c.piecePosition.z) > 0.01) {
      prevZ = c.piecePosition.z
      await dragPiece(it, new vec3(0, 0, -8), 300)
      const p = c.piecePosition
      expect(isValidPlacement(p.x, p.z, SOFA_A.w, SOFA_A.d, 0, BACKDROP_ROOM, solid), `no overlap while dragging into the pillar (${JSON.stringify(p)})`).toBe(true)
    }
    const pp = c.piecePosition
    log(`dragged into the pillar: ${JSON.stringify(pp)}, nearest ${c.nearestObstacle} ${c.nearestGapCm.toFixed(2)}`)
    expect(pp.z - hd >= PILLAR.maxZ - 0.6 && pp.z - hd <= PILLAR.maxZ + 3, `back edge stopped at the pillar front (${(pp.z - hd).toFixed(2)})`).toBe(true)
    expect(c.nearestObstacle, "touching the pillar").toBe("Pillar")
    expect(c.isClear, "red at the pillar").toBe(false)

    c.setPiecePosition(-230, -80)
    await sleep(300)
    prevZ = -Infinity
    g = 0
    while (g++ < 40 && Math.abs(prevZ - c.piecePosition.z) > 0.01) {
      prevZ = c.piecePosition.z
      await dragPiece(it, new vec3(0, 0, 8), 300)
      const p = c.piecePosition
      expect(isValidPlacement(p.x, p.z, SOFA_A.w, SOFA_A.d, 0, BACKDROP_ROOM, solid), `no overlap while dragging into the stub (${JSON.stringify(p)})`).toBe(true)
    }
    const ps = c.piecePosition
    log(`dragged into the stub: ${JSON.stringify(ps)}, nearest ${c.nearestObstacle} ${c.nearestGapCm.toFixed(2)}`)
    expect(ps.z + hd <= STUB.minZ + 0.6 && ps.z + hd >= STUB.minZ - 3, `front edge stopped at the stub (${(ps.z + hd).toFixed(2)})`).toBe(true)
    expect(c.nearestObstacle, "touching the stub").toBe("WallStub")

    // Left wall by drag: never past the wall line.
    c.setPiecePosition(-150, -250)
    await sleep(300)
    let prevX = Infinity
    g = 0
    while (g++ < 40 && Math.abs(prevX - c.piecePosition.x) > 0.01) {
      prevX = c.piecePosition.x
      await dragPiece(it, new vec3(-8, 0, 0), 300)
    }
    const pl = c.piecePosition
    log(`dragged into the left wall: ${JSON.stringify(pl)}`)
    expect(pl.x - hw >= R.minX - 0.01 && pl.x - hw <= R.minX + 3, `left edge at the left wall (${(pl.x - hw).toFixed(2)})`).toBe(true)
    log("C31 done")
  }
}
