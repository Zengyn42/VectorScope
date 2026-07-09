/**
 * Unit tests for src/blend.js — camera-transition blending state machine.
 * Verifies the user-specified schedule: after a source switch, frame n of X
 * displays prev*(1 - n/X) + cur*(n/X), n = 1..X.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlendController } from '../src/blend.js';
import { SRC } from '../src/zoom-pipeline.js';

const M_A = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const M_B = [2, 0, 5, 0, 2, 7, 0, 0, 1];

function makeCtl(X) {
    let x = X;
    const ctl = createBlendController({ getX: () => x });
    return { ctl, setX: (v) => { x = v; } };
}

test('no blending while the source stays constant', () => {
    const { ctl } = makeCtl(20);
    for (let i = 0; i < 5; i++) {
        const r = ctl.update(SRC.SEC1, M_A);
        assert.deepEqual(r, { t: 1, prevSrc: null, prevM: null });
    }
    assert.equal(ctl.isBlending(), false);
});

test('transition schedule matches the formula: t = n/X for n = 1..X', () => {
    const X = 20;
    const { ctl } = makeCtl(X);
    ctl.update(SRC.SEC1, M_A);                   // history frame (0.5x side)
    for (let n = 1; n <= X; n++) {
        const r = ctl.update(SRC.MAIN, M_B);     // crossed 1.0x → main
        assert.ok(Math.abs(r.t - n / X) < 1e-12, `frame ${n}: t=${r.t}`);
        assert.equal(r.prevSrc, SRC.SEC1);
        assert.deepEqual(r.prevM, M_A, 'prev matrix frozen at transition');
    }
    // Frame X+1: hand-off complete
    const done = ctl.update(SRC.MAIN, M_B);
    assert.deepEqual(done, { t: 1, prevSrc: null, prevM: null });
    assert.equal(ctl.isBlending(), false);
});

test('first blended frame is mostly the previous camera (n=1 → t=1/X)', () => {
    const { ctl } = makeCtl(20);
    ctl.update(SRC.SEC1, M_A);
    const r = ctl.update(SRC.MAIN, M_B);
    assert.ok(Math.abs(r.t - 0.05) < 1e-12);
});

test('prev matrix is a frozen copy — later mutation has no effect', () => {
    const { ctl } = makeCtl(10);
    const m = M_A.slice();
    ctl.update(SRC.SEC1, m);
    m[0] = 999;                                  // caller mutates its array
    const r = ctl.update(SRC.MAIN, M_B);
    assert.equal(r.prevM[0], 1, 'controller must have copied the matrix');
});

test('X = 0 disables blending (hard cut)', () => {
    const { ctl } = makeCtl(0);
    ctl.update(SRC.SEC1, M_A);
    const r = ctl.update(SRC.MAIN, M_B);
    assert.deepEqual(r, { t: 1, prevSrc: null, prevM: null });
});

test('second transition mid-blend restarts against the new outgoing camera', () => {
    const { ctl } = makeCtl(20);
    ctl.update(SRC.SEC1, M_A);
    ctl.update(SRC.MAIN, M_B);                   // blend SEC1→MAIN, n=1
    ctl.update(SRC.MAIN, M_B);                   // n=2
    const r = ctl.update(SRC.SEC2, M_A);         // crossed 5.0x mid-blend
    assert.equal(r.prevSrc, SRC.MAIN, 'new blend fades from MAIN');
    assert.ok(Math.abs(r.t - 1 / 20) < 1e-12, 'counter restarts at n=1');
});

test('bounce back across the boundary blends in the reverse direction', () => {
    const { ctl } = makeCtl(4);
    ctl.update(SRC.MAIN, M_B);
    // cross to SEC2 and complete the 4-frame blend
    for (let i = 0; i < 4; i++) ctl.update(SRC.SEC2, M_A);
    assert.equal(ctl.isBlending(), false);
    // cross back
    const r = ctl.update(SRC.MAIN, M_B);
    assert.equal(r.prevSrc, SRC.SEC2);
    assert.deepEqual(r.prevM, M_A);
});

test('live X change mid-blend is respected (t clamped to 1)', () => {
    const { ctl, setX } = makeCtl(20);
    ctl.update(SRC.SEC1, M_A);
    ctl.update(SRC.MAIN, M_B);                   // n=1, X=20
    setX(2);
    const r = ctl.update(SRC.MAIN, M_B);         // n=2, X=2 → t=1, blend ends
    assert.equal(r.t, 1);
    assert.equal(ctl.isBlending(), false);
});

test('reset() clears history — next frame does not trigger a blend', () => {
    const { ctl } = makeCtl(20);
    ctl.update(SRC.SEC1, M_A);
    ctl.update(SRC.MAIN, M_B);                   // blending
    ctl.reset();
    assert.equal(ctl.isBlending(), false);
    const r = ctl.update(SRC.SEC2, M_A);         // new source, but no history
    assert.deepEqual(r, { t: 1, prevSrc: null, prevM: null });
});
