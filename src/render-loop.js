/**
 * @module render-loop
 * @description
 * Per-frame render pipeline for VectorScope (passes per frame):
 *
 * ```
 * 1. scene → leading source RT (rtS/rtM/rtS2, for Combined warp shader;
 *    dual-mode blends also render the live follower RT)
 * 2. blend controller update → uBlend / uPrevSrc / uPrevHi uniforms
 * 3. scene → BEV panel     (R.bev, orthographic top-down, ghost mode)
 * 4. scene → Main panel    (R.main, direct)
 * 5. scene → UW panel      (R.sec1, direct)
 * 6. scene → Tele panel    (R.sec2, direct)
 * 7. quad  → Combined panel (warp shader, letterboxed to RT aspect)
 * ```
 *
 * The two per-frame *decisions* — which source RTs to render and what to
 * feed the blend uniforms — are pure functions ({@link sourcesToRender},
 * {@link blendFeed}) so they can be unit-tested without a GL context.
 *
 * **Idle skipping (weak-GPU optimization):**
 * The rAF loop only renders when something can have changed on screen:
 * - *continuous* activity: object animations running, a camera-transition
 *   blend in progress, or the user dragging an object;
 * - *dirty* frames: one-shot changes reported via `markDirty()` (store
 *   writes, slider input, pointer events, resize, async model loads);
 * - a keep-alive heartbeat (1 frame every `keepAlive` skipped frames) as a
 *   safety net for change sources that were not instrumented.
 * The BEV panel additionally renders at reduced rate (every `bevInterval`-th
 * rendered frame) during continuous activity; the final frame of a dirty
 * burst always includes BEV so it never freezes stale.
 * The gating decision is a pure function ({@link frameGate}).
 */

import { SRC, zoomSource, SRC_NOMINAL } from './zoom-pipeline.js';

/**
 * Which source RTs must be rendered this frame.
 *
 * Single mode renders only the leading source: during a blend the outgoing
 * RT is deliberately NOT re-rendered, so it freezes at its last frame for
 * free. Dual mode additionally renders the live follower RT while a blend
 * is active (docs/CAMERAS.md §4).
 *
 * @param {object} opts
 * @param {number}  opts.zsrc        - leading source index (SRC.*)
 * @param {boolean} opts.dual        - blend mode is 'dual'
 * @param {boolean} opts.blending    - a cross-fade is currently active
 * @param {number|null} opts.followerSrc - live follower source (SRC.* or null)
 * @param {boolean} opts.hasS2       - Tele camera exists in the rig
 * @returns {number[]} source indices to render, leading first
 */
export function sourcesToRender({ zsrc, dual, blending, followerSrc, hasS2 }) {
    const list = [zsrc];
    if (dual && blending && followerSrc !== null && followerSrc !== zsrc
        && (followerSrc !== SRC.SEC2 || hasS2)) {
        list.push(followerSrc);
    }
    return list;
}

/**
 * What to feed the warp shader's blend uniforms this frame.
 *
 * Single mode: the controller's frozen outgoing-camera state.
 * Dual mode: the live follower state (kept fresh by the sampling refresh).
 *
 * @param {object} opts
 * @param {number}      opts.t        - current-frame weight from the blend controller
 * @param {number|null} opts.prevSrc  - controller's outgoing source (null = not blending)
 * @param {number[]|null} opts.prevM  - controller's frozen sampling matrix
 * @param {boolean}     opts.dual     - blend mode is 'dual'
 * @param {number|null} opts.followerSrc - live follower source
 * @param {number[]|null} opts.followerM - live follower sampling matrix
 * @returns {{uBlend: number, prev: {src: number, m: number[]}|null}}
 */
export function blendFeed({ t, prevSrc, prevM, dual, followerSrc, followerM }) {
    if (prevSrc === null) return { uBlend: t, prev: null };
    return {
        uBlend: t,
        prev: dual ? { src: followerSrc, m: followerM } : { src: prevSrc, m: prevM },
    };
}

/**
 * Should this rAF tick render, and must it be a "final" (full) frame?
 *
 * A *final* frame is the last one of a dirty burst (or a keep-alive frame):
 * it forces the BEV panel to render so the screen is fully consistent
 * before the loop goes idle.
 *
 * @param {object} opts
 * @param {boolean} opts.continuous  - animations / blending / dragging active
 * @param {number}  opts.dirtyFrames - remaining one-shot dirty frames
 * @param {number}  opts.skipped     - consecutive skipped frames so far
 * @param {number}  opts.keepAlive   - heartbeat period in skipped frames
 * @returns {{render: boolean, finalFrame: boolean}}
 */
export function frameGate({ continuous, dirtyFrames, skipped, keepAlive }) {
    if (continuous || dirtyFrames > 0 || skipped >= keepAlive) {
        return { render: true, finalFrame: !continuous && dirtyFrames <= 1 };
    }
    return { render: false, finalFrame: false };
}

/**
 * Should the BEV panel render on this rendered frame?
 * @param {object} opts
 * @param {boolean} opts.finalFrame  - full frame (dirty burst end / heartbeat / direct call)
 * @param {number}  opts.tick        - rendered-frame counter
 * @param {number}  opts.interval    - render BEV every `interval`-th frame
 * @returns {boolean}
 */
export function bevDue({ finalFrame, tick, interval }) {
    return finalFrame || tick % interval === 0;
}

/**
 * Fixed-rate pacing for the whole render loop (CPU clock).
 *
 * The loop runs on rAF but frames are only rendered when 1000/fps ms have
 * elapsed since the previous render, so every panel steps at the same
 * uniform cadence regardless of the display's rAF rate (60/120/144 Hz).
 * Rendering everything at the same rate keeps per-frame GPU cost constant —
 * a lesson learned: rendering *parts* of the frame at different rates makes
 * heavy and light frames alternate, which reads as flicker on weak GPUs.
 *
 * @param {object} opts
 * @param {number} opts.now  - current time in ms
 * @param {number} opts.last - time of the previous rendered frame in ms
 * @param {number} opts.fps  - target frame rate; <= 0 disables pacing
 * @returns {boolean}
 */
export function paceDue({ now, last, fps }) {
    if (fps <= 0) return true;
    return now - last >= 1000 / fps - 1;   // 1ms tolerance for rAF jitter
}

/**
 * Create the render loop.
 *
 * @param {object} opts
 * @param {object} opts.renderer  - THREE.WebGLRenderer
 * @param {object} opts.scene     - THREE.Scene
 * @param {object} opts.gl        - GL context bundle from gl-bootstrap
 *        (uses rtM, rtS, rtS2, dScene, dCam, quad, matWarp)
 * @param {object} opts.R         - live camera rig (access by property, never destructure)
 * @param {object} opts.S         - shared app state
 * @param {object} opts.P         - panel rects from panels.js
 * @param {object} opts.camRig    - camera rig controller (syncMarkers)
 * @param {object} opts.bevGhost  - BEV ghost-mode controller (apply/restore)
 * @param {object} opts.sceneAnim - scene animator (update)
 * @param {object} opts.blendCtl  - blend controller (isBlending/update)
 * @param {number} opts.rtW       - RT width
 * @param {number} opts.rtH       - RT height
 * @param {Function} [opts.raf]   - injectable requestAnimationFrame (tests)
 * @param {number} [opts.bevInterval=2] - BEV renders every Nth rendered frame
 * @param {number} [opts.keepAlive=30]  - heartbeat frame every N skipped frames
 * @param {number} [opts.fps=30]        - fixed loop rate (CPU clock); <=0 = every rAF tick
 * @param {Function} [opts.now]         - injectable clock in ms (tests)
 * @param {object} [opts.transport]     - trajectory transport (src/transport.js).
 *        While playing, the transport paces the loop at the trajectory's own
 *        fps (the fixed-fps setting does not apply) and advances the frame
 *        counter; while engaged, `onTrajFrame(rec)` is invoked before every
 *        rendered frame so the trajectory drives cameras/zoom/focus/blend.
 * @param {Function} [opts.onTrajFrame] - receives the current dense frame record
 * @param {Function} [opts.onPostFrame] - called after every rendered frame
 *        (regardless of play mode) — used by the recorder to capture state
 * @returns {{frame: Function, start: Function, markDirty: Function,
 *            setFps: Function, getFps: Function}}
 */
export function createRenderLoop({
    renderer, scene, gl, R, S, P, camRig, bevGhost, sceneAnim, blendCtl,
    rtW, rtH, raf = requestAnimationFrame.bind(globalThis),
    bevInterval = 2, keepAlive = 30,
    fps = 30, now = () => performance.now(),
    transport = null, onTrajFrame = () => {}, onPostFrame = () => {},
}) {
    const { rtM, rtS, rtS2, dScene, dCam, quad, matWarp, rtBev, matBev } = gl;
    const rtAspect = rtW / rtH;

    let dirtyFrames = 3;   // paint the first frames on startup
    let skipped = 0;       // consecutive skipped rAF ticks
    let bevTick = 0;       // rendered-frame counter for BEV rate reduction
    let lastFrameT = -1e9; // time of the previous rendered frame (fps pacing)

    /** Request `n` rendered frames after a one-shot change (default 3). */
    function markDirty(n = 3) { dirtyFrames = Math.max(dirtyFrames, n); }

    function renderSrcRT(s) {
        const cam = s === SRC.SEC1 ? R.sec1 : s === SRC.SEC2 ? R.sec2 : R.main;
        const rt  = s === SRC.SEC1 ? rtS   : s === SRC.SEC2 ? rtS2   : rtM;
        cam.aspect = rtAspect; cam.updateProjectionMatrix();
        renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    }

    /**
     * Render one full frame.
     * @param {boolean} [finalFrame=true] - force the BEV panel to render
     *        (direct calls from tests always render everything).
     */
    function frame(finalFrame = true) {
        /* Trajectory frame (Play mode): apply the current record BEFORE
           anything renders — rig pose, zoom, focus D, lead/follower and the
           blend state all come from the file. `rec` stays null in free mode. */
        const rec = transport?.isEngaged() ? transport.current() : null;
        if (rec) onTrajFrame(rec);

        // Scene animation — skip the object being dragged (its base follows
        // the drag so motion resumes smoothly from the drop point).
        sceneAnim.update((o) => S.dragging && S.sel === o);
        R.main.updateMatrixWorld(true);
        R.sec1.updateMatrixWorld(true);
        if (R.sec2) R.sec2.updateMatrixWorld(true);
        camRig.syncMarkers();

        /* Pass 1: off-screen source RT(s) for the Combined warp shader.
           NOTE: uses the blend state from *before* this frame's update —
           on the transition frame itself the follower RT still holds the
           outgoing camera's fresh last frame, so no stale pixels show. */
        /* Trajectory blend is always "dual" (live follower layer): both
           layers are re-rendered every frame, so any seek reproduces the
           exact blend state — a frozen outgoing frame could not. */
        const dual = rec ? true : S.blendMode === 'dual';
        const trajBlending = !!rec && rec.blendT !== null;
        const zsrc = rec ? S.sampleSrc : zoomSource(S.zoom, !!R.sec2);
        for (const s of sourcesToRender({
            zsrc, dual, blending: rec ? trajBlending : blendCtl.isBlending(),
            followerSrc: S.followerSrc, hasS2: !!R.sec2,
        })) renderSrcRT(s);

        /* Pass 2: cross-fade uniforms.
           Free mode: the blend controller detects source switches and counts
           frames. Play mode: the trajectory states the blend per frame
           (blendT precomputed from the file's blend runs) — the controller
           is bypassed entirely so its history stays untouched. */
        if (rec) {
            matWarp.uniforms.uBlend.value = trajBlending ? rec.blendT : 1;
            if (trajBlending && S.followerM) {
                matWarp.uniforms.uPrevSrc.value = S.followerSrc;
                matWarp.uniforms.uPrevHi.value.set(...S.followerM);
            }
        } else if (S.sampleM) {
            const { t, prevSrc, prevM } = blendCtl.update(S.sampleSrc, S.sampleM);
            const feed = blendFeed({
                t, prevSrc, prevM, dual,
                followerSrc: S.followerSrc, followerM: S.followerM,
            });
            matWarp.uniforms.uBlend.value = feed.uBlend;
            if (feed.prev) {
                matWarp.uniforms.uPrevSrc.value = feed.prev.src;
                matWarp.uniforms.uPrevHi.value.set(...feed.prev.m);
            }
        }
        /* Radial blend direction + coverage radius.
           - Radial-IN (1): small FOV leading → large FOV incoming (edges first)
             coverRadius = outgoing_nominal / incoming_nominal (outgoing coverage)
           - Radial-OUT (-1): large FOV leading → small FOV incoming (center first)
             coverRadius = incoming_nominal / outgoing_nominal (incoming coverage) */
        if (S.blendShape === 'radial' && matWarp.uniforms.uBlend.value < 1) {
            const curSrc = zsrc;
            const prevSrc = matWarp.uniforms.uPrevSrc.value;
            const curNom = SRC_NOMINAL[curSrc] || 1;
            const prevNom = SRC_NOMINAL[prevSrc] || 1;
            if (prevNom > curNom) {
                // Outgoing narrower FOV → incoming wider: radial-IN (edges first)
                matWarp.uniforms.uBlendRadial.value = 1;
                matWarp.uniforms.uCoverRadius.value = curNom / prevNom;
            } else if (prevNom < curNom) {
                // Outgoing wider FOV → incoming narrower: radial-OUT (center first)
                matWarp.uniforms.uBlendRadial.value = -1;
                matWarp.uniforms.uCoverRadius.value = prevNom / curNom;
            } else {
                matWarp.uniforms.uBlendRadial.value = 0;
                matWarp.uniforms.uCoverRadius.value = 1.0;
            }
        } else {
            matWarp.uniforms.uBlendRadial.value = S.blendShape === 'radial' ? 0 : 0;
            matWarp.uniforms.uCoverRadius.value = 1.0;
        }

        /* Pass 3a: Bird's Eye → its own RT, rate-reduced: every
           `bevInterval`-th rendered frame (~15fps at 60fps) during
           continuous activity; always on final frames. Objects above
           ghost height are translucent. */
        bevTick++;
        if (P.bev.w > 0 && bevDue({ finalFrame, tick: bevTick, interval: bevInterval })) {
            const dpr = renderer.getPixelRatio();
            const bw = Math.max(1, Math.round(P.bev.w * dpr));
            const bh = Math.max(1, Math.round(P.bev.h * dpr));
            if (rtBev.width !== bw || rtBev.height !== bh) rtBev.setSize(bw, bh);
            bevGhost.apply();
            renderer.setRenderTarget(rtBev); renderer.clear();
            renderer.render(scene, R.bev);
            bevGhost.restore();
        }

        /* Pass 3-7: on-screen panel renders */
        renderer.setRenderTarget(null); renderer.clear(); renderer.setScissorTest(true);

        /* Passes 3b-6 skip zero-size panels (combined focus layout mode) */

        /* Pass 3b: blit the (possibly stale) BEV RT into its panel */
        if (P.bev.w > 0) {
            renderer.setViewport(P.bev.x, P.bev.y, P.bev.w, P.bev.h);
            renderer.setScissor(P.bev.x, P.bev.y, P.bev.w, P.bev.h);
            quad.material = matBev; renderer.render(dScene, dCam);
        }

        /* Pass 4: Main Camera panel */
        const panelAspect = P.m.h > 0 ? P.m.w / P.m.h : rtAspect;
        if (P.m.w > 0) {
            R.main.aspect = panelAspect; R.main.updateProjectionMatrix();
            renderer.setViewport(P.m.x, P.m.y, P.m.w, P.m.h);
            renderer.setScissor(P.m.x, P.m.y, P.m.w, P.m.h);
            renderer.render(scene, R.main);
        }

        /* Pass 5: UW Camera panel */
        if (P.s1.w > 0) {
            R.sec1.aspect = panelAspect; R.sec1.updateProjectionMatrix();
            renderer.setViewport(P.s1.x, P.s1.y, P.s1.w, P.s1.h);
            renderer.setScissor(P.s1.x, P.s1.y, P.s1.w, P.s1.h);
            renderer.render(scene, R.sec1);
        }

        /* Pass 6: Tele Camera panel */
        if (R.sec2 && P.s2.w > 0) {
            R.sec2.aspect = panelAspect; R.sec2.updateProjectionMatrix();
            renderer.setViewport(P.s2.x, P.s2.y, P.s2.w, P.s2.h);
            renderer.setScissor(P.s2.x, P.s2.y, P.s2.w, P.s2.h);
            renderer.render(scene, R.sec2);
        }

        /* Pass 7: Combined panel — warp shader on the display quad,
           letterboxed so the 9:16 RT keeps its aspect inside the panel. */
        let cx = P.c.x, cy = P.c.y, cw = P.c.w, ch = P.c.h;
        if (cw / ch > rtAspect) { const nw = ch * rtAspect; cx += (cw - nw) / 2; cw = nw; }
        else                    { const nh = cw / rtAspect; cy += (ch - nh) / 2; ch = nh; }
        renderer.setScissor(P.c.x, P.c.y, P.c.w, P.c.h);  // clear full panel (black bars)
        renderer.setViewport(cx, cy, cw, ch);
        quad.material = matWarp; renderer.render(dScene, dCam);

        renderer.setScissorTest(false);
        onPostFrame();
    }

    /** One rAF tick: render only when something can have changed, at a
     *  fixed CPU-clock rate (`fps`) so every frame has the same cost. */
    function tick() {
        const playing = !!transport?.isPlaying();
        const continuous = playing
            || sceneAnim.count() > 0 || blendCtl.isBlending() || S.dragging;
        const gate = frameGate({ continuous, dirtyFrames, skipped, keepAlive });
        if (!gate.render) { skipped++; return; }
        /* Pacing defers the frame without consuming dirtyFrames or
           counting as skipped — the next due tick picks it up. */
        const t = now();
        if (playing) {
            /* Play mode: the transport is the sole pacer — it advances the
               frame counter at the trajectory's own fps (late rAF ticks drop
               frames by jumping the counter). The fixed-fps setting is
               ignored so playback speed always matches the file. */
            if (!transport.advance(t)) return;
        } else if (!paceDue({ now: t, last: lastFrameT, fps })) {
            return;
        }
        lastFrameT = t;
        if (dirtyFrames > 0) dirtyFrames--;
        skipped = 0;
        frame(gate.finalFrame);
    }

    function start() {
        const loop = () => { raf(loop); tick(); };
        loop();
    }

    /** Change the fixed loop rate at runtime (30/60 FPS button). A frame
     *  that finishes late is simply dropped — `lastFrameT` is stamped with
     *  the actual render time, so the loop never queues catch-up frames. */
    function setFps(n) { fps = n; }
    function getFps() { return fps; }

    return { frame, start, markDirty, setFps, getFps };
}
