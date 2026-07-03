# VectorScope

WebGL stereo camera homography visualizer built with Three.js.

VectorScope renders a 3D scene from two virtual cameras (main + secondary) and computes the plane-induced homography between them in real time. It visualizes how stereo disparity changes with depth, zoom, and camera parameters — useful for understanding multi-view geometry, stereo rectification, and image warping.

## Quick Start

Serve the project directory over HTTP (ES modules require a server):

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .
```

Open `http://localhost:8080` in a WebGL-capable browser (Chrome recommended).

## Features

- **Three-panel layout**: Main camera, Secondary camera, and Combined (warped) view
- **Real-time homography**: Plane-induced homography `H = K1 (R12 + t12 n^T/d) K2^-1` computed and displayed as the user adjusts parameters
- **Focus depth control**: Slider to set the focal plane depth; homography changes in real time
- **Autofocus (AF)**: Draw a rectangle on the Main panel to automatically sample depth and set Focus D
- **Prewarp scale**: Apply a pre-warp scale to the secondary camera before homography
- **Zoom**: Animate or manually control zoom from 0.5x to 2.0x; Combined panel smoothly transitions between secondary (wide) and main (narrow) camera feeds
- **Object interaction**: Click to select objects, drag to reposition, adjust object depth via slider
- **Camera settings dialog**: Edit all intrinsic/extrinsic parameters live, or load from JSON
- **Scene loading**: Load custom glTF/GLB scenes, or use the built-in bedroom/fallback scene
- **Cross-platform**: WebGL pre-flight check with fix instructions for disabled GPU acceleration

## Controls

| Control | Description |
|---------|-------------|
| **Load Scene** | Load a custom `.glb` / `.gltf` file |
| **Set Camera** | Open camera parameter editor |
| **Reset All** | Restore all objects and parameters to defaults |
| **Focus D** | Depth of the homography focal plane (0.1 - 10.0 m) |
| **AF** | Autofocus — draw a rectangle to sample depth |
| **Prewarp** | Pre-warp scale for secondary camera (0.25x - 4.0x) |
| **Zoom** | Zoom level (0.5x - 2.0x) |
| **Warp** | Toggle homography warp on/off in Combined panel |
| **Play** | Animate zoom 0.5x → 2.0x → 0.5x in a loop |
| **Obj Depth** | Move selected object along camera view direction |

Mouse interaction (Main/Secondary panels):
- **Click** an object to select it (highlighted in emissive)
- **Drag** to reposition the selected object on its depth plane

## Architecture

```
index.html              Entry point: HTML/CSS, renderer, cameras, render loop, UI wiring
src/
  math.js               3x3 matrix library (row-major float[9]), zero dependencies
  camera.js             Default stereo camera parameters (intrinsics, extrinsics)
  homography.js         Plane-induced homography computation + zoom matrix
  shader.js             GLSL warp shader + ShaderMaterial factory for Combined panel
  panels.js             Three-panel layout manager (GL coordinates, aspect locking)
  interaction.js        Object selection (raycast) and depth-plane drag
  autofocus.js          AF rectangle selection + depth sampling (MeshDepthMaterial)
  loader.js             glTF/GLB scene loader with object registry
  camera-dialog.js      Camera settings modal dialog UI
lib/
  three.module.js       Three.js r170 (ES module)
  GLTFLoader.js         glTF loader addon
  DRACOLoader.js        Draco mesh compression decoder
  draco/                Draco WASM decoder files
test/
  math.test.js          Unit tests for math.js
  homography.test.js    Unit tests for homography.js
assets/
  bedroom.glb           Default demo scene
```

## Module Reference

### `src/math.js`

3x3 matrix library using row-major flat arrays (`float[9]`). Zero dependencies.

**Exports:** `M` object with methods:
- `M.id()` — identity matrix
- `M.mul(A, B)` — matrix multiply
- `M.inv(m)` — inverse (returns `null` if singular)
- `M.T(m)` — transpose
- `M.v(m, v)` — matrix-vector multiply
- `M.out(a, b)` — outer product
- `M.add(A, B)` — element-wise addition
- `M.sc(A, s)` — scalar multiply
- `M.lerp(A, B, t)` — element-wise interpolation
- `M.K(fx, fy, cx, cy)` — camera intrinsic matrix

### `src/camera.js`

Default stereo camera parameters.

**Exports:**
- `SCENE_CAM` — mutable scene camera world pose `{ position, rotation_euler_deg }`
- `DEF_CAM` — default main + secondary camera params (intrinsics, extrinsics, image_size)

Main camera: `fx=fy=1500`, identity extrinsics.
Secondary camera: `fx=fy=750` (2x wider FOV), `0.5m` rightward offset.

### `src/homography.js`

Plane-induced homography and zoom matrix computation.

**Exports:**
- `eulerR(deg)` — Euler angles (degrees) to 3x3 rotation matrix
- `computeH(camParams, D)` — compute homography `H` at depth `D`
- `zoomMatrix(zoom, w, h)` — pixel-space zoom/crop matrix

**Homography formula:** `H = K1 * (R12 + t12 * n2^T / d2) * K2^-1`

Handles coordinate conversion between Three.js (Y-up, Z-back) and CV (Y-down, Z-forward) conventions internally.

### `src/shader.js`

GLSL vertex/fragment shaders and material factory for the Combined warp panel.

**Exports:**
- `VS` — vertex shader string (pass-through UVs)
- `FS` — fragment shader string (homography warp + zoom crop)
- `createWarpMaterial(THREE, texM, texS, rtW, rtH)` — creates `ShaderMaterial` with all uniforms

### `src/panels.js`

Three-panel layout manager computing GL-coordinate viewport rects.

**Exports:**
- `createPanelManager({ $, RT_W, RT_H, onCameraAspect })` — returns `{ P, layoutPanels, getPanel, toNDC }`

`P` contains panel rects `{ m, s, c }` each with `{ x, y, w, h }` in GL coordinates.

### `src/interaction.js`

Click-to-select and drag-to-reposition for 3D objects.

**Exports:**
- `initInteraction(opts)` — returns `{ sel, syncDepthSlider }`

Uses `Raycaster` for hit testing, `Plane` for constrained drag, `emissive` color for selection highlight.

### `src/autofocus.js`

Interactive rectangle AF with GPU depth sampling.

**Exports:**
- `initAutofocus(opts)` — binds AF button, pointer events, depth pass

Depth pipeline: `MeshDepthMaterial` (RGBADepthPacking) → `Uint8Array` readback → perspective unpack → median filter.

### `src/loader.js`

glTF/GLB scene loader with object registry for selection.

**Exports:**
- `initLoader(opts)` — one-time setup
- `loadScene(url, opts)` — replace scene
- `loadObject(url, opts)` — add single object
- `removeObject(objOrId)` — remove by reference or UUID
- `listObjects()` — enumerate loaded objects
- `resetPositions()` — restore original positions
- `getLoaderState()` — access internal registry

### `src/camera-dialog.js`

Modal dialog for editing camera parameters with live preview.

**Exports:**
- `renderCamDialog(container, { camParams, sceneCam })` — populate input fields
- `readCamInputs(key)` — read camera params from DOM
- `readSceneInputs()` — read scene camera from DOM
- `bindDialog(overlayEl, { onApply })` — wire up events

## Render Pipeline

Each frame performs 5 render passes:

1. **Main RT** — render scene with main camera to `rtM` (1920x1080)
2. **Secondary RT** — render scene with secondary camera to `rtS` (1920x1080)
3. **Main panel** — render scene directly to Main viewport (panel aspect ratio)
4. **Secondary panel** — render scene directly to Secondary viewport
5. **Combined panel** — render warp quad with `matWarp` shader (reads `rtM` + `rtS` textures)

The Combined panel uses render targets (not direct rendering) because the warp shader needs random-access pixel sampling via the homography matrix.

Main and Secondary panels render the scene directly (not via RT) for cross-platform compatibility — mid-frame `outputColorSpace` switching breaks on macOS Metal backend.

## Camera JSON Format

Load custom camera configurations via the "Set Camera" dialog or file picker:

```json
{
  "main_camera": {
    "intrinsics": { "fx": 1500, "fy": 1500, "cx": 960, "cy": 540 },
    "extrinsics": { "position": [0, 0, 0], "rotation_euler_deg": [0, 0, 0] },
    "image_size": [1920, 1080]
  },
  "secondary_camera": {
    "intrinsics": { "fx": 750, "fy": 750, "cx": 960, "cy": 540 },
    "extrinsics": { "position": [0.5, 0, 0], "rotation_euler_deg": [0, 0, 0] },
    "image_size": [1920, 1080]
  }
}
```

## Running Tests

```bash
node --test test/math.test.js test/homography.test.js
```

Tests cover all `M.*` matrix operations and homography edge cases (identity, pure baseline, inverse, different focal lengths).

## Requirements

- Modern browser with WebGL support (Chrome, Firefox, Edge, Safari)
- ES module support (all modern browsers)
- Local HTTP server (ES modules don't work over `file://`)

If WebGL is disabled (common on macOS Chrome), VectorScope shows a full-screen error with step-by-step fix instructions.

## License

Proprietary.
