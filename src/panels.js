/**
 * @module panels
 * @description
 * Panel layout manager for VectorScope's two-row viewport.
 *
 * Layout:
 * ```
 * ┌──────────────┬──────────────┬──────────────┐
 * │  Bird's Eye  │  Object Info │  Controls    │  ← top row ~35%
 * │  (canvas)    │  (DOM)       │  (DOM)       │
 * ├──────────┬───┴────┬─────────┼──────────────┤
 * │  Main    │ Sec 1  │  Sec 2  │  Combined    │  ← bottom row ~65%
 * │ (canvas) │(canvas)│ (canvas)│  (canvas)    │
 * └──────────┴────────┴─────────┴──────────────┘
 * ```
 *
 * Canvas-rendered panels: bev, m, s1, s2, c (GL coordinates, y-up)
 * DOM overlay panels: panel-info, panel-controls (CSS positioned by JS)
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
    const P = { bev: {}, m: {}, s1: {}, s2: {}, c: {} };

    function layoutPanels() {
        const r = $('viewport-container').getBoundingClientRect();
        const W = r.width, H = r.height;
        const topH = Math.floor(H * 0.35);
        const botH = H - topH - GAP;
        const topColW = Math.floor((W - 2 * GAP) / 3);
        const botColW = Math.floor((W - 3 * GAP) / 4);

        /* Top row: only bird's eye is canvas-rendered (left 1/3) */
        P.bev = { x: 0, y: botH + GAP, w: topColW, h: topH };

        /* Bottom row: 4 equal camera panels */
        P.m  = { x: 0,                   y: 0, w: botColW, h: botH };
        P.s1 = { x: botColW + GAP,       y: 0, w: botColW, h: botH };
        P.s2 = { x: 2 * (botColW + GAP), y: 0, w: botColW, h: botH };
        P.c  = { x: 3 * (botColW + GAP), y: 0, w: W - 3 * (botColW + GAP), h: botH };

        /* Position DOM overlay panels (CSS coords, top-left origin) */
        const infoEl = $('panel-info');
        const ctrlEl = $('panel-controls');
        if (infoEl) {
            infoEl.style.left = (topColW + GAP) + 'px';
            infoEl.style.top = '0px';
            infoEl.style.width = topColW + 'px';
            infoEl.style.height = topH + 'px';
        }
        if (ctrlEl) {
            ctrlEl.style.left = (2 * (topColW + GAP)) + 'px';
            ctrlEl.style.top = '0px';
            ctrlEl.style.width = (W - 2 * (topColW + GAP)) + 'px';
            ctrlEl.style.height = topH + 'px';
        }

        /* Panel labels (convert GL → CSS coords) */
        const setLabel = (id, px) => {
            const el = $(id);
            if (!el) return;
            el.style.left = (px.x + 8) + 'px';
            el.style.top = (H - px.y - px.h + 6) + 'px';
        };
        setLabel('lbl-bev', P.bev);
        setLabel('lbl-m', P.m);
        setLabel('lbl-s1', P.s1);
        setLabel('lbl-s2', P.s2);
        setLabel('lbl-c', P.c);

        /* Horizontal separator between top and bottom rows */
        const sepH = $('sep-h');
        if (sepH) {
            sepH.style.top = (H - botH - GAP) + 'px';
        }

        /* Vertical separators between bottom panels */
        ['sep-v1', 'sep-v2', 'sep-v3'].forEach((id, i) => {
            const el = $(id);
            if (!el) return;
            el.style.left = ((i + 1) * (botColW + GAP) - GAP) + 'px';
            el.style.top = (H - botH) + 'px';
            el.style.height = botH + 'px';
        });

        /* Sync camera aspect to bottom panel shape */
        if (onCameraAspect) onCameraAspect(botColW / botH);
    }

    /** Determine which panel a CSS click lands on */
    function getPanel(cx, cy) {
        const r = $('main-canvas').getBoundingClientRect();
        const x = cx - r.left, y = cy - r.top;
        const H = r.height;
        const glY = H - y;

        for (const [key, p] of Object.entries(P)) {
            if (x >= p.x && x < p.x + p.w && glY >= p.y && glY < p.y + p.h) {
                return key;
            }
        }
        return null;
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
