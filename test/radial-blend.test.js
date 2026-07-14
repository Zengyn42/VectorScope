import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { radialBlendParams } from '../src/radial-blend.js';

describe('radialBlendParams', () => {
    it('Tele→Main at z=3: edges-first, coverRadius = 3/5 = 0.6', () => {
        const { direction, coverRadius } = radialBlendParams(1, 5, 3);
        assert.equal(direction, 1);
        assert.ok(Math.abs(coverRadius - 0.6) < 1e-9);
    });

    it('Tele→Main at z=4.9: coverRadius ≈ 0.98 (near full frame at boundary)', () => {
        const { direction, coverRadius } = radialBlendParams(1, 5, 4.9);
        assert.equal(direction, 1);
        assert.ok(Math.abs(coverRadius - 0.98) < 1e-9);
    });

    it('Main→Tele at z=7: center-first, coverRadius = 5/7 ≈ 0.714', () => {
        const { direction, coverRadius } = radialBlendParams(5, 1, 7);
        assert.equal(direction, -1);
        assert.ok(Math.abs(coverRadius - 5 / 7) < 1e-9);
    });

    it('Main→Tele at z=5.1: coverRadius ≈ 0.98 (near full frame at boundary)', () => {
        const { direction, coverRadius } = radialBlendParams(5, 1, 5.1);
        assert.equal(direction, -1);
        assert.ok(Math.abs(coverRadius - 5 / 5.1) < 1e-9);
    });

    it('same nominal: flat', () => {
        const { direction, coverRadius } = radialBlendParams(1, 1, 1);
        assert.equal(direction, 0);
        assert.equal(coverRadius, 1.0);
    });

    it('UW→Main at z=0.8: center-first', () => {
        const { direction } = radialBlendParams(1, 0.5, 0.8);
        assert.equal(direction, -1);
    });

    it('Main→UW at z=0.8: edges-first', () => {
        const { direction } = radialBlendParams(0.5, 1, 0.8);
        assert.equal(direction, 1);
    });

    it('coverRadius clamped to 1.0 at boundary', () => {
        assert.equal(radialBlendParams(1, 5, 5).coverRadius, 1.0);
        assert.equal(radialBlendParams(5, 1, 5).coverRadius, 1.0);
    });
});
