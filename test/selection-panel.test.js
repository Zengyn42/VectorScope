import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ANIM_SPEEDS, fmtSpeed } from '../src/selection-panel.js';

describe('animation speed presets', () => {
    it('offers the six presets in ascending order', () => {
        assert.deepEqual(ANIM_SPEEDS, [0.25, 0.5, 1, 2, 4, 8]);
    });

    it('includes 1x (default speed) so the current state is always selectable', () => {
        assert.ok(ANIM_SPEEDS.includes(1));
    });

    it('formats compact labels', () => {
        assert.equal(fmtSpeed(0.25), '0.25x');
        assert.equal(fmtSpeed(0.5), '0.5x');
        assert.equal(fmtSpeed(1), '1x');
        assert.equal(fmtSpeed(2), '2x');
        assert.equal(fmtSpeed(8), '8x');
    });
});
