/**
 * @module radial-blend
 * @description
 * Pure computation for radial blend direction and coverage radius.
 *
 * When blending between two cameras with radial mode, the direction
 * (edges-first vs center-first) and the coverage radius depend on
 * the FOV relationship between the outgoing and incoming cameras.
 *
 * - Radial-IN (1): outgoing has narrower FOV → incoming wider.
 *   Edges transition first; coverRadius = incoming / outgoing nominal.
 * - Radial-OUT (-1): outgoing has wider FOV → incoming narrower.
 *   Center transitions first; coverRadius = outgoing / incoming nominal.
 * - Same FOV: no radial direction (flat blend).
 *
 * Pure module — no DOM, no Three.js. Fully unit-testable.
 */

/**
 * Compute radial blend parameters from camera nominals and current zoom.
 *
 * @param {number} curNom  - incoming (current lead) camera's nominal zoom
 * @param {number} prevNom - outgoing (previous lead) camera's nominal zoom
 * @param {number} z       - current zoom factor
 * @returns {{direction: number, coverRadius: number}}
 *   direction: 1 = edges-first, -1 = center-first, 0 = flat
 *   coverRadius: the narrow-FOV camera's actual coverage fraction in the
 *                output frame at the current zoom. The radial blend boundary
 *                starts at this radius and sweeps toward center (edges-first)
 *                or from center toward this radius (center-first).
 */
export function radialBlendParams(curNom, prevNom, z) {
    if (prevNom > curNom) {
        // Edges-first (e.g. Tele→Main): the outgoing camera (narrow FOV)
        // only covers a fraction of the output. At z=prevNom it covers the
        // full frame; as z decreases, coverage shrinks.
        // coverRadius = z / prevNom (how much of the output the outgoing fills)
        const coverRadius = Math.min(1.0, z / prevNom);
        return { direction: 1, coverRadius };
    }
    if (prevNom < curNom) {
        // Center-first (e.g. Main→Tele): the incoming camera (narrow FOV)
        // only has valid data in a fraction of the output. At z=curNom it
        // covers the full frame; as z increases beyond, coverage shrinks.
        const coverRadius = Math.min(1.0, curNom / z);
        return { direction: -1, coverRadius };
    }
    return { direction: 0, coverRadius: 1.0 };
}
