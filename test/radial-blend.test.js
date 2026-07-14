import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { radialBlendParams } from '../src/radial-blend.js';

describe('radialBlendParams', () => {
    it('narrow→wide (Tele→Main): edges first (direction=1)', () => {
        const { direction, coverRadius } = radialBlendParams(1, 5);
        assert.equal(direction, 1);
        assert.equal(coverRadius, 1.0);
    });

    it('wide→narrow (UW→Main): center first (direction=-1)', () => {
        const { direction, coverRadius } = radialBlendParams(1, 0.5);
        assert.equal(direction, -1);
        assert.equal(coverRadius, 0.5);
    });

    it('same nominal: flat (no radial direction)', () => {
        const { direction, coverRadius } = radialBlendParams(1, 1);
        assert.equal(direction, 0);
        assert.equal(coverRadius, 1.0);
    });

    it('UW→Main (wide→narrow): center first', () => {
        const { direction } = radialBlendParams(1, 0.5);
        assert.equal(direction, -1);
    });

    it('Main→UW (narrow→wide): edges first', () => {
        const { direction } = radialBlendParams(0.5, 1);
        assert.equal(direction, 1);
    });

    it('Main→Tele (wide→narrow): center first', () => {
        const { direction } = radialBlendParams(5, 1);
        assert.equal(direction, -1);
    });

    it('Tele→Main (narrow→wide): edges first', () => {
        const { direction } = radialBlendParams(1, 5);
        assert.equal(direction, 1);
    });

    it('coverRadius: edges-first=1.0, center-first=0.5', () => {
        assert.equal(radialBlendParams(1, 5).coverRadius, 1.0);   // Tele→Main edges-first
        assert.equal(radialBlendParams(0.5, 1).coverRadius, 1.0); // Main→UW edges-first
        assert.equal(radialBlendParams(5, 1).coverRadius, 0.5);   // Main→Tele center-first
        assert.equal(radialBlendParams(1, 0.5).coverRadius, 0.5); // UW→Main center-first
        assert.equal(radialBlendParams(1, 1).coverRadius, 1.0);
    });
});
