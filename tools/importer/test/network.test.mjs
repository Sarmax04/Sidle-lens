// Hard rule: the importer never contacts sharetextures.com or sketchfab.com.
import {test} from "node:test"
import assert from "node:assert/strict"
import {readdir, readFile} from "node:fs/promises"
import {dirname, join, relative} from "node:path"
import {fileURLToPath} from "node:url"

import {BLOCKED_HOSTS, isBlockedHost, assertAllowedUrl, safeFetch} from "../lib/net.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const BLOCKED_URLS = [
  "https://sharetextures.com/models/sofa_17",
  "https://www.sharetextures.com/models/furniture/sofa-17",
  "http://cdn.sharetextures.com/x.zip",
  "https://sketchfab.com/3d-models/bed-123",
  "https://media.sketchfab.com/models/abc/file.glb",
  "https://SKETCHFAB.COM./x",
]

async function sources(dir = ROOT) {
  const out = []
  for (const e of await readdir(dir, {withFileTypes: true})) {
    if (["node_modules", "out", "inbox", "test"].includes(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await sources(p)))
    else if (/\.(m?js|cjs)$/.test(e.name)) out.push(p)
  }
  return out
}

test("blocked hosts: sharetextures.com and sketchfab.com, with every subdomain", () => {
  assert.deepEqual(BLOCKED_HOSTS, ["sharetextures.com", "sketchfab.com"])
  for (const u of BLOCKED_URLS) {
    assert.equal(isBlockedHost(new URL(u).hostname), true, u)
    assert.throws(() => assertAllowedUrl(u), /never contacts sharetextures\.com or sketchfab\.com/, u)
  }
  for (const ok of ["https://api.polyhaven.com/info/sofa_02", "https://notsketchfab.com/", "https://sharetextures.com.example.org/", "file:///C:/x.glb", "data:,x"]) {
    assert.doesNotThrow(() => assertAllowedUrl(ok), ok)
  }
})

test("safeFetch never calls fetch for a blocked host, and refuses redirects to one", async (t) => {
  const calls = []
  const real = globalThis.fetch
  t.after(() => (globalThis.fetch = real))
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return new Response(null, {status: 302, headers: {location: "https://www.sketchfab.com/3d-models/x"}})
  }
  for (const u of BLOCKED_URLS) await assert.rejects(safeFetch(u), /refusing to contact/)
  assert.deepEqual(calls, [], "no request was made")
  await assert.rejects(safeFetch("https://example.org/redirects-to-sketchfab"), /refusing to contact www\.sketchfab\.com/)
  assert.deepEqual(calls, ["https://example.org/redirects-to-sketchfab"], "the redirect target was not requested")
})

test("source scan: every network call goes through lib/net.mjs; no other file names the blocked sites", async () => {
  const files = await sources()
  assert.ok(files.some((f) => f.endsWith("import.mjs")))
  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, "/")
    const text = await readFile(f, "utf8")
    if (rel === "lib/net.mjs") continue
    assert.doesNotMatch(text, /(?<![A-Za-z])fetch\s*\(/, `${rel} calls fetch() directly; use safeFetch`)
    assert.doesNotMatch(text, /from\s+["'](?:node:)?(?:https?|net|tls|undici|axios|got|node-fetch)["']/, `${rel} imports a network module`)
    assert.doesNotMatch(text, /sharetextures|sketchfab/i, `${rel} mentions a blocked site`)
  }
})
