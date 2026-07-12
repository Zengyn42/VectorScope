import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSegmentConfig, DEFAULT_SEGMENTS, CAM_NAMES, camName, camIndex } from '../src/segment-config.js';
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
            assert.equal(camIndex('unknown'), SRC.MAIN); // fallback
        });
    });

    describe('default config matches hardcoded rules', () => {
        const cfg = createSegmentConfig();

        it('0.5x → UW leads, Main follows', () => {
            assert.equal(cfg.getLeadSource(0.5, true), SRC.SEC1);
            assert.equal(cfg.getFollowerSource(0.5, true), SRC.MAIN);
        });

        it('0.9x → UW leads, Main follows', () => {
            assert.equal(cfg.getLeadSource(0.9, true), SRC.SEC1);
            assert.equal(cfg.getFollowerSource(0.9, true), SRC.MAIN);
        });

        it('1.0x → Main leads, UW follows', () => {
            assert.equal(cfg.getLeadSource(1.0, true), SRC.MAIN);
            assert.equal(cfg.getFollowerSource(1.0, true), SRC.SEC1);
        });

        it('3.0x → Main leads, Tele follows', () => {
            assert.equal(cfg.getLeadSource(3.0, true), SRC.MAIN);
            assert.equal(cfg.getFollowerSource(3.0, true), SRC.SEC2);
        });

        it('5.0x → Tele leads, Main follows', () => {
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
            assert.equal(cfg.getFollowerSource(3.0, false), SRC.MAIN);
        });
    });

    describe('custom config', () => {
        it('can swap lead/follower for a segment', () => {
            const cfg = createSegmentConfig([
                { from: 0.5, to: 1.0, lead: SRC.MAIN, follower: SRC.SEC1 },
                { from: 1.0, to: 10.0, lead: SRC.MAIN, follower: SRC.SEC2 },
            ]);
            // At 0.7x, normally UW leads — but we swapped it
            assert.equal(cfg.getLeadSource(0.7, true), SRC.MAIN);
            assert.equal(cfg.getFollowerSource(0.7, true), SRC.SEC1);
        });

        it('setSegments replaces config', () => {
            const cfg = createSegmentConfig();
            cfg.setSegments([
                { from: 0.5, to: 5.0, lead: SRC.SEC1, follower: SRC.SEC2 },
                { from: 5.0, to: 10.0, lead: SRC.SEC2, follower: SRC.SEC1 },
            ]);
            assert.equal(cfg.getLeadSource(2.0, true), SRC.SEC1);
            assert.equal(cfg.getFollowerSource(2.0, true), SRC.SEC2);
        });
    });

    describe('serialize / restore', () => {
        it('round-trips correctly', () => {
            const cfg = createSegmentConfig();
            const data = cfg.serialize();
            assert.deepEqual(data, DEFAULT_SEGMENTS);

            cfg.setSegments([{ from: 1, to: 5, lead: SRC.MAIN, follower: SRC.SEC1 }]);
            cfg.restore(data);
            assert.deepEqual(cfg.getSegments(), DEFAULT_SEGMENTS);
        });

        it('restore ignores invalid data', () => {
            const cfg = createSegmentConfig();
            cfg.restore(null);
            cfg.restore([]);
            cfg.restore('bad');
            assert.deepEqual(cfg.getSegments(), DEFAULT_SEGMENTS);
        });
    });
});
