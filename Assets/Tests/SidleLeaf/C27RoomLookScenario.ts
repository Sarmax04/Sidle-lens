/**
 * Done criteria 24 and 25 (Update 7) — a nicer room that changes only the look.
 *
 * 24: the floor, plank lines, accent wall, baseboards, window, door frame and
 *     rug exist under their names; they are decoration only (no colliders, not
 *     in the clearance list); no room colour is darker than mid-tone (WCAG
 *     relative luminance >= 0.35, computed here from each material's colour);
 *     the outline and gap number stay readable on the floor surfaces (they sit
 *     above them, and their colours differ clearly: CIE76 dE >= 30; luminance
 *     contrast is logged).
 * 25: room size, wall height, doorway opening, coffee table, start position and
 *     clearance results are exactly as before (worked out independently here).
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {ROOM_DEPTH_CM, ROOM_WIDTH_CM} from "../../Scripts/SidleGeometry"
import {COFFEE, findChild, local, log, obj, resetState, ROOM, SOFA_A_HALF, START} from "./SidleTestHelpers"

/** Brief, Update 7: every room colour at least mid-tone. */
const MIN_LUMINANCE = 0.35
/** Readability: the marking colours must clearly differ from every floor surface. */
const MIN_DELTA_E = 30
/** Room surfaces (not the furniture pieces, outline or labels, which also live under VirtualRoom). */
const ROOM_ROOTS = ["Floor", "Walls", "Doorway", "CoffeeTable", "RoomDecor"]

function lin(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
/** WCAG relative luminance of an sRGB colour. */
function luminance(c: vec4): number {
  return 0.2126 * lin(c.x) + 0.7152 * lin(c.y) + 0.0722 * lin(c.z)
}
function contrast(a: vec4, b: vec4): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
function lab(c: vec4): number[] {
  const r = lin(c.x)
  const g = lin(c.y)
  const b = lin(c.z)
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}
function deltaE(a: vec4, b: vec4): number {
  const p = lab(a)
  const q = lab(b)
  return Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2)
}

function colourOf(so: SceneObject): vec4 {
  const v = so.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
  if (!v || !v.mainMaterial) throw new Error(`${so.name} has no mesh visual`)
  return v.mainMaterial.mainPass.baseColor
}

/** Every mesh visual under `root`, with its colour. */
function visuals(root: SceneObject): {name: string; colour: vec4}[] {
  const out: {name: string; colour: vec4}[] = []
  const stack = [root]
  while (stack.length) {
    const so = stack.pop()!
    const v = so.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
    if (v && v.mainMaterial) out.push({name: so.name, colour: v.mainMaterial.mainPass.baseColor})
    for (let i = 0; i < so.getChildrenCount(); i++) stack.push(so.getChild(i))
  }
  return out
}

function countComponents(root: SceneObject, type: string): number {
  let n = 0
  const stack = [root]
  while (stack.length) {
    const so = stack.pop()!
    n += so.getComponents(type as any).length
    for (let i = 0; i < so.getChildrenCount(); i++) stack.push(so.getChild(i))
  }
  return n
}

/** Independent rectangle-to-rectangle gap (axis aligned). */
function rectGap(a: {minX: number; maxX: number; minZ: number; maxZ: number}, b: {minX: number; maxX: number; minZ: number; maxZ: number}): number {
  const dx = Math.max(0, b.minX - a.maxX, a.minX - b.maxX)
  const dz = Math.max(0, b.minZ - a.maxZ, a.minZ - b.maxZ)
  return Math.sqrt(dx * dx + dz * dz)
}

@component
export class C27RoomLookScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()

    // ── 24a. The named room parts exist ────────────────────────────────────────
    const decor = obj("RoomDecor")
    const planks: SceneObject[] = []
    for (let i = 1; ; i++) {
      const p = findSceneObjectByName(`RoomFloorPlank_${i}`, decor)
      if (!p) break
      planks.push(p)
    }
    log(`plank lines: ${planks.length}`)
    expect(planks.length >= 10, `thin plank lines on the floor (${planks.length})`).toBe(true)
    for (const p of planks) {
      const s = p.getTransform().getLocalScale()
      expect(Math.min(s.x, s.z) <= 2 && Math.max(s.x, s.z) >= ROOM_DEPTH_CM - 1, `${p.name} is a thin line along the floor`).toBe(true)
    }
    for (const n of ["RoomBaseboard_Left", "RoomBaseboard_Right", "RoomBaseboard_Far", "RoomBaseboard_NearLeft", "RoomBaseboard_NearRight"]) {
      const b = findChild(decor, n)
      expect(b.getTransform().getLocalPosition().y - b.getTransform().getLocalScale().y / 2, `${n} on the floor`).toBeCloseTo(0, 2)
    }
    const win = findChild(decor, "RoomWindow")
    const winX = win.getTransform().getLocalPosition().x
    expect(Math.abs(winX - ROOM.minX) < 0.01 || Math.abs(winX - ROOM.maxX) < 0.01, `window in a long (side) wall (x ${winX})`).toBe(true)
    const pane = findChild(win, "RoomWindowPane")
    const rug = findChild(decor, "RoomRug")
    const doorFrame = findChild(obj("Doorway"), "RoomDoorFrame")
    for (const n of ["Jamb_Left", "Jamb_Right", "Head"]) expect(findChild(doorFrame, n).enabled, `door frame has ${n}`).toBe(true)

    // ── 24b. Colours ───────────────────────────────────────────────────────────
    const floorC = colourOf(obj("Floor"))
    const plankC = colourOf(planks[0])
    const rugC = colourOf(rug)
    const wallL = colourOf(obj("Wall_Left"))
    const wallR = colourOf(obj("Wall_Right"))
    const wallFar = colourOf(obj("Wall_Far"))
    const bb = colourOf(findChild(decor, "RoomBaseboard_Left"))
    const frameC = colourOf(findChild(doorFrame, "Jamb_Left"))
    const paneC = colourOf(pane)
    log(`luminance: floor ${luminance(floorC).toFixed(3)}, planks ${luminance(plankC).toFixed(3)}, rug ${luminance(rugC).toFixed(3)}, walls ${luminance(wallL).toFixed(3)}, accent ${luminance(wallFar).toFixed(3)}, baseboard ${luminance(bb).toFixed(3)}, door frame ${luminance(frameC).toFixed(3)}, pane ${luminance(paneC).toFixed(3)}`)
    expect(floorC.x > floorC.y && floorC.y > floorC.z, `floor is a warm wood tone (${floorC})`).toBe(true)
    const dPlank = Math.abs(luminance(plankC) - luminance(floorC))
    expect(dPlank > 0.02 && dPlank < 0.3, `plank lines slightly lighter or darker than the floor (dL ${dPlank.toFixed(3)})`).toBe(true)
    expect(JSON.stringify(wallL) === JSON.stringify(wallR), "left and right walls share the warm white").toBe(true)
    expect(luminance(wallL) > 0.75 && wallL.x >= wallL.z, `walls warm white (L ${luminance(wallL).toFixed(3)})`).toBe(true)
    expect(deltaE(wallFar, wallL) > 10, "far wall is an accent colour").toBe(true)
    expect(luminance(wallFar) < luminance(wallL) && luminance(wallFar) <= 0.75, `accent wall a soft mid colour (L ${luminance(wallFar).toFixed(3)})`).toBe(true)
    expect(luminance(bb) > luminance(wallL), "baseboards lighter than the walls").toBe(true)
    expect(luminance(frameC) > 0.75, "door frame in a light tone").toBe(true)
    expect(luminance(paneC) > 0.75, "window pane pale and bright").toBe(true)

    // No room colour darker than mid-tone.
    let darkest = {name: "", l: Infinity}
    let count = 0
    for (const r of ROOM_ROOTS) {
      for (const v of visuals(obj(r))) {
        count++
        const l = luminance(v.colour)
        if (l < darkest.l) darkest = {name: `${r}/${v.name}`, l}
      }
    }
    log(`REPORT darkest room colour: ${darkest.name} L=${darkest.l.toFixed(3)} (of ${count} room visuals)`)
    expect(darkest.l >= MIN_LUMINANCE, `darkest room colour ${darkest.name} L ${darkest.l.toFixed(3)} >= ${MIN_LUMINANCE}`).toBe(true)

    // Decoration only: no colliders in the room surfaces or decoration, and the clearance list has the same five obstacles.
    for (const r of ROOM_ROOTS) expect(countComponents(obj(r), "Physics.ColliderComponent"), `no colliders under ${r}`).toBe(0)
    expect(c.clearances.map((h) => h.obstacle).sort().join(","), "clearance obstacles unchanged").toBe("CoffeeTable,DoorwayWall,FarWall,LeftWall,RightWall")

    // Readability: markings sit above every floor surface and clearly differ in colour.
    const surfaceTop = (so: SceneObject) => so.getTransform().getLocalPosition().y + so.getTransform().getLocalScale().y / 2
    const topOfFloor = Math.max(surfaceTop(rug), ...planks.map(surfaceTop), surfaceTop(obj("Floor")))
    const edge = obj("Edge_Front")
    const edgeTop = edge.getTransform().getLocalPosition().y + edge.getTransform().getLocalScale().y / 2
    log(`floor surfaces top ${topOfFloor.toFixed(2)} cm, outline top ${edgeTop.toFixed(2)} cm`)
    expect(edgeTop - topOfFloor >= 0.2, "outline stands above the rug and plank lines").toBe(true)
    const marks: [string, vec4][] = [
      ["green outline", c.clearColor],
      ["red outline", c.tooCloseColor],
      ["gap number", c.labelsUI.gapColor],
    ]
    for (const [sn, sc] of [["floor", floorC], ["plank lines", plankC], ["rug", rugC]] as [string, vec4][]) {
      const parts: string[] = []
      for (const [mn, mc] of marks) {
        const de = deltaE(sc, mc)
        parts.push(`${mn} ${contrast(sc, mc).toFixed(2)}:1 dE ${de.toFixed(0)}`)
        expect(de >= MIN_DELTA_E, `${mn} on ${sn}: dE ${de.toFixed(1)} >= ${MIN_DELTA_E}`).toBe(true)
      }
      log(`REPORT on ${sn} (L ${luminance(sc).toFixed(3)}): ${parts.join(" | ")}`)
    }
    // Live: red edge and gap number on the new floor, the number above the floor surfaces.
    c.setPiecePosition(ROOM.minX + SOFA_A_HALF.w + 40, START.z) // 40 cm from the left wall
    await sleep(100)
    expect(c.gapLabelText, "gap number on the new floor").toBe("40 cm")
    expect(obj("GapLabel").enabled, "gap number shown").toBe(true)
    expect(local("GapLabel").y > topOfFloor, `gap number above the floor surfaces (y ${local("GapLabel").y})`).toBe(true)
    expect(c.outlineEdgeColors.join(","), "left edge red").toBe("green,green,green,red")

    // ── 25. Room, doorway, coffee table and clearance numbers unchanged ───────
    const R = c.roomSpec
    expect(R.maxX - R.minX, "room width").toBeCloseTo(ROOM_WIDTH_CM, 3)
    expect(R.maxZ - R.minZ, "room depth").toBeCloseTo(ROOM_DEPTH_CM, 3)
    expect(JSON.stringify(R), "room lines").toBe(JSON.stringify(ROOM))
    expect(obj("Wall_Left").getTransform().getLocalScale().y, "wall height").toBeCloseTo(250, 3)
    expect(obj("Wall_Far").getTransform().getLocalScale().x - 20, "far wall spans the room").toBeCloseTo(ROOM_WIDTH_CM, 3)
    const jl = findChild(doorFrame, "Jamb_Left").getTransform().getLocalPosition()
    const jr = findChild(doorFrame, "Jamb_Right").getTransform().getLocalPosition()
    const head = findChild(doorFrame, "Head").getTransform().getLocalPosition()
    expect(jr.x - jl.x - 5, "doorway opening width").toBeCloseTo(90, 3)
    expect(head.y - 2.5, "doorway opening height").toBeCloseTo(200, 3)
    expect(local("Doorway").z, "doorway on the near wall line").toBeCloseTo(ROOM.maxZ, 3)
    const ct = local("CoffeeTable")
    expect(ct.x, "coffee table x").toBeCloseTo((COFFEE.minX + COFFEE.maxX) / 2, 3)
    expect(ct.z, "coffee table z").toBeCloseTo((COFFEE.minZ + COFFEE.maxZ) / 2, 3)
    const top = findChild(obj("CoffeeTable"), "Top").getTransform()
    expect(JSON.stringify([top.getLocalScale().x, top.getLocalScale().z, top.getLocalPosition().y + top.getLocalScale().y / 2]), "coffee table 100 x 50 x 45").toBe(JSON.stringify([100, 50, 45]))

    // Clearance numbers at the start spot and two others, against an independent calculation.
    for (const [x, z] of [[START.x, START.z], [0, -400], [-60, -120]]) {
      c.setPiecePosition(x, z)
      await sleep(30)
      const s = {minX: x - SOFA_A_HALF.w, maxX: x + SOFA_A_HALF.w, minZ: z - SOFA_A_HALF.d, maxZ: z + SOFA_A_HALF.d}
      const want: {[k: string]: number} = {
        LeftWall: s.minX - ROOM.minX,
        RightWall: ROOM.maxX - s.maxX,
        FarWall: s.minZ - ROOM.minZ,
        DoorwayWall: ROOM.maxZ - s.maxZ,
        CoffeeTable: rectGap(s, COFFEE),
      }
      const got = c.clearances
      log(`clearances at (${x}, ${z}): ${got.map((h) => `${h.obstacle} ${h.gap.toFixed(3)}`).join(", ")}`)
      expect(got.length, `(${x}, ${z}): five obstacles`).toBe(5)
      for (const h of got) expect(Math.abs(h.gap - want[h.obstacle]) < 1e-6, `(${x}, ${z}): ${h.obstacle} ${h.gap} vs ${want[h.obstacle]}`).toBe(true)
    }

    await resetState()
    expect(c.piecePosition.x, "start spot x").toBe(START.x)
    expect(c.piecePosition.z, "start spot z").toBe(START.z)
    log("C27 done")
  }
}
