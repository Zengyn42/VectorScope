# VectorScope Homography Pipeline

Complete reference for the sampling matrix computation, lead/follower
homography alignment, segment configuration, and the data flow from pure
math to shader uniforms.

---

## 1. Coordinate System & Output Space

All sampling matrices map **output px → source RT px** (row-major 3x3).
The output coordinate space is the Combined view's pixel grid, defined by
the lead camera's current zoom and warp state.

Both the lead and follower matrices start from the **same** output pixel
and map to their respective render targets. This shared origin is what
makes blending work: at focus depth D, the same 3D point produces the same
output pixel through either camera's matrix.

```
output_pixel ──M_lead──→ lead RT pixel
output_pixel ──M_fol───→ follower RT pixel
```

---

## 2. Three Cameras & Nominal Zoom

| Camera | Code | Nominal zoom | Full-frame condition |
|--------|------|-------------|---------------------|
| UW (Ultra-Wide) | `SRC.SEC1` | `1 / prewarp1` | z = 0.5x (prewarp1=2) |
| Main | `SRC.MAIN` | `1.0` | z = 1.0x |
| Tele | `SRC.SEC2` | `prewarp2` | z = 5.0x (prewarp2=5) |

**Nominal zoom** = the zoom factor at which a camera shows its full frame
(crop factor = 1.0). The prewarp values are focal length ratios relative
to Main:

- `prewarp1 = f_Main / f_UW` (e.g. 2.0 → UW has half the focal length)
- `prewarp2 = f_Tele / f_Main` (e.g. 5.0 → Tele has 5x the focal length)

**Crop factor** at zoom z for a camera with nominal N:

```
crop = z / nominal
```

`crop = 1.0` → full frame. `crop = 2.0` → 2x digital zoom into the RT.

Module: `src/camera-sampling.js` — `cameraNominal()`, `cameraCrop()`,
`cameraSampleMatrix()`.

---

## 3. Zoom Segments (Default)

The total zoom range [0.5, 10.0] is divided by **breakpoints** into
segments. Default breakpoints: **[1.0, 2.0, 5.0]** → 4 segments.

Convention: `z < breakpoint` belongs to the segment above it;
`z >= breakpoint` belongs to the segment below it.

| Segment | Range | Lead | Follower | Warp-ON sampling |
|---------|-------|------|----------|------------------|
| A | [0.5, 1.0) | UW | Main | `normLerp(I, H(UW←Main, D), log-t)` |
| B | [1.0, 2.0) | Main | UW | `crop(z)` (plain center crop) |
| C | [2.0, 5.0) | Main | Tele | `normLerp(crop(2), H(Main←Tele, D), log-t)` |
| D | [5.0, 10.0] | Tele | Main | `crop(z / prewarp2)` |

**Lead camera** = the camera currently displayed in the Combined view.
**Follower camera** = used only during blending when the lead transitions
at a segment boundary.

### Configurable segments

Users can reconfigure via the **Segments** dialog button:
- Add/remove breakpoints (zoom boundaries)
- Change lead/follower camera assignment per segment
- Saved/loaded with the scene via the config store

When a custom segment assignment contradicts the hardcoded warp rules
(e.g. Main leading at 0.7x), the lead falls back to a plain center
crop at `z / nominal(lead)` — warp interpolation only works for the
default segment arrangement.

Module: `src/segment-config.js` — breakpoint model with
`getLeadSource()`, `getFollowerSource()`.

---

## 4. Sampling Matrix Computation

### 4.1 Lead camera: `computeSampleMatrix()`

For the default segment arrangement, the lead's sampling matrix includes
warp interpolation in the handover segments (A and C):

**Segment A** (UW, warp ON):
```
t = log(z / 0.5) / log(2)           // log-space: 0 at 0.5x, 1 at 1.0x
H = computeHPair(UW_cam, Main_cam, D)
M_lead = normLerp(Identity, H, t)
```

**Segment B** (Main):
```
M_lead = zoomMatrix(z)              // plain crop
```

**Segment C** (Main → Tele, warp ON):
```
t = log(z / 2) / log(2.5)           // log-space: 0 at 2x, 1 at 5x
H = computeHPair(Main_cam, Tele_cam, D)
M_lead = normLerp(zoomMatrix(2), H, t)
```

**Segment D** (Tele):
```
M_lead = zoomMatrix(z / prewarp2)   // residual crop
```

**Warp OFF** (any segment): each camera uses its own prewarp-based crop:
```
UW:   M = zoomMatrix(prewarp1) × zoomMatrix(z)   // = crop(prewarp1 × z)
Main: M = zoomMatrix(z)
Tele: M = zoomMatrix(z / prewarp2)
```

Module: `src/zoom-pipeline.js` — `computeSampleMatrix()`.

### 4.2 Explicit lead override: `computeSampleMatrixExplicit()`

When the lead source is explicitly set (by segment config or trajectory
playback), the function checks whether it matches the hardcoded default
for the current zoom:

- **Matches default** → full warp interpolation via `computeSampleMatrix()`
- **Contradicts default** → plain crop fallback: `zoomMatrix(z / nominal)`

This ensures warp math is only applied when the segment boundaries are
correct for it.

### 4.3 Follower camera: `computeFollowerMatrix()`

The follower's matrix guarantees **pixel alignment with the lead at
focus depth D**. Both matrices share the same output coordinate space
(the Combined view's pixel grid, defined by the lead).

**Warp ON:**
```
H_relative = computeHPair(follower_cam, lead_cam, D)
M_follower = H_relative × M_lead
```

Where `computeHPair(cam1, cam2, D)` computes the plane-induced
homography that maps cam2 pixels → cam1 pixels at depth D:

```
H = K1 · (R12 + t12 · n2ᵀ / d2) · K2⁻¹
```

This guarantees: for any 3D point P on the focus plane at depth D,

```
inv(M_lead) × project(P, lead_cam)  =  inv(M_follower) × project(P, follower_cam)
```

Both produce the same output pixel → perfect alignment during blending.

**Warp OFF:** each camera computes its own crop independently using the
prewarp ratio as an approximate alignment factor:

```
UW:   M_follower = zoomMatrix(prewarp1) × zoomMatrix(z)
Main: M_follower = zoomMatrix(z)
Tele: M_follower = zoomMatrix(z / prewarp2)
```

**Degenerate case:** if follower = lead, returns a copy of the lead matrix.

### 4.4 Continuity at segment boundaries (warp ON)

The follower matrix converges to the lead matrix from the other side of
the boundary:

```
M_follower(1.0⁻) → Identity = M_lead(1.0⁺)    // UW→Main boundary
M_follower(5.0⁻) → Identity = M_lead(5.0⁺)    // Main→Tele boundary
```

This ensures the two blend layers are already aligned at the hand-off
point, so the cross-fade is seamless.

---

## 5. HUD Display

The HUD (bottom-right overlay) shows the **geometric correction
component** of each camera's homography — the prewarp crop factored out:

```
H_displayed = M_current × inv(M_base)
```

Where `M_base` is the same camera's matrix with `warp = false` (pure
prewarp crop). This extracts only the perspective correction:

- **Warp OFF**: H = Identity (no geometric correction)
- **Warp ON**: H shows the pure warping effect

Both `H_lead` and `H_follower` are displayed as labeled 3x3 matrices.

Module: `src/sampling-hud.js` — `formatHMatrix()`, `extractH()`.

---

## 6. Data Flow: Math → Shader

```
                   segment-config
                        │
                  getLeadSource(z)
                  getFollowerSource(z)
                        │
              ┌─────────▼──────────┐
              │  sampling-hud.js   │
              │  (refreshH)        │
              │                    │
              │  computeSampleMatrixExplicit(opts)
              │    → { src, m: M_lead }
              │                    │
              │  computeFollowerMatrix(opts)
              │    → { src, m: M_follower }
              └─────────┬──────────┘
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
    matWarp.uSrc   S.sampleSrc   S.followerSrc
    matWarp.uHi    S.sampleM     S.followerM
    (lead src+M)   (blend ctrl)  (dual blend)
           │            │            │
           ▼            ▼            ▼
      ┌────────────────────────────────┐
      │       render-loop.js           │
      │                                │
      │  zsrc = zoomSource(z, segCfg)  │  ← which RTs to render
      │  sourcesToRender(zsrc, ...)    │
      │                                │
      │  Pass 1: render source RTs     │
      │  Pass 2: blend uniforms        │
      │    uBlend, uPrevSrc, uPrevHi   │
      │  Pass 3: full-screen warp quad │
      └────────────────────────────────┘
           │
           ▼
      ┌────────────────────────────────┐
      │       shader (GLSL)            │
      │                                │
      │  curUV = (uHi × fragCoord)     │  ← lead sampling
      │  prevUV = (uPrevHi × fragCoord)│  ← follower sampling
      │  blend = mix(prev, cur, uBlend)│
      └────────────────────────────────┘
```

### Source priority

1. **Trajectory playback** (Play mode): lead/follower come from the
   trajectory frame's recorded metadata — overrides everything.
2. **Segment config** (free mode): lead/follower from
   `segmentConfig.getLeadSource()` / `getFollowerSource()`.
3. **Hardcoded default** (no segment config): `zoomSource()` /
   `followerSource()` fallback.

---

## 7. Plane-Induced Homography: `computeHPair()`

Maps pixels from camera 2 → camera 1 via a fronto-parallel plane at
depth D in the rig frame.

**Inputs:**
- `mc` (camera 1): intrinsics `{fx, fy, cx, cy}` + extrinsics `{position, rotation_euler_deg}`
- `sc` (camera 2): same structure
- `D`: plane depth in meters

**Steps:**
1. Convert both cameras' extrinsics from Three.js convention (Y-up, Z-toward-viewer) to CV convention (Y-down, Z-forward) via flip matrix `diag(1, -1, -1)`.
2. Compute relative pose: `R12 = R1 · R2ᵀ`, `t12 = t1 - R12 · t2`.
3. Transform the plane normal into both camera frames.
4. Compute `H = K1 · (R12 + t12 · n2ᵀ / d2) · K2⁻¹`, normalize by `H[8]`.

**Result:** a 3x3 row-major matrix. `H × [u2, v2, 1]ᵀ` gives the
corresponding pixel `[u1, v1, 1]ᵀ` in camera 1.

Module: `src/homography.js` — `computeHPair()`.

---

## 8. Warp Interpolation: `normLerp()`

Blends two 3x3 projective matrices at parameter t ∈ [0, 1]:

1. Normalize both matrices so `h33 = 1` (projective equivalence).
2. Linearly interpolate each element.
3. Re-normalize result to `h33 = 1`.

The interpolation parameter runs in **log-zoom space** so perceived zoom
speed is uniform:
```
t = log(z / z_start) / log(z_end / z_start)
```

---

## 9. Module Map

| Module | Purpose | Pure? |
|--------|---------|-------|
| `src/camera-sampling.js` | Per-camera nominal, crop, sample matrix (warp-off) | Yes |
| `src/zoom-pipeline.js` | Full warp pipeline: segments, normLerp, lead/follower matrices | Yes |
| `src/homography.js` | Plane-induced H computation, zoomMatrix | Yes |
| `src/math.js` | 3x3 matrix ops (mul, inv, transpose, etc.) | Yes |
| `src/segment-config.js` | Breakpoint-based segment → lead/follower config | Yes |
| `src/segment-dialog.js` | Modal UI for editing segment config | DOM |
| `src/sampling-hud.js` | Pushes pipeline math into shader uniforms + HUD | DOM |
| `src/render-loop.js` | Frame pacing, RT rendering, blend state machine | DOM/GL |

---

## 10. Key Invariants

1. **Alignment**: At focus depth D, `inv(M_lead) × pixel_lead = inv(M_follower) × pixel_follower` for any point on the focus plane.

2. **Boundary continuity**: `M_follower(boundary⁻) ≈ M_lead(boundary⁺)` — the follower converges to the lead at every segment boundary.

3. **Warp-off identity**: When warp is off, `H_displayed = Identity` for both cameras (the HUD shows the geometric correction component only).

4. **Segment config fallback**: When a custom lead assignment contradicts the hardcoded warp rules, the lead uses plain crop (`z / nominal`) — warp interpolation math is not applied.

5. **No cross-dependency**: The lead matrix is computed first; the follower matrix depends on the lead (via `H_relative × M_lead`), but NOT the other way around.
