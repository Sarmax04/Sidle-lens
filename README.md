# Sidle

**Try furniture in your room at real size, before you buy it.**

Sidle is an AR Lens for Snap Spectacles (SPECS), built for the Devpost "Learn AR with SPECS" hackathon. A real-scale sofa, chair, table or bed stands on the floor of a virtual living room. You walk around it, see its size from every side, and a floor outline tells you whether you would still have room to walk past it.

> Demo video: _add the YouTube link here_

## The idea

Photos and 3D viewers on a phone show you a picture of furniture. Sidle puts the piece in your space at 1:1 scale, so you judge how much room it takes by standing next to it and walking past it.

- The piece stands on the floor at real size and does not follow you.
- A faint outline on the floor shows its footprint. It is **green** when there is at least 80 cm free to the walls, the doorway and other furniture. When the gap drops below 80 cm, the edge facing the obstacle turns **red** and a live gap number (for example "62 cm") appears on the floor.
- You can drag the piece along the floor, rotate it in 15 degree steps and show its width, depth and height.
- You can switch between types (sofa, chair, table, bed) and compare variants of the same type in the same spot.

In the preview, the "room" is a virtual stand-in: 7 m x 8 m, four walls, a 90 x 200 cm doorway and a 100 x 50 x 45 cm coffee table in a far corner. The Lens places the room around where you start, so you always begin about 1 m inside the doorway, facing into the room. On real glasses the same indicator would measure against the actual room.

## Controls

All controls use the Spectacles Interaction Kit and UI Kit, so they work with the mouse in Lens Studio's Interactive Preview (a click is a pinch).

| Control | What it does |
|---|---|
| Drag the piece | Moves it along the floor. It cannot pass through walls or the coffee table. |
| Next piece | Goes to the next type (sofa, chair, table, bed) and shows its first variant in the same spot and facing. |
| Compare | Switches to the next variant of the current type in the same spot and facing. Greyed out when a type has only one variant. |
| Measure | Shows or hides width, depth and height in cm. They also show while you drag. |
| Rotate left / right | Turns the piece in 15 degree steps. |
| Gallery | Opens a picture gallery with one tab per type and up to six tiles per page. Pick a tile to show that piece in the same spot. |
| Grab bar (top of the panel) | Pinch and drag to move the control panel. It keeps that position relative to your head. |
| "-" / "+" (next to the grab bar) | Make the panel smaller or bigger (75%, 100%, 125%, 150%). |

An arrow on the panel points to the piece when it is behind you.

## Run it

1. Install **Lens Studio 5.22 or newer**.
2. Clone this repo and open `RoomFit.esproj` in Lens Studio. (RoomFit was the original working name of the project; the Lens is called Sidle.)
3. Lens Studio fetches the packages it needs (Spectacles Interaction Kit, Spectacles UI Kit, and the LEAF test plugin).
4. Open the Preview panel and choose Interactive Preview. Move with WASD, Q and E to go down and up, and right-drag to look around.

No SPECS glasses are needed. The Lens starts about 1 m inside the doorway, facing a three-seater sofa about 3 m away.

## The furniture

Sidle ships with four plain built-in pieces (Sofa A, Sofa B, a bed and a dining table) that can be switched off with the `showPlaceholderPieces` checkbox on the controller, and 15 realistic models listed in `Assets/Models/catalog.json`.

Each model is scaled at runtime so its bounding box matches the catalog width, depth and height, and stands on the floor with its pivot at the bottom centre. If a model or the catalog is missing or broken, the Lens shows a plain box of the catalog size, logs a warning and keeps working.

### The importer

`tools/importer/` is a Node command line tool, outside the Lens, that turns a model into a catalog entry:

- Poly Haven links (CC0), or local `.glb`, `.gltf`, `.fbx` and `.obj` files.
- Scales to the real size in cm, checks it against plausible sizes for the category, and turns beds whose long side is on X.
- Reduces models to about 15,000 triangles (never above 60,000) and textures to 1024 px, and renders a 256 x 256 thumbnail for the gallery.
- Never contacts sharetextures.com or sketchfab.com. Models from those sites are imported from files downloaded by hand.

```
cd tools/importer
npm install
npm test
node import.mjs https://polyhaven.com/a/GothicBed_01
node import.mjs --model <file-or-folder> --name "..." --category sofa --credit "..." --license "CC0"
```

## How it was built

- Planned with the Devpost Learn skill pack; the planning documents are in [`devpost/`](devpost/), starting with [`design-brief.md`](devpost/design-brief.md).
- Built through the CLAD plugin with Claude Code and the Lens Studio MCP.
- The design brief grew in five updates: imported pieces, piece types and variants, a movable lower panel, a gallery, and panel size.
- Every done criterion in the brief has a LEAF test scenario in `Assets/Tests/SidleLeaf/`. All scenarios pass in the Lens Studio preview.

### Code layout

| Script | Role |
|---|---|
| `SidleController.ts` | Single owner of state: current piece, position, rotation, Measure, panel offset and size, gallery. |
| `SidleGeometry.ts` | Pure floor-plan math: oriented rectangles, clearance to walls and obstacles. |
| `SidleCatalog.ts` | Catalog parsing and model normalisation. |
| `SidlePanelUI.ts`, `SidleGalleryUI.ts`, `SidleLabelsUI.ts` | Passive views. |
| `SidleLazyFollow.ts`, `SidlePanelOffset.ts` | Panel follows your head at an offset you can change. |

## What is proven and what is not

- **Logic proven:** clearance maths, piece switching, gallery, panel movement and size, and fallback on missing models are covered by LEAF tests and checked in the preview.
- **Feel unproven (needs real glasses):** comfort over time, real hand tracking, how a large piece fills the real field of view, text legibility on the additive display, and measuring a real room instead of the virtual one.

## Credits

Third-party models are used under their licences. Full details are in [`CREDITS.md`](CREDITS.md).

| Piece | Author | Licence | Source |
|---|---|---|---|
| Sofa 01, Sofa 02, Arm Chair 01, Gothic Bed 01 | Kirill Sannikov | CC0 | Poly Haven |
| Sofa 03 | Fran Calvente | CC0 | Poly Haven |
| Painted Wooden Chair 01 | Kuutti Siitonen | CC0 | Poly Haven |
| Dining Table | Aron Lyczek | CC0 | Poly Haven |
| Sofa 4, Sofa 22, Sofa 17, Armchair 16, Table 3, Table 4 | Taha Arslan | CC0 | ShareTextures |
| Classic Bed ("Bed1") | Scopia Visual Interfaces Systems, s.l. (scopia.es) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Sweet Home 3D free models |
| Single Bed ("Children bed") | Scopia Visual Interfaces Systems, s.l. (scopia.es) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Sweet Home 3D free models |

The two Scopia beds were converted to GLB, scaled and simplified for this project.

## Author

Antonio Mestrovic ([@Sarmax04](https://github.com/Sarmax04))
