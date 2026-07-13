# VectorScope File Formats

Instructions for creating camera JSON and trajectory JSON files
programmatically or by hand.

---

## 1. Camera JSON

A camera JSON defines the stereo rig: intrinsics, extrinsics, and image
size for each physical camera. VectorScope uses this to compute
plane-induced homographies for the Combined view.

### Schema

```jsonc
{
  "main_camera": {
    "intrinsics": { "fx": 1500, "fy": 1500, "cx": 540, "cy": 960 },
    "extrinsics": { "position": [0, 0, 0], "rotation_euler_deg": [0, 0, 0] },
    "image_size": [1080, 1920]
  },
  "secondary_camera": {
    "intrinsics": { "fx": 750, "fy": 750, "cx": 540, "cy": 960 },
    "extrinsics": { "position": [0.5, 0, 0], "rotation_euler_deg": [0, 0, 0] },
    "image_size": [1080, 1920]
  },
  "secondary_camera_2": {
    "intrinsics": { "fx": 7500, "fy": 7500, "cx": 540, "cy": 960 },
    "extrinsics": { "position": [-0.5, 0, 0], "rotation_euler_deg": [0, 0, 0] },
    "image_size": [1080, 1920]
  }
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `main_camera` | object | **Required.** The reference camera — all extrinsics are relative to it. Typically has identity extrinsics `[0,0,0]`. |
| `secondary_camera` | object | **Required.** The UW (ultra-wide) camera. Shown in the `[0.5, 1.0)x` zoom range. |
| `secondary_camera_2` | object | **Optional.** The Tele camera. Shown in the `[5.0, 10.0]x` zoom range. If omitted, VectorScope operates in 2-camera mode. |

#### Per-camera fields

| Field | Type | Description |
|-------|------|-------------|
| `intrinsics.fx` | number | Focal length in pixels (horizontal). Determines the camera's FOV. |
| `intrinsics.fy` | number | Focal length in pixels (vertical). Usually equals `fx` for square pixels. |
| `intrinsics.cx` | number | Principal point X (pixels). Typically `image_width / 2`. |
| `intrinsics.cy` | number | Principal point Y (pixels). Typically `image_height / 2`. |
| `extrinsics.position` | `[x, y, z]` | Camera position in **Three.js convention** (Y-up, Z-toward-viewer), relative to `main_camera`. Units: meters. |
| `extrinsics.rotation_euler_deg` | `[rx, ry, rz]` | Euler rotation in degrees, YXZ order (Three.js default). `[0,0,0]` = same orientation as main. |
| `image_size` | `[width, height]` | Render target resolution in pixels. Must match across all cameras for correct homography. |

### Key Relationships

- **Prewarp1** = `main_camera.fx / secondary_camera.fx` — the focal length
  ratio between Main and UW. Default: `1500 / 750 = 2.0`.
- **Prewarp2** = `secondary_camera_2.fx / main_camera.fx` — the focal
  length ratio between Tele and Main. Default: `7500 / 1500 = 5.0`.
- The **nominal zoom** of each camera derives from these ratios:
  UW nominal = `1 / prewarp1` (0.5x), Main = 1.0x, Tele = `prewarp2` (5.0x).

### Loading

Load via the UI: **Set Camera → Load Camera JSON** button in the dialog.

Programmatically (in the browser console):
```js
VS_DEBUG.store.set('cameras', { camParams: myJsonObject });
```

### Generating from Real Cameras

To create a camera JSON from a real multi-camera phone or rig:

1. **Intrinsics**: Run camera calibration (e.g., OpenCV `calibrateCamera`)
   to get `fx, fy, cx, cy`. Convert to pixel units matching `image_size`.

2. **Extrinsics**: Calibrate the stereo pair (e.g., OpenCV
   `stereoCalibrate`) to get the relative rotation and translation.
   Convert rotation to Euler degrees (YXZ). Convert translation to meters.
   Note: position is the camera's location, not the translation vector `t`
   from `[R|t]` — use `position = -R^T * t`.

3. **Coordinate convention**: VectorScope uses Three.js convention
   (Y-up, Z-toward-viewer). OpenCV uses Y-down, Z-forward. Apply the
   flip: `position_threejs = [x_cv, -y_cv, -z_cv]`,
   `rotation_threejs = [rx_cv, -ry_cv, -rz_cv]` (approximate — exact
   conversion depends on rotation representation).

---

## 2. Trajectory JSON

A trajectory is a frame-indexed script that drives the camera rig in Play
mode. It is **scene-independent** — the same trajectory can play over any
loaded scene.

### Schema

```jsonc
{
  "version": 1,
  "name": "dolly-zoom-01",
  "fps": 30,
  "frames": [
    {
      "lead": "main",
      "follower": "uw",
      "zoom": 1.0,
      "focusD": 3.0,
      "blend": false,
      "sceneCam": {
        "position": [1.7, 0.8, 4.5],
        "rotation_euler_deg": [0, 0, 0]
      }
    },
    { "zoom": 1.02 },
    { "zoom": 1.05, "focusD": 3.2 },
    { "zoom": 1.1, "lead": "uw", "follower": "main", "blend": true }
  ]
}
```

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | number | **Yes** | Must be `1`. |
| `name` | string | No | Display name. Default: `"trajectory"`. |
| `fps` | number | **Yes** | Playback frame rate (positive). The transport replays at this rate regardless of the app's render FPS setting. |
| `frames` | array | **Yes** | Non-empty array of frame records. |

### Per-Frame Fields

**Frame 0 must include all required fields.** Subsequent frames use
**delta encoding**: any omitted field is inherited from the previous frame.

| Field | Type | Required (frame 0) | Description |
|-------|------|-------------------|-------------|
| `lead` | string | **Yes** | Leading camera: `"uw"`, `"main"`, or `"tele"`. This is the camera displayed in the Combined view. |
| `follower` | string | **Yes** | Follower camera: `"uw"`, `"main"`, or `"tele"`. Used during blending. Must differ from `lead`. |
| `zoom` | number | **Yes** | Zoom factor (0.5–10.0). |
| `focusD` | number | **Yes** | Focus plane depth in meters (positive). Objects at this depth align perfectly across cameras. |
| `blend` | boolean | No | `true` = this frame is part of a cross-fade transition. Default: `false`. |
| `sceneCam` | object | **Yes** | Rig base pose: `{ position: [x,y,z], rotation_euler_deg: [rx,ry,rz] }`. |
| `camParams` | object | No | Full camera parameters (same shape as the camera JSON above). Heavy — include only on frames where intrinsics/extrinsics change. |
| `prewarp1` | number | No | Override prewarp1 for this frame. |
| `prewarp2` | number | No | Override prewarp2 for this frame. |
| `warp` | boolean | No | Override warp toggle for this frame. |
| `blendX` | number | No | Override blend length (frames) for this frame. |
| `blendMode` | string | No | `"single"` or `"dual"`. |
| `blendShape` | string | No | `"flat"` or `"radial"`. |
| `sampleM` | array | No | 9-element row-major lead sampling matrix (recorded trajectories). |
| `followerM` | array | No | 9-element row-major follower sampling matrix (recorded trajectories). |

### Delta Encoding Rules

- Frame 0 is stored in full (all required fields).
- Frame N inherits all fields from frame N-1, then overlays any fields
  explicitly present in frame N.
- At minimum, each delta frame should include `{ "zoom": <value> }` even
  if zoom hasn't changed (this ensures the frame count is correct).
- The parser expands deltas at load time into dense records — playback
  reads fully-populated frames with zero per-frame allocation.

### Blend Runs

Consecutive frames with `"blend": true` form a **blend run**. The parser
automatically computes `blendT` for each frame in the run:

```
blendT = (index_in_run + 1) / run_length
```

- First frame of a run: `blendT ≈ 0` (almost entirely outgoing camera)
- Last frame of a run: `blendT = 1.0` (transition complete)
- Frames with `blend: false`: `blendT = null` (no cross-fade)

### Validation Rules

The parser (`parseTrajectory`) enforces:

1. `version` must be `1`
2. `fps` must be a positive finite number
3. `frames` must be a non-empty array
4. Frame 0 must include: `lead`, `follower`, `zoom`, `focusD`, `sceneCam`
5. `lead` and `follower` must be one of `"uw"`, `"main"`, `"tele"`
6. `lead !== follower` (they must differ)
7. `zoom > 0` and finite
8. `focusD > 0` and finite
9. `sceneCam` must have `position[3]` and `rotation_euler_deg[3]`

### Creating a Trajectory Programmatically

#### Minimal example (3 frames, zoom from 1x to 2x):

```json
{
  "version": 1,
  "fps": 30,
  "frames": [
    {
      "lead": "main",
      "follower": "uw",
      "zoom": 1.0,
      "focusD": 3.0,
      "sceneCam": { "position": [0, 1, 5], "rotation_euler_deg": [0, 0, 0] }
    },
    { "zoom": 1.5 },
    { "zoom": 2.0 }
  ]
}
```

#### Dolly zoom (zoom in while pulling camera back):

```json
{
  "version": 1,
  "name": "dolly-zoom",
  "fps": 30,
  "frames": [
    {
      "lead": "main", "follower": "uw",
      "zoom": 1.0, "focusD": 3.0,
      "sceneCam": { "position": [0, 1.4, 3], "rotation_euler_deg": [0, 0, 0] }
    },
    { "zoom": 1.5, "sceneCam": { "position": [0, 1.4, 4], "rotation_euler_deg": [0, 0, 0] } },
    { "zoom": 2.0, "sceneCam": { "position": [0, 1.4, 5], "rotation_euler_deg": [0, 0, 0] } },
    { "zoom": 2.5, "sceneCam": { "position": [0, 1.4, 6], "rotation_euler_deg": [0, 0, 0] } }
  ]
}
```

#### Camera handover with blend (UW → Main at 1.0x):

```json
{
  "version": 1,
  "name": "uw-to-main",
  "fps": 30,
  "frames": [
    {
      "lead": "uw", "follower": "main",
      "zoom": 0.8, "focusD": 3.0,
      "sceneCam": { "position": [0, 1, 5], "rotation_euler_deg": [0, 0, 0] }
    },
    { "zoom": 0.9 },
    { "zoom": 1.0, "lead": "main", "follower": "uw", "blend": true },
    { "zoom": 1.0, "blend": true },
    { "zoom": 1.0, "blend": true },
    { "zoom": 1.0, "blend": false },
    { "zoom": 1.1 }
  ]
}
```

In this example, frames 2–4 form a 3-frame blend run. The parser computes:
- Frame 2: `blendT = 1/3` (mostly UW)
- Frame 3: `blendT = 2/3` (mostly Main)
- Frame 4: `blendT = 3/3 = 1.0` (fully Main)

### Loading

- **UI**: Click **Load** in the trajectory section, select a `.json` file.
- **Scene save**: Trajectories in the library are saved alongside the scene
  in a `trajectories/` subdirectory and auto-loaded on scene load.
- **Recording**: Use the **Rec** button to capture live interaction into a
  trajectory. The recorder captures every rendered frame automatically.

### Python Helper

Generate a trajectory from a Python script:

```python
import json, math

frames = []
n_frames = 90  # 3 seconds at 30fps
for i in range(n_frames):
    t = i / (n_frames - 1)
    frame = {
        "zoom": 1.0 + t * 4.0,           # 1x → 5x
        "focusD": 3.0,
        "sceneCam": {
            "position": [math.sin(t * math.pi) * 2, 1.4, 5 - t * 2],
            "rotation_euler_deg": [0, t * 30, 0]   # slow pan
        }
    }
    if i == 0:
        frame["lead"] = "main"
        frame["follower"] = "uw"
    # At 5x, switch to tele
    if frame["zoom"] >= 5.0 and i > 0:
        frame["lead"] = "tele"
        frame["follower"] = "main"
    frames.append(frame)

traj = {"version": 1, "name": "sweep", "fps": 30, "frames": frames}
with open("sweep.json", "w") as f:
    json.dump(traj, f, indent=2)
```
