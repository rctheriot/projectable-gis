# Legacy table calibration (reference)

The last working calibration of the physical table, recovered from the *uncommitted*
working tree of the old Angular project (`src/assets/defaultData/defaultTrackingPoints.js`)
before that folder was deleted. It was never committed upstream, so this is the only
surviving record of it.

**Reference data — not used by this app.**

## What it describes

Six correspondences between camera pixels and map coordinates, per camera, plus four
hand-tuned offsets. The old tracker interpolated linearly between these points, and
someone nudged `xOffset`/`yOffset` with the arrow keys each session to correct drift
the linear model could not express.

| Field | Meaning |
|---|---|
| `camX`, `camY` | position in camera 1, in pixels |
| `cam2X`, `cam2Y` | position in camera 2, in pixels |
| `mapX`, `mapY` | where that point landed on the projected map |

Points visible to only one camera carry zeros for the other.

## How it maps to the new tracker

`src/pucks/homography.ts` replaces this with a planar homography, which models
perspective and needs no per-session offset nudging. The old numbers are still useful:

- they show roughly where the two cameras' fields of view overlap — what the old
  `seenInOtherCamera()` flicker hack was working around;
- `mapX`/`mapY` are in the old projected-map pixel space, so convert them to
  normalised table coordinates (`[0,1]` across the puck area) before feeding
  `computeHomography`;
- they are a sanity check on a fresh calibration: a new solve should place the same
  physical points in about the same spots.

Four points suffice for a homography, so six gives two spare for the least-squares fit.

## The data

```js
export const defaultTrackingPoints = {
offsets: {
xOffset: 111,
yOffset: 85,
xOffset2: 49,
yOffset2: 135,
},
trackingPoints: [
{
cam2X: 33,
cam2Y: 54,
camX: 0,
camY: 0,
mapX: 40.5,
mapY: 40.5,
},
{
cam2X: 31.5,
cam2Y: 330.5,
camX: 0,
camY: 0,
mapX: 266.49488830566406,
mapY: 40.5,
},
{
cam2X: 352,
cam2Y: 60.5,
camX: 76,
camY: 60.5,
mapX: 40.5,
mapY: 393.4795837402344,
},
{
cam2X: 351,
cam2Y: 330.5,
camX: 71.5,
camY: 343.5,
mapX: 266.49488830566406,
mapY: 393.4795837402344,
},
{
cam2X: 0,
cam2Y: 0,
camX: 330,
camY: 70,
mapX: 40.5,
mapY: 668.2193603515625,
},
{
cam2X: 0,
cam2Y: 0,
camX: 328,
camY: 343,
mapX: 266.49488830566406,
mapY: 668.2193603515625,
},
]
};
```

