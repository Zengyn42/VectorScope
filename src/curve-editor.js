/**
 * @module curve-editor
 * @description
 * Graphical bezier curve editor — Photoshop-style curve panel.
 *
 * A canvas shows the curve from P1 to P4. The user drags 4 control points:
 * - P1 (square): start point — below P1.x, output = 0
 * - P2 (circle): first control handle — tangent at P1
 * - P3 (circle): second control handle — tangent at P4
 * - P4 (square): end point — above P4.x, output = 1
 *
 * The canvas coordinate system:
 * - X axis: input (0 → 1), left to right
 * - Y axis: output (0 → 1), bottom to top
 *
 * Requires: src/bezier-curve.js for sampleCurve().
 */

import { sampleCurve, DEFAULT_CURVE } from './bezier-curve.js';

const SIZE = 200;      // canvas pixel size
const PAD = 16;        // padding around the plot area
const PLOT = SIZE - 2 * PAD;
const HIT = 10;        // hit radius for point dragging

/**
 * Convert curve-space (0..1) to canvas pixel coords.
 */
function toCanvas(pt) {
    return { cx: PAD + pt.x * PLOT, cy: PAD + (1 - pt.y) * PLOT };
}

/**
 * Convert canvas pixel coords to curve-space (0..1).
 */
function fromCanvas(cx, cy) {
    return {
        x: Math.max(0, Math.min(1, (cx - PAD) / PLOT)),
        y: Math.max(0, Math.min(1, 1 - (cy - PAD) / PLOT)),
    };
}

/**
 * Draw the curve editor onto a canvas context.
 */
function draw(ctx, curve) {
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Background
    ctx.fillStyle = '#0a0f1e';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Grid
    ctx.strokeStyle = '#1a2040';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const v = PAD + (i / 4) * PLOT;
        ctx.beginPath(); ctx.moveTo(v, PAD); ctx.lineTo(v, PAD + PLOT); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(PAD, v); ctx.lineTo(PAD + PLOT, v); ctx.stroke();
    }

    // Diagonal reference (linear)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD, PAD + PLOT);
    ctx.lineTo(PAD + PLOT, PAD);
    ctx.stroke();
    ctx.setLineDash([]);

    // Clamp regions (dimmed)
    const p1c = toCanvas(curve.p1);
    const p4c = toCanvas(curve.p4);

    // Below P1: output = 0
    if (curve.p1.x > 0.01) {
        ctx.fillStyle = 'rgba(233,69,96,0.06)';
        ctx.fillRect(PAD, PAD, p1c.cx - PAD, PLOT);
    }
    // Above P4: output = 1
    if (curve.p4.x < 0.99) {
        ctx.fillStyle = 'rgba(79,195,247,0.06)';
        ctx.fillRect(p4c.cx, PAD, PAD + PLOT - p4c.cx, PLOT);
    }

    // Control handles (lines from P1→P2, P3→P4)
    const p2c = toCanvas(curve.p2);
    const p3c = toCanvas(curve.p3);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p1c.cx, p1c.cy); ctx.lineTo(p2c.cx, p2c.cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p4c.cx, p4c.cy); ctx.lineTo(p3c.cx, p3c.cy); ctx.stroke();

    // Curve path
    const pts = sampleCurve(curve, 80);
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Flat region before P1 (y=0)
    ctx.moveTo(PAD, PAD + PLOT);
    const first = toCanvas(pts[0]);
    ctx.lineTo(first.cx, PAD + PLOT);
    // Curve itself
    for (const p of pts) {
        const c = toCanvas(p);
        ctx.lineTo(c.cx, c.cy);
    }
    // Flat region after P4 (y=1)
    const last = toCanvas(pts[pts.length - 1]);
    ctx.lineTo(last.cx, PAD);
    ctx.lineTo(PAD + PLOT, PAD);
    ctx.stroke();

    // Control points
    function drawPt(pt, isEndpoint) {
        const c = toCanvas(pt);
        ctx.fillStyle = isEndpoint ? '#4fc3f7' : '#fff';
        if (isEndpoint) {
            // Square
            ctx.fillRect(c.cx - 4, c.cy - 4, 8, 8);
            ctx.strokeStyle = '#4fc3f7';
            ctx.strokeRect(c.cx - 4, c.cy - 4, 8, 8);
        } else {
            // Circle
            ctx.beginPath();
            ctx.arc(c.cx, c.cy, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#aaa';
            ctx.stroke();
        }
    }
    drawPt(curve.p1, true);
    drawPt(curve.p2, false);
    drawPt(curve.p3, false);
    drawPt(curve.p4, true);

    // Axis labels
    ctx.fillStyle = '#666';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('0', PAD, PAD + PLOT + 12);
    ctx.fillText('1', PAD + PLOT, PAD + PLOT + 12);
    ctx.textAlign = 'right';
    ctx.fillText('0', PAD - 4, PAD + PLOT + 3);
    ctx.fillText('1', PAD - 4, PAD + 3);
}

/**
 * Create and bind a curve editor inside a container element.
 *
 * @param {HTMLElement} container - DOM element to host the canvas + value labels
 * @param {object} opts
 * @param {object} opts.curve - initial curve {p1, p2, p3, p4}
 * @param {Function} opts.onChange - called with updated curve on every drag
 * @returns {{getCurve, setCurve, canvas}}
 */
export function createCurveEditor(container, { curve: initCurve, onChange }) {
    let curve = JSON.parse(JSON.stringify(initCurve || DEFAULT_CURVE));

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.style.cssText = 'cursor:crosshair;border:1px solid #333;border-radius:4px;';
    container.appendChild(canvas);

    // Value display
    const info = document.createElement('div');
    info.style.cssText = 'font:10px monospace;color:#888;margin-top:4px;line-height:1.5;';
    container.appendChild(info);

    const ctx = canvas.getContext('2d');
    const pointKeys = ['p1', 'p2', 'p3', 'p4'];

    function updateInfo() {
        info.innerHTML = pointKeys.map(k => {
            const p = curve[k];
            return `<span style="color:${k === 'p1' || k === 'p4' ? '#4fc3f7' : '#ccc'}">${k.toUpperCase()}</span>=(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;
        }).join('&ensp;');
    }

    function redraw() { draw(ctx, curve); updateInfo(); }

    // Drag handling
    let dragKey = null;

    function hitTest(cx, cy) {
        for (const k of pointKeys) {
            const c = toCanvas(curve[k]);
            if (Math.abs(cx - c.cx) < HIT && Math.abs(cy - c.cy) < HIT) return k;
        }
        return null;
    }

    canvas.addEventListener('pointerdown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (SIZE / rect.width);
        const cy = (e.clientY - rect.top) * (SIZE / rect.height);
        dragKey = hitTest(cx, cy);
        if (dragKey) {
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!dragKey) return;
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (SIZE / rect.width);
        const cy = (e.clientY - rect.top) * (SIZE / rect.height);
        const pt = fromCanvas(cx, cy);
        curve[dragKey] = pt;
        // Enforce P1.x <= P4.x
        if (dragKey === 'p1' && curve.p1.x > curve.p4.x) curve.p1.x = curve.p4.x;
        if (dragKey === 'p4' && curve.p4.x < curve.p1.x) curve.p4.x = curve.p1.x;
        redraw();
        if (onChange) onChange(JSON.parse(JSON.stringify(curve)));
        e.preventDefault();
    });

    canvas.addEventListener('pointerup', () => { dragKey = null; });

    redraw();

    return {
        getCurve() { return JSON.parse(JSON.stringify(curve)); },
        setCurve(c) {
            curve = JSON.parse(JSON.stringify(c));
            redraw();
        },
        canvas,
    };
}
