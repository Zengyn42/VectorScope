# VectorScope Module Map

Overview of all modules, their dependencies, exported functions, and
inter-module relationships.

---

## 1. Module Dependency Graph

```mermaid
graph TD
    subgraph "Pure Math (zero dependencies)"
        math["math.js<br/>3×3 matrix ops"]
        camera["camera.js<br/>DEF_CAM, SCENE_CAM"]
        blend["blend.js<br/>createBlendController"]
        transport["transport.js<br/>createTransport"]
        trajectory["trajectory.js<br/>parseTrajectory"]
        configStore["config-store.js<br/>createConfigStore"]
        helpReg["help-registry.js<br/>createHelpRegistry"]
        sceneAnim["scene-anim.js<br/>createSceneAnimator"]
        trajFrame["traj-frame.js<br/>applyTrajFrameToState"]
        radialBlend["radial-blend.js<br/>radialBlendParams"]
        trajLib["trajectory-library.js<br/>createTrajectoryLibrary,<br/>trajToJson"]
    end

    subgraph "Homography Pipeline"
        homography["homography.js<br/>computeHPair, zoomMatrix"]
        zoomPipeline["zoom-pipeline.js<br/>computeSampleMatrix,<br/>zoomSource, followerSource,<br/>computeFollowerMatrix"]
        cameraSampling["camera-sampling.js<br/>cameraNominal, cameraCrop,<br/>cameraSampleMatrix"]
        segConfig["segment-config.js<br/>createSegmentConfig"]
    end

    subgraph "Curve System"
        bezierCurve["bezier-curve.js<br/>evalCurve, sampleCurve"]
        curveEditor["curve-editor.js<br/>createCurveEditor"]
        zoomAnim["zoom-anim.js<br/>createZoomAnimator"]
    end

    subgraph "Segment UI"
        segDialog["segment-dialog.js<br/>bindSegmentDialog"]
    end

    subgraph "Rendering (DOM/GL)"
        shader["shader.js<br/>GLSL warp shader"]
        glBootstrap["gl-bootstrap.js<br/>createGlContext"]
        renderLoop["render-loop.js<br/>createRenderLoop"]
        samplingHud["sampling-hud.js<br/>createSamplingRefresh"]
    end

    subgraph "Scene Management"
        loader["loader.js<br/>loadScene, initLoader"]
        assetReg["asset-registry.js<br/>createAssetRegistry"]
        assetParse["asset-parse.js<br/>createAssetParser"]
        sceneIO["scene-io.js<br/>createSceneIO"]
        sceneMgr["scene-manager.js<br/>createSceneManager"]
        fallback["fallback-scene.js<br/>createFallbackScene"]
    end

    subgraph "Interaction (DOM)"
        panels["panels.js<br/>createPanelManager"]
        interaction["interaction.js<br/>initInteraction"]
        selPanel["selection-panel.js<br/>initSelectionPanel"]
        uiControls["ui-controls.js<br/>initUiControls"]
        camDialog["camera-dialog.js<br/>renderCamDialog"]
        autofocus["autofocus.js<br/>initAutofocus"]
        cameraRig["camera-rig.js<br/>createCameraRig"]
        bevGhost["bev-ghost.js<br/>createBevGhost"]
        objectOps["object-ops.js<br/>createObjectOps"]
        recorder["recorder.js<br/>createRecorder"]
    end

    %% Homography pipeline dependencies
    homography --> math
    zoomPipeline --> math
    zoomPipeline --> homography
    cameraSampling --> zoomPipeline
    cameraSampling --> homography
    cameraSampling --> math
    segConfig --> zoomPipeline

    %% Curve system dependencies
    curveEditor --> bezierCurve
    zoomAnim --> zoomPipeline
    zoomAnim --> bezierCurve

    %% Segment dialog
    segDialog --> zoomPipeline
    segDialog --> segConfig

    %% Rendering
    glBootstrap --> shader
    renderLoop --> zoomPipeline
    renderLoop --> radialBlend
    samplingHud --> zoomPipeline
    samplingHud --> math

    %% Scene
    sceneIO --> trajectory

    %% Interaction
    uiControls --> zoomAnim
    uiControls --> camDialog
    uiControls --> zoomPipeline
    recorder --> trajectory
    recorder --> zoomPipeline

    %% Orchestrator
    indexHTML["index.html<br/>(orchestrator)"]
    indexHTML --> zoomPipeline
    indexHTML --> blend
    indexHTML --> sceneAnim
    indexHTML --> cameraRig
    indexHTML --> bevGhost
    indexHTML --> fallback
    indexHTML --> loader
    indexHTML --> assetReg
    indexHTML --> objectOps
    indexHTML --> assetParse
    indexHTML --> sceneIO
    indexHTML --> panels
    indexHTML --> interaction
    indexHTML --> selPanel
    indexHTML --> autofocus
    indexHTML --> glBootstrap
    indexHTML --> renderLoop
    indexHTML --> samplingHud
    indexHTML --> uiControls
    indexHTML --> sceneMgr
    indexHTML --> configStore
    indexHTML --> trajectory
    indexHTML --> transport
    indexHTML --> recorder
    indexHTML --> segConfig
    indexHTML --> segDialog
    indexHTML --> bezierCurve
    indexHTML --> curveEditor
    indexHTML --> trajLib
    indexHTML --> trajFrame
    indexHTML --> camera

    style math fill:#1a3a1a,stroke:#4caf50
    style homography fill:#1a3a1a,stroke:#4caf50
    style zoomPipeline fill:#1a3a1a,stroke:#4caf50
    style cameraSampling fill:#1a3a1a,stroke:#4caf50
    style bezierCurve fill:#1a3a1a,stroke:#4caf50
    style segConfig fill:#1a3a1a,stroke:#4caf50
    style blend fill:#1a3a1a,stroke:#4caf50
    style radialBlend fill:#1a3a1a,stroke:#4caf50
    style trajLib fill:#1a3a1a,stroke:#4caf50
    style trajFrame fill:#1a3a1a,stroke:#4caf50
    style configStore fill:#1a3a1a,stroke:#4caf50
    style helpReg fill:#1a3a1a,stroke:#4caf50
    style trajectory fill:#1a3a1a,stroke:#4caf50
    style transport fill:#1a3a1a,stroke:#4caf50
    style sceneAnim fill:#1a3a1a,stroke:#4caf50
    style camera fill:#1a3a1a,stroke:#4caf50
    style indexHTML fill:#3a1a1a,stroke:#e94560
```

Green nodes = pure modules (no DOM/GL). Red node = orchestrator (index.html).

---

## 2. Function Call Flow

### 2.1 Sampling Pipeline (per-frame)

```mermaid
sequenceDiagram
    participant RL as render-loop
    participant SH as sampling-hud
    participant SC as segment-config
    participant ZP as zoom-pipeline
    participant HM as homography
    participant BC as bezier-curve
    participant RB as radial-blend

    RL->>SH: refreshH()
    SH->>SC: getLeadSource(z)
    SH->>SC: getFollowerSource(z)
    SH->>SC: getSegmentWarp(z)
    SH->>SC: getSegmentRange(z)
    SH->>ZP: computeSampleMatrixExplicit(opts)
    ZP->>ZP: lead matches default?
    alt matches default rules
        ZP->>ZP: computeSampleMatrix(opts)
        ZP->>HM: computeHPair(lead, follower, D)
        ZP->>BC: warpCurve(t) [if configured]
        ZP->>ZP: normLerp(startM, H, t)
    else custom segment
        ZP->>HM: computeHPair(lead, follower, D)
        ZP->>BC: warpCurve(t) [if configured]
        ZP->>ZP: normLerp(crop, H, t)
    end
    ZP-->>SH: {src, m: M_lead}

    SH->>ZP: computeFollowerMatrix(opts)
    ZP->>HM: computeHPair(fol_cam, lead_cam, D)
    ZP-->>SH: {src, m: M_follower}

    SH-->>RL: uniforms set (uSrc, uHi, uBlend...)

    RL->>RL: sourcesToRender(zsrc, dual, blending)
    RL->>RL: renderSrcRT(s) for each source
    RL->>RB: radialBlendParams(curNom, prevNom)
    RB-->>RL: {direction, coverRadius}
    RL->>RL: Pass 3: full-screen warp quad
```

### 2.2 Zoom Transition (Go button click)

```mermaid
sequenceDiagram
    participant UI as ui-controls
    participant ZA as zoom-anim
    participant BC as bezier-curve
    participant ST as config-store
    participant SH as sampling-hud

    UI->>ZA: animateTo(target)
    loop each rAF frame
        ZA->>ZA: t = (now - t0) / duration
        alt zoom curve configured
            ZA->>BC: evalCurve(t, curve)
            BC-->>ZA: eased t
        else default
            ZA->>ZA: easeInOutQuad(t)
        end
        ZA->>ST: set('controls', {zoom})
        ST->>SH: apply → renderControls → refreshH()
    end
```

### 2.3 Trajectory Playback

```mermaid
sequenceDiagram
    participant TP as transport
    participant RL as render-loop
    participant TF as traj-frame
    participant SH as sampling-hud

    RL->>TP: isEngaged()? current()
    TP-->>RL: rec (frame record)
    RL->>TF: applyTrajFrameToState(S, rec)
    TF-->>RL: updated fields
    Note over RL: DOM sync (sliders, buttons)
    RL->>SH: refreshH()
    Note over RL: Blend from rec.blendT (not blend controller)
```

### 2.4 Scene Save/Load

```mermaid
sequenceDiagram
    participant IO as scene-io
    participant CS as config-store
    participant TL as trajectory-library
    participant SC as segment-config

    Note over IO: Save
    IO->>CS: store.serialize()
    CS-->>IO: {controls, cameras, segments, ...}
    IO->>TL: trajLibraryIO.serialize()
    TL-->>IO: [{name, json}, ...]
    IO->>IO: write JSON + trajectory files

    Note over IO: Load
    IO->>CS: store.applyAll(json)
    CS->>SC: apply → segmentConfig.restore()
    IO->>TL: trajLibraryIO.restore(jsons)
```

---

## 3. Module Inventory

### Pure Modules (no DOM, fully testable)

| Module | Lines | Exports | Purpose |
|--------|------:|--------:|---------|
| `math.js` | 137 | 1 | 3×3 matrix operations (mul, inv, transpose, det, etc.) |
| `homography.js` | 153 | 4 | Plane-induced homography, zoomMatrix, eulerR |
| `zoom-pipeline.js` | 302 | 11 | 4-segment zoom pipeline, warp interpolation, lead/follower matrices |
| `camera-sampling.js` | 114 | 5 | Per-camera nominal, crop, sample matrix (warp-off path) |
| `segment-config.js` | 208 | 9 | Breakpoint-based segment → lead/follower/warp config |
| `bezier-curve.js` | 136 | 7 | Cubic bezier evaluation, curve sampling |
| `blend.js` | 83 | 1 | Camera-transition blend state machine |
| `radial-blend.js` | 38 | 1 | Radial blend direction + coverage radius |
| `trajectory.js` | 156 | 5 | Trajectory parser (delta expansion, blend injection) |
| `trajectory-library.js` | 101 | 2 | Trajectory storage + delta-encode serialization |
| `traj-frame.js` | 83 | 3 | Pure state mapping: traj record → app state S |
| `transport.js` | 149 | 1 | Play/Pause/Stop/Seek state machine + master clock |
| `recorder.js` | 137 | 1 | Per-frame state capture for trajectory recording |
| `camera.js` | 64 | 2 | Default camera params + scene camera constants |
| `config-store.js` | 128 | 1 | Central config store (register/set/serialize/applyAll) |
| `help-registry.js` | 67 | 2 | Distributed help system (collect + render) |
| `scene-anim.js` | 202 | 5 | Object animation engine (spin, bob, orbit, float) |
| `zoom-anim.js` | 98 | 1 | Zoom preset transitions + Play bounce loop |
| `shader.js` | 163 | 3 | GLSL vertex + fragment shaders (warp + blend) |

### DOM/GL Modules

| Module | Lines | Exports | Purpose |
|--------|------:|--------:|---------|
| `render-loop.js` | 377 | 6 | Frame pacing, RT rendering, blend uniforms, BEV |
| `sampling-hud.js` | 129 | 2 | Pipeline math → shader uniforms + HUD display |
| `ui-controls.js` | 233 | 3 | Control panel widgets ↔ config store |
| `panels.js` | 247 | 2 | Layout manager (5 panels + labels + separators) |
| `interaction.js` | 224 | 2 | Mouse/pointer handlers (drag, select, orbit) |
| `selection-panel.js` | 274 | 3 | Object info panel (position, depth, rotation, anim) |
| `camera-dialog.js` | 176 | 4 | Camera params edit dialog |
| `segment-dialog.js` | 196 | 2 | Segment config dialog (breakpoints + lead/follower/warp) |
| `curve-editor.js` | 233 | 1 | Canvas bezier curve editor |
| `autofocus.js` | 220 | 2 | Tap-to-focus (depth pass + median sampling) |
| `gl-bootstrap.js` | 80 | 1 | WebGL context, render targets, materials |
| `camera-rig.js` | 193 | 1 | Three.js camera instances from intrinsics/extrinsics |
| `bev-ghost.js` | 69 | 2 | BEV ghost transparency for tall objects |
| `loader.js` | 260 | 9 | GLTF/OBJ model loader |
| `scene-io.js` | 232 | 6 | Scene save/load (JSON + trajectory files) |
| `scene-manager.js` | 59 | 1 | Scene load orchestration + fallback timer |
| `fallback-scene.js` | 72 | 1 | Default primitives when no model loaded |
| `asset-registry.js` | 81 | 1 | Drag-and-drop asset catalog |
| `asset-parse.js` | 121 | 3 | GLTF/OBJ/image file parser |
| `object-ops.js` | 212 | 2 | Object add/delete/duplicate/hide operations |

### Orchestrator

| File | Lines | Role |
|------|------:|------|
| `index.html` | 1180 | HTML layout + CSS + JS wiring (imports all modules, creates instances, binds DOM events) |

---

## 4. Test Coverage

| Test file | Tests | Covers |
|-----------|------:|--------|
| `math.test.js` | — | Matrix ops |
| `homography.test.js` | — | computeH, computeHPair, zoomMatrix |
| `zoom-pipeline.test.js` | 36 | All segment logic, lead/follower, segRange warp |
| `camera-sampling.test.js` | 17 | cameraNominal, cameraCrop, cameraSampleMatrix |
| `segment-config.test.js` | 26 | Breakpoints, assignments, per-segment warp |
| `bezier-curve.test.js` | 18 | bezierAt, solveBezierT, evalCurve, sampleCurve |
| `blend.test.js` | — | Blend controller state machine |
| `radial-blend.test.js` | 7 | radialBlendParams |
| `trajectory-library.test.js` | 13 | trajToJson, createTrajectoryLibrary |
| `traj-frame.test.js` | 12 | applyTrajFrameToState, TRAJ_LOCK_IDS |
| `render-loop.test.js` | — | sourcesToRender, blendFeed, frameGate, paceDue |
| `sampling-hud.test.js` | 7 | formatHMatrix, refreshH |
| `recorder.test.js` | 7 | Recorder capture/start/stop |
| `config-store.test.js` | — | Config store register/set/serialize |
| `scene-io.test.js` | 4 | Scene save/load |
| `camera.test.js` | 7 | Camera constants |
| `shader.test.js` | 11 | GLSL source structure |
| ... | ... | ... |
| **Total** | **334** | |
