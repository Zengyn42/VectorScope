/**
 * @module autofocus
 * @description
 * Interactive autofocus (AF) system for VectorScope.
 *
 * Allows the user to select a rectangular region on the Main camera panel,
 * then samples depth within that region to automatically set the Focus D
 * parameter. This is analogous to tap-to-focus on a real camera, but with
 * a draggable rectangle for precise area selection.
 *
 * **User workflow:**
 * 1. Click the "AF" button in the control bar — cursor changes to crosshair
 * 2. Click and drag on the Main panel to draw a selection rectangle
 *    (red outline with translucent fill)
 * 3. On mouse release, depth is sampled within the rectangle
 * 4. Focus D slider is updated to the median depth value
 * 5. AF mode exits automatically; the red rectangle remains visible until
 *    the next AF activation
 *
 * **Depth sampling pipeline:**
 * 1. Map screen-space rectangle → render target pixel coordinates
 *    (with aspect ratio correction: panel aspect may differ from RT 16:9)
 * 2. Render a depth pass using `MeshDepthMaterial` with `RGBADepthPacking`
 * 3. Read back pixel data as `Uint8Array` (cross-platform compatible)
 * 4. Unpack RGBA → NDC depth → perspective distance:
 *    `viewZ = (near * far) / ((far - near) * ndc - far)`
 * 5. Take the **median** of valid depth samples (filters outliers)
 * 6. Clamp to [0.1, 10.0] range and update Focus D
 *
 * **Aspect ratio correction:**
 * The Main panel may have a different aspect ratio than the 16:9 render target.
 * Horizontal coordinates are corrected: `toRTx = ((nx * 2 - 1) * panelAR / rtAR + 1) / 2`
 *
 * **Event handling:**
 * Uses capture-phase pointer events to intercept before the interaction module's
 * handlers, preventing accidental object selection during AF rectangle drawing.
 *
 * @requires three (renderer, scene, depthMat, rtDepth passed as dependencies)
 * @requires ./panels.js (for panel rects P)
 *
 * @example
 * import { initAutofocus } from './autofocus.js';
 *
 * initAutofocus({
 *     $, canvas, renderer, scene, depthMat, rtDepth, P, RT_W: 1920, RT_H: 1080,
 *     getMainCam: () => mainCam,
 *     onFocus: (depth) => {
 *         state.depthD = depth;
 *         slider.value = depth;
 *         refreshHomography();
 *     },
 * });
 *
 * @param {object} opts
 * @param {Function} opts.$          - `getElementById` shorthand
 * @param {Element}  opts.canvas     - The WebGL canvas element
 * @param {object}   opts.renderer   - Three.js `WebGLRenderer` instance
 * @param {object}   opts.scene      - Three.js `Scene` containing objects to depth-sample
 * @param {object}   opts.depthMat   - `MeshDepthMaterial` with `RGBADepthPacking`
 * @param {object}   opts.rtDepth    - `WebGLRenderTarget` for the depth pass
 * @param {object}   opts.P          - Panel rects from `createPanelManager`: `{ m, s, c }`
 * @param {object}   [opts.S]        - Shared app state; sets `S._continuousAF` for render loop
 * @param {number}   opts.RT_W       - Render target width (pixels, typically 1920)
 * @param {number}   opts.RT_H       - Render target height (pixels, typically 1080)
 * @param {Function} opts.getMainCam - Returns the current main `PerspectiveCamera`
 * @param {Function} opts.onFocus    - Callback invoked with the computed focus depth (meters);
 *                                     receives `Infinity` when the region contains no object
 */
/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Autofocus',
    order: 41,
    entries: [
        ['AF (continuous)', 'Toggle continuous auto-focus: samples the center 10% of the Main camera each frame and updates Focus D'],
        ['AF Select (Advanced)', 'Click AF Select, then drag a rectangle on the Main panel — Focus D is set to the median depth inside it'],
        ['AF on empty space', 'If the sampled region contains no object, Focus D is left unchanged'],
    ],
};

export function initAutofocus({ $, canvas, renderer, scene, depthMat, rtDepth, P, S, RT_W, RT_H, getMainCam, onFocus, onToggle }) {
    const afState = { active: false, dragging: false, x0: 0, y0: 0 };
    /** Continuous AF state */
    const contAF = { active: false };
    const afRect = $('af-rect');

    function runAF(screenRect) {
        const mainCam = getMainCam();
        if (!mainCam || screenRect.w < 2 || screenRect.h < 2) return;
        const near = mainCam.near, far = mainCam.far;

        // Map screen rect → RT pixel coords
        // Main panel is direct-rendered with panelAspect, depth RT uses rtAspect.
        const cont = $('viewport-container').getBoundingClientRect();
        const cssTop = cont.height - P.m.y - P.m.h;
        const panelAR = P.m.w / P.m.h;
        const rtAR = RT_W / RT_H;

        const nx0 = (screenRect.x - P.m.x) / P.m.w;
        const ny0 = (screenRect.y - cssTop) / P.m.h;
        const nx1 = nx0 + screenRect.w / P.m.w;
        const ny1 = ny0 + screenRect.h / P.m.h;

        // Correct horizontal for aspect ratio difference
        const toRTx = (nx) => ((nx * 2 - 1) * panelAR / rtAR + 1) / 2;
        const rx0 = Math.max(0, Math.floor(toRTx(nx0) * RT_W));
        const rx1 = Math.min(RT_W, Math.ceil(toRTx(nx1) * RT_W));
        const ry0 = Math.max(0, Math.floor((1 - ny1) * RT_H));
        const ry1 = Math.min(RT_H, Math.ceil((1 - ny0) * RT_H));
        const rtX = rx0, rtY = ry0;
        const rtW = rx1 - rx0, rtH = ry1 - ry0;
        if (rtW < 1 || rtH < 1) return;

        // Render depth pass.
        // The scene background color also fills the depth RT (three.js renders
        // the background even under an overrideMaterial), so empty pixels would
        // unpack to a bogus small depth. Swap in a white background for this
        // pass: white unpacks to ndc≈1 and is filtered by the >= 0.999 check,
        // making truly empty regions yield zero samples.
        const prevOverride = scene.overrideMaterial;
        const prevBg = scene.background;
        if (prevBg && prevBg.isColor) scene.background = prevBg.clone().setHex(0xffffff);
        scene.overrideMaterial = depthMat;
        mainCam.aspect = RT_W / RT_H;
        mainCam.updateProjectionMatrix();
        renderer.setRenderTarget(rtDepth);
        renderer.clear();
        renderer.render(scene, mainCam);
        scene.overrideMaterial = prevOverride;
        scene.background = prevBg;
        renderer.setRenderTarget(null);

        // Read selected region
        const buf = new Uint8Array(rtW * rtH * 4);
        renderer.readRenderTargetPixels(rtDepth, rtX, rtY, rtW, rtH, buf);

        // Unpack RGBA depth → perspective NDC → linear distance
        const depths = [];
        const n = rtW * rtH;
        for (let i = 0; i < n; i++) {
            const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2], a = buf[i * 4 + 3];
            const ndc = (r / 256 + g / 65536 + b / 16777216 + a / 4294967296);
            if (ndc >= 0.999) continue;
            const viewZ = (near * far) / ((far - near) * ndc - far);
            const dist = -viewZ;
            if (dist > near && dist < far * 0.95) depths.push(dist);
        }
        /* Nothing in the selected region: report Infinity so the caller
           can display "inf" instead of silently doing nothing. */
        if (depths.length === 0) { onFocus(Infinity); return; }

        // Median depth
        depths.sort((a, b) => a - b);
        const focusD = Math.max(0.1, Math.min(10, depths[Math.floor(depths.length / 2)]));
        onFocus(focusD);
    }

    // ── Continuous AF (btn-af): toggle per-frame center-10% sampling ──
    $('btn-af').onclick = () => {
        contAF.active = !contAF.active;
        if (S) S._continuousAF = contAF.active;
        $('btn-af').classList.toggle('active', contAF.active);
        if (onToggle) onToggle(contAF.active);
        // Exit manual AF select if it was active
        if (contAF.active && afState.active) {
            afState.active = false;
            afRect.style.display = 'none';
            canvas.style.cursor = '';
            const selBtn = $('btn-af-sel');
            if (selBtn) selBtn.classList.remove('active');
        }
    };

    // ── AF Select (btn-af-sel, in Advanced): manual rectangle selection ──
    const afSelBtn = $('btn-af-sel');
    if (afSelBtn) {
        afSelBtn.onclick = () => {
            // Turn off continuous AF if active
            if (contAF.active) {
                contAF.active = false;
                if (S) S._continuousAF = false;
                $('btn-af').classList.remove('active');
            }
            afState.active = !afState.active;
            afSelBtn.classList.toggle('active', afState.active);
            if (!afState.active) {
                afRect.style.display = 'none';
                afState.dragging = false;
                canvas.style.cursor = '';
            } else {
                canvas.style.cursor = 'crosshair';
            }
        };
    }

    // Capture-phase handlers to intercept before interaction handlers
    canvas.addEventListener('pointerdown', (e) => {
        if (!afState.active) return;
        const cont = $('viewport-container').getBoundingClientRect();
        afState.x0 = e.clientX - cont.left;
        afState.y0 = e.clientY - cont.top;
        afState.dragging = true;
        afRect.style.left = afState.x0 + 'px';
        afRect.style.top = afState.y0 + 'px';
        afRect.style.width = '0px';
        afRect.style.height = '0px';
        afRect.style.display = 'block';
        e.preventDefault();
        e.stopPropagation();
    }, true);

    canvas.addEventListener('pointermove', (e) => {
        if (!afState.active || !afState.dragging) return;
        const cont = $('viewport-container').getBoundingClientRect();
        const cx = e.clientX - cont.left;
        const cy = e.clientY - cont.top;
        const x = Math.min(afState.x0, cx);
        const y = Math.min(afState.y0, cy);
        const w = Math.abs(cx - afState.x0);
        const h = Math.abs(cy - afState.y0);
        afRect.style.left = x + 'px';
        afRect.style.top = y + 'px';
        afRect.style.width = w + 'px';
        afRect.style.height = h + 'px';
        e.preventDefault();
        e.stopPropagation();
    }, true);

    canvas.addEventListener('pointerup', (e) => {
        if (!afState.active || !afState.dragging) return;
        afState.dragging = false;
        const cont = $('viewport-container').getBoundingClientRect();
        const cx = e.clientX - cont.left;
        const cy = e.clientY - cont.top;
        const x = Math.min(afState.x0, cx);
        const y = Math.min(afState.y0, cy);
        const w = Math.abs(cx - afState.x0);
        const h = Math.abs(cy - afState.y0);

        runAF({ x, y, w, h });

        // Exit AF select mode — keep rect visible until next activation
        afState.active = false;
        const selBtn2 = $('btn-af-sel');
        if (selBtn2) selBtn2.classList.remove('active');
        canvas.style.cursor = '';

        e.preventDefault();
        e.stopPropagation();
    }, true);

    /**
     * Run one continuous-AF sample: center 10% of the Main panel.
     * Call this every rendered frame when contAF is active.
     * Uses CSS coordinates relative to the viewport container.
     */
    function tickContinuousAF() {
        if (!contAF.active) return;
        if (!P.m || P.m.w <= 0) return;
        const cont = $('viewport-container').getBoundingClientRect();
        // BEV/panel coords use WebGL Y-from-bottom; convert to CSS Y-from-top
        const cssTop = cont.height - P.m.y - P.m.h;
        // Center 10% width × 10% height
        const cw = P.m.w * 0.1;
        const ch = P.m.h * 0.1;
        const cx = P.m.x + (P.m.w - cw) / 2;
        const cy = cssTop + (P.m.h - ch) / 2;
        runAF({ x: cx, y: cy, w: cw, h: ch });
    }

    /** @returns {boolean} whether continuous AF is currently active */
    function isContinuousAF() { return contAF.active; }

    return { tickContinuousAF, isContinuousAF };
}
