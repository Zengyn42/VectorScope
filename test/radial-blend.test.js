import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { radialBlendParams } from '../src/radial-blend.js';

describe('radialBlendParams', () => {
    it('narrower outgoing → wider incoming: radial-IN (edges first)', () => {
        const { direction, coverRadius } = radialBlendParams(1, 5);
        assert.equal(direction, 1);
        assert.equal(coverRadius, 1.0);
    });

    it('wider outgoing → narrower incoming: radial-OUT (center first)', () => {
        const { direction, coverRadius } = radialBlendParams(1, 0.5);
        assert.equal(direction, -1);
        assert.equal(coverRadius, 0.5);
    });

    it('same nominal: flat (no radial direction)', () => {
        const { direction, coverRadius } = radialBlendParams(1, 1);
        assert.equal(direction, 0);
        assert.equal(coverRadius, 1.0);
    });

    it('Main→UW transition (1→0.5): UW wider, radial-IN', () => {
        const { direction } = radialBlendParams(0.5, 1);
        assert.equal(direction, 1);
    });

    it('UW→Main transition (0.5→1): Main narrower, radial-OUT', () => {
        const { direction } = radialBlendParams(1, 0.5);
        assert.equal(direction, -1);
    });

    it('Main→Tele transition (1→5): Tele narrower, radial-OUT', () => {
        const { direction } = radialBlendParams(5, 1);
        assert.equal(direction, -1);
    });

    it('Tele→Main transition (5→1): Main wider, radial-IN', () => {
        const { direction } = radialBlendParams(1, 5);
        assert.equal(direction, 1);
    });

    it('radial-IN coverRadius is 1.0, radial-OUT is 0.5', () => {
        // Radial-IN (narrow→wide): full frame
        assert.equal(radialBlendParams(1, 5).coverRadius, 1.0);
        assert.equal(radialBlendParams(0.5, 1).coverRadius, 1.0);
        // Radial-OUT (wide→narrow): half frame
        assert.equal(radialBlendParams(5, 1).coverRadius, 0.5);
        assert.equal(radialBlendParams(1, 0.5).coverRadius, 0.5);
        // Same: flat
        assert.equal(radialBlendParams(1, 1).coverRadius, 1.0);
    });
});
