import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SRC } from '../src/zoom-pipeline.js';
import { zoomMatrix } from '../src/homography.js';
import {
    cameraNominal, cameraCrop, cameraSampleMatrix, computeBothMatrices,
} from '../src/camera-sampling.js';

const W = 1080, H = 1920;
const EPS = 1e-9;

function assertMatClose(actual, expected, msg, eps = EPS) {
    assert.equal(actual.length, expected.length, `${msg}: length`);
    for (let i = 0; i < actual.length; i++) {
        assert.ok(Math.abs(actual[i] - expected[i]) < eps,
            `${msg}: [${i}] got ${actual[i]}, expected ${expected[i]}`);
    }
}

describe('cameraNominal', () => {
    it('UW nominal = 1/prewarp1', () => {
        assert.equal(cameraNominal(SRC.SEC1, 2, 5), 0.5);
        assert.equal(cameraNominal(SRC.SEC1, 4, 5), 0.25);
    });

    it('Main nominal = 1.0 always', () => {
        assert.equal(cameraNominal(SRC.MAIN, 2, 5), 1.0);
        assert.equal(cameraNominal(SRC.MAIN, 99, 99), 1.0);
    });

    it('Tele nominal = prewarp2', () => {
        assert.equal(cameraNominal(SRC.SEC2, 2, 5), 5);
        assert.equal(cameraNominal(SRC.SEC2, 2, 10), 10);
    });

    it('defaults: prewarp1=1 → UW nominal=1, prewarp2=5 → Tele nominal=5', () => {
        assert.equal(cameraNominal(SRC.SEC1), 1.0);
        assert.equal(cameraNominal(SRC.SEC2), 5.0);
    });
});

describe('cameraCrop', () => {
    it('at nominal zoom, crop = 1.0 (full frame)', () => {
        assert.equal(cameraCrop(0.5, SRC.SEC1, 2, 5), 1.0);
        assert.equal(cameraCrop(1.0, SRC.MAIN, 2, 5), 1.0);
        assert.equal(cameraCrop(5.0, SRC.SEC2, 2, 5), 1.0);
    });

    it('at 2× nominal, crop = 2.0', () => {
        assert.equal(cameraCrop(1.0, SRC.SEC1, 2, 5), 2.0);
        assert.equal(cameraCrop(2.0, SRC.MAIN, 2, 5), 2.0);
        assert.equal(cameraCrop(10.0, SRC.SEC2, 2, 5), 2.0);
    });

    it('at 0.5× nominal, crop = 0.5', () => {
        assert.equal(cameraCrop(0.25, SRC.SEC1, 2, 5), 0.5);
        assert.equal(cameraCrop(0.5, SRC.MAIN, 2, 5), 0.5);
        assert.equal(cameraCrop(2.5, SRC.SEC2, 2, 5), 0.5);
    });
});

describe('cameraSampleMatrix', () => {
    it('produces zoomMatrix(crop) for each camera', () => {
        // UW at z=1.0, prewarp1=2: crop = 1.0 / 0.5 = 2.0
        const m = cameraSampleMatrix({ z: 1.0, src: SRC.SEC1, w: W, h: H, prewarp1: 2, prewarp2: 5 });
        const expected = zoomMatrix(2.0, W, H);
        assertMatClose(m, expected, 'UW @1.0x');
    });

    it('Main at z=3.0: crop = 3.0', () => {
        const m = cameraSampleMatrix({ z: 3.0, src: SRC.MAIN, w: W, h: H });
        assertMatClose(m, zoomMatrix(3.0, W, H), 'Main @3.0x');
    });

    it('Tele at z=5.0, prewarp2=5: crop = 1.0 (full frame)', () => {
        const m = cameraSampleMatrix({ z: 5.0, src: SRC.SEC2, w: W, h: H, prewarp1: 2, prewarp2: 5 });
        assertMatClose(m, zoomMatrix(1.0, W, H), 'Tele @5.0x');
    });

    it('Tele at z=10.0, prewarp2=5: crop = 2.0', () => {
        const m = cameraSampleMatrix({ z: 10.0, src: SRC.SEC2, w: W, h: H, prewarp1: 2, prewarp2: 5 });
        assertMatClose(m, zoomMatrix(2.0, W, H), 'Tele @10.0x');
    });

    it('identity matrix at crop=1 (full frame, centered)', () => {
        const m = cameraSampleMatrix({ z: 1.0, src: SRC.MAIN, w: W, h: H });
        // zoomMatrix(1.0) should be identity
        const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
        assertMatClose(m, I, 'identity at crop=1');
    });
});

describe('computeBothMatrices', () => {
    it('computes lead and follower independently', () => {
        const { lead, follower } = computeBothMatrices({
            z: 1.5, leadSrc: SRC.MAIN, followerSrc: SRC.SEC1,
            w: W, h: H, prewarp1: 2, prewarp2: 5,
        });
        assert.equal(lead.src, SRC.MAIN);
        assert.equal(follower.src, SRC.SEC1);

        // Lead: Main at z=1.5, crop=1.5
        assertMatClose(lead.m, zoomMatrix(1.5, W, H), 'lead');
        // Follower: UW at z=1.5, nominal=0.5, crop=3.0
        assertMatClose(follower.m, zoomMatrix(3.0, W, H), 'follower');
    });

    it('lead and follower are independent (different matrices)', () => {
        const { lead, follower } = computeBothMatrices({
            z: 3.0, leadSrc: SRC.MAIN, followerSrc: SRC.SEC2,
            w: W, h: H, prewarp1: 2, prewarp2: 5,
        });
        // Main crop=3.0, Tele crop=3/5=0.6
        assertMatClose(lead.m, zoomMatrix(3.0, W, H), 'lead Main');
        assertMatClose(follower.m, zoomMatrix(0.6, W, H), 'follower Tele');
    });

    it('same source produces same matrix', () => {
        const { lead, follower } = computeBothMatrices({
            z: 2.0, leadSrc: SRC.MAIN, followerSrc: SRC.MAIN,
            w: W, h: H, prewarp1: 2, prewarp2: 5,
        });
        assertMatClose(lead.m, follower.m, 'same source same matrix');
    });

    it('Tele leading at z=7.0: crop = 7/5 = 1.4', () => {
        const { lead } = computeBothMatrices({
            z: 7.0, leadSrc: SRC.SEC2, followerSrc: SRC.MAIN,
            w: W, h: H, prewarp1: 2, prewarp2: 5,
        });
        assertMatClose(lead.m, zoomMatrix(1.4, W, H), 'Tele @7x');
    });

    it('UW leading at z=0.5: crop = 0.5/0.5 = 1.0 (full frame)', () => {
        const { lead } = computeBothMatrices({
            z: 0.5, leadSrc: SRC.SEC1, followerSrc: SRC.MAIN,
            w: W, h: H, prewarp1: 2, prewarp2: 5,
        });
        assertMatClose(lead.m, zoomMatrix(1.0, W, H), 'UW @0.5x full frame');
    });
});
