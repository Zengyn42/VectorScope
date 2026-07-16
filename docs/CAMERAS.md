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
| A | [0.5, 1.0)x | UW | `normLerp(I, H(UW←Main), log-t)` |
| B | [1.0, 2.0]x | Main | `crop(z)` |
| C | (2.0, 5.0)x | Main | `normLerp(crop(2), H(Main←Tele view), log-t)` |
| D | [5.0, 10]x | Tele | `crop(z/5)` |

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
