// Sidle DEMO replay (Lens Studio editor script; run it with the Lens Studio MCP tool ExecuteEditorCode,
// path = this file). It starts the DEMO scenario in the Preview (backdrop mode, head = preview) and
// drives the PREVIEW head along Assets/Tests/SidleDemo/DemoPath.json, so the Colorful Home backdrop
// moves with the camera exactly as with WASD. Lives outside Assets/ so the Lens does not compile it.
//
// Sync: the head is held at the path's first pose until the DEMO posts "SidleDemoStart" (its clock
// zero). A timer then plays the path by DEMO time, interpolating between the recorded samples. At every
// scene start ("SidleDemoScene") and every pinch ("SidleDemoPinch", sent when the DEMO's camera has
// stopped for it) the replay's time is pulled onto the recorded time of that moment, gently (drift under
// 0.1 s is ignored, corrections run at most 0.1 s per s, so the walk never speeds up by more than 10%).
//
// Robustness: one owner object (globalThis.__sidleReplay) owns the timer and the message listener;
// a new run stops the old owner first and the owner cleans up when the DEMO ends, the path ends or a
// watchdog fires. Every tick the head's pose is read back and re-sent if it did not take. If the DEMO
// does not report its start within 10 s the start request is sent once more; if it still does not
// start, or it starts with head = walker (backdrop would not move), the replay stops with a FAILED line.
//
// args (all optional): {scene: "1" | "1,2" | "all", rate: updates per second (default 62: smoothest
//   camera; 30 or 20 per second gave 1-2 fps more but 28-70% more frame-to-frame jitter),
//   record: "1" (the DEMO logs the actual camera pose for the accuracy check), logTicks: true (log every
//   commanded pose as [SidleTick] lines), start: false (only arm;
//   then press Run on DEMO in the LEAF panel: its default head = auto finds the armed replay)}

const fs = await import("LensStudio:FileSystem")
const g = globalThis as any
const A: any = typeof args === "object" && args ? args : {}
if (g.__sidleReplay) g.__sidleReplay.stop("replaced by a new run")

const model = pluginSystem.findInterface(Editor.Model.IModel) as Editor.Model.IModel
const file = model.project.assetsDirectory.appended(new Editor.Path("Tests/SidleDemo/DemoPath.json"))
const P = JSON.parse(fs.readFile(file) as any)
const S: number[][] = P.samples // [t, x, y, z, yawDeg, pitchDeg]
const PINCH: number[] = P.pinches || []
const dm = pluginSystem.findInterface(Editor.Dock.IDockManager) as any
const panel = dm ? dm.findPanel("Snap.Plugin.Gui.PreviewPanel") : null
if (!panel || Editor.isNull(panel)) throw new Error("Preview panel not found: open the Preview panel first")

const RATE = Math.max(5, Math.min(120, Number(A.rate ?? 62)))
const SCENE = String(A.scene ?? "all")
const DEG = Math.PI / 180
/** Re-anchoring: drift below DEADBAND s is ignored; corrections run at most MAX_CORR s of path time per s. */
const DEADBAND = 0.1
const MAX_CORR = 0.1

/** Pose (x, y, z, yaw, pitch) at DEMO time t, interpolated between the recorded samples. */
function poseAt(t: number): number[] {
  if (t <= S[0][0]) return S[0]
  const last = S[S.length - 1]
  if (t >= last[0]) return last
  let lo = 0
  let hi = S.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (S[mid][0] <= t) lo = mid
    else hi = mid
  }
  const a = S[lo]
  const b = S[hi]
  const u = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
  let dy = b[4] - a[4]
  dy = ((dy + 540) % 360) - 180
  return [t, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4] + dy * u, a[5] + (b[5] - a[5]) * u]
}

const now = () => Date.now() / 1000
const own = {
  armedAt: now(),
  started: false,
  t0: 0,
  ticks: 0,
  markers: 0,
  resends: 0,
  offset: 0,
  target: 0,
  last: 0,
  retried: false,
  stopped: false,
  cmd: null as vec3 | null,
  conn: null as any,
  timer: null as any,
  stop: (why: string) => {},
}

/** Set the preview head; read back the previous command first and re-send if it did not take. */
function apply(s: number[]): void {
  try {
    if (own.cmd) {
      const c = panel.pose.column3
      if (Math.abs(c.x - own.cmd.x) + Math.abs(c.y - own.cmd.y) + Math.abs(c.z - own.cmd.z) > 1.0) own.resends++
    }
    const yaw = s[4] * DEG
    const pitch = s[5] * DEG
    const eye = new vec3(s[1], s[2], s[3])
    const fwd = new vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    panel.pose = mat4.lookAt(eye, eye.add(fwd), new vec3(0, 1, 0)).inverse()
    own.cmd = eye
  } catch (e) {
    own.stop(`preview head not settable (${e})`)
  }
}

function sendStart(): void {
  panel.postMessage({
    type: "ScenarioStartRequest",
    scenarioId: "DEMO",
    config: {
      __leaf__log_level: "INFO",
      __leaf__timeout_secs: "600",
      __leaf__diagnostic_policy: "fallback",
      __leaf__diagnostic_report_duration_ms: "-1",
      scene: SCENE,
      head: "preview",
      record: String(A.record ?? "0"),
    },
  })
}

own.stop = (why: string) => {
  if (own.stopped) return
  own.stopped = true
  if (own.timer) clearInterval(own.timer)
  own.timer = null
  try {
    if (own.conn && own.conn.disconnect) own.conn.disconnect()
  } catch (e) {
    // already gone
  }
  own.conn = null
  const secs = own.started ? now() - own.t0 : 0
  const rate = secs > 0 ? own.ticks / secs : 0
  const failed = /FAILED/.test(why)
  console.log(`[SidleReplay] ${failed ? "" : "stopped: "}${why}; ${own.ticks} pose updates in ${secs.toFixed(2)} s = ${rate.toFixed(1)} per second (set ${RATE}); ${own.markers} sync markers; ${own.resends} re-sends`)
  if (g.__sidleReplay === own) g.__sidleReplay = null
}

// One owner: listener first, then the head reset, then the start request (the DEMO's start message
// can never arrive before the listener exists).
own.conn = panel.onMessage.connect((mo: any) => {
  if (own.stopped) return
  const d = mo && mo.data !== undefined ? mo.data : mo
  if (!d || typeof d !== "object") return
  if (d.type === "SidleDemoHello") {
    panel.postMessage({type: "SidleReplayArmed"}) // a DEMO with head = auto then uses the preview head
    return
  }
  if (d.type === "SidleDemoStart") {
    if (d.head !== "preview" || d.backdrop === false) {
      own.stop(`FAILED: the DEMO started with head = ${d.head}, backdrop = ${d.backdrop} (needs head = preview and room mode backdrop); the backdrop would not move`)
      return
    }
    own.started = true
    own.t0 = now()
    own.offset = 0
    own.target = 0
    own.last = own.t0
    console.log(`[SidleReplay] DEMO started (scenes ${d.scenes}) ${(own.t0 - own.armedAt).toFixed(2)} s after the command; replaying the path at ${RATE} per second`)
  } else if (d.type === "SidleDemoEnd") {
    if (own.started) own.stop("DEMO ended")
  } else if (own.started && (d.type === "SidleDemoScene" || d.type === "SidleDemoPinch")) {
    const rec = d.type === "SidleDemoScene" ? P.scenes[String(d.n)] : PINCH[d.k]
    if (rec !== undefined) own.target = rec - (now() - own.t0)
    own.markers++
  }
})
g.__sidleReplay = own

apply(S[0]) // ready check: throws (and stops) if the preview head cannot be set
own.timer = setInterval(() => {
  if (own.stopped) return
  if (!own.started) {
    apply(S[0])
    const waited = now() - own.armedAt
    if (A.start !== false && waited > 10 && !own.retried) {
      own.retried = true
      console.log("[SidleReplay] no DEMO start after 10 s, sending the start request again")
      sendStart()
    } else if (A.start !== false && waited > 25) {
      own.stop("FAILED: the DEMO did not start within 25 s (is the Preview running the Lens, room mode backdrop, LEAF package loaded?)")
    }
    return
  }
  const t1 = now()
  // Re-anchoring without speed spikes: ignore drift under DEADBAND s, and change the path time at most
  // MAX_CORR s per s (the walk then runs at 0.9-1.1x speed, about 1.3 cm/s more or less at walking pace).
  const err = own.target - own.offset
  if (Math.abs(err) > DEADBAND) {
    const step = MAX_CORR * (t1 - own.last)
    own.offset += Math.max(-step, Math.min(step, err))
  }
  own.last = t1
  const pathT = t1 - own.t0 + own.offset
  const pose = poseAt(pathT)
  apply(pose)
  if (A.logTicks) console.log(`[SidleTick] ${(t1 - own.t0).toFixed(3)} ${pathT.toFixed(3)} ${pose[1].toFixed(2)} ${pose[3].toFixed(2)} ${pose[4].toFixed(3)} ${own.offset.toFixed(3)} ${own.target.toFixed(3)}`)
  own.ticks++
  if (t1 - own.t0 > P.duration + 3.0) own.stop("path finished")
}, 1000 / RATE)

if (A.start !== false) sendStart()
return `replay armed (${S.length} samples, scenes ${SCENE}, ${RATE} updates per second)${A.start !== false ? ", DEMO start requested" : "; now press Run on DEMO in the LEAF panel"}`
