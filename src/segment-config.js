/**
 * @module segment-config
 * @description
 * Configurable zoom-segment → lead/follower camera mapping.
 *
 * The default mapping matches the hardcoded rules in zoom-pipeline.js:
 * | Zoom range   | Lead  | Follower |
 * |--------------|-------|----------|
 * | [0.5, 1.0)   | UW    | Main     |
 * | [1.0, 2.0)   | Main  | UW       |
 * | [2.0, 5.0)   | Main  | Tele     |
 * | [5.0, 10.0]  | Tele  | Main     |
 *
 * Users can reconfigure via the Segment Config dialog — e.g. swap lead/follower
 * for a segment, or change boundary zoom values.
 *
 * Pure module — no DOM, no Three.js. Fully unit-testable.
 */

import { SRC } from './zoom-pipeline.js';

/** Camera name ↔ SRC index helpers */
export const CAM_NAMES = ['UW', 'Main', 'Tele'];
export function camName(src) { return CAM_NAMES[src] || '?'; }
export function camIndex(name) {
    const i = CAM_NAMES.indexOf(name);
    return i >= 0 ? i : SRC.MAIN;
}

/**
 * Default segment definitions.
 * Each segment: { from, to, lead, follower }
 * - from/to: zoom boundaries (inclusive/exclusive per convention)
 * - lead/follower: SRC.* indices
 */
export const DEFAULT_SEGMENTS = [
    { from: 0.5, to: 1.0, lead: SRC.SEC1, follower: SRC.MAIN },
    { from: 1.0, to: 2.0, lead: SRC.MAIN, follower: SRC.SEC1 },
    { from: 2.0, to: 5.0, lead: SRC.MAIN, follower: SRC.SEC2 },
    { from: 5.0, to: 10.0, lead: SRC.SEC2, follower: SRC.MAIN },
];

/**
 * Create a segment config instance with lookup methods.
 * @param {Array} [segments] - initial segments (deep-cloned)
 */
export function createSegmentConfig(segments) {
    let segs = JSON.parse(JSON.stringify(segments || DEFAULT_SEGMENTS));

    /**
     * Find the segment containing zoom z.
     * Convention: lower bound inclusive, upper exclusive (except last segment).
     */
    function findSegment(z) {
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            if (i === segs.length - 1) {
                // Last segment: upper bound inclusive
                if (z >= s.from && z <= s.to) return s;
            } else {
                if (z >= s.from && z < s.to) return s;
            }
        }
        // Fallback: clamp to nearest
        return z < segs[0].from ? segs[0] : segs[segs.length - 1];
    }

    return {
        /** Get the leading camera SRC for a given zoom */
        getLeadSource(z, hasS2) {
            const seg = findSegment(z);
            const src = seg.lead;
            return (src === SRC.SEC2 && !hasS2) ? SRC.MAIN : src;
        },

        /** Get the follower camera SRC for a given zoom */
        getFollowerSource(z, hasS2) {
            const seg = findSegment(z);
            const src = seg.follower;
            return (src === SRC.SEC2 && !hasS2) ? SRC.MAIN : src;
        },

        /** Get all segments (deep copy) */
        getSegments() { return JSON.parse(JSON.stringify(segs)); },

        /** Replace all segments */
        setSegments(newSegs) { segs = JSON.parse(JSON.stringify(newSegs)); },

        /** Serialize for config store */
        serialize() { return JSON.parse(JSON.stringify(segs)); },

        /** Restore from serialized data */
        restore(data) {
            if (Array.isArray(data) && data.length > 0) {
                segs = JSON.parse(JSON.stringify(data));
            }
        },
    };
}
