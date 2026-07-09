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
 */

import { SRC, zoomSource } from './zoom-pipeline.js';

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
 * @returns {{frame: Function, start: Function}}
 */
export function createRenderLoop({
    renderer, scene, gl, R, S, P, camRig, bevGhost, sceneAnim, blendCtl,
    rtW, rtH, raf = requestAnimationFrame.bind(globalThis),
}) {
    const { rtM, rtS, rtS2, dScene, dCam, quad, matWarp } = gl;
    const rtAspect = rtW / rtH;

    function renderSrcRT(s) {
        const cam = s === SRC.SEC1 ? R.sec1 : s === SRC.SEC2 ? R.sec2 : R.main;
        const rt  = s === SRC.SEC1 ? rtS   : s === SRC.SEC2 ? rtS2   : rtM;
        cam.aspect = rtAspect; cam.updateProjectionMatrix();
        renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    }

    function frame() {
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
        const dual = S.blendMode === 'dual';
        const zsrc = zoomSource(S.zoom, !!R.sec2);
        for (const s of sourcesToRender({
            zsrc, dual, blending: blendCtl.isBlending(),
            followerSrc: S.followerSrc, hasS2: !!R.sec2,
        })) renderSrcRT(s);

        /* Pass 2: advance the cross-fade, feed the previous-layer uniforms */
        if (S.sampleM) {
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

        /* Pass 3-7: on-screen panel renders */
        renderer.setRenderTarget(null); renderer.clear(); renderer.setScissorTest(true);

        /* Pass 3: Bird's Eye — objects above ghost height are translucent */
        bevGhost.apply();
        renderer.setViewport(P.bev.x, P.bev.y, P.bev.w, P.bev.h);
        renderer.setScissor(P.bev.x, P.bev.y, P.bev.w, P.bev.h);
        renderer.render(scene, R.bev);
        bevGhost.restore();

        /* Pass 4: Main Camera panel */
        const panelAspect = P.m.w / P.m.h;
        R.main.aspect = panelAspect; R.main.updateProjectionMatrix();
        renderer.setViewport(P.m.x, P.m.y, P.m.w, P.m.h);
        renderer.setScissor(P.m.x, P.m.y, P.m.w, P.m.h);
        renderer.render(scene, R.main);

        /* Pass 5: UW Camera panel */
        R.sec1.aspect = panelAspect; R.sec1.updateProjectionMatrix();
        renderer.setViewport(P.s1.x, P.s1.y, P.s1.w, P.s1.h);
        renderer.setScissor(P.s1.x, P.s1.y, P.s1.w, P.s1.h);
        renderer.render(scene, R.sec1);

        /* Pass 6: Tele Camera panel */
        if (R.sec2) {
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
    }

    function start() {
        const loop = () => { raf(loop); frame(); };
        loop();
    }

    return { frame, start };
}
