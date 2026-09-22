# Projectable GIS

A GIS storytelling table. A projector throws a map onto a 3D-printed relief model;
cameras under the table read fiducials on physical pucks; turning a puck moves
through time, switches scenarios, or brings map layers in and out.

The first story is **Oahu Energy Goals** — what Hawaii's path to 100% renewable by
2045 costs in land, and what it collides with.

This replaces an Angular 8 application from 2022. See `PLAN.md` for the analysis of
the old system and why the rebuild went this way.

---

## Quick start

```bash
npm install
npm run dev               # http://localhost:4200
```

The story bundle in `public/stories/` is **committed**, so a fresh clone runs
immediately. You do not need the legacy Angular repo to work on the app.

### Rebuilding a story bundle (maintainers only)

```bash
npm run prepare-story
```

This regenerates `public/stories/` from the original Angular assets at
`../old_projectable_pucks/haven-table-map-angular/src/assets/plans/oahu` (override
with `-- --source <dir>`, or `-- --only <story-id>` for one story). It is a content
migration step, deliberately **not** part of `npm run build` -- it needs source data
that is not in this repo and is not available on a CI or hosting build machine.
Commit whatever it produces.

### Driving it without a rig

The table runs from the keyboard so you can build and demo away from the hardware:

| Key | Action |
|---|---|
| `1`–`4` | choose which puck the arrows drive |
| `←` `→` | rotate that puck (one press = one detent) |
| `W A S D` | slide it around the table |

Layers can also just be clicked in the legend.

### Running on the table

```
?story=oahu-energy                                  skip the story picker
?pucks=websocket&tracker=ws://localhost:8765        read pucks from an external tracker
```

---

## How it is put together

```
camera / keyboard / websocket
        │  PuckReading { markerId, x, y, angle, confidence }
        ▼
   usePucks ──▶ Zustand store ──▶ StoryMap (MapLibre)
   (rotation                   ├─▶ charts
    integrator)                └─▶ legend, readouts, puck halos
```

**Tracking is separated from display.** Puck input arrives through the `PuckSource`
interface (`src/pucks/`), so the application cannot tell whether a puck moved
because of a camera, a keyboard, or an external tracker process. In the old version
computer vision, coordinate maths, application state, and rendering all shared one
`requestAnimationFrame` loop.

**Stories are data, not code.** A story is one JSON file plus its assets
(`public/stories/<id>/`). The old version expressed each island as ~520 lines of
TypeScript with live d3 closures embedded per layer and hand-tuned `vw`/`vh`
constants per UI element.

### Adding a story

1. Copy `scripts/lib/oahu-story.mjs`, point `sourceDir` at your assets, describe
   your layers.
2. Import it in `scripts/lib/stories.mjs` and add it to `STORIES`.
3. `npm run prepare-story` (or `-- --only <id>` to rebuild just one).

It appears on the landing page. No application code changes.

### Layer fill modes

| Mode | What it does | Used by |
|---|---|---|
| `static` | one colour for the whole layer | parks, government land |
| `categorical` | colour from a feature property | agricultural productivity class |
| `buildout` | fills best-first until the year's energy budget runs out | solar, wind |
| `joined-choropleth` | colour from a per-year table joined by key | rooftop solar saturation |

`buildout` is the centrepiece: parcels are ranked best-first at build time and
stamped with an exclusive prefix sum of their cost, so at runtime a parcel is built
when `_cum < budget`. Turning the year puck becomes **one paint-property update per
time-varying layer** instead of a JavaScript pass over every feature. MapLibre still
re-evaluates the expression per feature internally, so this is a large constant-factor
win rather than free — see "Performance" below for measured numbers.

---

## What was fixed along the way

**Georeferencing.** The base raster is now placed by its true geographic corners,
taken from the legacy `map.bounds`. The old renderer also declared
`width: 3613, height: 2794` — stale copy-paste shared across four different islands
— and stretched every raster to that aspect. Oahu's raster is within 0.3% of its
bounds' real Web Mercator aspect, so that stretch was pure error (it distorted Maui
by 13% and Puerto Rico by 52%).

**Wind buildout units.** The wind layer spent `MWac * 0.2283 * 8760` — annual MWh —
out of a budget measured in MW of installed capacity. The budget was roughly 2000x
too small, so at most one parcel ever lit up. Each parcel now costs its own MWac.

**Outlines followed the fill.** Unbuilt parcels were drawing their borders, which
covered the unbuilt half of the island in white speckle.

**`getDistanceMoved()` returned the y-delta for both axes**, so movement gating was
half-broken. That whole code path is gone: rotation is now integrated from the
angle (`src/pucks/rotation.ts`).

**Rotation no longer drops or doubles steps.** The old version thresholded on
`minRotation`, then disabled the puck for a fixed delay so one twist could not fire
twice — fast turns lost steps, slow turns fired twice. Rotation is now integrated,
so a fast 90° flick and a slow one emit the same number of steps, and the remainder
stays banked.

**Two cameras, one coordinate frame.** `computeHomography` (`src/pucks/homography.ts`)
models perspective and solves a least-squares fit from four or more points. The old
tracker interpolated linearly between six points per camera, assuming no lens
distortion and a perfectly square mount, and needed live arrow-key offset nudging
plus an anti-flicker hack to stop the cameras fighting over a marker.

**Data races.** A story now loads all of its CSVs before first paint. Previously
each chart kicked off its own load, and the solar layer read generation data that
only existed if the generation chart happened to have resolved first.

**Mutable plan objects.** `layer.active` was mutated in place on the exported plan
module, leaving stale toggles behind on navigation. Story JSON is immutable; all
view state lives in the store.

**Layers that looked broken.** At 2016 the wind budget is exactly zero (all 99 MW
already existed), utility solar covers 0.23% of its resource, and rooftop solar has
no data before 2018 -- so switching any of them on drew nothing at all. Correct, and
indistinguishable from a bug. Buildout layers now tint their unbuilt resource
faintly (`unbuiltColor`), so you can see the land available and watch it fill, and
the legend reports each active layer's state (`28% built`, `none yet`, `from 2018`).

**Chart form.** The generation mix was a donut, which asked people standing around
a table to compare angles across six technologies -- the hardest version of that
question. It is now vertical bars on a shared baseline, on a scale fixed across the
whole time range, so scrubbing the year makes bars genuinely grow and shrink rather
than rescaling the axis underneath them. The capacity line chart was dropped as
redundant with it; `line` remains a supported chart type for other stories.

**Chart palette.** The original put orange, yellow and red side by side: DER and Bio
sat at ΔE 4.4 under deuteranopia, and Fossil/DER at 12.1 even for full colour
vision. The palette is re-stepped to keep each technology's hue identity while
passing contrast, chroma, lightness and CVD checks against the dark surface.

**Asset weight.** 190MB of rasters and GeoJSON down to ~35MB, by capping the base
raster at 4096px (above the GPU texture limit on many integrated chips — it would
have failed on the rig, not on a laptop), trimming each layer to the properties it
actually uses, and rounding coordinates to ~10cm.

**A black map under StrictMode.** MapLibre's shared worker pool does not survive a
same-tick `remove()` / `new Map()` cycle, which is exactly what React StrictMode's
double-invoked effect produces: the second map's style never finishes loading and
its canvas stays black, with no error raised. `StoryMap` defers teardown by a task
and cancels it if the effect re-runs, so a StrictMode remount reuses the live map.

---

## Layout on the table

```
+-------------------------------+--------+---------------------------+
| chart + year/scenario         | layers |                           |
+-------------------------------+        |           map             |
| puck area (cameras see this)  |        |     (over the terrain)    |
+-------------------------------+--------+---------------------------+
```

The rail is a **fixed pixel width** (`--rail-width`, default 1120px) because it maps
onto a physical region of the table rather than a proportion of the screen -- 1120px
is 27.5% of the rig's 4096px throw, where the legacy app put the map's left edge.
Tune it once to the rig and leave it: changing it moves where pucks are expected to
physically sit. It is capped at 46vw so a development laptop still shows the map.

The lower half of the rail is the puck zone, kept deliberately clear of interface.
**Tracker coordinates are normalised across that element, not the viewport**, so
table space maps onto the area the cameras actually cover. The layer list runs down
the rail's inner edge so it sits beside the pucks that drive it, rather than across
the map.

---

## Performance

Measured in dev on a laptop at 1568x760, with all four time-varying layers visible
(solar 10,401 features, solar-vs-ag 10,401, wind 8,806, DER 356):

- **0.1-1.7 ms** of JavaScript per year step, for all four layers together
- a full 2016 -> 2045 sweep (29 steps) runs smoothly with no visible stutter

`StoryMap` logs `[perf] year=... repainted N layer(s) in Xms` in dev, so this is
easy to re-measure at rig resolution. Note it times the paint-property calls;
MapLibre re-evaluates the expressions on its own render frame.

Two things keep this cheap: buildout rank and cost are precomputed at build time, so
a year change is a comparison against a scalar rather than a pass over every
feature; and hidden layers are skipped entirely and repainted when they are next
shown.

If a much larger story ever does stutter, the fix does not change the architecture:
because `_cum` is a sorted prefix sum, the built set is always a prefix, so layers
can be pre-split into per-year buckets and toggled by visibility instead.

---

## Layout

```
src/
  story/     schema, loader, data indexing
  state/     Zustand store — all mutable view state
  map/       MapLibre map and the fill-mode → paint-expression translation
  charts/    hand-rolled SVG charts
  pucks/     PuckSource implementations, homography, rotation integrator
  ui/        landing page, table view, legend, puck halos
scripts/
  build-story.mjs      asset pipeline
  lib/oahu-story.mjs   the Oahu story definition
```

## Deploying (Cloudflare Pages)

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | from `.nvmrc` (22) |

Nothing else is needed. Vite copies `public/` into `dist/`, so the story bundle
ships with the build -- `prepare-story` must **not** be in the build command, as it
depends on source assets that only exist on a maintainer's machine.

The bundle is ~32MB across 22 files, with the largest at ~10MB: comfortably inside
Cloudflare's 25 MiB per-file and 20,000-file limits.

## Tests

```bash
npm test
```

Covers the buildout prefix-sum and comparator, the homography solver, and the
rotation integrator — the three places where a silent error would be invisible on
the table.

## Next: replacing the camera pipeline

`WebSocketPuckSource` is the seam. A tracker process should send frames of
table-space readings:

```json
{ "t": 12345.6,
  "pucks": [ { "markerId": 384, "x": 0.42, "y": 0.71, "angle": 137.2, "confidence": 0.98 } ] }
```

`x`/`y` are normalised `[0,1]` across the projected surface. Recommended: AprilTag
`tag36h11`, detected at native camera resolution, with ChArUco-derived intrinsics
and a per-camera homography into the shared table frame.

Puck hardware: recess the tag flush with the contact surface, print matte, and add a
detent ring matching `degreesPerStep` so one felt click is exactly one step.
