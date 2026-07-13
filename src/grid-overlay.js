/**
 * @module grid-overlay
 * @description
 * Grid overlay for the Combined view — visualizes how the lead and follower
 * sampling matrices warp source RT pixels into the output frame.
 *
 * When enabled, draws two grids on a transparent 2D canvas positioned
 * over the Combined panel:
 * - **Lead grid** (camera color): shows the sampling grid of the leading camera
 * - **Follower grid** (red): shows the sampling grid of the follower camera
 *
 * The grids are drawn in OUTPUT space: each grid line represents a row/column
 * of the source RT, mapped through inv(M_sampling) into output coordinates.
 * Where the grids overlap = alignment at the focus plane.
 *
 * Also draws a center crosshair and a text label showing lead/follower names.
 */

import { M } from './math.js';
import { SRC } from './zoom-pipeline.js';

const CAM_COLORS = { [SRC.SEC1]: '#81c784', [SRC.MAIN]: '#4fc3f7', [SRC.SEC2]: '#fff176' };
const CAM_NAMES = { [SRC.SEC1]: 'UW', [SRC.MAIN]: 'Main', [SRC.SEC2]: 'Tele' };

/**
 * Create a grid overlay controller.
 *
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas - the overlay canvas element
 * @param {number} opts.rtW - render target width
 * @param {number} opts.rtH - render target height
 * @returns {{update, setEnabled, isEnabled}}
 */
export function createGridOverlay({ canvas, rtW, rtH }) {
    const ctx = canvas.getContext('2d');
    let enabled = false;

    /**
     * Map a source RT pixel through inv(M) to get the output pixel position.
     * M maps output→source, so inv(M) maps source→output.
     */
    function sourceToOutput(invM, srcPx) {
        const p = M.v(invM, [srcPx[0], srcPx[1], 1]);
        if (Math.abs(p[2]) < 1e-10) return null;
        return [p[0] / p[2], p[1] / p[2]];
    }

    /**
     * Draw a sampling grid on the overlay canvas.
     * Grid lines represent rows/columns of the source RT, mapped to output space.
     */
    function drawGrid(invM, color, alpha, cw, ch) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = alpha;

        const steps = 10;
        const sub = 40;

        // Horizontal source lines → output space
        for (let j = 0; j <= steps; j++) {
            const srcY = (j / steps) * rtH;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i <= sub; i++) {
                const srcX = (i / sub) * rtW;
                const out = sourceToOutput(invM, [srcX, srcY]);
                if (!out) continue;
                const cx = (out[0] / rtW) * cw;
                const cy = (out[1] / rtH) * ch;
                if (!started) { ctx.moveTo(cx, cy); started = true; }
                else ctx.lineTo(cx, cy);
            }
            ctx.stroke();
        }

        // Vertical source lines → output space
        for (let i = 0; i <= steps; i++) {
            const srcX = (i / steps) * rtW;
            ctx.beginPath();
            let started = false;
            for (let j = 0; j <= sub; j++) {
                const srcY = (j / sub) * rtH;
                const out = sourceToOutput(invM, [srcX, srcY]);
                if (!out) continue;
                const cx = (out[0] / rtW) * cw;
                const cy = (out[1] / rtH) * ch;
                if (!started) { ctx.moveTo(cx, cy); started = true; }
                else ctx.lineTo(cx, cy);
            }
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Redraw the grid overlay.
     *
     * @param {object} opts
     * @param {number} opts.leadSrc - SRC index of the lead camera
     * @param {number[]} opts.leadM - 9-element lead sampling matrix
     * @param {number} opts.followerSrc - SRC index of the follower
     * @param {number[]} opts.followerM - 9-element follower sampling matrix
     * @param {object} opts.panelRect - {x, y, w, h} of the Combined panel in CSS coords
     */
    function update({ leadSrc, leadM, followerSrc, followerM, panelRect }) {
        if (!enabled || !leadM || !panelRect) {
            canvas.style.display = 'none';
            return;
        }

        // Position canvas over the Combined panel
        const { x, y, w, h } = panelRect;
        canvas.style.display = 'block';
        canvas.style.left = x + 'px';
        canvas.style.top = y + 'px';
        canvas.width = Math.round(w);
        canvas.height = Math.round(h);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';

        const cw = canvas.width, ch = canvas.height;
        ctx.clearRect(0, 0, cw, ch);

        // Compute inverse matrices (source → output mapping)
        const leadInv = M.inv(leadM);
        const folInv = followerM ? M.inv(followerM) : null;

        // Draw follower grid first (behind)
        if (folInv) {
            drawGrid(folInv, '#e94560', 0.4, cw, ch);
        }

        // Draw lead grid on top
        if (leadInv) {
            const color = CAM_COLORS[leadSrc] || '#4fc3f7';
            drawGrid(leadInv, color, 0.6, cw, ch);
        }

        // Center crosshair
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(cw / 2 - 12, ch / 2); ctx.lineTo(cw / 2 + 12, ch / 2);
        ctx.moveTo(cw / 2, ch / 2 - 12); ctx.lineTo(cw / 2, ch / 2 + 12);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Labels (top-right to avoid overlapping the Combined panel label)
        const leadName = CAM_NAMES[leadSrc] || '?';
        const folName = CAM_NAMES[followerSrc] || '?';
        ctx.font = '11px monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = CAM_COLORS[leadSrc] || '#4fc3f7';
        ctx.fillText(`Lead: ${leadName}`, cw - 6, 14);
        ctx.fillStyle = '#e94560';
        ctx.fillText(`Fol: ${folName}`, cw - 6, 28);
        ctx.textAlign = 'left';
    }

    function setEnabled(v) {
        enabled = !!v;
        if (!enabled) canvas.style.display = 'none';
    }

    return {
        update,
        setEnabled,
        isEnabled: () => enabled,
    };
}
