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

## 5. Rig Pose Model

Implemented in `src/camera-rig.js` (`init` for full rebuild, `applyPose`
for the cheap per-frame path used by trajectory playback).

**Three-level composition** — each level is a rigid offset on top of its
parent:

```
SCENE_CAM (rig base pose, world)          src/camera.js SCENE_CAM
  └─ Main   = base ∘ main_camera.extrinsics
       ├─ UW   = Main ∘ secondary_camera.extrinsics
       └─ Tele = Main ∘ secondary_camera_2.extrinsics
```

For every camera, with `refQuat`/`refPos` = its parent's world pose:

```js
cam.position   = ext.position rotated by refQuat, + refPos
cam.quaternion = refQuat ⊗ eulerQuat(ext.rotation_euler_deg)
```

- **UW/Tele use `rig.main.quaternion` / `rig.main.position` as the
  reference**, so their JSON extrinsics are always *relative to Main*, not
  to the world. Rotating the rig moves all three cameras together.
- Euler convention: degrees, THREE **'ZYX' order** (`R = Rz·Ry·Rx`) —
  matched exactly by the pure-quaternion helpers in
  `src/camera-preset.js` (`eulerToQuat`) and by the CV-side `eulerR` in
  `src/homography.js`.
- **Intrinsics → frustum**: vertical FOV from `fy`
  (`fov = 2·atan(imgH / 2fy)`). An off-center optical axis
  (`cx,cy ≠ image center` by more than 0.5 px) is applied as an
  asymmetric frustum via `setViewOffset(imgW, imgH, cx−imgW/2,
  cy−imgH/2, imgW, imgH)`; otherwise `clearViewOffset()`.
- `applyPose(p, basePose)` also refreshes FOV/view-offset every call, so
  per-frame focal or optical-center changes during trajectory playback
  take effect immediately.

### Homography-side convention (src/homography.js)

`computeHPair(mc, sc, D)` returns `H = K1·(R12 + t12·n2ᵀ/d2)·K2⁻¹`
mapping **cam2 px → cam1 px**, with the focus plane fronto-parallel *in
the rig (Main) frame* at depth D. Three.js (Y-up, Z-back) ↔ CV (Y-down,
Z-forward) conversion via `Flip = diag(1,−1,−1)`. The formula is fully
general — it handles non-identity Main extrinsics correctly, although in
normal use Main's extrinsics are identity (the rig pose lives in
SCENE_CAM). Set `globalThis.VS_DEBUG_H = true` to log per-call t12/d2/H.

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
extrinsics are stored **relative to Main** (the system convention).

### Load rules (`src/camera-preset.js`)

1. **File Main extrinsics is identity** → apply *relative*: the current
   scene's rig pose (SCENE_CAM + current Main extrinsics) is kept; only
   intrinsics and the relative UW/Tele extrinsics come from the file.
2. **Not identity** → the UI asks the user (`planPresetLoad` →
   `mainIsIdentity:false`):
   - **absolute** — SCENE_CAM ← the file's Main pose, Main extrinsics
     reset to identity (the pose is re-homed into the rig base);
   - **relative** — keep the current rig pose, as in rule 1.
3. **In all cases** UW/Tele extrinsics entering the system are re-derived
   relative to the file's Main: `rel = inv(main_file) ∘ sec_file`
   (`relativeExt`, pure quaternion math — no-op when Main is identity).

Applying goes through the single entry point
`store.set('cameras', {camParams, sceneCam})`, which re-inits the rig,
recomputes H, and re-renders the Set Camera dialog.

### Save / Remove

- **Save as preset** (`buildPresetJson`): snapshots the live camera
  params, **forces Main extrinsics to identity**, keeps UW/Tele
  relative values as-is → POST `/api/save`.
- **Remove** button (Set Camera dialog): confirm → POST `/api/delete` →
  refresh the preset list.
