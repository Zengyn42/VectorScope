# Macro Mode

Macro Mode forces the Combined view onto the **UW camera** when the focus
distance drops below a threshold — simulating a phone camera's macro
switch (UW has the shortest minimum focus distance). This document is the
authoritative record of the full logic as implemented.

Module: `src/macro-mode.js` (pure state machine, no DOM/Three.js).
Wiring: `index.html` (`getOverride`, HUD label, toggle button).
Pipeline: `src/zoom-pipeline.js` (forced-source warp path),
`src/h-damping.js` (H_applied damping), `src/sampling-hud.js` (refreshH).

---

## 1. Activation & UI

| Element | Behaviour |
|---|---|
| `Macro` button | Toggles the mode. Debounced 200 ms (rapid toggling used to crash WebGL). Active state highlighted. |
| Threshold slider (`sld-macro`) | 0.10 – 3.00 m, step 0.05, default **0.5 m**. Only visible while the mode is enabled. Live-updates the threshold. |
| Combined label | Shows `◎ Macro Mode` (blue `#4ea8de`) whenever the state machine is in `to_mid` / `to_uw` / `holding` / `back_mid`. |
| Status HUD | Shows `🔬 Macro → UW` while an override is in force. |

Enabling the mode does **not** switch cameras by itself — the switch is
driven per-frame by the trigger condition below.

## 2. Trigger condition

Evaluated once per frame in `tick(focusD, zoom, hasS2)`:

- **Enter**: `focusD < threshold` AND the zoom-determined leading camera
  (`zoomSource(zoom, hasS2)`) is not already UW.
- **Exit**: `focusD >= threshold` while holding on UW.

`focusD` is the **live** AF value (`S.depthD`) — the enter/exit decision
always uses real AF, even though the homography uses the damped D
(see §6). There is intentionally **no hysteresis**: an object oscillating
around the threshold makes the mode bounce in and out repeatedly (boss
decision: "就让他反复跳动").

## 3. State machine

```
idle ──(D < T, lead=Main)────────────▸ to_uw
idle ──(D < T, lead=Tele)──▸ to_mid ──(blend done)──▸ to_uw
to_uw ──(blend done)──▸ holding
holding ──(D ≥ T, target=Main)──▸ back_target ──(blend done)──▸ idle
holding ──(D ≥ T, target=Tele)──▸ back_mid ──(blend done)──▸ back_target ──▸ idle
holding ──(D ≥ T, target=UW, i.e. zoom < 1x)──▸ idle   (no transition needed)
```

Sequential hops (boss decision): Tele never blends straight to UW —
always **Tele → Main → UW**, each hop waiting for the previous blend to
complete (`isBlending()` from the blend controller). Same on the way
back: **UW → Main → Tele**.

The module never drives the blend controller directly. It only reports
`{ overrideSrc }`; the render loop's existing blend controller detects
the source change and cross-fades on its own.

## 4. Pipeline integration (`getOverride` in index.html)

Priority order inside `getOverride()`:

1. **Trajectory playback** (`transport.current()`) — wins over macro.
2. **Macro override** — when `tick()` returns a source:
   `{ leadSrc, warpT: getWarpT(S._blendT, S.zoom), damp: true }`
3. `null` — free mode, normal zoom-segment rules.

`refreshH` (sampling-hud.js) feeds `leadSrc`/`warpT` into
`computeSampleMatrixExplicit`.

## 5. Homography warp strength (`getWarpT`)

Definitions: `t` is the warp strength — `t=0` pure crop (digital zoom
only), `t=1` full homography. `blendT` is the blend controller's
cross-fade progress (0→1).

| State | warp t | Rationale |
|---|---|---|
| `to_mid` | **1** | Intermediate hop shown at full warp |
| `to_uw` | **1** | UW appears at full homography immediately; the *visual* transition is the blend cross-fade, NOT a t-ramp (boss correction) |
| `holding`, zoom ≥ 1.0 | **1** | UW outside its natural segment: full warp toward the zoom-determined camera |
| `holding`, zoom < 1.0 | `null` | Inside the natural UW segment [0.5, 1.0): normal log-space segment t applies |
| `back_mid` | **1 − blendT** | Exit: outgoing UW ramps t 1→0 across the blend |
| `back_target` | `null` | New leading camera follows its own segment rules |

## 6. Warp math for the forced UW source (`zoom-pipeline.js`)

UW forced at zoom > 1 has no natural segment (`segRange` doesn't match),
so the **macro fallback path** applies:

```
follower    = opts.followerSrc ?? Main          (UW's natural pair)
Hlf         = computeHPair(UW, follower, D)     — follower full frame → UW px
H_full      = Hlf · crop(z / folNominal)        — zoom scale gap composed in
m           = scaleThenWarp(H_full, crop_UW(z), warpT)
```

Two critical properties:

- **Zoom scale gap** (boss fix): `Hlf` alone reproduces the follower at
  its *nominal* zoom. Entering macro from Tele at 5x must show the
  follower's view **at 5x**, so the follower's `crop(z)` is composed
  before the homography. No FOV snap on entry.
- **Scale-then-warp decoupling**: `scaleThenWarp` applies the current
  zoom's crop first and interpolates only the geometric residual
  `H_res = H_full · inv(crop(z))` by t. t=0 → exact `crop(z)`,
  t=1 → `H_full`; scaling always tracks z exactly regardless of t.

## 7. Interaction with H damping (`h-damping.js`)

Macro mode **keeps** the H_applied damping rules (`ov.damp = true`);
only trajectory playback bypasses damping. Consequences:

- Entering/exiting macro is a lead-source switch → the damped D **snaps**
  to the live D (H_applied resets to H_desired), covered visually by the
  blend cross-fade.
- During `holding` with zoom static: damped D is **frozen** — AF changes
  (object walking closer) do NOT move H_applied (boss fix; previously
  macro bypassed damping and H followed AF live).
- During `holding` with zoom changing: damped D chases live D with
  `alpha = clamp(|Δzoom| × damping_factor, 0, 1)` as everywhere else.
- Mode enter/exit decisions still use live AF (§2), so freezing D never
  prevents entering or leaving macro.

## 8. Known behaviours / edge cases

- Zoom < 1.0 while holding: UW is the natural camera anyway; warp t and
  (if zoom moves) damping follow the normal segment A rules.
- No Tele configured (`hasS2 = false`): `zoomSource` never returns Tele,
  so only the single-hop paths occur.
- `serialize()` / `restore()` expose the full state for undo/redo
  snapshots.
- Threshold changes while holding take effect on the next `tick`.

## 9. History (commits)

| Commit | Change |
|---|---|
| `f19f2a9` | Macro warp-strength interpolation + combined label |
| `e63fb12` | Entry uses t=1 immediately (no warp ramp); only exit ramps |
| `92d3be9` | H damping introduced (macro initially bypassed it) |
| `e8aa8f9` | Scale-then-warp decoupling; macro keeps damping (`ov.damp`); zoom scale gap composed into forced-UW target |
