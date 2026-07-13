import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTrajFrameToState, shouldLockControls, TRAJ_LOCK_IDS } from '../src/traj-frame.js';

describe('applyTrajFrameToState', () => {
    function makeS() {
        return { zoom: 1, depthD: 3, prewarpScale: 1, prewarpScale2: 5, warp: false,
                 blendX: 20, blendMode: 'single', blendShape: 'flat', camParams: null };
    }

    it('always sets zoom and focusD', () => {
        const S = makeS();
        const u = applyTrajFrameToState(S, { zoom: 2.5, focusD: 4.2 });
        assert.equal(S.zoom, 2.5);
        assert.equal(S.depthD, 4.2);
        assert.equal(u.zoom, 2.5);
        assert.equal(u.focusD, 4.2);
    });

    it('sets prewarp1 when present', () => {
        const S = makeS();
        applyTrajFrameToState(S, { zoom: 1, focusD: 3, prewarp1: 3.0 });
        assert.equal(S.prewarpScale, 3.0);
    });

    it('does not touch prewarp1 when absent', () => {
        const S = makeS();
        S.prewarpScale = 7;
        applyTrajFrameToState(S, { zoom: 1, focusD: 3 });
        assert.equal(S.prewarpScale, 7);
    });

    it('sets prewarp2 when present', () => {
        const S = makeS();
        applyTrajFrameToState(S, { zoom: 1, focusD: 3, prewarp2: 8.0 });
        assert.equal(S.prewarpScale2, 8.0);
    });

    it('sets warp when present', () => {
        const S = makeS();
        applyTrajFrameToState(S, { zoom: 1, focusD: 3, warp: true });
        assert.equal(S.warp, true);
    });

    it('sets blendX when present', () => {
        const S = makeS();
        applyTrajFrameToState(S, { zoom: 1, focusD: 3, blendX: 40 });
        assert.equal(S.blendX, 40);
    });

    it('sets blendMode when present', () => {
        const S = makeS();
        applyTrajFrameToState(S, { zoom: 1, focusD: 3, blendMode: 'dual' });
        assert.equal(S.blendMode, 'dual');
    });

    it('sets blendShape when present', () => {
        const S = makeS();
        applyTrajFrameToState(S, { zoom: 1, focusD: 3, blendShape: 'radial' });
        assert.equal(S.blendShape, 'radial');
    });

    it('sets camParams when present', () => {
        const S = makeS();
        const cam = { main_camera: {} };
        applyTrajFrameToState(S, { zoom: 1, focusD: 3, camParams: cam });
        assert.equal(S.camParams, cam);
    });

    it('returns which fields were updated', () => {
        const S = makeS();
        const u = applyTrajFrameToState(S, { zoom: 1, focusD: 3, warp: true, blendX: 10 });
        assert.ok('zoom' in u);
        assert.ok('focusD' in u);
        assert.ok('warp' in u);
        assert.ok('blendX' in u);
        assert.ok(!('prewarp1' in u));
        assert.ok(!('blendMode' in u));
    });
});

describe('shouldLockControls', () => {
    it('locks when engaged', () => {
        assert.equal(shouldLockControls(true, false), true);
    });

    it('locks when recording', () => {
        assert.equal(shouldLockControls(false, true), true);
    });

    it('unlocks when idle', () => {
        assert.equal(shouldLockControls(false, false), false);
    });
});

describe('TRAJ_LOCK_IDS', () => {
    it('is a non-empty array of strings', () => {
        assert.ok(Array.isArray(TRAJ_LOCK_IDS));
        assert.ok(TRAJ_LOCK_IDS.length > 0);
        assert.ok(TRAJ_LOCK_IDS.every(id => typeof id === 'string'));
    });

    it('includes key controls', () => {
        assert.ok(TRAJ_LOCK_IDS.includes('sld-z'));
        assert.ok(TRAJ_LOCK_IDS.includes('btn-warp'));
        assert.ok(TRAJ_LOCK_IDS.includes('sld-d'));
    });
});
