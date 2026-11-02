/**
 * Done criterion 16 (Update 4) — every gallery tile of an imported piece shows
 * the thumbnail named by its catalog "thumbnail" field (Assets/Models/thumbs),
 * with its name; built-in pieces and pieces whose thumbnail is missing show a
 * plain tile with the name and a colour swatch (no image).
 * Expected thumbnails come from the bundled catalog; the missing cases use two
 * extra entries (thumbnail file that does not exist, no thumbnail field).
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {bundledCatalog, expectedOffer, ExpectedType, log, resetState, tap, tileView, TILES_PER_PAGE} from "./SidleTestHelpers"

function baseName(path: string): string {
  const f = path.split("/").pop() ?? path
  return f.replace(/\.[^.]*$/, "")
}

/** Walk every tab and page; check each tile against `expectThumb` (null = plain tile). */
async function checkTiles(it: DefaultLeafInteractor, c: SidleController, offer: ExpectedType[], expectThumb: (key: string) => string | null, ctx: string): Promise<{thumbs: number; plain: number}> {
  let thumbs = 0
  let plain = 0
  await tap(it, "GalleryButton")
  for (let ti = 0; ti < offer.length; ti++) {
    const t = offer[ti]
    await tap(it, `GalleryTab_${ti + 1}`)
    const pages = Math.ceil(t.variants.length / TILES_PER_PAGE)
    for (let p = 0; p < pages; p++) {
      if (p > 0) await tap(it, "GalleryNextButton")
      const vs = t.variants.slice(p * TILES_PER_PAGE, (p + 1) * TILES_PER_PAGE)
      for (let s = 0; s < vs.length; s++) {
        const v = vs[s]
        const tv = tileView(s)
        const want = expectThumb(v.key)
        const at = `${ctx} ${v.key}`
        expect(tv.visible, `${at}: tile visible`).toBe(true)
        expect(tv.name, `${at}: name on the tile`).toBe(v.name)
        if (want) {
          expect(tv.thumb, `${at}: thumbnail`).toBe(want)
          expect(tv.swatch, `${at}: no swatch`).toBe(false)
          thumbs++
        } else {
          expect(tv.thumb, `${at}: no image`).toBe(null)
          expect(tv.swatch, `${at}: plain tile with a swatch`).toBe(true)
          expect(c.galleryThumbnailFor(v.key), `${at}: controller has no thumbnail`).toBe("")
          plain++
        }
      }
    }
  }
  await tap(it, "GalleryCloseButton")
  return {thumbs, plain}
}

@component
export class C19GalleryThumbsScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C19Interactor")
    const cat = bundledCatalog()

    // Wiring read-back: every catalog thumbnail has a texture on SidleController.thumbnailTextures
    const texNames = (c.thumbnailTextures ?? []).filter((t) => !!t).map((t) => t.name)
    log(`thumbnailTextures (${texNames.length}): ${texNames.join(", ")}`)
    const withThumb = cat.filter((e) => typeof e.thumbnail === "string" && e.thumbnail)
    expect(withThumb.length, "every bundled piece names a thumbnail").toBe(cat.length)
    for (const e of withThumb) expect(texNames.indexOf(baseName(e.thumbnail)) >= 0, `texture for ${e.thumbnail}`).toBe(true)

    // Bundled catalog: imported pieces show their thumbnail, built-ins a plain tile
    const thumbOf = (list: any[]) => (key: string) => {
      const e = list.find((x) => `Imported_${x.id}` === key)
      if (!e || typeof e.thumbnail !== "string" || !e.thumbnail) return null
      const b = baseName(e.thumbnail)
      return texNames.indexOf(b) >= 0 ? b : null
    }
    const r1 = await checkTiles(it, c, expectedOffer(cat, true), thumbOf(cat), "bundled")
    log(`bundled: ${r1.thumbs} thumbnail tiles, ${r1.plain} plain tiles`)
    expect(r1.thumbs, "all imported pieces show a thumbnail").toBe(cat.length)
    expect(r1.plain, "built-ins are plain tiles").toBe(4)

    // Missing thumbnails fall back to a plain named tile
    const extra = [
      {id: "no_such_thumb", name: "No Such Thumb", category: "chair", sourceUrl: "https://example.org/a/x", domain: "example.org",
        widthCm: 50, depthCm: 50, heightCm: 90, glb: "Models/armchair_01.glb", yawDeg: 0, credit: "test", thumbnail: "Models/thumbs/does_not_exist.png"},
      {id: "no_thumb_field", name: "No Thumb Field", category: "table", sourceUrl: "https://example.org/a/y", domain: "example.org",
        widthCm: 120, depthCm: 80, heightCm: 75, glb: "Models/dining_table.glb", yawDeg: 0, credit: "test"},
    ]
    const withMissing = cat.concat(extra)
    c.loadCatalogText(JSON.stringify(withMissing))
    await sleep(150)
    const r2 = await checkTiles(it, c, expectedOffer(withMissing, true), thumbOf(withMissing), "missing")
    log(`with missing: ${r2.thumbs} thumbnail tiles, ${r2.plain} plain tiles`)
    expect(r2.plain, "built-ins + the two missing ones are plain").toBe(4 + extra.length)
    expect(r2.thumbs, "bundled pieces still show their thumbnail").toBe(cat.length)

    c.loadCatalogText(null)
    await resetState()
    log("C19 done")
  }
}
