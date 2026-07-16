# VectorScope Radial Blending

How the radial camera-transition blend works — the circular sweep
effect that replaces the outgoing camera with the incoming camera
during a zoom-driven camera switch.

---

## 1. When Does Blending Occur?

A blend triggers when the **lead camera source switches** (e.g.,
zooming past 5.0x switches from Tele to Main). The blend lasts X
frames (configurable via the Blend slider, default 20).

Two blend modes:
- **Single**: outgoing RT pixels frozen at last frame (zero cost), but sampled
  through the LIVE matrix for that camera — the frozen frame still tracks zoom
- **Dual**: outgoing = live follower camera, re-rendered every frame
  via `H(follower ← lead, D) × M_lead` (tracks zoom/motion)

Two blend shapes:
- **Flat**: uniform alpha cross-fade (`mix(prev, cur, t)`)
- **Radial**: circular sweep — the topic of this document

---

## 2. Radial Blend Direction

The direction depends on the FOV relationship between the outgoing
and incoming cameras:

### Edges-first (direction = 1)

**When:** narrow-FOV outgoing → wide-FOV incoming (e.g., Tele → Main)

The outgoing camera (Tele) has a smaller field of view than the
incoming camera (Main). In the output frame, the Tele's image only
covers the center — the edges have no Tele data and must show Main.

Visual effect: Main appears from the **edges** first, and the Tele
region **shrinks toward the center** until it disappears.

```
Frame 1:       Frame 5:       Frame 10:      Frame 20:
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Main     │  │ Main     │  │ Main     │  │          │
│ ┌──────┐ │  │ ┌────┐   │  │  ┌──┐   │  │          │
│ │ Tele │ │  │ │Tele│   │  │  │Te│   │  │  Main    │
│ │      │ │  │ │    │   │  │  └──┘   │  │          │
│ └──────┘ │  │ └────┘   │  │          │  │          │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

### Center-first (direction = -1)

**When:** wide-FOV outgoing → narrow-FOV incoming (e.g., Main → Tele)

The incoming camera (Tele) has a smaller field of view. It only has
valid data in the center of the output frame.

Visual effect: Tele appears from the **center** first, and the Main
region **retreats to the edges** until it disappears.

```
Frame 1:       Frame 5:       Frame 10:      Frame 20:
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│          │  │ Main     │  │ Main     │  │          │
│          │  │ ┌────┐   │  │ ┌──────┐ │  │          │
│  Main    │  │ │Tele│   │  │ │ Tele │ │  │  Tele   │
│          │  │ │    │   │  │ │      │ │  │          │
│          │  │ └────┘   │  │ └──────┘ │  │          │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

---

## 3. Coverage Radius (zoom-dependent)

The `coverRadius` represents the narrow-FOV camera's actual coverage
fraction in the output frame **at the current zoom level**. It is NOT
a fixed value — it changes as zoom changes during the blend.

### Edges-first (Tele → Main)

```
coverRadius = min(1.0, z / prevNominal)
```

| Zoom | coverRadius | Meaning |
|------|-------------|---------|
| z = 5.0 | 1.0 | Tele covers full output (at boundary) |
| z = 4.0 | 0.8 | Tele covers center 80% |
| z = 3.0 | 0.6 | Tele covers center 60% |
| z = 2.0 | 0.4 | Tele covers center 40% |

### Center-first (Main → Tele)

```
coverRadius = min(1.0, curNominal / z)
```

| Zoom | coverRadius | Meaning |
|------|-------------|---------|
| z = 5.0 | 1.0 | Tele covers full output (at boundary) |
| z = 6.0 | 0.83 | Tele covers center 83% |
| z = 7.0 | 0.71 | Tele covers center 71% |
| z = 10.0 | 0.50 | Tele covers center 50% |

---

## 4. Shader Math

The radial effect is computed per-pixel in the GLSL fragment shader.

### Coordinate system

```glsl
vec2 center = uR * 0.5;                        // output center in pixels
float dist = length((px - center) / center);    // 0 at center, ~1 at edges
float r = uCoverRadius;                          // narrow-FOV coverage radius
float feather = 0.15;                            // smooth boundary width
```

`dist` is normalized so the frame edges are at ~1.0 and corners at
~1.4 (for 9:16 portrait aspect).

### Edges-first (uBlendRadial == 1)

```glsl
float boundary = r * (1.0 - uBlend);   // starts at r, shrinks to 0
float radialW = smoothstep(boundary - feather, boundary + feather, dist);
w = max(uBlend, radialW);
```

- `boundary` sweeps from `r` (the Tele's edge) **inward to 0** (center)
- Pixels with `dist > boundary`: `radialW ≈ 1` → incoming (Main)
- Pixels with `dist < boundary`: `radialW ≈ 0` → `w = uBlend` (outgoing + linear)

### Center-first (uBlendRadial == -1)

```glsl
float boundary = r * uBlend;           // starts at 0, grows to r
float radialW = smoothstep(boundary + feather, boundary - feather, dist);
w = max(uBlend, radialW);
```

- `boundary` sweeps from **0 (center) outward to `r`** (the Tele's edge)
- Pixels with `dist < boundary`: `radialW ≈ 1` → incoming (Tele)
- Pixels with `dist > boundary`: `radialW ≈ 0` → `w = uBlend` (outgoing + linear)

### Final blend

```glsl
// Soft-edge safety: prevent black edges where outgoing has no data
w = max(w, 1.0 - prevEdge);

col = mix(prev, col, w);
// w = 0: full outgoing (prev)
// w = 1: full incoming (col)
```

---

## 5. Soft Edge Falloff

The `edgeWeight(uv)` function provides a smooth 0→1 falloff within 3%
of the RT boundary:

```glsl
float edgeWeight(vec2 s) {
    float margin = 0.03;
    float dx = min(s.x, 1.0 - s.x);
    float dy = min(s.y, 1.0 - s.y);
    return smoothstep(0.0, margin, min(dx, dy));
}
```

This replaces the old binary `inBounds()` check. Where the outgoing
camera's UV is near or outside the RT boundary, `prevEdge` approaches 0,
and `w = max(w, 1.0 - prevEdge)` pushes the blend toward the incoming
camera. No hard black edges.

---

## 6. Direction Lock During Blend

When zooming rapidly (e.g., 5x → 1x), the blend may cross a **segment
boundary** mid-blend (e.g., z=2.0 where the follower switches from Tele
to UW). In dual mode, the live follower (`S.followerSrc`) changes, but
the **radial direction must stay locked** to the original transition
cameras.

The render loop saves the blend controller's original `prevSrc` and uses
it for the radial direction calculation:

```javascript
blendOrigPrevSrc = prevSrc;  // from blendCtl.update()
// ...
const radialPrevSrc = blendOrigPrevSrc ?? matWarp.uniforms.uPrevSrc.value;
const { direction, coverRadius } = radialBlendParams(curNom, prevNom, S.zoom);
```

Without this lock, the direction would flip from edges-first to
center-first at z=2.0, causing a visible "inward then outward" reversal.

---

## 7. Data Flow

```
radialBlendParams(curNom, prevNom, z)
    │
    ├── direction (1 or -1)
    └── coverRadius (z-dependent)
          │
          ▼
render-loop.js
    │
    ├── matWarp.uniforms.uBlendRadial = direction
    ├── matWarp.uniforms.uCoverRadius = coverRadius
    └── matWarp.uniforms.uBlend = t (from blend controller)
          │
          ▼
shader.js (GLSL)
    │
    ├── boundary = r * (1-t) or r * t
    ├── radialW = smoothstep(...)
    ├── w = max(t, radialW)
    ├── w = max(w, 1 - prevEdge)    ← soft edge safety
    └── col = mix(prev, col, w)
```

---

## 8. Module Map

| Module | Role |
|--------|------|
| `radial-blend.js` | Pure: `radialBlendParams(curNom, prevNom, z)` → `{direction, coverRadius}` |
| `render-loop.js` | Sets shader uniforms, locks direction via `blendOrigPrevSrc` |
| `shader.js` | GLSL: per-pixel boundary sweep + soft edge falloff |
| `blend.js` | Blend state machine: detects source switches, counts frames |
| `camera-sampling.js` | `cameraNominal(src)` used to determine FOV relationship |

---

## 9. Test Coverage

Integration tests in `test/integration.test.js`:

| Test | What it verifies |
|------|-----------------|
| `radial coverRadius is zoom-dependent` | coverRadius = z/5 at z=3 and z=4.9 |
| `radial direction stays locked (5x→1x)` | prevSrc stays SEC2 and direction stays 1 for 20-frame blend crossing z=2.0 |
| `follower matrix uses same lead as shader` | M_follower = H × M_lead_actual (no re-derivation mismatch) |

Unit tests in `test/radial-blend.test.js`:

| Test | What it verifies |
|------|-----------------|
| Tele→Main at z=3 | direction=1, coverRadius=0.6 |
| Tele→Main at z=4.9 | coverRadius=0.98 |
| Main→Tele at z=7 | direction=-1, coverRadius=5/7 |
| coverRadius clamped at boundary | z=5 → coverRadius=1.0 |
