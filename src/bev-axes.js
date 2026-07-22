/**
 * @module bev-axes
 * @description
 * 2D canvas overlay that draws a small coordinate-axis compass in the
 * bottom-left corner of the BEV panel, showing the world XZ orientation.
 *
 * BEV looks straight down (-Y), so the ground plane maps to screen space:
 *   screen right  →  world  +X
 *   screen down   →  world  +Z  (Three.js right-hand Y-up: looking down -Y
 *                                 means -Z is away from viewer, +Z is toward)
 *
 * The overlay canvas is absolutely positioned over the BEV panel.
 * It must be updated each frame (or on resize) via `update(bevPanel)`.
 */

/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'BEV Axes',
    order: 15,
    text: 'Small coordinate compass shown in the bottom-left of the Bird\'s Eye view.',
    entries: [
        ['+X (red)', 'World +X axis — screen right'],
        ['+Z (blue)', 'World +Z axis — screen down'],
    ],
};

/**
 * Create the BEV axes overlay.
 * @returns {{ update: Function, remove: Function }}
 */
export function createBevAxes() {
    const canvas = document.createElement('canvas');
    canvas.id = 'bev-axes';
    canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:5;';
    document.body.appendChild(canvas);

    const SIZE = 80;   // px — bounding box of the axis indicator
    const MARGIN = 8;  // px — gap from BEV panel edge
    const LEN = 48;    // arrow length in canvas pixels
    const CX = 16;     // origin dot X in canvas coords (near left)
    const CY = 16;     // origin dot Y in canvas coords (near top)

    /**
     * Update the overlay position and redraw axes.
     * @param {object|null} bevPanel - P.bev rect in WebGL coords
     *        { x, y, w, h } where y is from the bottom of the viewport
     */
    function update(bevPanel) {
        if (!bevPanel || bevPanel.w <= 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = '';

        // Convert WebGL coords (Y from bottom) to CSS coords (Y from top)
        const htmlTop = window.innerHeight - (bevPanel.y + bevPanel.h);

        canvas.width  = SIZE;
        canvas.height = SIZE;
        canvas.style.left   = (bevPanel.x + MARGIN) + 'px';
        canvas.style.top    = (htmlTop + bevPanel.h - SIZE - MARGIN) + 'px';

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, SIZE, SIZE);

        // ── +X axis (red) → screen right ──
        ctx.save();
        ctx.strokeStyle = '#e94560';
        ctx.fillStyle   = '#e94560';
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.lineTo(CX + LEN, CY);
        ctx.stroke();
        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(CX + LEN, CY);
        ctx.lineTo(CX + LEN - 8, CY - 5);
        ctx.lineTo(CX + LEN - 8, CY + 5);
        ctx.closePath();
        ctx.fill();
        // Label — below the arrow tip
        ctx.font = 'bold 13px monospace';
        ctx.fillText('+X', CX + LEN - 10, CY + 18);
        ctx.restore();

        // ── +Z axis (blue) → screen down ──
        ctx.save();
        ctx.strokeStyle = '#4ea8de';
        ctx.fillStyle   = '#4ea8de';
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.lineTo(CX, CY + LEN);
        ctx.stroke();
        // Arrowhead (pointing down)
        ctx.beginPath();
        ctx.moveTo(CX, CY + LEN);
        ctx.lineTo(CX - 5, CY + LEN - 8);
        ctx.lineTo(CX + 5, CY + LEN - 8);
        ctx.closePath();
        ctx.fill();
        // Label — to the right of the arrow tip
        ctx.font = 'bold 13px monospace';
        ctx.fillText('+Z', CX + 7, CY + LEN + 4);
        ctx.restore();

        // ── Origin dot (white) ──
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(CX, CY, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    /** Remove the canvas from the DOM. */
    function remove() {
        canvas.remove();
    }

    return { update, remove };
}
