import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { radialBlendParams } from '../src/radial-blend.js';

describe('radialBlendParams', () => {
    it('narrow→wide (Tele→Main): edges first', () => {
        const { direction, coverRadius } = radialBlendParams(1, 5);
        assert.equal(direction, -1);
        assert.equal(coverRadius, 1.0);
    });

    it('wide→narrow (Main→Tele): center first', () => {
        const { direction, coverRadius } = radialBlendParams(1, 0.5);
        assert.equal(direction, 1);
        assert.equal(coverRadius, 0.5);
    });

    it('same nominal: flat (no radial direction)', () => {
        const { direction, coverRadius } = radialBlendParams(1, 1);
        assert.equal(direction, 0);
        assert.equal(coverRadius, 1.0);
    });

    it('UW→Main (zoom up, wide outgoing → narrow incoming): center first', () => {
        // prevNom=0.5 (UW), curNom=1 (Main): prevNom < curNom
        const { direction } = radialBlendParams(1, 0.5);
        assert.equal(direction, 1);
    });

    it('Main→UW (zoom down, narrow outgoing → wide incoming): edges first', () => {
        // prevNom=1 (Main), curNom=0.5 (UW): prevNom > curNom
        const { direction } = radialBlendParams(0.5, 1);
        assert.equal(direction, -1);
    });

    it('Main→Tele (zoom up, wide outgoing → narrow incoming): center first', () => {
        // prevNom=1 (Main), curNom=5 (Tele): prevNom < curNom
        const { direction } = radialBlendParams(5, 1);
        assert.equal(direction, 1);
    });

    it('Tele→Main (zoom down, narrow outgoing → wide incoming): edges first', () => {
        // prevNom=5 (Tele), curNom=1 (Main): prevNom > curNom
        const { direction } = radialBlendParams(1, 5);
        assert.equal(direction, -1);
    });

    it('coverRadius: edges-first=1.0, center-first=0.5', () => {
        // Narrow→wide (edges first): coverRadius=1.0
        assert.equal(radialBlendParams(1, 5).coverRadius, 1.0);   // Tele→Main
        assert.equal(radialBlendParams(0.5, 1).coverRadius, 1.0); // Main→UW
        // Wide→narrow (center first): coverRadius=0.5
        assert.equal(radialBlendParams(5, 1).coverRadius, 0.5);   // Main→Tele
        assert.equal(radialBlendParams(1, 0.5).coverRadius, 0.5); // UW→Main
        // Same: flat
        assert.equal(radialBlendParams(1, 1).coverRadius, 1.0);
    });
});
