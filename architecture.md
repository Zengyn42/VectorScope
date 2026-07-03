# VectorScope — Architecture Document

## Overview

VectorScope is a real-time stereo camera homography visualizer built with Three.js (r170) and vanilla ES modules. It renders a 3D scene from two virtual cameras and computes the plane-induced homography between them, allowing users to interactively explore how stereo disparity changes with depth, zoom, and camera parameters.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        index.html                               │
│  Application shell: HTML/CSS + Bootstrap + Render Loop          │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ State S  │ │ Renderer │ │ Cameras  │ │ Render Targets   │   │
│  │ (shared) │ │ (WebGL)  │ │ (main+   │ │ (rtM, rtS,       │   │
│  │          │ │          │ │  sec)    │ │  rtDepth)        │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────────────┘   │
│       │             │            │             │                 │
│  ┌────▼─────────────▼────────────▼─────────────▼──────────────┐ │
│  │              Module Wiring (dependency injection)          │ │
│  └──┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬───────┘ │
│     │      │      │      │      │      │      │      │         │
└─────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼─────────┘
      │      │      │      │      │      │      │      │
      ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼
  math.js camera.js homo-  shader panels inter- auto-  loader.js
                   graphy  .js    .js    action focus  camera-
                   .js                   .js    .js    dialog.js
```

## Module Dependency Graph

```
                    ┌──────────┐
                    │ math.js  │  Zero dependencies
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │homography│  Imports: math.js
                    │   .js    │
                    └────┬─────┘
                         │
  ┌──────────┐     ┌─────┘
  │camera.js │     │          No inter-module dependencies
  └────┬─────┘     │          (all others receive deps via DI)
       │           │
       │     ┌─────▼──────┐
       │     │ index.html  │  Imports all modules
       │     │ (main)      │
       │     └─────┬───────┘
       │           │
       │     Dependency Injection
       │     ┌─────┼─────────┬──────────┬────────────┐
       │     │     │         │          │            │
       ▼     ▼     ▼         ▼          ▼            ▼
    shader panels  inter-  auto-     loader    camera-
    .js    .js     action  focus     .js       dialog
                   .js     .js                 .js
```

### Dependency Injection Pattern

Modules do **not** import Three.js or each other (except math→homography). Instead, `index.html` passes all dependencies as constructor/init arguments:

```javascript
// Example: interaction.js receives everything it needs
const { sel, syncDepthSlider } = initInteraction({
    THREE,           // Three.js namespace
    canvas,          // DOM element
    scene,           // Three.js scene
    S,               // shared state
    P,               // panel rects (from panels.js)
    getMainCam,      // closure: () => mainCam
    getSecCam,       // closure: () => secCam
    getPanel,        // function from panels.js
    toNDC,           // function from panels.js
    $,               // getElementById shorthand
});
```

**Why closures for cameras?** The main/secondary cameras can be re-created by `initCams()` (when camera parameters change). Closures `() => mainCam` ensure modules always reference the current camera, not a stale reference.

## Module Catalog

### Pure Modules (no DOM, no Three.js)

| Module | Purpose | Exports |
|--------|---------|---------|
| `math.js` | 3×3 matrix operations (row-major `float[9]`) | `M` object with `id, mul, inv, T, v, out, add, sc, lerp, K` |
| `camera.js` | Default stereo camera parameters | `SCENE_CAM` (mutable), `DEF_CAM` (const) |
| `homography.js` | Plane-induced homography + zoom matrix | `eulerR, computeH, zoomMatrix` |

### Three.js Modules (receive THREE via DI)

| Module | Purpose | Init Function | Returns |
|--------|---------|---------------|---------|
| `shader.js` | Warp GLSL shader + material factory | `createWarpMaterial(THREE, texM, texS, rtW, rtH)` | `ShaderMaterial` |
| `panels.js` | Three-panel layout (GL coordinates) | `createPanelManager({$, RT_W, RT_H, onCameraAspect})` | `{P, layoutPanels, getPanel, toNDC}` |
| `interaction.js` | Object selection + depth-plane drag | `initInteraction({THREE, canvas, scene, S, P, ...})` | `{sel, syncDepthSlider}` |
| `autofocus.js` | AF rectangle + GPU depth sampling | `initAutofocus({$, canvas, renderer, scene, ...})` | void (binds events) |
| `loader.js` | glTF/GLB scene loading + object registry | `initLoader({scene, GLTFLoader, DRACOLoader, ...})` | void (stateful module) |
| `camera-dialog.js` | Camera parameter editing modal | `renderCamDialog, bindDialog, readCamInputs, readSceneInputs` | — |

## Shared State Architecture

All mutable application state lives in a single object `S` defined in `index.html`:

```javascript
const S = {
    warp: false,           // Homography warp toggle
    zoom: 1.0,             // Zoom level [0.5, 2.0]
    prewarpScale: 1.0,     // Pre-warp scale [0.25, 4.0]
    depthD: 3.0,           // Focus depth [0.1, 10.0] meters
    sel: null,             // Selected Three.js object
    dragging: false,       // Drag-in-progress flag
    dragPlane: Plane,      // Drag constraint plane
    dragOff: Vector3,      // Drag offset
    objs: [],              // Selectable object array (from loader)
    origPos: Map,          // Original positions for reset
    camParams: null,       // Current camera parameters
};
```

Modules receive `S` by reference and mutate it directly. This is intentional — there is no event bus or state management library. The update flow is:

```
User input → slider/button handler → update S → call refreshH() → update shader uniforms + HUD
```

## Render Pipeline

### Per-Frame Render Passes (5 total)

```
Frame N
├── Pass 1: scene → rtM    (main cam @ 1920×1080, off-screen RT)
├── Pass 2: scene → rtS    (sec cam @ 1920×1080, off-screen RT)
├── Pass 3: scene → screen  (main cam @ panel aspect, Main panel viewport)
├── Pass 4: scene → screen  (sec cam @ panel aspect, Secondary panel viewport)
└── Pass 5: quad  → screen  (warp shader, Combined panel viewport)
```

### Why 5 Passes Instead of 3?

A natural optimization would be to render Main/Secondary panels from the RT textures (via fullscreen quads), reducing 5 passes to 3. This was attempted and **reverted** because:

1. **macOS Metal backend crash**: Switching `outputColorSpace` between `LinearSRGBColorSpace` (for RT rendering) and `SRGBColorSpace` (for screen output) mid-frame causes the Metal backend to produce a black screen. Removing the switch causes double-gamma (too bright) or washed-out colors.

2. **Aspect ratio mismatch**: The RT is always 16:9 (1920×1080). The Main/Secondary panels have a different aspect ratio (depends on window size). Displaying an RT texture on a differently-shaped panel requires letterboxing logic that adds complexity without visual benefit.

3. **Direct rendering is simpler**: Each panel just calls `renderer.render(scene, cam)` with appropriate viewport/scissor — no intermediate textures, no aspect correction, no color space juggling.

The Combined panel **must** use RTs because the warp shader needs random-access pixel sampling across the entire image via the homography matrix.

### Camera Aspect Switching

The camera `aspect` ratio is set differently for RT passes vs. direct passes:

```javascript
// RT passes: fixed 16:9 for homography accuracy
mainCam.aspect = 1920 / 1080;
mainCam.updateProjectionMatrix();

// Direct passes: match panel shape
mainCam.aspect = panelWidth / panelHeight;
mainCam.updateProjectionMatrix();
```

This is safe because `updateProjectionMatrix()` is a CPU-only operation.

## Homography Mathematics

### Core Formula

The plane-induced homography maps pixels from camera 2 to camera 1 via a world plane at depth D:

```
H = K1 · (R12 + t12 · n2ᵀ / d2) · K2⁻¹
```

Where:
- `K1, K2` — 3×3 camera intrinsic matrices
- `R12 = R1 · R2ᵀ` — relative rotation (cam2 → cam1)
- `t12 = t1 - R12 · t2` — relative translation
- `n2` — plane normal in cam2's frame
- `d2` — signed distance from cam2 to the plane

### Prewarp Scale Pipeline

The Combined panel applies transforms in this order:

```
Secondary image → S (prewarp scale) → H (homography, unwarps S) → Z (zoom crop)
```

- **Warp ON**: Shader inverse = `H⁻¹` (S is fully compensated — the homography operates on pre-scaled pixels and the inverse undoes both)
- **Warp OFF**: Shader inverse = `S` (just show the prewarp effect without homography alignment)

### Coordinate Convention

Three.js uses Y-up, Z-toward-viewer. Computer vision uses Y-down, Z-forward. The flip matrix `diag(1, -1, -1)` converts between them:

```javascript
const Flip = [1, 0, 0,  0, -1, 0,  0, 0, -1];
R_cv = Flip · R_threejs · Flip   // rotation in CV convention
C_cv = [x, -y, -z]                // position in CV convention
```

## Panel Layout System

### Coordinate Systems

Two coordinate systems are in play:

| System | Origin | Y direction | Used by |
|--------|--------|-------------|---------|
| GL coordinates | Bottom-left | Up | `setViewport`, `setScissor`, panel rects `P.m/s/c` |
| CSS coordinates | Top-left | Down | DOM positioning, click events, label placement |

`panels.js` stores rects in GL coordinates and converts to CSS internally for label/separator positioning.

### Layout

```
┌──────────────────────────────────┐
│  ┌──────────┐ ┌───────────────┐  │  40% height
│  │ Main (m) │ │ Secondary (s) │  │  Two equal-width panels
│  └──────────┘ └───────────────┘  │
│  ═══════════════════════════════  │  2px separator
│  ┌────────────────────────────┐  │  60% height
│  │       Combined (c)         │  │  Aspect-locked to 16:9
│  │    (centered, letterboxed) │  │  Centered if panel is wider
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

## Autofocus Depth Sampling

### Pipeline

```
Screen rectangle → aspect correction → RT pixel coords → depth render pass
→ readRenderTargetPixels (Uint8Array) → RGBA unpack → perspective depth
→ median filter → clamp [0.1, 10.0] → update Focus D
```

### Aspect Ratio Correction

The Main panel may have a different aspect ratio than the depth RT (always 16:9). Horizontal coordinates are corrected:

```javascript
toRTx = ((nx * 2 - 1) * panelAR / rtAR + 1) / 2
```

This maps normalized panel X [0,1] to normalized RT X [0,1], accounting for the FOV difference caused by different aspect ratios.

### Depth Unpacking

Depth is encoded as RGBA using `RGBADepthPacking` and unpacked to perspective distance:

```javascript
// RGBA → NDC depth [0, 1]
ndc = r/256 + g/65536 + b/16777216 + a/4294967296

// NDC → perspective view-space Z (negative for points in front of camera)
viewZ = (near * far) / ((far - near) * ndc - far)

// View-space Z → positive distance from camera
dist = -viewZ
```

**Why not linear unpack?** PerspectiveCamera depth buffer is non-linear (hyperbolic). Using `near + ndc * (far - near)` gives incorrect distances. The correct formula accounts for the perspective projection's `1/z` mapping.

**Why Uint8Array not Float32Array?** `FloatType` render targets fail on some GPUs (especially mobile and older integrated graphics). RGBA byte packing with `Uint8Array` readback is universally supported.

## Cross-Platform Compatibility

### macOS Chrome Issues

| Problem | Root Cause | Fix |
|---------|------------|-----|
| Black screen | `outputColorSpace` switched mid-frame | Keep sRGB throughout; direct scene render for Main/Sec panels |
| WebGL disabled | GPU acceleration off (default on some Macs) | Pre-flight WebGL check with error overlay and fix instructions |
| Double gamma | Shader had manual sRGB conversion + Three.js sRGB colorspace | Removed shader `toSRGB()` function |

### Renderer Options

```javascript
new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'default',          // Not 'high-performance' — can crash on macOS
    failIfMajorPerformanceCaveat: false,  // Allow software fallback
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));  // Cap at 2x for GPU budget
```

## Event Handling

### Priority Order

The autofocus module uses **capture-phase** event listeners (`addEventListener(..., true)`) to intercept pointer events before the interaction module's bubble-phase listeners:

```
Pointer event
  → AF capture handler (if AF mode active: draw rectangle, stopPropagation)
  → Interaction bubble handler (if not intercepted: raycast + select/drag)
```

This prevents accidental object selection while drawing the AF rectangle.

### Interaction Flow

```
pointerdown on Main/Sec panel
  → raycast against S.objs
  → if hit: select object, set dragPlane, enable dragging
  → if miss: deselect

pointermove (while dragging)
  → raycast against dragPlane
  → update object position (X/Y only, depth locked)

pointerup
  → end drag
```

## File Organization

```
VectorScope/
├── index.html              Application shell (HTML + CSS + bootstrap + render loop)
├── README.md               User-facing documentation
├── architecture.md         This file — system design document
├── src/
│   ├── math.js             3×3 matrix library (zero deps)
│   ├── camera.js           Default camera parameters (zero deps)
│   ├── homography.js       Homography + zoom computation (deps: math.js)
│   ├── shader.js           GLSL warp shader + material factory (DI: THREE)
│   ├── panels.js           Panel layout manager (DI: DOM)
│   ├── interaction.js      Object selection + drag (DI: THREE, DOM, panels)
│   ├── autofocus.js        AF rectangle + depth sampling (DI: THREE, DOM, renderer)
│   ├── loader.js           glTF/GLB loader + object registry (DI: GLTFLoader)
│   └── camera-dialog.js    Camera settings modal (DI: DOM)
├── lib/
│   ├── three.module.js     Three.js r170
│   ├── GLTFLoader.js       glTF 2.0 loader addon
│   ├── DRACOLoader.js      Draco mesh compression addon
│   └── draco/              Draco WASM decoder files
├── test/
│   ├── math.test.js        Unit tests for math.js (39 tests)
│   └── homography.test.js  Unit tests for homography.js
└── assets/
    └── bedroom.glb         Default demo scene
```

## Design Decisions

### Why No Build System?

VectorScope uses native ES modules with an import map — no bundler, no transpiler, no npm. This is intentional:
- Zero build step → instant iteration (edit → refresh)
- Import map handles the Three.js bare specifier (`import * as THREE from 'three'`)
- All modern browsers support ES modules natively
- The entire app is 9 source files (~600 lines of JS + 200 lines of HTML/CSS)

### Why Dependency Injection Over Direct Imports?

Modules like `interaction.js` and `autofocus.js` could directly `import * as THREE from 'three'`. They don't, because:
1. **Testability**: Modules can be tested with mock objects
2. **Camera lifecycle**: Cameras are re-created on parameter change; closures (`() => mainCam`) ensure modules always use the current camera
3. **Single import point**: Only `index.html` imports Three.js, making version upgrades a one-line change

### Why Shared Mutable State?

A reactive state management system (signals, observables, etc.) would be overkill for 12 state fields. Direct mutation + explicit `refreshH()` calls is simpler, faster, and debuggable. The state object `S` is small enough to inspect entirely in the console.
