/**
 * @module bev-planes
 * @description
 * Pure-function configuration for the three BEV view planes.
 * No DOM, no THREE.js — safe to unit-test in Node.js.
 *
 * Planes:
 *   xz  — top-down  (camera from +Y, screen right=+X, screen down=+Z)
 *   xy  — front     (camera from +Z, screen right=+X, screen up=+Y)
 *   zy  — side      (camera from −X, screen right=+Z, screen up=+Y)
 *
 * Each definition carries:
 *   ghostAxis    — which box axis to compare for BEV ghost clipping ('x'|'y'|'z')
 *   ghostLabel   — display name shown on the Ghost slider ('X'|'Y'|'Z')
 *   compass      — two { label, color, dx, dy } descriptors for the 2D compass
 *                  (dx/dy in canvas coords: right=+1, DOWN=+1)
 *   bevCamDir    — unit vector pointing FROM view center TO BEV camera position
 *   bevCamUp     — camera up vector; null = use the Three.js default (degenerate handled)
 *   worldPan(dr, dd, s)  — converts screen pixel drag (right=+dr, down=+dd, scale=s)
 *                           to { x, y, z } world offset to ADD to camera position
 *   dragNormal   — { x, y, z } plane normal for BEV object-drag intersection
 *   centerOf(mainPos, fwdXZ, size)  — returns { cx, cy, cz } BEV view center (no pan)
 *   projectWorld(wx, wy, wz)  — project a world vector to { u, v } screen coordinates
 *                               u > 0 = screen right, v > 0 = screen DOWN
 */

export const BEV_PLANE_ORDER = ['xz', 'xy', 'zy'];

export const BEV_PLANE_DEFS = {
    /** Top-down view: camera from +Y, looking down -Y. */
    xz: {
        ghostAxis: 'y',
        ghostLabel: 'Y',
        compass: [
            { label: '+X', color: '#e94560', dx:  1, dy:  0 },   // screen right
            { label: '+Z', color: '#4ea8de', dx:  0, dy:  1 },   // screen down
        ],
        bevCamDir:  { x: 0, y: 1, z: 0 },
        bevCamUp:   null,
        worldPan:   (dr, dd, s) => ({ x: -dr * s, y: 0,       z: -dd * s }),
        dragNormal: { x: 0, y: 1, z: 0 },
        centerOf(mainPos, fwdXZ, size) {
            return {
                cx: mainPos.x + fwdXZ.x * size * 0.4,
                cy: 0,
                cz: mainPos.z + fwdXZ.z * size * 0.4,
            };
        },
        projectWorld(wx, wy, wz) { return { u: wx, v: wz }; },
    },

    /** Front view: camera from +Z, looking along -Z. */
    xy: {
        ghostAxis: 'z',
        ghostLabel: 'Z',
        compass: [
            { label: '+X', color: '#e94560', dx:  1, dy:  0 },   // screen right
            { label: '+Y', color: '#4ea8de', dx:  0, dy: -1 },   // screen UP
        ],
        bevCamDir:  { x: 0, y: 0, z: 1 },
        bevCamUp:   [0, 1, 0],
        worldPan:   (dr, dd, s) => ({ x: -dr * s, y: dd * s,  z: 0 }),
        dragNormal: { x: 0, y: 0, z: 1 },
        centerOf(mainPos) {
            return { cx: mainPos.x, cy: mainPos.y, cz: 0 };
        },
        projectWorld(wx, wy, wz) { return { u: wx, v: -wy }; },
    },

    /** Side view: camera from −X, looking along +X. */
    zy: {
        ghostAxis: 'x',
        ghostLabel: 'X',
        compass: [
            { label: '+Z', color: '#e94560', dx:  1, dy:  0 },   // screen right
            { label: '+Y', color: '#4ea8de', dx:  0, dy: -1 },   // screen UP
        ],
        bevCamDir:  { x: -1, y: 0, z: 0 },
        bevCamUp:   [0, 1, 0],
        worldPan:   (dr, dd, s) => ({ x: 0,       y: dd * s,  z: -dr * s }),
        dragNormal: { x: 1, y: 0, z: 0 },
        centerOf(mainPos) {
            return { cx: 0, cy: mainPos.y, cz: mainPos.z };
        },
        projectWorld(wx, wy, wz) { return { u: wz, v: -wy }; },
    },
};

/**
 * Cycle to the next BEV plane in order xz → xy → zy → xz.
 * @param {string} current
 * @returns {string}
 */
export function nextBevPlane(current) {
    const idx = BEV_PLANE_ORDER.indexOf(current);
    return BEV_PLANE_ORDER[(idx + 1) % BEV_PLANE_ORDER.length];
}

/**
 * Get the plane definition (falls back to xz on unknown key).
 * @param {string} name
 * @returns {object}
 */
export function getBevPlaneDef(name) {
    return BEV_PLANE_DEFS[name] || BEV_PLANE_DEFS.xz;
}
