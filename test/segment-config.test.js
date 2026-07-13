import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createSegmentConfig, DEFAULT_BREAKPOINTS, DEFAULT_ASSIGNMENTS,
    CAM_NAMES, camName, camIndex, RANGE_MIN, RANGE_MAX,
} from '../src/segment-config.js';
import { SRC } from '../src/zoom-pipeline.js';

describe('segment-config', () => {
    describe('helpers', () => {
        it('camName returns correct names', () => {
            assert.equal(camName(SRC.SEC1), 'UW');
            assert.equal(camName(SRC.MAIN), 'Main');
            assert.equal(camName(SRC.SEC2), 'Tele');
        });

        it('camIndex returns correct indices', () => {
            assert.equal(camIndex('UW'), SRC.SEC1);
            assert.equal(camIndex('Main'), SRC.MAIN);
            assert.equal(camIndex('Tele'), SRC.SEC2);
            assert.equal(camIndex('unknown'), SRC.MAIN);
        });
    });

    describe('default config matches hardcoded rules', () => {
        const cfg = createSegmentConfig();

        it('0.7x → UW leads, Main follows (z < 1.0)', () => {
            assert.equal(cfg.getLeadSource(0.7, true), SRC.SEC1);
            assert.equal(cfg.getFollowerSource(0.7, true), SRC.MAIN);
        });

        it('1.0x → Main leads, UW follows (z >= 1.0, < 2.0)', () => {
            assert.equal(cfg.getLeadSource(1.0, true), SRC.MAIN);
            assert.equal(cfg.getFollowerSource(1.0, true), SRC.SEC1);
        });

        it('1.5x → Main leads, UW follows', () => {
            assert.equal(cfg.getLeadSource(1.5, true), SRC.MAIN);
            assert.equal(cfg.getFollowerSource(1.5, true), SRC.SEC1);
        });

        it('2.0x → Main leads, Tele follows (z >= 2.0, < 5.0)', () => {
            assert.equal(cfg.getLeadSource(2.0, true), SRC.MAIN);
            assert.equal(cfg.getFollowerSource(2.0, true), SRC.SEC2);
        });

        it('3.0x → Main leads, Tele follows', () => {
            assert.equal(cfg.getLeadSource(3.0, true), SRC.MAIN);
            assert.equal(cfg.getFollowerSource(3.0, true), SRC.SEC2);
        });

        it('5.0x → Tele leads, Main follows (z >= 5.0)', () => {
            assert.equal(cfg.getLeadSource(5.0, true), SRC.SEC2);
            assert.equal(cfg.getFollowerSource(5.0, true), SRC.MAIN);
        });

        it('10.0x → Tele leads, Main follows (last segment inclusive)', () => {
            assert.equal(cfg.getLeadSource(10.0, true), SRC.SEC2);
            assert.equal(cfg.getFollowerSource(10.0, true), SRC.MAIN);
        });
    });

    describe('hasS2=false fallback', () => {
        const cfg = createSegmentConfig();

        it('Tele lead falls back to Main when no sec2', () => {
            assert.equal(cfg.getLeadSource(7.0, false), SRC.MAIN);
        });

        it('Tele follower falls back to Main when no sec2', () => {
            // Default segment [1.0, 5.0) has follower=SEC1, not SEC2
            // Segment [5.0, 10] has follower=MAIN — no change needed
            // Let's test a custom config
            const cfg2 = createSegmentConfig({
                breakpoints: [1.0],
                assignments: [
                    { lead: SRC.SEC1, follower: SRC.SEC2 },
                    { lead: SRC.MAIN, follower: SRC.SEC2 },
                ],
            });
            assert.equal(cfg2.getFollowerSource(3.0, false), SRC.MAIN);
        });
    });

    describe('breakpoint operations', () => {
        it('addBreakpoint splits a segment', () => {
            const cfg = createSegmentConfig();
            // Default: breakpoints [1.0, 2.0, 5.0] → 4 segments
            cfg.addBreakpoint(3.0);
            assert.deepEqual(cfg.getBreakpoints(), [1.0, 2.0, 3.0, 5.0]);
            // Now 5 segments
            assert.equal(cfg.getAssignments().length, 5);
        });

        it('addBreakpoint rejects duplicates', () => {
            const cfg = createSegmentConfig();
            cfg.addBreakpoint(1.0); // already exists
            assert.deepEqual(cfg.getBreakpoints(), [1.0, 2.0, 5.0]);
        });

        it('addBreakpoint rejects out-of-range values', () => {
            const cfg = createSegmentConfig();
            cfg.addBreakpoint(0.5);  // at RANGE_MIN
            cfg.addBreakpoint(10.0); // at RANGE_MAX
            assert.deepEqual(cfg.getBreakpoints(), [1.0, 2.0, 5.0]);
        });

        it('removeBreakpoint merges segments', () => {
            const cfg = createSegmentConfig();
            cfg.removeBreakpoint(0); // remove 1.0 breakpoint
            assert.deepEqual(cfg.getBreakpoints(), [2.0, 5.0]);
            assert.equal(cfg.getAssignments().length, 3);
        });

        it('setBreakpoint re-sorts on value change', () => {
            const cfg = createSegmentConfig({
                breakpoints: [2.0, 5.0],
                assignments: [
                    { lead: SRC.SEC1, follower: SRC.MAIN },
                    { lead: SRC.MAIN, follower: SRC.SEC1 },
                    { lead: SRC.SEC2, follower: SRC.MAIN },
                ],
            });
            // Move breakpoint 0 (value 2.0) to 7.0 — should re-sort after 5.0
            cfg.setBreakpoint(0, 7.0);
            assert.deepEqual(cfg.getBreakpoints(), [5.0, 7.0]);
            // The assignment that was for [2.0, 5.0) should now be for [5.0, 7.0)
        });

        it('setBreakpoint clamps to valid range', () => {
            const cfg = createSegmentConfig();
            cfg.setBreakpoint(0, 0.1); // below RANGE_MIN+0.01
            const bps = cfg.getBreakpoints();
            assert.ok(bps[0] >= RANGE_MIN + 0.01);
        });
    });

    describe('setAssignment', () => {
        it('changes lead/follower for a segment', () => {
            const cfg = createSegmentConfig();
            // Segment 0: [0.5, 1.0) — change lead from UW to Main
            cfg.setAssignment(0, SRC.MAIN, SRC.SEC1);
            assert.equal(cfg.getLeadSource(0.7, true), SRC.MAIN);
            assert.equal(cfg.getFollowerSource(0.7, true), SRC.SEC1);
        });

        it('preserves warp flag when changing lead/follower', () => {
            const cfg = createSegmentConfig();
            // Segment 0 default warp=true
            assert.equal(cfg.getSegmentWarp(0.7), true);
            cfg.setAssignment(0, SRC.MAIN, SRC.SEC1);
            assert.equal(cfg.getSegmentWarp(0.7), true); // still true
        });
    });

    describe('per-segment warp', () => {
        it('default warp flags match hardcoded segments', () => {
            const cfg = createSegmentConfig();
            assert.equal(cfg.getSegmentWarp(0.7), true);   // A: warp on
            assert.equal(cfg.getSegmentWarp(1.5), false);  // B: warp off
            assert.equal(cfg.getSegmentWarp(3.0), true);   // C: warp on
            assert.equal(cfg.getSegmentWarp(7.0), false);  // D: warp off
        });

        it('setSegmentWarp toggles the flag', () => {
            const cfg = createSegmentConfig();
            cfg.setSegmentWarp(1, true);  // turn on warp for segment B
            assert.equal(cfg.getSegmentWarp(1.5), true);
            cfg.setSegmentWarp(1, false);
            assert.equal(cfg.getSegmentWarp(1.5), false);
        });

        it('getSegmentRange returns correct boundaries', () => {
            const cfg = createSegmentConfig();
            assert.deepEqual(cfg.getSegmentRange(0.7), [0.5, 1.0]);
            assert.deepEqual(cfg.getSegmentRange(1.5), [1.0, 2.0]);
            assert.deepEqual(cfg.getSegmentRange(3.0), [2.0, 5.0]);
            assert.deepEqual(cfg.getSegmentRange(7.0), [5.0, 10.0]);
        });

        it('warp flag survives serialize/restore', () => {
            const cfg = createSegmentConfig();
            cfg.setSegmentWarp(1, true);
            const data = cfg.serialize();
            const cfg2 = createSegmentConfig();
            cfg2.restore(data);
            assert.equal(cfg2.getSegmentWarp(1.5), true);
        });
    });

    describe('serialize / restore', () => {
        it('round-trips correctly', () => {
            const cfg = createSegmentConfig();
            const data = cfg.serialize();
            assert.deepEqual(data.breakpoints, DEFAULT_BREAKPOINTS);
            assert.deepEqual(data.assignments, DEFAULT_ASSIGNMENTS);

            cfg.addBreakpoint(2.0);
            cfg.restore(data);
            assert.deepEqual(cfg.getBreakpoints(), DEFAULT_BREAKPOINTS);
        });

        it('restore ignores invalid data', () => {
            const cfg = createSegmentConfig();
            cfg.restore(null);
            cfg.restore({});
            cfg.restore({ breakpoints: [1], assignments: [] }); // length mismatch
            assert.deepEqual(cfg.getBreakpoints(), DEFAULT_BREAKPOINTS);
        });
    });

    describe('custom initial config', () => {
        it('accepts custom breakpoints and assignments', () => {
            const cfg = createSegmentConfig({
                breakpoints: [3.0],
                assignments: [
                    { lead: SRC.MAIN, follower: SRC.SEC2 },
                    { lead: SRC.SEC2, follower: SRC.MAIN },
                ],
            });
            assert.equal(cfg.getLeadSource(1.0, true), SRC.MAIN);
            assert.equal(cfg.getLeadSource(4.0, true), SRC.SEC2);
        });
    });
});
