/**
 * SidleGeometry — pure 2D floor-plan math for Sidle (no scene access).
 *
 * Owns: piece catalog shape, oriented-rectangle (OBB) corners, clearance
 * measurement against walls + rectangular obstacles, and overlap resolution
 * ("nearest valid spot"). All coordinates are VirtualRoom-local floor-plane
 * centimeters: X = width axis, Z = depth axis (near/doorway wall at +Z).
 *
 * Yaw convention matches quat.angleAxis(yaw, vec3.up()):
 *   world.x =  local.x * cos(yaw) + local.z * sin(yaw)
 *   world.z = -local.x * sin(yaw) + local.z * cos(yaw)
 *
 * Must not: touch SceneObjects, components, or UI.
 */

export interface Pt {
  x: number
  z: number
}

export interface RoomSpec {
  minX: number // left wall line
  maxX: number // right wall line
  minZ: number // far wall line
  maxZ: number // near (doorway) wall line
}

export interface Obstacle {
  name: string
  cx: number
  cz: number
  w: number // along X
  d: number // along Z
}

/** Piece-local edge names, in outline order. front = local +Z. */
export const EDGE_NAMES = ["front", "right", "back", "left"] as const
export type EdgeName = (typeof EDGE_NAMES)[number]

export interface ClearanceHit {
  obstacle: string
  gap: number // cm, >= 0
  piecePoint: Pt // closest point on the piece outline
  obstaclePoint: Pt // closest point on the obstacle
  edge: EdgeName // piece edge facing the obstacle
}

export function rotateLocal(lx: number, lz: number, yaw: number): Pt {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {x: lx * c + lz * s, z: -lx * s + lz * c}
}

export function toLocal(dx: number, dz: number, yaw: number): Pt {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {x: dx * c - dz * s, z: dx * s + dz * c}
}

/** Corners in order: front-right, back-right, back-left, front-left. */
export function obbCorners(cx: number, cz: number, w: number, d: number, yaw: number): Pt[] {
  const hw = w / 2
  const hd = d / 2
  const local: Pt[] = [
    {x: hw, z: hd},
    {x: hw, z: -hd},
    {x: -hw, z: -hd},
    {x: -hw, z: hd},
  ]
  return local.map((p) => {
    const r = rotateLocal(p.x, p.z, yaw)
    return {x: cx + r.x, z: cz + r.z}
  })
}

export function aabbCorners(o: Obstacle): Pt[] {
  const hw = o.w / 2
  const hd = o.d / 2
  return [
    {x: o.cx + hw, z: o.cz + hd},
    {x: o.cx + hw, z: o.cz - hd},
    {x: o.cx - hw, z: o.cz - hd},
    {x: o.cx - hw, z: o.cz + hd},
  ]
}

/** World-axis half extents of a rotated rectangle. */
export function halfExtents(w: number, d: number, yaw: number): Pt {
  const c = Math.abs(Math.cos(yaw))
  const s = Math.abs(Math.sin(yaw))
  return {x: (c * w + s * d) / 2, z: (s * w + c * d) / 2}
}

/** Which piece edge faces a world-space direction. */
export function edgeFacing(dirX: number, dirZ: number, yaw: number, w: number, d: number): EdgeName {
  const l = toLocal(dirX, dirZ, yaw)
  // Normalize by half-extents so a long side isn't favored at corners.
  const ax = Math.abs(l.x) / Math.max(w / 2, 1)
  const az = Math.abs(l.z) / Math.max(d / 2, 1)
  if (az >= ax) return l.z >= 0 ? "front" : "back"
  return l.x >= 0 ? "right" : "left"
}

function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const len2 = abx * abx + abz * abz
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return {x: a.x + abx * t, z: a.z + abz * t}
}

function dist(a: Pt, b: Pt): number {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z))
}

/** Separating-axis overlap test; returns minimum push for polygon A out of B, or null if separated. */
export function satPush(a: Pt[], b: Pt[]): Pt | null {
  const axes: Pt[] = []
  const addAxes = (poly: Pt[]) => {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const ex = q.x - p.x
      const ez = q.z - p.z
      const len = Math.sqrt(ex * ex + ez * ez)
      if (len > 1e-6) axes.push({x: -ez / len, z: ex / len})
    }
  }
  addAxes(a)
  addAxes(b)
  let best: Pt | null = null
  let bestOverlap = Number.MAX_VALUE
  for (const ax of axes) {
    let aMin = Number.MAX_VALUE
    let aMax = -Number.MAX_VALUE
    let bMin = Number.MAX_VALUE
    let bMax = -Number.MAX_VALUE
    for (const p of a) {
      const v = p.x * ax.x + p.z * ax.z
      aMin = Math.min(aMin, v)
      aMax = Math.max(aMax, v)
    }
    for (const p of b) {
      const v = p.x * ax.x + p.z * ax.z
      bMin = Math.min(bMin, v)
      bMax = Math.max(bMax, v)
    }
    const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin)
    if (overlap <= 0) return null
    if (overlap < bestOverlap) {
      bestOverlap = overlap
      // push A in the direction away from B along this axis
      const aCenter = (aMin + aMax) / 2
      const bCenter = (bMin + bMax) / 2
      const sign = aCenter >= bCenter ? 1 : -1
      best = {x: ax.x * overlap * sign, z: ax.z * overlap * sign}
    }
  }
  return best
}

export function isValidPlacement(
  cx: number,
  cz: number,
  w: number,
  d: number,
  yaw: number,
  room: RoomSpec,
  obstacles: Obstacle[],
): boolean {
  const e = halfExtents(w, d, yaw)
  const eps = 0.01
  if (cx - e.x < room.minX - eps || cx + e.x > room.maxX + eps) return false
  if (cz - e.z < room.minZ - eps || cz + e.z > room.maxZ + eps) return false
  const poly = obbCorners(cx, cz, w, d, yaw)
  for (const o of obstacles) {
    if (satPush(poly, aabbCorners(o)) !== null) return false
  }
  return true
}

function clampToRoom(p: Pt, w: number, d: number, yaw: number, room: RoomSpec): Pt {
  const e = halfExtents(w, d, yaw)
  const loX = room.minX + e.x
  const hiX = room.maxX - e.x
  const loZ = room.minZ + e.z
  const hiZ = room.maxZ - e.z
  return {
    x: loX > hiX ? (room.minX + room.maxX) / 2 : Math.max(loX, Math.min(hiX, p.x)),
    z: loZ > hiZ ? (room.minZ + room.maxZ) / 2 : Math.max(loZ, Math.min(hiZ, p.z)),
  }
}

/**
 * Nearest position to (x, z) where the piece is inside the room and does not
 * overlap any obstacle. Used for dragging, swaps and rotations.
 */
export function resolvePlacement(
  x: number,
  z: number,
  w: number,
  d: number,
  yaw: number,
  room: RoomSpec,
  obstacles: Obstacle[],
): Pt {
  let p = clampToRoom({x, z}, w, d, yaw, room)
  for (let iter = 0; iter < 8; iter++) {
    let moved = false
    const poly = obbCorners(p.x, p.z, w, d, yaw)
    for (const o of obstacles) {
      const push = satPush(poly, aabbCorners(o))
      if (push) {
        p = {x: p.x + push.x * 1.001, z: p.z + push.z * 1.001}
        moved = true
        break
      }
    }
    p = clampToRoom(p, w, d, yaw, room)
    if (!moved) break
  }
  if (isValidPlacement(p.x, p.z, w, d, yaw, room, obstacles)) return p

  // Fallback: ring search outward from the requested point for the closest valid spot.
  const step = 5
  for (let r = step; r <= 600; r += step) {
    let best: Pt | null = null
    let bestD = Number.MAX_VALUE
    const n = Math.max(8, Math.round((2 * Math.PI * r) / step))
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const c = clampToRoom({x: x + Math.cos(a) * r, z: z + Math.sin(a) * r}, w, d, yaw, room)
      if (isValidPlacement(c.x, c.z, w, d, yaw, room, obstacles)) {
        const dd = dist(c, {x, z})
        if (dd < bestD) {
          bestD = dd
          best = c
        }
      }
    }
    if (best) return best
  }
  return p
}

/**
 * Gaps from the piece to every wall line and obstacle, sorted nearest-first.
 * Wall names: "LeftWall", "RightWall", "FarWall", "DoorwayWall" (near wall incl.
 * the doorway opening, measured to the wall line across it).
 */
export function measureClearances(
  cx: number,
  cz: number,
  w: number,
  d: number,
  yaw: number,
  room: RoomSpec,
  obstacles: Obstacle[],
): ClearanceHit[] {
  const corners = obbCorners(cx, cz, w, d, yaw)
  const hits: ClearanceHit[] = []

  const wall = (name: string, gapOf: (p: Pt) => number, project: (p: Pt) => Pt, nx: number, nz: number) => {
    let best = corners[0]
    let bestGap = gapOf(best)
    for (const c of corners) {
      const g = gapOf(c)
      if (g < bestGap) {
        bestGap = g
        best = c
      }
    }
    // If an edge runs parallel to the wall, use the middle of that edge.
    const near = corners.filter((c) => gapOf(c) - bestGap < 1)
    if (near.length > 1) {
      best = {
        x: near.reduce((a, c) => a + c.x, 0) / near.length,
        z: near.reduce((a, c) => a + c.z, 0) / near.length,
      }
    }
    hits.push({
      obstacle: name,
      gap: Math.max(0, bestGap),
      piecePoint: best,
      obstaclePoint: project(best),
      edge: edgeFacing(nx, nz, yaw, w, d),
    })
  }
  wall("LeftWall", (p) => p.x - room.minX, (p) => ({x: room.minX, z: p.z}), -1, 0)
  wall("RightWall", (p) => room.maxX - p.x, (p) => ({x: room.maxX, z: p.z}), 1, 0)
  wall("FarWall", (p) => p.z - room.minZ, (p) => ({x: p.x, z: room.minZ}), 0, -1)
  wall("DoorwayWall", (p) => room.maxZ - p.z, (p) => ({x: p.x, z: room.maxZ}), 0, 1)

  for (const o of obstacles) {
    const oc = aabbCorners(o)
    let bestGap = Number.MAX_VALUE
    let pp: Pt = corners[0]
    let op: Pt = oc[0]
    // piece corners vs obstacle edges
    for (const c of corners) {
      for (let i = 0; i < 4; i++) {
        const q = closestOnSegment(c, oc[i], oc[(i + 1) % 4])
        const g = dist(c, q)
        if (g < bestGap) {
          bestGap = g
          pp = c
          op = q
        }
      }
    }
    // obstacle corners vs piece edges
    for (const c of oc) {
      for (let i = 0; i < 4; i++) {
        const q = closestOnSegment(c, corners[i], corners[(i + 1) % 4])
        const g = dist(c, q)
        if (g < bestGap) {
          bestGap = g
          pp = q
          op = c
        }
      }
    }
    if (satPush(corners, oc) !== null) bestGap = 0
    let dx = op.x - pp.x
    let dz = op.z - pp.z
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) {
      dx = o.cx - cx
      dz = o.cz - cz
    }
    hits.push({
      obstacle: o.name,
      gap: bestGap,
      piecePoint: pp,
      obstaclePoint: op,
      edge: edgeFacing(dx, dz, yaw, w, d),
    })
  }

  hits.sort((a, b) => a.gap - b.gap)
  return hits
}
