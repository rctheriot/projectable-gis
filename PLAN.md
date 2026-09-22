# Projectable Pucks — Analysis & Rebuild Plan

> **Status: built.** The replacement lives in this directory — see `README.md` to run
> it. This document is the analysis of the legacy system that the rebuild was based
> on. Sections 1 and 2 still describe `old_projectable_pucks/` accurately. Section 3
> records the architectural decisions; section 4 records what shipped.
>
> Scope changed during the build: the project is now **Oahu only**, reframed as a
> general GIS storytelling app with "Oahu Energy Goals" as its first story. Maui,
> Big Island and Puerto Rico were dropped.

*Analysis of `old_projectable_pucks/haven-table-map-angular` (last commit 2022-03-10).*

---

## 1. What the old project actually is

**The artifact:** an Angular 8 SPA, projected from above onto a 3D-printed relief model of an
island. Two webcams under the table read ArUco fiducials on the bottom of physical pucks. The app
projects a halo/label onto each puck and responds to rotating them.

**The four pucks** (`src/assets/defaultData/markers.ts`):

| Job | ArUco ID | Rotate left / right |
|---|---|---|
| `year` | 384 | step the year 2016 → 2045 |
| `layer` | 6 | cycle which GIS layer is "armed" |
| `add` | 7 | toggle the armed layer on/off |
| `scenario` | 11 | cycle scenario (`postapril`, `e3`, `e3genmod`) |

**The content:** four "plans" — Oahu, Maui, Big Island, Puerto Rico. Each has a satellite base
raster, a set of GeoJSON land layers (transmission, government/DoD land, agriculture, parks,
existing RE, utility-scale solar, wind, DER), and CSV time series (capacity, generation,
curtailment, battery) per scenario per technology. Layers render as d3 SVG paths over the raster;
a pie chart, line chart, legend, and title float around it.

### What it is trying to *show*

This is not a map browser. It is a **policy conversation tool**. The argument it makes:

> Getting Hawaii to 100% renewable by 2045 requires physical land. Here is how much, here is
> *where*, here is which scenario gets there differently, and here is what that land is currently
> used for.

The year puck makes the buildout a timeline you scrub. The scenario puck makes competing
utility/consultant projections directly comparable. The layer pucks let you overlay "planned solar"
on "prime agricultural land" or "DoD land" and see the conflict yourself. The physical terrain and
the physical pucks exist so that **several people can stand around it at once**, each holding a
variable — it's built for legislators, agency staff, and public meetings, not for one analyst at a
desk.

Design consequences that follow directly: **latency and legibility beat feature count**, and it has
to survive an unbriefed visitor poking at it with no instructions.

---

## 2. Why it is failing now

### Hard rot
- Angular 8 / Node 8 typings / d3 **v3** / TypeScript 3.4. Effectively unbuildable on a modern
  toolchain; the `node_modules` on disk is from 2024 and there are ~20 open Dependabot branches.
- Startup is two `.bat` files, VLC on display 1, Chrome positioned by pixel offset on display 2.
- 871 MB of assets in-repo, incl. four 30–46 MB PNGs of Oahu alone.

### The real architectural disease
CV, coordinate math, app state, and rendering all live in one `requestAnimationFrame` loop
(`ar.service.ts`). Every camera hiccup is a dropped frame in the UI, and nothing can be tested or
replaced independently.

### Specific tracking bugs (this is why the pucks feel unreliable)
- **Detection runs on a 400×400 canvas** — `video-feed.component.ts:28-29`. The detector is starved
  of pixels before it ever starts.
- **No homography, no lens undistortion.** `ar.service.track()` is hand-rolled axis-aligned linear
  interpolation from 6 calibration points, per camera. It assumes zero lens distortion and zero
  camera rotation. That is why there are `incrementXOffset()` / `decrementYOffset()` arrow-key
  nudges — a person is manually correcting an unmodeled error every session.
- **`getDistanceMoved()` is broken** — `projectableMarker.ts`, both `x` and `y` return
  `Math.abs(data[0].corners[0].y - data[1].corners[0].y)`. The x-delta is never computed. Motion
  gating has been half-working this entire time.
- **`seenInOtherCamera()`** is an anti-flicker hack that exists *only* because the two cameras were
  never calibrated into one shared table coordinate frame.
- Rotation is inferred from noisy corner angles with a `minRotation` threshold plus a `delay`/
  `disable()` timeout to suppress repeats — a stack of fudge factors standing in for "how far did
  the user actually turn this."

### Content authoring is hostile
`oahu/plan.ts` is 521 lines of TypeScript with live d3 closures (`setupFunction`, `updateFunction`)
embedded per layer, plus hand-tuned `vw`/`vh` magic numbers for every UI element. Adding an island
is a week of work. `bounds: [[-158.281, 21.710], [-157.647, 21.252]]` is hand-measured — the base
PNGs carry **no georeferencing at all**, while the GeoJSON is proper WGS84. The registration between
them is a guess someone tuned by eye.

---

## 3. The recommendation

### 3.1 Split tracking out of the display app — this matters more than the framework choice

```
┌──────────────────┐   WebSocket   ┌────────────────────┐
│ tracker service  │──────────────▶│ display app        │
│ Python + OpenCV  │  {id,x,y,θ,   │ Vite + React       │
│ owns: cameras,   │   conf, t}    │ owns: map, charts, │
│ calib, detect,   │◀──────────────│ state, projection  │
│ pose, smoothing  │   (commands)  │                    │
└──────────────────┘               └────────────────────┘
```

The tracker emits table-space coordinates in millimetres — **not** pixels, not camera space. The
display app never sees a camera. This single split makes the renderer swappable, calibration a real
standalone procedure, and the CV testable against recorded video.

### 3.2 Markers: keep fiducials, fix the pipeline

**ArUco was never the problem.** The implementation was. Nothing exotic (hand tracking, depth
cameras, capacitive tags) beats a fiducial read by a camera 40cm away in controlled light.

The modernization worth making:
- **AprilTag `tag36h11`** via `pupil-apriltags`, or OpenCV `cv2.aruco` with `DICT_4X4_50`. AprilTag
  has better blur tolerance and far better false-positive rejection; it's the robotics default now.
- Use a **small dictionary**. You need 4–8 pucks. Fewer bits → larger cells → better detection.
- **Full camera calibration:** ChArUco board → `calibrateCamera` for intrinsics + distortion →
  `findHomography` per camera into **one shared table plane**. Both cameras then report the same
  coordinate system and `seenInOtherCamera()` and the offset-nudge keys both disappear.
- Subpixel corner refinement, detection at full sensor resolution.
- Smoothing on pose, not on decisions: a small Kalman or one-euro filter, then derive rotation from
  the filtered angle instead of thresholding raw corner noise.

### 3.3 New pucks (you have a printer)

- **Recess the tag flush** with the contact surface. Any air gap under the table surface defocuses it.
- 40–50 mm tag, **matte** print, no gloss — glare from the projector is a real failure mode.
- **Printed detent ring.** Physical clicks matching discrete year/layer steps eliminate the entire
  `minRotation`/`delay`/`disable()` class of bug: one detent = one step, and the user feels it.
- **Two tags per puck at a known offset.** The old `markers.ts` already has an unused `secondId`
  field — someone was heading here. Gives redundancy at camera edges and a better angle estimate.
- Weighted base, felt bottom ring so it slides but doesn't drift.

**Open question that changes the design:** is the table surface *clear* or *diffusing*? If
diffusing, add IR illumination + an IR-pass filter on the cameras — that makes detection immune to
both ambient light and projector spill, and is the single biggest reliability upgrade available. If
clear, you may not need it.

### 3.4 Renderer: **Vite + React + MapLibre GL**. Not Godot.

The content is a georeferenced raster base + GeoJSON vector layers with per-feature data-driven
styling + charts + a text HUD. That is a 2D GIS/dataviz application, and MapLibre does the
projection, tiling, and styling natively.

Godot would mean reimplementing map projection, vector rendering, chart layout, and text layout
from scratch — you'd fight the engine the entire way. **The 3D here is physical; the app is a 2D
image projected onto it.**

The one condition that would change this: if terrain-aware warping becomes a goal (§3.6), you add a
three.js warp pass *inside* the React app. Still not Godot.

Stack: Vite + React + TypeScript, MapLibre GL for the map, Zustand for state, Observable Plot or
visx for charts, WebSocket client for puck state.

### 3.5 Content as data, not code

Replace `plan.ts` with declarative JSON:
- A layer-style schema (MapLibre paint/layout properties) instead of embedded d3 closures.
- Layout as a named-slot grid instead of per-element `vw`/`vh` constants.
- CSVs stay CSVs; load and index them at startup.
- Rasters → **COG or PMTiles**, served rather than bundled. This kills the 871 MB repo and gets you
  real georeferencing at the same time.

Target: **adding a new island is a data drop plus one JSON file**, no code.

### 3.6 Two things to decide before building

1. **Terrain parallax.** A projector above a relief model is geometrically correct at exactly one
   height. On Big Island that's a visible mismatch on ridges. Does the current rig just accept this
   (aligned at mean elevation), or is correcting it a goal? Correcting means rendering MapLibre to a
   texture and warping it through a calibration mesh — a real scope fork, worth knowing up front.
2. **Georeferencing provenance.** The base PNGs have no geotransform. Before committing to MapLibre
   you need properly georeferenced rasters. If the originals are gone, that's a GIS data task, not a
   rendering task — schedule it early, it can block everything else.

---

## 4. What shipped

| Area | Decision |
|---|---|
| Renderer | Vite + React 19 + TypeScript + MapLibre GL, blank style (runs fully offline) |
| State | Zustand; story JSON is immutable, all view state in the store |
| Content | Declarative story JSON + a build-time asset pipeline (`npm run prepare-story`) |
| Tracking | `PuckSource` interface with keyboard and WebSocket implementations; homography and rotation integrator implemented and tested |
| Assets | 190MB → ~35MB; base raster capped at 4096px for the GPU texture limit |

Bugs found and fixed are listed in `README.md`. The ones that were changing what
people saw on the table: the raster stretch from a stale hard-coded aspect, the wind
buildout's MW-vs-MWh units mismatch, outlines drawn on unbuilt parcels, and the
chart palette's colour-vision failures.

### Still open

- **Camera pipeline.** `WebSocketPuckSource` is the seam and the wire format is
  documented, but no tracker process exists yet. AprilTag `tag36h11` at native
  resolution, ChArUco intrinsics, per-camera homography into the shared table frame.
- **New pucks.** Recessed flush tags, matte print, detent rings matching
  `degreesPerStep`, two tags per puck at a known offset.
- **Terrain parallax.** A projector above a relief model is geometrically correct at
  exactly one height. Still an open question whether the rig accepts this (aligned
  at mean elevation) or wants a calibration-mesh warp pass.
- **Is the table surface clear or diffusing?** If diffusing, IR illumination plus an
  IR-pass filter makes detection immune to ambient light and projector spill.

---

## 5. One-line summary

*Keep the fiducials and the idea; throw away the coupling.* Tracking sits behind an
interface instead of inside the render loop, stories are data instead of executable
TypeScript, and the buildout that used to walk 10,000 features per frame is now one
paint expression against a precomputed prefix sum.
