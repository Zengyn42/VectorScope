# VectorScope Camera Naming, Zoom Segments & Blending Modes

This document is the reference for the three-camera rig naming convention,
the leading/follower camera relationship across the zoom range, and the two
camera-transition blending modes of the Combined view.

## 1. Camera Naming

| Display name | Short | Param key (JSON) | Rig field | Role |
|---|---|---|---|---|
| **Main Camera** | Main | `main_camera` | `R.main` | Reference camera; all extrinsics are relative to it |
| **UW Camera** (Ultra Wide) | UW | `secondary_camera` | `R.sec1` | Ultra-wide FOV camera — sources the < 1.0x zoom range |
| **Tele Camera** (Telescope) | Tele | `secondary_camera_2` | `R.sec2` | Telescope (narrow FOV) camera — sources the ≥ 5.0x zoom range |

> The JSON param keys (`secondary_camera`, `secondary_camera_2`) and rig
> fields (`sec1`, `sec2`) are kept unchanged for file-format compatibility.
> Everything user-facing (panel labels, BEV markers, selection panel,
> camera dialog) uses **UW Camera** / **Tele Camera**.

Shader texture slots: `tS1` = UW RT, `tM` = Main RT, `tS2` = Tele RT
(`SRC = { SEC1: 0, MAIN: 1, SEC2: 2 }`).

## 2. Zoom Segments (Combined view)

Half-open intervals — a boundary zoom belongs to the **next** camera:

| Segment | Zoom range | Active source | Warp-ON sampling |
|---|---|---|---|
| A | [0.5, 1.0)x | UW | `scaleThenWarp(H(UW←Main), crop(z/0.5), log-t)` |
| B | [1.0, 2.0]x | Main | `crop(z)` (segment warp flag = false) |
| C | (2.0, 5.0)x | Main | `scaleThenWarp(H(Main←Tele), crop(z), log-t)` |
| D | [5.0, 10]x | Tele | `crop(z/prewarp2)` (segment warp flag = false) |

See `docs/HOMOGRAPHY_PIPELINE.md` §8 for `scaleThenWarp` (zoom scaling is
applied first, warp t only drives the geometric residual) and for H
damping of the Focus-D input.

## 3. Leading / Follower Cameras

At every zoom level the Combined view has a **leading** camera (the one
actually displayed — identical to the active source above) and a
**follower** camera (the one standing by to take over at the nearest
segment boundary). The follower's frame can be warped into the leading
camera's pixel space with the plane-induced homography at focus depth D:

```
M_follower = H(follower ← leading, D) ∘ M_leading
```

where `M_leading` is the leading camera's sampling matrix (output px →
leading px) and `H(follower ← leading, D)` maps leading px → follower px.

| Zoom range | Leading | Follower |
|---|---|---|
| [0.5, 1.0)x | UW | Main |
| [1.0, 2.0)x | Main | UW |
| [2.0, 5.0)x | Main | Tele |
| [5.0, ∞)x | Tele | Main |

Boundary ownership for the follower is also half-open **from above**: at
exactly **2.0x the follower is Tele** (the [2, 5) row applies), at exactly
1.0x the follower is UW, at exactly 5.0x the follower is Main.

Continuity property (warp ON): as z approaches a boundary, the follower's
matrix converges to the leading matrix on the other side of the boundary —
e.g. `M_follower(1⁻) → I = M_leading(1⁺)` — so the two frames align at the
hand-off point (exactly on the focus plane; off-plane geometry shows the
usual plane-induced parallax mismatch).

Implemented by `followerSource(z, hasS2)` and `computeFollowerMatrix(...)`
in `src/zoom-pipeline.js`.

## 4. Blending Modes

When the zoom crosses a segment boundary the active source switches. To
hide the hard cut, the first X displayed frames after the switch cross-fade
(X = Blend slider, 0 = off):

```
displayed(n) = prev * (1 - n/X) + current * (n/X),   n = 1..X
```

### Single mode (default)

`prev` = the **frozen last frame** of the outgoing camera, sampled with the
**live sampling matrix for that camera** (`S.liveM[prevSrc]`, recomputed on
every zoom change as `H(prev ← leading, D) ∘ M_leading`). Zero-copy: the
outgoing RT simply stops being re-rendered, so its *pixels* hold the last
frame — but because the matrix stays live, the frozen frame keeps scaling
and warping with the zoom during the cross-fade. Cheap (one scene render
per frame); only *scene motion* lags in the frozen layer — zoom motion
does not.

### Dual mode

`prev` = the **live follower camera**, rendered to its own RT every blend
frame and sampled with the live follower matrix
`H(follower ← leading, D) ∘ M_leading`, recomputed whenever zoom/params
change. Two scene renders per frame during the blend, but both layers track
scene motion and zoom, so the cross-fade stays aligned. Because the
follower table above matches the outgoing camera for every boundary
crossing (in both directions), the live follower is always the correct
`prev` camera during a blend.

Toggle: the **Single/Dual** button next to the Blend slider
(`S.blendMode`). The blend state machine (`src/blend.js`) is shared by both
modes; dual mode only replaces *what* is fed as the previous layer.

## 5. Rig Pose Model (Five-Layer Coordinate Chain)

Implemented in `src/camera-rig.js` (`init` for full rebuild, `applyPose`
for the cheap per-frame path used by trajectory playback).

**Five-layer composition** — scene → scene-cam → rig → cameras:

```
scene (world origin)
  └─ scene-cam (SCENE_CAM: WASDQE navigation pose)     src/camera.js SCENE_CAM
       └─ rig (orientation layer: landscape=identity, portrait=Rz(+90°) CCW)
            ├─ Main  = rig ∘ main_camera.extrinsics
            ├─ UW    = rig ∘ secondary_camera.extrinsics
            └─ Tele  = rig ∘ secondary_camera_2.extrinsics
```

All three cameras (Main, UW, Tele) are direct children of the **rig
frame** — NOT nested under Main. Their JSON extrinsics are always
*relative to the rig*, not to each other. Moving Main's extrinsics does
NOT affect UW/Tele positions.

**Rig coordinate system**: x along sensor long edge, y along sensor
short edge, z along optical axis. Sensor long edge is always x:
`image_size = [1920, 1080]`.

For every camera, `poseCam(cam, cp, baseQuat, basePos)` applies:

```js
// 1. Rig rotation (qRig) applied to the extrinsic offset; the extrinsic
//    ORIENTATION is conjugated (qRig ⊗ qExt ⊗ qRig⁻¹): the rig body roll
//    is cancelled by the portrait DISPLAY rotation (see below), so an
//    identity-extrinsics camera renders unrolled — world content upright.
offset.applyQuaternion(qRig);
qExt = qRig ⊗ eulerQuat(ext.rotation_euler_deg) ⊗ qRig⁻¹;
// 2. Then composed with the base (SCENE_CAM) pose
cam.position   = offset.applyQuaternion(baseQuat) + basePos
cam.quaternion = baseQuat ⊗ qExt
```

### Rig orientation (portrait vs landscape)

The rig quaternion `qRig` depends on the window aspect ratio:

| Window | Condition | qRig | Physical meaning |
|---|---|---|---|
| **Landscape** | `winW ≥ winH` | identity | Rig coincides with scene-cam; sensor x = screen horizontal |
| **Portrait** | `winW < winH` | Rz(+90°) CCW (seen from the screen front) | Phone rotated CCW: sensor x → screen vertical |

Portrait is the *phone rotated CCW* model: the rig (cameras + baseline)
physically rolls Rz(+90°), and the DISPLAY rotates the sensor image back
+90° CCW so world content stays upright on screen. The display rotation
cancels the body roll for camera ORIENTATION (conjugation above) but not
for the baseline POSITION.

Consequence: **extrinsic +x baseline** gives:
- **Landscape**: horizontal parallax (left-right, 左右)
- **Portrait**: vertical parallax (up-down, 上下) — the sensor-x baseline
  is displayed along the screen vertical

The same preset file produces correct parallax in both orientations
without any data modification.

### Intrinsics → frustum

- **Landscape**: FOV from `fy` and the window height
  (`fov = 2·atan(winH / 2fy)`)
- **Portrait**: FOV from `fx` and the window height
  (`fov = 2·atan(winH / 2fx)`) — sensor x becomes display vertical

An off-center optical axis (`cx,cy ≠ SENSOR center` by more than
0.5 px) is applied as an asymmetric frustum via
`setViewOffset(winW, winH, ox, oy, winW, winH)` with
`(ox, oy) = (−dx, −dy)` in landscape and `(−dy, +dx)` in portrait,
where `(dx, dy) = (cx − imgW/2, cy − imgH/2)` (the sensor principal
offset rotates with the display in portrait);
otherwise `clearViewOffset()`. The offsets are **negated**: a positive setViewOffset shifts the rendered
window right/down, which moves the optical-axis point left/up in the
output — the negation puts the axis point AT the translated window
position, matching the K used by `computeHPairWin` and the shader
sampling matrices.

### Sensor vs window

`image_size` is the SENSOR extent. The displayed output is a 1:1,
**center-anchored `winW×winH` window** of the sensor (window = the
shared RT size, `getWinSize` option of `createCameraRig`). Sensor px ↔
window px conversion is a center-aligned **translation** —
`u_win = u_img − (imgW/2 − winW/2)` — composed with a +90° CCW display
rotation in portrait; never a scale: enlarging the
sensor (with a centered optical axis) changes neither the render nor
any homography; it only adds usable pixels outside the center window.

### Other details

- Euler convention: degrees, THREE **'ZYX' order** (`R = Rz·Ry·Rx`) —
  matched exactly by the pure-quaternion helpers in
  `src/camera-preset.js` (`eulerToQuat`) and by the CV-side `eulerR` in
  `src/homography.js`.
- `applyPose(p, basePose)` also refreshes FOV/view-offset every call, so
  per-frame focal or optical-center changes during trajectory playback
  take effect immediately.

### Homography-side convention (src/homography.js)

`computeHPair(mc, sc, D)` returns `H = K1·(R12 + t12·n2ᵀ/d2)·K2⁻¹`
mapping **cam2 px → cam1 px** in SENSOR pixel space, with the focus plane
fronto-parallel in the rig frame at depth D. All camera extrinsics are
relative to the rig frame. The pipeline uses
`computeHPairWin(mc, sc, D, winW, winH)` — the same H conjugated into
**window px** by per-camera sensor→window maps (`W(mc)·H·W(sc)⁻¹`).
`W` is a center-aligned translation in landscape, composed with the
+90° CCW display rotation in portrait:

```
landscape:  u_w = u_s + (winW − imgW)/2,  v_w = v_s + (winH − imgH)/2
portrait:   u_w = v_s + (winW − imgH)/2,  v_w = −u_s + (winH + imgW)/2
```

H depends on each optical center only through its offset from the
sensor center. In landscape with `image_size` equal to the window, W = I
and `computeHPairWin == computeHPair`.

The rig BODY rotation cancels in R12 (both cameras share it), so the
sensor-space H is orientation-independent; the orientation enters only
through the display rotation inside `W` — which is what turns the
sensor-x baseline parallax vertical on a portrait screen.

Three.js (Y-up, Z-back) ↔ CV (Y-down, Z-forward) conversion via
`Flip = diag(1,−1,−1)`. The formula is fully general — it handles
non-identity Main extrinsics correctly, although in normal use Main's
extrinsics are identity (the rig pose lives in SCENE_CAM). Set
`globalThis.VS_DEBUG_H = true` to log per-call t12/d2/H.

Render vs H consistency is verified numerically in
`test/landscape-roll.test.js` (sub-pixel error < 1e-6 px for both
portrait and landscape, with offset + rotation extrinsics).

## 6. Camera Presets

Preset files live in **`resource/camera_setting/*.json`** in the repo,
served and managed by `serve.py`:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/list?kind=camera` | GET | list preset filenames |
| `/api/save?kind=camera` | POST `{name, data}` | write a preset |
| `/api/delete?kind=camera` | POST `{file}` | delete (filename whitelist `[\w\- ]{1,64}\.json`) |

Client: `src/resource-presets.js` (fails soft on static hosts without the
API). Trajectory presets use the same machinery with
`kind=trajectory` → `resource/trajectory_setting/`.

### Canonical form

A canonical preset has **Main extrinsics = identity** — the rig's world
pose is *not* part of a preset; presets are position-independent. UW/Tele
extrinsics are stored **relative to the rig frame** (the system
convention).

### Load rules (`src/camera-preset.js`)

1. **File Main extrinsics is identity** → apply *relative*: the current
   scene's rig pose (SCENE_CAM + current Main extrinsics) is kept; only
   intrinsics and the rig-relative UW/Tele extrinsics come from the file.
2. **Not identity** → the UI asks the user (`planPresetLoad` →
   `mainIsIdentity:false`):
   - **absolute** — SCENE_CAM ← the file's Main pose, Main extrinsics
     reset to identity (the pose is re-homed into the rig base);
   - **relative** — keep the current rig pose, as in rule 1.
3. UW/Tele extrinsics from the file are used **as-is** — they are already
   rig-relative in the preset format.

Applying goes through the single entry point
`store.set('cameras', {camParams, sceneCam})`, which re-inits the rig,
recomputes H, and re-renders the Set Camera dialog.

### Save / Remove

- **Save as preset** (`buildPresetJson`): snapshots the live camera
  params, **forces Main extrinsics to identity**, keeps UW/Tele
  rig-relative values as-is → POST `/api/save`.
- **Remove** button (Set Camera dialog): confirm → POST `/api/delete` →
  refresh the preset list.

## 7. Bird's Eye View (BEV) Planes

The BEV panel supports three view planes, cycled by clicking the scene
compass in the bottom-left corner. Configuration lives in
`src/bev-planes.js` (pure functions, no DOM).

| Plane | Camera from | Screen right | Screen up/down | Ghost axis | Drag normal |
|-------|------------|-------------|---------------|------------|-------------|
| **xz** (top-down) | +Y looking −Y | +X | +Z (down) | Y | Y=0 plane |
| **xy** (front) | +Z looking −Z | +X | +Y (up) | Z | Z=0 plane |
| **zy** (side) | +X looking −X | −Z | +Y (up) | X | X=0 plane |

Each plane definition provides:
- `ghostAxis` / `ghostLabel` — which axis the Ghost slider cuts against
  (BEV section cut: geometry beyond the threshold is removed with a
  clipping plane; camera markers are never clipped)
- `compass` — 2D axis labels for the scene compass overlay
- `bevCamDir` / `bevCamUp` — BEV camera orientation
- `worldPan(dr, dd, s)` — screen drag → world offset mapping
- `dragNormal` — intersection plane for BEV object drag
- `centerOf(mainPos, fwdXZ, size)` — view center computation
- `projectWorld(wx, wy, wz)` — world vector → screen { u, v } projection

The scene compass (bottom-left) shows all three world axes for the
current plane — fixed colors X=red, Y=blue, Z=green; the axis
perpendicular to the view plane is drawn as a dot — and is clickable
(cycles xz → xy → zy → xz). The rig compass (bottom-right) shows the
camera rig's own X/Y/Z axes in the same fixed colors, projected onto
the current view plane, reflecting SCENE_CAM rotation ∘ rig
orientation (portrait/landscape).

Camera markers (sphere + direction line + FOV wedge) maintain constant
screen size via `group.scale.setScalar(bevSize / 6)` in `syncMarkers()`.

BEV interaction uses deferred selection: pointer-down stores a pending
target; movement > 4 px triggers pan (without changing selection);
pointer-up with no movement completes the selection. Double-click +
drag moves objects on the current view plane.
