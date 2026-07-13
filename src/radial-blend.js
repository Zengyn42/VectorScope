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
 * Compute radial blend parameters from camera nominals.
 *
 * @param {number} curNom  - incoming (current lead) camera's nominal zoom
 * @param {number} prevNom - outgoing (previous lead) camera's nominal zoom
 * @returns {{direction: number, coverRadius: number}}
 *   direction: 1 = radial-in, -1 = radial-out, 0 = flat
 *   coverRadius: radius fraction for the shader's uCoverRadius uniform
 */
export function radialBlendParams(curNom, prevNom) {
    // Coverage radius is always 1.0 — the radial effect spans the full frame.
    // When warp is ON, the follower matrix aligns both cameras' images to
    // cover the full output. The shader's per-pixel OOB guard handles any
    // actual out-of-bounds sampling (no black edges). The direction alone
    // determines the visual effect (edges-first vs center-first).
    if (prevNom > curNom) {
        // Outgoing narrower FOV → incoming wider: radial-IN (edges first)
        return { direction: 1, coverRadius: 1.0 };
    }
    if (prevNom < curNom) {
        // Outgoing wider FOV → incoming narrower: radial-OUT (center first)
        return { direction: -1, coverRadius: 0.5 };
    }
    return { direction: 0, coverRadius: 1.0 };
}
