import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { radialBlendParams } from '../src/radial-blend.js';

describe('radialBlendParams', () => {
    it('narrower outgoing → wider incoming: radial-IN (edges first)', () => {
        // prevNom=5 (Tele, narrow FOV) → curNom=1 (Main, wider FOV)
        const { direction, coverRadius } = radialBlendParams(1, 5);
        assert.equal(direction, 1);
        assert.ok(Math.abs(coverRadius - 0.2) < 1e-9, `coverRadius=${coverRadius}`);
    });

    it('wider outgoing → narrower incoming: radial-OUT (center first)', () => {
        // prevNom=0.5 (UW, wide FOV) → curNom=1 (Main, narrower FOV)
        const { direction, coverRadius } = radialBlendParams(1, 0.5);
        assert.equal(direction, -1);
        assert.ok(Math.abs(coverRadius - 0.5) < 1e-9, `coverRadius=${coverRadius}`);
    });

    it('same nominal: flat (no radial direction)', () => {
        const { direction, coverRadius } = radialBlendParams(1, 1);
        assert.equal(direction, 0);
        assert.equal(coverRadius, 1.0);
    });

    it('Main→UW transition (1→0.5): UW wider, radial-IN', () => {
        const { direction, coverRadius } = radialBlendParams(0.5, 1);
        assert.equal(direction, 1);
        assert.ok(Math.abs(coverRadius - 0.5) < 1e-9);
    });

    it('UW→Main transition (0.5→1): Main narrower, radial-OUT', () => {
        const { direction, coverRadius } = radialBlendParams(1, 0.5);
        assert.equal(direction, -1);
        assert.ok(Math.abs(coverRadius - 0.5) < 1e-9);
    });

    it('Main→Tele transition (1→5): Tele narrower, radial-OUT', () => {
        const { direction, coverRadius } = radialBlendParams(5, 1);
        assert.equal(direction, -1);
        assert.ok(Math.abs(coverRadius - 0.2) < 1e-9);
    });

    it('Tele→Main transition (5→1): Main wider, radial-IN', () => {
        const { direction, coverRadius } = radialBlendParams(1, 5);
        assert.equal(direction, 1);
        assert.ok(Math.abs(coverRadius - 0.2) < 1e-9);
    });
});
