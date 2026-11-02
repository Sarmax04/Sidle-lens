// 256×256 PNG thumbnails: headless Chromium (playwright) renders the .glb with three.js.
// The page is served from a fake origin backed by local files only (three.js from node_modules);
// every other request is aborted, so rendering never touches the network.

import {readFile, mkdir, writeFile} from "node:fs/promises"
import {createRequire} from "node:module"
import {dirname, join, normalize, sep} from "node:path"

const require = createRequire(import.meta.url)
const ORIGIN = "http://sidle-thumbs.invalid"
export const THUMB_PX = 256

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#e9e7e3}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from "three"
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js"
const S = ${THUMB_PX}
try {
  const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true})
  renderer.setPixelRatio(1)
  renderer.setSize(S, S)
  renderer.toneMapping = THREE.NeutralToneMapping
  document.body.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xe9e7e3)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8580, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 2.0)
  sun.position.set(2, 4, 3)
  scene.add(sun)
  const gltf = await new GLTFLoader().loadAsync("/model.glb")
  const model = gltf.scene
  scene.add(model)
  const box = new THREE.Box3().setFromObject(model)
  if (box.isEmpty()) throw new Error("model has no geometry")
  const centre = box.getCenter(new THREE.Vector3())
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius
  const camera = new THREE.PerspectiveCamera(30, 1, radius / 100, radius * 100)
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(15))) * 1.02
  const az = THREE.MathUtils.degToRad(35), el = THREE.MathUtils.degToRad(22)
  camera.position.set(centre.x + dist * Math.cos(el) * Math.sin(az), centre.y + dist * Math.sin(el), centre.z + dist * Math.cos(el) * Math.cos(az))
  camera.lookAt(centre)
  renderer.render(scene, camera)
  window.__thumb = "ok"
} catch (e) {
  window.__thumb = "error: " + (e && e.message ? e.message : e)
}
</script></body></html>`

function threeFile(rel) {
  const base = dirname(dirname(require.resolve("three"))) // <three>/build/three.cjs; "exports" hides package.json
  const p = normalize(join(base, rel))
  if (!p.startsWith(base + sep)) throw new Error(`bad path ${rel}`)
  return p
}

const MIME = {".js": "text/javascript", ".glb": "model/gltf-binary", ".html": "text/html"}

/**
 * Renders `glbPath` to a PNG at `pngPath`. Throws on any failure (the caller decides to carry on).
 * `opts.timeoutMs` bounds the whole render.
 */
export async function renderThumbnail(glbPath, pngPath, {timeoutMs = 60000} = {}) {
  const {chromium} = await import("playwright")
  const browser = await chromium.launch({headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]})
  try {
    const page = await browser.newPage({viewport: {width: THUMB_PX, height: THUMB_PX}, deviceScaleFactor: 1})
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== ORIGIN) return route.abort("blockedbyclient")
      try {
        let body
        let type
        if (url.pathname === "/") (body = PAGE), (type = MIME[".html"])
        else if (url.pathname === "/model.glb") (body = await readFile(glbPath)), (type = MIME[".glb"])
        else if (url.pathname.startsWith("/three/")) {
          body = await readFile(threeFile(decodeURIComponent(url.pathname.slice("/three/".length))))
          type = MIME[".js"]
        } else return route.fulfill({status: 404, body: "not found"})
        return route.fulfill({status: 200, contentType: type, body})
      } catch {
        return route.fulfill({status: 404, body: "not found"})
      }
    })
    const problems = []
    page.on("pageerror", (e) => problems.push(e.message))
    page.on("requestfailed", (r) => problems.push(`${r.url()} ${r.failure()?.errorText}`))
    page.on("console", (m) => m.type() === "error" && problems.push(m.text()))
    await page.goto(`${ORIGIN}/`, {timeout: timeoutMs})
    try {
      await page.waitForFunction(() => window.__thumb, null, {timeout: timeoutMs})
    } catch (e) {
      throw new Error(`thumbnail page did not finish (${problems.slice(0, 3).join(" | ") || e.message.split("\n")[0]})`)
    }
    const state = await page.evaluate(() => window.__thumb)
    if (state !== "ok") throw new Error(`thumbnail render failed (${state})`)
    const png = await page.locator("canvas").screenshot({type: "png", timeout: timeoutMs})
    await mkdir(dirname(pngPath), {recursive: true})
    await writeFile(pngPath, png)
  } finally {
    await browser.close()
  }
}

/** Never throws: returns the catalog "thumbnail" value ("" on failure) and a warning, if any. */
export async function tryThumbnail(glbPath, pngPath, catalogPath, render = renderThumbnail) {
  try {
    await render(glbPath, pngPath)
    return {thumbnail: catalogPath, warning: null}
  } catch (e) {
    return {thumbnail: "", warning: `thumbnail not rendered: ${String(e?.message || e).split("\n")[0]}`}
  }
}
