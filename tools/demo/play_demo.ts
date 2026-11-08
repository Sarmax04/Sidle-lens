// Sidle DEMO replay (Lens Studio editor script; run it with the Lens Studio MCP tool ExecuteEditorCode,
// path = this file). It starts the DEMO scenario in the Preview (backdrop mode, head = preview) and
// drives the PREVIEW head along Assets/Tests/SidleDemo/DemoPath.json, so the Colorful Home backdrop
// moves with the camera exactly as with WASD. Lives outside Assets/ so the Lens does not compile it.
//
// Sync: the head is held at the path's first pose until the DEMO posts "SidleDemoStart" (its clock
// zero). A timer (about 60 per second) then plays the path by DEMO time, interpolating between the
// recorded samples. At every scene start ("SidleDemoScene") and every pinch ("SidleDemoPinch", sent
// when the DEMO's camera has stopped for it) the replay's time is eased (over 0.25 s) onto the
// recorded time of that moment, so no skew builds up and each pinch lands in its recorded stop.
// Running it again stops a previous replay first.
// args (optional): {start: false} = only arm the replay (then press Run on DEMO in the LEAF panel with
// head = preview); {record: "1"} = the DEMO also logs the actual camera pose (accuracy check).

const fs = await import("LensStudio:FileSystem")
const g = globalThis as any
if (g.__sidleReplay) g.__sidleReplay.stop("restarted")

const model = pluginSystem.findInterface(Editor.Model.IModel) as Editor.Model.IModel
const file = model.project.assetsDirectory.appended(new Editor.Path("Tests/SidleDemo/DemoPath.json"))
const P = JSON.parse(fs.readFile(file) as any)
const S: number[][] = P.samples // [t, x, y, z, yawDeg, pitchDeg]
const PINCH: number[] = P.pinches || []
const dm = pluginSystem.findInterface(Editor.Dock.IDockManager) as any
const panel = dm.findPanel("Snap.Plugin.Gui.PreviewPanel")
if (!panel) throw new Error("Preview panel not found")

const DEG = Math.PI / 180

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
  return [0, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4] + dy * u, a[5] + (b[5] - a[5]) * u]
}

function apply(s: number[]): void {
  const yaw = s[4] * DEG
  const pitch = s[5] * DEG
  const eye = new vec3(s[1], s[2], s[3])
  const fwd = new vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  panel.pose = mat4.lookAt(eye, eye.add(fwd), new vec3(0, 1, 0)).inverse()
}

const now = () => Date.now() / 1000
const st = {started: false, t0: 0, ticks: 0, msgs: 0, offset: 0, target: 0, last: 0, conn: null as any, timer: null as any}

function stop(why: string): void {
  if (st.timer) clearInterval(st.timer)
  try {
    if (st.conn && st.conn.disconnect) st.conn.disconnect()
  } catch (e) {
    // already gone
  }
  const secs = st.started ? now() - st.t0 : 0
  const rate = secs > 0 ? st.ticks / secs : 0
  console.log(`[SidleReplay] stopped (${why}): ${st.ticks} pose updates in ${secs.toFixed(2)} s = ${rate.toFixed(1)} per second; ${st.msgs} sync markers`)
  g.__sidleReplay = null
}

st.conn = panel.onMessage.connect((mo: any) => {
  const d = mo && mo.data !== undefined ? mo.data : mo
  if (!d || typeof d !== "object") return
  if (d.type === "SidleDemoStart") {
    st.started = true
    st.t0 = now()
    st.offset = 0
    st.target = 0
    st.last = st.t0
    console.log("[SidleReplay] DEMO started, replaying the path")
  } else if (st.started && (d.type === "SidleDemoScene" || d.type === "SidleDemoPinch")) {
    const rec = d.type === "SidleDemoScene" ? P.scenes[String(d.n)] : PINCH[d.k]
    if (rec !== undefined) st.target = rec - (now() - st.t0)
    st.msgs++
  }
})

apply(S[0])
st.timer = setInterval(() => {
  if (!st.started) {
    apply(S[0])
    return
  }
  const t1 = now()
  st.offset += (st.target - st.offset) * Math.min(1, (t1 - st.last) / 0.25)
  st.last = t1
  apply(poseAt(t1 - st.t0 + st.offset))
  st.ticks++
  if (now() - st.t0 > P.duration + 3.0) stop("path finished")
}, 16)
g.__sidleReplay = {stop, st}

const startDemo = !(typeof args === "object" && args && (args as any).start === false)
if (startDemo) {
  panel.postMessage({
    type: "ScenarioStartRequest",
    scenarioId: "DEMO",
    config: {
      __leaf__log_level: "INFO",
      __leaf__timeout_secs: "600",
      __leaf__diagnostic_policy: "fallback",
      __leaf__diagnostic_report_duration_ms: "-1",
      scene: "all",
      head: "preview",
      record: String((args as any)?.record ?? "0"),
    },
  })
}
return `replay armed (${S.length} samples, ${P.duration.toFixed(1)} s)${startDemo ? ", DEMO started" : "; now run DEMO with head = preview"}`
