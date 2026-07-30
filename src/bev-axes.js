/**
 * @module bev-axes
 * @description
 * 2D canvas overlay that draws two coordinate-axis compasses over the BEV panel:
 *
 * **Scene compass** (bottom-left, clickable):
 *   Shows the BEV plane's world-axis orientation in screen space.
 *   Each plane has two labelled arrows defined by `BEV_PLANE_DEFS[plane].compass`.
 *   Clicking cycles to the next BEV plane.
 *   Label: "scene".
 *
 * **Rig compass** (bottom-right, read-only):
 *   Shows the camera rig's own X and Y axes projected onto the current BEV plane.
 *   A near-zero projection (axis is perpendicular to the view) draws as a dot + stub.
 *   Label: "camera rig".
 *
 * Call `update(bevPanel, planeDef, rigAxes)` once per frame (or on resize).
 * `rigAxes` is `{ xAxis: THREE.Vector3, yAxis: THREE.Vector3 }` in world space.
 */

/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'BEV Axes',
    order: 15,
    text: 'Two coordinate compasses shown in the Bird\'s Eye view. Click the left (scene) compass to cycle the view plane.',
    entries: [
        ['Scene compass (bottom-left)', 'World axes for the current BEV plane; click to cycle xz → xy → zy → xz'],
        ['Rig compass (bottom-right)', 'Camera rig\'s own X (red) and Y (blue) axes projected onto the current view'],
    ],
};

/** Draw one compass indicator onto a 2D canvas context.
 *  @param {CanvasRenderingContext2D} ctx
 *  @param {Array<{label,color,dx,dy}>} arrows - up to 2 arrow descriptors
 *  @param {string} footerLabel - small label drawn below the compass
 *  @param {number} SIZE - canvas width/height (square)
 */
function drawCompass(ctx, arrows, footerLabel, SIZE) {
    const LEN = 40;         // arrow length in canvas px
    const OX = 18;          // origin X
    const OY = 18;          // origin Y (top of canvas)

    ctx.clearRect(0, 0, SIZE, SIZE);

    for (const { label, color, dx, dy } of arrows) {
        const mag = Math.sqrt(dx * dx + dy * dy);
        const DOT_THRESHOLD = 0.08;  // treat as near-zero if magnitude below this

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle   = color;
        ctx.lineWidth   = 2.5;

        if (mag < DOT_THRESHOLD) {
            /* Near-zero projection: axis points into/out of the view plane.
               Draw a circle (dot) with a short stub below to indicate depth. */
            ctx.beginPath();
            ctx.arc(OX, OY, 5, 0, Math.PI * 2);
            ctx.stroke();
            // Stub pointing down-right to suggest "going into the screen"
            ctx.beginPath();
            ctx.moveTo(OX, OY);
            ctx.lineTo(OX + 6, OY + 6);
            ctx.stroke();
        } else {
            /* Normalise so arrow is always LEN px long regardless of projection mag. */
            const nx = (dx / mag) * LEN;
            const ny = (dy / mag) * LEN;
            const tipX = OX + nx;
            const tipY = OY + ny;

            // Shaft
            ctx.beginPath();
            ctx.moveTo(OX, OY);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();

            // Arrowhead (perpendicular to shaft, 8px side)
            const perp = { x: -ny / LEN * 5, y: nx / LEN * 5 };
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - nx / LEN * 8 + perp.x, tipY - ny / LEN * 8 + perp.y);
            ctx.lineTo(tipX - nx / LEN * 8 - perp.x, tipY - ny / LEN * 8 - perp.y);
            ctx.closePath();
            ctx.fill();

            // Label — offset perpendicular to arrow so it doesn't overlap
            ctx.font = 'bold 11px monospace';
            // Perpendicular offset for label placement
            const lox = -(ny / LEN) * 14 + (nx / LEN) * 4;
            const loy =  (nx / LEN) * 14 + (ny / LEN) * 4;
            ctx.fillText(label, tipX + lox, tipY + loy);
        }
        ctx.restore();
    }

    // Origin dot
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(OX, OY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Footer label (bottom of canvas)
    ctx.save();
    ctx.fillStyle = '#888888';
    ctx.font = '9px sans-serif';
    ctx.fillText(footerLabel, 2, SIZE - 3);
    ctx.restore();
}

/**
 * Create the dual BEV axes overlay.
 * @returns {{ update: Function, remove: Function, onPlaneSwitch: Function }}
 */
export function createBevAxes() {
    const SIZE = 80;    // px — bounding box of each compass indicator
    const MARGIN = 8;   // px — gap from BEV panel edge

    /* Scene compass (bottom-left): plane-aware, clickable to cycle planes. */
    const sceneCanvas = document.createElement('canvas');
    sceneCanvas.id = 'bev-axes-scene';
    sceneCanvas.width  = SIZE;
    sceneCanvas.height = SIZE;
    sceneCanvas.style.cssText = 'position:absolute;z-index:5;cursor:pointer;';
    sceneCanvas.title = 'Click to cycle BEV plane';
    document.body.appendChild(sceneCanvas);

    /* Rig compass (bottom-right): read-only, shows rig orientation. */
    const rigCanvas = document.createElement('canvas');
    rigCanvas.id = 'bev-axes-rig';
    rigCanvas.width  = SIZE;
    rigCanvas.height = SIZE;
    rigCanvas.style.cssText = 'position:absolute;pointer-events:none;z-index:5;';
    document.body.appendChild(rigCanvas);

    /**
     * Update both overlay positions and redraw.
     * @param {object|null} bevPanel - P.bev rect: { x, y, w, h } (WebGL coords, Y from bottom)
     * @param {object|null} planeDef - current BEV_PLANE_DEFS entry
     * @param {{xAxis,yAxis}|null} rigAxes - rig world X and Y axes (THREE.Vector3)
     */
    function update(bevPanel, planeDef, rigAxes) {
        if (!bevPanel || bevPanel.w <= 0) {
            sceneCanvas.style.display = 'none';
            rigCanvas.style.display   = 'none';
            return;
        }

        // Convert WebGL Y-from-bottom to CSS Y-from-top
        const htmlTop = window.innerHeight - (bevPanel.y + bevPanel.h);

        sceneCanvas.style.display = '';
        rigCanvas.style.display   = '';

        // Scene compass: bottom-left
        sceneCanvas.style.left = (bevPanel.x + MARGIN) + 'px';
        sceneCanvas.style.top  = (htmlTop + bevPanel.h - SIZE - MARGIN) + 'px';

        // Rig compass: bottom-right
        rigCanvas.style.left = (bevPanel.x + bevPanel.w - SIZE - MARGIN) + 'px';
        rigCanvas.style.top  = (htmlTop + bevPanel.h - SIZE - MARGIN) + 'px';

        // ── Scene compass ──
        const sceneCtx = sceneCanvas.getContext('2d');
        const arrows = planeDef ? planeDef.compass : [
            { label: '+X', color: '#e94560', dx: 1, dy: 0 },
            { label: '+Z', color: '#4ea8de', dx: 0, dy: 1 },
        ];
        drawCompass(sceneCtx, arrows, 'scene', SIZE);

        // ── Rig compass ──
        const rigCtx = rigCanvas.getContext('2d');
        if (rigAxes && planeDef) {
            const { xAxis, yAxis } = rigAxes;
            const px = planeDef.projectWorld(xAxis.x, xAxis.y, xAxis.z);  // { u, v }
            const py = planeDef.projectWorld(yAxis.x, yAxis.y, yAxis.z);
            drawCompass(rigCtx, [
                { label: 'X', color: '#e94560', dx: px.u, dy: px.v },
                { label: 'Y', color: '#4ea8de', dx: py.u, dy: py.v },
            ], 'camera rig', SIZE);
        } else {
            rigCtx.clearRect(0, 0, SIZE, SIZE);
        }
    }

    /** Register a callback for plane-switch clicks on the scene compass. */
    function onPlaneSwitch(cb) {
        sceneCanvas.addEventListener('click', cb);
    }

    /** Remove both canvases from the DOM. */
    function remove() {
        sceneCanvas.remove();
        rigCanvas.remove();
    }

    return { update, remove, onPlaneSwitch };
}
