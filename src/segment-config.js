/**
 * @module segment-config
 * @description
 * Configurable zoom-segment → lead/follower camera mapping using a
 * **breakpoint model**.
 *
 * Users place breakpoints (zoom values) that split the fixed total range
 * [0.5, 10.0] into segments. Each segment gets a lead and follower camera
 * assignment. Breakpoints use strict-less-than convention:
 *   - Below a breakpoint: zoom < breakpoint
 *   - At and above: zoom >= breakpoint
 *
 * Example with breakpoints [1.0, 5.0]:
 *   | Segment          | Convention | Lead | Follower |
 *   |------------------|------------|------|----------|
 *   | [0.5, 1.0)       | z < 1.0    | UW   | Main     |
 *   | [1.0, 5.0)       | z >= 1.0   | Main | UW       |
 *   | [5.0, 10.0]      | z >= 5.0   | Tele | Main     |
 *
 * Pure module — no DOM, no Three.js. Fully unit-testable.
 */

import { SRC } from './zoom-pipeline.js';
import { camDisplayName, camColor } from './camera.js';

/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Segment Config',
    order: 31,
    entries: [
        ['Segments button (Seg)', 'Opens the segment config dialog — configure which camera leads and follows for each zoom range'],
        ['Breakpoints', 'Zoom values that divide the [0.5, 10.0] range into segments. Default: 1.0, 2.0, 5.0'],
        ['Convention', 'Below a breakpoint: z &lt; value. At/above: z &ge; value'],
        ['Lead camera', 'The camera displayed in the Combined view at that zoom range'],
        ['Follower camera', 'Used only during blending transitions at segment boundaries'],
        ['Add breakpoint', 'Splits a segment; new segment inherits the parent\'s lead/follower'],
        ['Reset', 'Restores default breakpoints [1.0, 2.0, 5.0] and assignments'],
    ],
};

/** Camera name ↔ SRC index helpers (delegates to camera.js for colors/names) */
export const CAM_NAMES = ['UW', 'Main', 'Tele'];
export function camName(src) { return camDisplayName(src); }
export function camIndex(name) {
    const i = CAM_NAMES.indexOf(name);
    return i >= 0 ? i : SRC.MAIN;
}

/**
 * Generate the Combined view label text and color for a given zoom.
 *
 * Uses segment config to determine lead/follower names. The label shows
 * "Lead→Follower" when warp is active, or just "Lead" when not.
 * Color matches the leading camera's panel label color.
 *
 * @param {number} z - current zoom factor
 * @param {object} [segCfg] - segment config instance (null → hardcoded fallback)
 * @param {boolean} [hasS2=true] - whether tele camera exists
 * @returns {{text: string, color: string}}
 */
export function segmentLabel(z, segCfg, hasS2 = true) {
    let leadSrc, followerSrc, warp;
    if (segCfg) {
        leadSrc = segCfg.getLeadSource(z, hasS2);
        followerSrc = segCfg.getFollowerSource(z, hasS2);
        warp = segCfg.getSegmentWarp(z);
    } else {
        // Hardcoded fallback matching default segments
        if (z < 1) { leadSrc = SRC.SEC1; followerSrc = SRC.MAIN; warp = true; }
        else if (z <= 2) { leadSrc = SRC.MAIN; followerSrc = SRC.SEC1; warp = false; }
        else if (z < 5) { leadSrc = SRC.MAIN; followerSrc = SRC.SEC2; warp = true; }
        else { leadSrc = SRC.SEC2; followerSrc = SRC.MAIN; warp = false; }
    }
    const leadName = camDisplayName(leadSrc);
    const folName = camDisplayName(followerSrc);
    const text = warp ? `${leadName}\u2192${folName}` : leadName;
    const color = camColor(leadSrc);
    return { text, color };
}

/** Fixed total range */
export const RANGE_MIN = 0.5;
export const RANGE_MAX = 10.0;

/**
 * Default breakpoints and segment assignments.
 * breakpoints: sorted zoom values that divide [0.5, 10.0]
 * segments: one more element than breakpoints, each has {lead, follower}
 */
export const DEFAULT_BREAKPOINTS = [1.0, 2.0, 5.0];
export const DEFAULT_ASSIGNMENTS = [
    { lead: SRC.SEC1, follower: SRC.MAIN, warp: true },    // [0.5, 1.0)  UW→Main handover
    { lead: SRC.MAIN, follower: SRC.SEC1, warp: false },   // [1.0, 2.0)  Main plain crop
    { lead: SRC.MAIN, follower: SRC.SEC2, warp: true },    // [2.0, 5.0)  Main→Tele handover
    { lead: SRC.SEC2, follower: SRC.MAIN, warp: false },   // [5.0, 10.0] Tele plain crop
];

/**
 * Create a segment config instance with breakpoint-based lookup.
 * @param {object} [init] - optional initial state {breakpoints, assignments}
 */
export function createSegmentConfig(init) {
    let breakpoints = init?.breakpoints
        ? [...init.breakpoints].sort((a, b) => a - b)
        : [...DEFAULT_BREAKPOINTS];
    let assignments = init?.assignments
        ? JSON.parse(JSON.stringify(init.assignments))
        : JSON.parse(JSON.stringify(DEFAULT_ASSIGNMENTS));

    /**
     * Find which segment index zoom z belongs to.
     * Segments: [RANGE_MIN, bp[0]), [bp[0], bp[1]), ..., [bp[n-1], RANGE_MAX]
     * Convention: lower bound inclusive (>=), upper bound exclusive (<)
     * except the last segment which includes RANGE_MAX.
     */
    function segmentIndex(z) {
        for (let i = 0; i < breakpoints.length; i++) {
            if (z < breakpoints[i]) return i;
        }
        return breakpoints.length; // last segment
    }

    function ensureConsistency() {
        // Sort breakpoints, adjust assignments to match
        const paired = breakpoints.map((bp, i) => ({ bp, assign: assignments[i + 1] }));
        paired.sort((a, b) => a.bp - b.bp);
        breakpoints = paired.map(p => p.bp);
        // First assignment stays, rest follow sorted order
        const newAssign = [assignments[0]];
        paired.forEach(p => newAssign.push(p.assign));
        // Trim or pad to correct length
        while (newAssign.length < breakpoints.length + 1) {
            newAssign.push({ lead: SRC.MAIN, follower: SRC.SEC1, warp: false });
        }
        assignments = newAssign.slice(0, breakpoints.length + 1);
    }

    return {
        /** Get the leading camera SRC for a given zoom */
        getLeadSource(z, hasS2) {
            const idx = segmentIndex(z);
            const src = assignments[idx]?.lead ?? SRC.MAIN;
            return (src === SRC.SEC2 && !hasS2) ? SRC.MAIN : src;
        },

        /** Get the follower camera SRC for a given zoom */
        getFollowerSource(z, hasS2) {
            const idx = segmentIndex(z);
            const src = assignments[idx]?.follower ?? SRC.MAIN;
            return (src === SRC.SEC2 && !hasS2) ? SRC.MAIN : src;
        },

        /** Get the per-segment warp flag for a given zoom */
        getSegmentWarp(z) {
            const idx = segmentIndex(z);
            return assignments[idx]?.warp ?? false;
        },

        /** Get the segment boundaries [from, to] for a given zoom */
        getSegmentRange(z) {
            const idx = segmentIndex(z);
            const from = idx === 0 ? RANGE_MIN : breakpoints[idx - 1];
            const to = idx >= breakpoints.length ? RANGE_MAX : breakpoints[idx];
            return [from, to];
        },

        /** Get current breakpoints (copy) */
        getBreakpoints() { return [...breakpoints]; },

        /** Get current assignments (deep copy) */
        getAssignments() { return JSON.parse(JSON.stringify(assignments)); },

        /** Add a breakpoint, auto-creating a new segment with default assignment */
        addBreakpoint(value) {
            if (value <= RANGE_MIN || value >= RANGE_MAX) return;
            // Don't add duplicate
            if (breakpoints.some(bp => Math.abs(bp - value) < 0.01)) return;
            // Insert in sorted position
            const idx = breakpoints.findIndex(bp => bp > value);
            const insertAt = idx < 0 ? breakpoints.length : idx;
            breakpoints.splice(insertAt, 0, value);
            // New segment inherits from the segment it splits
            const sourceIdx = insertAt; // the segment that was at this position
            const inherited = assignments[sourceIdx]
                ? { ...assignments[sourceIdx] }
                : { lead: SRC.MAIN, follower: SRC.SEC1 };
            assignments.splice(insertAt + 1, 0, inherited);
        },

        /** Remove a breakpoint by index, merging adjacent segments */
        removeBreakpoint(idx) {
            if (idx < 0 || idx >= breakpoints.length) return;
            breakpoints.splice(idx, 1);
            // Remove the segment after the breakpoint (merge into previous)
            assignments.splice(idx + 1, 1);
        },

        /** Update a breakpoint value; re-sorts if needed */
        setBreakpoint(idx, value) {
            if (idx < 0 || idx >= breakpoints.length) return;
            value = Math.max(RANGE_MIN + 0.01, Math.min(RANGE_MAX - 0.01, value));
            breakpoints[idx] = value;
            ensureConsistency();
        },

        /** Update a segment's lead/follower (preserves warp flag) */
        setAssignment(segIdx, lead, follower) {
            if (segIdx < 0 || segIdx >= assignments.length) return;
            const warp = assignments[segIdx]?.warp ?? false;
            assignments[segIdx] = { lead, follower, warp };
        },

        /** Toggle per-segment warp flag */
        setSegmentWarp(segIdx, warp) {
            if (segIdx < 0 || segIdx >= assignments.length) return;
            assignments[segIdx].warp = !!warp;
        },

        /** Reset to defaults */
        reset() {
            breakpoints = [...DEFAULT_BREAKPOINTS];
            assignments = JSON.parse(JSON.stringify(DEFAULT_ASSIGNMENTS));
        },

        /** Serialize for config store / scene save */
        serialize() {
            return {
                breakpoints: [...breakpoints],
                assignments: JSON.parse(JSON.stringify(assignments)),
            };
        },

        /** Restore from serialized data */
        restore(data) {
            if (!data || !Array.isArray(data.breakpoints) || !Array.isArray(data.assignments)) return;
            if (data.breakpoints.length + 1 !== data.assignments.length) return;
            breakpoints = [...data.breakpoints].sort((a, b) => a - b);
            assignments = JSON.parse(JSON.stringify(data.assignments));
        },
    };
}
