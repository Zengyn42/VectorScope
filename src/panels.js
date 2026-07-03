/**
 * @module panels
 * @description
 * Panel layout manager for VectorScope's three-panel viewport.
 *
 * VectorScope displays three panels in a split layout:
 * ```
 * ┌─────────────┬──────────────┐
 * │  Main (m)   │ Secondary (s)│   ← top 40% of viewport
 * ├─────────────┴──────────────┤
 * │       Combined (c)         │   ← bottom 60%, aspect-locked to RT
 * └────────────────────────────┘
 * ```
 *
 * **Coordinate system:**
 * Panel rects use **GL coordinates** (origin at bottom-left, y-up) matching
 * WebGL's `setViewport(x, y, width, height)`. CSS coordinate conversion
 * (origin at top-left, y-down) is handled internally by `getPanel()` and `toNDC()`.
 *
 * The Combined panel is aspect-locked to the render target (16:9 by default),
 * with letterboxing if the available space has a different aspect ratio.
 *
 * **No THREE.js dependency** — this module only manipulates numbers and DOM
 * positioning for labels/separators.
 *
 * @example
 * import { createPanelManager } from './panels.js';
 *
 * const { P, layoutPanels, getPanel, toNDC } = createPanelManager({
 *     $: id => document.getElementById(id),
 *     RT_W: 1920, RT_H: 1080,
 *     onCameraAspect: (aspect) => { camera.aspect = aspect; },
 * });
 *
 * window.addEventListener('resize', layoutPanels);
 * layoutPanels();
 *
 * // Which panel did the user click?
 * canvas.addEventListener('click', (e) => {
 *     const panel = getPanel(e.clientX, e.clientY);  // 'm', 's', or 'c'
 *     const ndc = toNDC(e.clientX, e.clientY, P[panel]);  // { x, y } in [-1, 1]
 * });
 *
 * @param {object} opts
 * @param {Function} opts.$ - `getElementById` shorthand
 * @param {number}   opts.RT_W - Render target width (pixels)
 * @param {number}   opts.RT_H - Render target height (pixels)
 * @param {Function} opts.onCameraAspect - Called with panel aspect ratio on layout change
 * @returns {{ P: object, layoutPanels: Function, getPanel: Function, toNDC: Function }}
 */
export function createPanelManager({ $, RT_W, RT_H, onCameraAspect }) {
    const GAP = 2;
    const P = { m: {}, s: {}, c: {} };

    function layoutPanels() {
        const r = $('viewport-container').getBoundingClientRect();
        const W = r.width, H = r.height;
        const topH = Math.floor(H * 0.4);
        const botH = H - topH - GAP;
        const halfW = Math.floor((W - GAP) / 2);

        P.m = { x: 0, y: botH + GAP, w: halfW, h: topH };
        P.s = { x: halfW + GAP, y: botH + GAP, w: W - halfW - GAP, h: topH };

        // Combined panel: aspect-locked to RT
        const targetAspect = RT_W / RT_H;
        let cw = W, ch = botH;
        if (cw / ch > targetAspect) cw = Math.floor(ch * targetAspect);
        else ch = Math.floor(cw / targetAspect);
        const cx = Math.floor((W - cw) / 2);
        const cy = Math.floor((botH - ch) / 2);
        P.c = { x: cx, y: cy, w: cw, h: ch };

        // Labels
        $('lbl-m').style.left = (P.m.x + 8) + 'px';
        $('lbl-m').style.top = (H - P.m.y - P.m.h + 6) + 'px';
        $('lbl-s').style.left = (P.s.x + 8) + 'px';
        $('lbl-s').style.top = (H - P.s.y - P.s.h + 6) + 'px';
        $('lbl-c').style.left = (P.c.x + 8) + 'px';
        $('lbl-c').style.top = (H - P.c.y - P.c.h + 6) + 'px';

        // Separators
        $('sep-v').style.left = halfW + 'px';
        $('sep-v').style.top = (H - P.m.y - P.m.h) + 'px';
        $('sep-v').style.height = topH + 'px';
        $('sep-h').style.top = (H - P.m.y - P.m.h - GAP) + 'px';

        // Sync camera aspect
        if (onCameraAspect) onCameraAspect(P.m.w / P.m.h);
    }

    /** Determine which panel a CSS click lands on */
    function getPanel(cx, cy) {
        const r = $('main-canvas').getBoundingClientRect();
        const x = cx - r.left, y = cy - r.top;
        const H = r.height;
        const topRowCSSTop = H - P.m.y - P.m.h;
        if (y < topRowCSSTop) return 'c';
        if (x < P.m.w) return 'm';
        return 's';
    }

    /** Convert CSS client coords → NDC for a given panel rect */
    function toNDC(cx, cy, p) {
        const r = $('main-canvas').getBoundingClientRect();
        const H = r.height;
        const panelCSSTop = H - p.y - p.h;
        return {
            x: ((cx - r.left - p.x) / p.w) * 2 - 1,
            y: -((cy - r.top - panelCSSTop) / p.h) * 2 + 1,
        };
    }

    return { P, layoutPanels, getPanel, toNDC };
}
