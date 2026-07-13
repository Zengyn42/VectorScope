/**
 * @module bezier-curve
 * @description
 * Cubic bezier curve evaluation for easing/remapping.
 *
 * A curve is defined by 4 control points in 2D: P1, P2, P3, P4.
 * - P1 and P4 are the range endpoints (user-adjustable)
 * - P2 and P3 define the tangent strength and shape
 *
 * Evaluation:
 * - input < P1.x → 0
 * - input > P4.x → 1
 * - P1.x ≤ input ≤ P4.x → cubic bezier interpolation (y output)
 *
 * The curve is parametric: B(t) = (1-t)³P1 + 3(1-t)²tP2 + 3(1-t)t²P3 + t³P4
 * To map x → y: solve Bx(t) = x via Newton's method, return By(t).
 *
 * Pure module — no DOM. Fully unit-testable.
 */

/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Curve Editor',
    order: 42,
    entries: [
        ['Zoom Curve (\u2035 next to Go)', 'Controls the easing of zoom transitions when clicking Go preset buttons (0.5x, 1.0x, etc.). Replaces the default ease-in-out'],
        ['Warp Curve (\u2035 next to Warp)', 'Controls how fast the homography interpolation progresses within a warp segment (Identity \u2192 computed H)'],
        ['P1 / P4 (squares)', 'Range endpoints — the curve only applies between P1.x and P4.x. Below P1.x \u2192 output 0, above P4.x \u2192 output 1'],
        ['P2 / P3 (circles)', 'Tangent handles — control the curve shape and acceleration. Drag to create ease-in, ease-out, or S-curves'],
        ['Duration (zoom only)', 'Time in milliseconds for the zoom transition. Default: 600ms'],
        ['Reset Linear', 'Restores the default linear curve (no easing). For zoom, reverts to the built-in easeInOutQuad'],
    ],
};

/**
 * Default curve: linear from (0,0) to (1,1).
 */
export const DEFAULT_CURVE = {
    p1: { x: 0, y: 0 },
    p2: { x: 0.33, y: 0.33 },
    p3: { x: 0.67, y: 0.67 },
    p4: { x: 1, y: 1 },
};

/**
 * Evaluate cubic bezier at parameter t for one axis.
 * @param {number} t - parameter in [0, 1]
 * @param {number} v0 - P1 value
 * @param {number} v1 - P2 value
 * @param {number} v2 - P3 value
 * @param {number} v3 - P4 value
 * @returns {number}
 */
export function bezierAt(t, v0, v1, v2, v3) {
    const u = 1 - t;
    return u * u * u * v0 + 3 * u * u * t * v1 + 3 * u * t * t * v2 + t * t * t * v3;
}

/**
 * Derivative of cubic bezier at parameter t for one axis.
 * @param {number} t
 * @param {number} v0 - P1 value
 * @param {number} v1 - P2 value
 * @param {number} v2 - P3 value
 * @param {number} v3 - P4 value
 * @returns {number}
 */
export function bezierDerivAt(t, v0, v1, v2, v3) {
    const u = 1 - t;
    return 3 * u * u * (v1 - v0) + 6 * u * t * (v2 - v1) + 3 * t * t * (v3 - v2);
}

/**
 * Solve for t given target x value using Newton's method.
 * @param {number} x - target x
 * @param {number} x0 - P1.x
 * @param {number} x1 - P2.x
 * @param {number} x2 - P3.x
 * @param {number} x3 - P4.x
 * @returns {number} t in [0, 1]
 */
export function solveBezierT(x, x0, x1, x2, x3) {
    // Initial guess: linear approximation
    const range = x3 - x0;
    if (Math.abs(range) < 1e-10) return 0.5;
    let t = (x - x0) / range;
    t = Math.max(0, Math.min(1, t));

    // Newton iterations
    for (let i = 0; i < 12; i++) {
        const cx = bezierAt(t, x0, x1, x2, x3) - x;
        if (Math.abs(cx) < 1e-8) break;
        const dx = bezierDerivAt(t, x0, x1, x2, x3);
        if (Math.abs(dx) < 1e-10) break;
        t -= cx / dx;
        t = Math.max(0, Math.min(1, t));
    }
    return t;
}

/**
 * Evaluate the bezier curve: map input x → output y.
 *
 * - x < P1.x → 0
 * - x > P4.x → 1
 * - P1.x ≤ x ≤ P4.x → bezier interpolation
 *
 * @param {number} x - input value
 * @param {object} curve - {p1, p2, p3, p4} each with {x, y}
 * @returns {number} output y value
 */
export function evalCurve(x, curve) {
    const { p1, p2, p3, p4 } = curve;
    if (x <= p1.x) return 0;
    if (x >= p4.x) return 1;
    const t = solveBezierT(x, p1.x, p2.x, p3.x, p4.x);
    return bezierAt(t, p1.y, p2.y, p3.y, p4.y);
}

/**
 * Sample the curve at N uniform x steps (for rendering the curve path).
 * @param {object} curve - {p1, p2, p3, p4}
 * @param {number} [n=64] - number of samples
 * @returns {Array<{x: number, y: number}>} sampled points
 */
export function sampleCurve(curve, n = 64) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push({
            x: bezierAt(t, curve.p1.x, curve.p2.x, curve.p3.x, curve.p4.x),
            y: bezierAt(t, curve.p1.y, curve.p2.y, curve.p3.y, curve.p4.y),
        });
    }
    return pts;
}
