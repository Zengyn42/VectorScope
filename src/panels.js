/**
 * @module panels
 * @description
 * Panel layout manager for VectorScope's two-row viewport.
 *
 * Layout mode `full` (default):
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
 * Layout mode `combined` (focus mode):
 * ```
 * ┌───────────────────────────────┬──────────────┐
 * │                               │  Controls    │
 * │       Combined (centered)     │  (DOM)       │
 * │                               │              │
 * └───────────────────────────────┴──────────────┘
 * ```
 * All other panels collapse to zero-size rects (the render loop skips
 * zero-size panels) and their DOM decorations (labels, borders, info
 * panel, separator) are hidden. The homography HUD and status HUD are
 * `position:fixed` and remain visible in both modes.
 *
 * Canvas-rendered panels: bev, m, s1, s2, c (GL coordinates, y-up)
 * DOM overlay panels: panel-info, panel-controls (CSS positioned by JS)
 *
 * @param {object} opts
 * @param {Function} opts.$ - `getElementById` shorthand
 * @param {number}   opts.RT_W - Render target width (pixels)
 * @param {number}   opts.RT_H - Render target height (pixels)
 * @param {Function} opts.onCameraAspect - Called with panel aspect ratio on layout change
 * @returns {{ P: object, layoutPanels: Function, getPanel: Function, toNDC: Function,
 *             setMode: Function, getMode: Function }}
 */
/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Panels',
    order: 10,
    entries: [
        ['Bird\'s Eye', 'Top-down overview; camera positions shown as colored markers'],
        ['Main / UW / Tele', 'Direct view of each physical camera (1x / 0.5x / 5x)'],
        ['Combined', 'The zoom-pipeline output: one camera\'s frame, warp-sampled per zoom level'],
        ['Combined button', 'Focus mode: hide everything except the Combined view + the controls panel'],
    ],
};

export function createPanelManager({ $, RT_W: initW, RT_H: initH, onCameraAspect }) {
    let RT_W = initW, RT_H = initH;
    const GAP = 2;
    const BOT_GAP = 28;   // buffer between bottom-row camera panels
    const P = { bev: {}, m: {}, s1: {}, s2: {}, c: {} };
    let mode = 'full';    // 'full' | 'combined'

    /* ── shared DOM helpers (GL → CSS coords) ── */
    const setLabel = (id, px, H) => {
        const el = $(id);
        if (!el) return;
        el.style.display = '';
        el.style.left = (px.x + 8) + 'px';
        el.style.top = (H - px.y - px.h + 6) + 'px';
    };
    const setBorder = (id, p, H) => {
        const el = $(id);
        if (!el) return;
        el.style.display = '';
        el.style.left = p.x + 'px';
        el.style.top = (H - p.y - p.h) + 'px';
        el.style.width = p.w + 'px';
        el.style.height = p.h + 'px';
    };
    const hide = (ids) => ids.forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });

    function layoutFull() {
        const r = $('viewport-container').getBoundingClientRect();
        const W = r.width, H = r.height;
        const topH = Math.floor(H * 0.35);
        const botH = H - topH - GAP;
        /* Top row: bird's eye fills the full row height at fixed 16:9,
           the info/controls panels butt up against its right edge */
        let bevH = topH;
        let bevW = Math.floor(bevH * 16 / 9);
        if (bevW > Math.floor(W * 0.5)) {   // don't let BEV eat more than half the width
            bevW = Math.floor(W * 0.5);
            bevH = Math.floor(bevW * 9 / 16);
        }
        P.bev = { x: 0, y: H - bevH, w: bevW, h: bevH };

        /* Bottom row: 4 camera panels, each fixed 9:16 (portrait),
           block left-aligned, anchored to the bottom edge
           (right side stays free for the homography matrix HUD) */
        let pw = Math.min(Math.floor((W - 3 * BOT_GAP) / 4), Math.floor(botH * 9 / 16));
        let ph = Math.floor(pw * 16 / 9);
        if (ph > botH) { ph = botH; pw = Math.floor(ph * 9 / 16); }
        const x0 = 0;
        P.m  = { x: x0,                      y: 0, w: pw, h: ph };
        P.s1 = { x: x0 + (pw + BOT_GAP),     y: 0, w: pw, h: ph };
        P.s2 = { x: x0 + 2 * (pw + BOT_GAP), y: 0, w: pw, h: ph };
        P.c  = { x: x0 + 3 * (pw + BOT_GAP), y: 0, w: pw, h: ph };

        /* Position DOM overlay panels (CSS coords, top-left origin) */
        const infoEl = $('panel-info');
        const ctrlEl = $('panel-controls');
        /* Info + controls split the width remaining right of the BEV */
        const restW = W - bevW - GAP;
        const infoW = Math.floor((restW - GAP) / 2);
        if (infoEl) {
            infoEl.style.display = '';
            infoEl.style.left = (bevW + GAP) + 'px';
            infoEl.style.top = '0px';
            infoEl.style.width = infoW + 'px';
            infoEl.style.height = topH + 'px';
        }
        if (ctrlEl) {
            ctrlEl.style.left = (bevW + GAP + infoW + GAP) + 'px';
            ctrlEl.style.top = '0px';
            ctrlEl.style.width = (W - bevW - infoW - 2 * GAP) + 'px';
            ctrlEl.style.height = topH + 'px';
        }

        /* Panel labels + red borders */
        setLabel('lbl-bev', P.bev, H);
        setLabel('lbl-m', P.m, H);
        setLabel('lbl-s1', P.s1, H);
        setLabel('lbl-s2', P.s2, H);
        setLabel('lbl-c', P.c, H);
        setBorder('bd-bev', P.bev, H);
        setBorder('bd-m', P.m, H);
        setBorder('bd-s1', P.s1, H);
        setBorder('bd-s2', P.s2, H);
        setBorder('bd-c', P.c, H);

        /* Horizontal separator between top and bottom rows */
        const sepH = $('sep-h');
        if (sepH) {
            sepH.style.display = '';
            sepH.style.top = (H - botH - GAP) + 'px';
        }

        /* Vertical separators are replaced by per-panel red borders — hide them */
        hide(['sep-v1', 'sep-v2', 'sep-v3']);

        /* Restore the fixed HUDs to the right edge */
        const hmat = $('hmat'), status = $('status');
        if (hmat) hmat.style.right = '16px';
        if (status) status.style.right = '16px';

        /* Sync camera aspect to bottom panel shape (9:16) */
        if (onCameraAspect) onCameraAspect(pw / ph);
    }

    function layoutCombined() {
        const r = $('viewport-container').getBoundingClientRect();
        const W = r.width, H = r.height;
        const Z = { x: 0, y: 0, w: 0, h: 0 };
        Object.assign(P.bev, Z);
        Object.assign(P.m, Z);
        Object.assign(P.s1, Z);
        Object.assign(P.s2, Z);

        /* Controls panel docks to the right edge, full height */
        const ctrlW = Math.min(360, Math.floor(W * 0.3));
        const ctrlEl = $('panel-controls');
        if (ctrlEl) {
            ctrlEl.style.left = (W - ctrlW) + 'px';
            ctrlEl.style.top = '0px';
            ctrlEl.style.width = ctrlW + 'px';
            ctrlEl.style.height = H + 'px';
        }

        /* Combined panel: 9:16 (RT aspect), centered in the remaining area */
        const MARGIN = 16;
        const availW = W - ctrlW - GAP;
        let ch = H - 2 * MARGIN;
        let cw = Math.floor(ch * RT_W / RT_H);
        if (cw > availW - 2 * MARGIN) {
            cw = availW - 2 * MARGIN;
            ch = Math.floor(cw * RT_H / RT_W);
        }
        P.c = {
            x: Math.max(0, Math.floor((availW - cw) / 2)),
            y: Math.max(0, Math.floor((H - ch) / 2)),
            w: cw, h: ch,
        };

        /* Hide everything that belongs to the collapsed panels */
        hide(['panel-info', 'lbl-bev', 'lbl-m', 'lbl-s1', 'lbl-s2',
              'bd-bev', 'bd-m', 'bd-s1', 'bd-s2',
              'sep-h', 'sep-v1', 'sep-v2', 'sep-v3']);

        setLabel('lbl-c', P.c, H);
        setBorder('bd-c', P.c, H);

        /* The fixed-position HUDs sit at the right edge — shift them left of
           the docked controls panel so they stay readable */
        const hmat = $('hmat'), status = $('status');
        if (hmat) hmat.style.right = (ctrlW + 16) + 'px';
        if (status) status.style.right = (ctrlW + 16) + 'px';

        if (onCameraAspect) onCameraAspect(RT_W / RT_H);
    }

    function layoutPanels() {
        if (mode === 'combined') layoutCombined();
        else layoutFull();
    }

    /** Switch layout mode ('full' | 'combined') and re-layout. */
    function setMode(m) {
        mode = m === 'combined' ? 'combined' : 'full';
        layoutPanels();
    }

    function getMode() { return mode; }

    /** Determine which panel a CSS click lands on (zero-size panels never match) */
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

    /** Update the render target dimensions (called when aspect ratio changes). */
    function setRT(w, h) { RT_W = w; RT_H = h; }

    return { P, layoutPanels, getPanel, toNDC, setMode, getMode, setRT };
}
