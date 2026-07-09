/**
 * Unit tests for src/zoom-anim.js — zoom animation controller.
 * Uses injected fake raf/caf/now so tests run deterministically with no
 * real timers: `pump()` advances the clock and fires queued callbacks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoomAnimator } from '../src/zoom-anim.js';

/** Fake frame scheduler + clock. */
function makeClock() {
    let t = 0, nextId = 1;
    const queue = new Map();          // id -> callback
    return {
        now: () => t,
        raf: (fn) => { const id = nextId++; queue.set(id, fn); return id; },
        caf: (id) => { queue.delete(id); },
        /** Advance time by dt ms and run all currently queued callbacks once. */
        step(dt = 16) {
            t += dt;
            const cbs = [...queue.values()];
            queue.clear();
            for (const fn of cbs) fn(t);
        },
        pending: () => queue.size,
    };
}

function makeHarness(opts = {}) {
    const clock = makeClock();
    let zoom = opts.zoom ?? 1;
    const playStates = [];
    const anim = createZoomAnimator({
        getZoom: () => zoom,
        setLogZoom: (lv) => { zoom = 10 ** lv; },
        onPlayState: (p) => playStates.push(p),
        raf: clock.raf, caf: clock.caf, now: clock.now,
        ...opts.animOpts,
    });
    return { clock, anim, playStates, getZoom: () => zoom };
}

test('animateTo reaches the target after the duration', () => {
    const { clock, anim, getZoom } = makeHarness({ zoom: 1 });
    anim.animateTo(5);
    assert.equal(anim.isAnimating(), true);
    for (let i = 0; i < 60 && anim.isAnimating(); i++) clock.step(16);
    assert.equal(anim.isAnimating(), false);
    assert.ok(Math.abs(getZoom() - 5) < 1e-9, `expected 5, got ${getZoom()}`);
});

test('animateTo is a no-op when already at the target', () => {
    const { clock, anim } = makeHarness({ zoom: 2 });
    anim.animateTo(2);
    assert.equal(anim.isAnimating(), false);
    assert.equal(clock.pending(), 0);
});

test('animateTo eases monotonically in log space (1x → 10x never overshoots)', () => {
    const { clock, anim, getZoom } = makeHarness({ zoom: 1 });
    anim.animateTo(10);
    let prev = getZoom();
    for (let i = 0; i < 60 && anim.isAnimating(); i++) {
        clock.step(16);
        const z = getZoom();
        assert.ok(z >= prev - 1e-12, `zoom decreased: ${prev} -> ${z}`);
        assert.ok(z <= 10 + 1e-9, `overshoot: ${z}`);
        prev = z;
    }
    assert.ok(Math.abs(getZoom() - 10) < 1e-9);
});

test('stopPreset halts an in-flight transition (manual slider drag)', () => {
    const { clock, anim, getZoom } = makeHarness({ zoom: 1 });
    anim.animateTo(10);
    clock.step(100);          // partway through 600ms
    const mid = getZoom();
    assert.ok(mid > 1 && mid < 10);
    anim.stopPreset();
    assert.equal(anim.isAnimating(), false);
    clock.step(1000);
    assert.equal(getZoom(), mid, 'zoom must not move after stopPreset');
});

test('togglePlay starts/stops the bounce loop and reports state', () => {
    const { clock, anim, playStates } = makeHarness({ zoom: 1 });
    assert.equal(anim.togglePlay(), true);
    assert.equal(anim.isPlaying(), true);
    clock.step(16);
    assert.equal(anim.togglePlay(), false);
    assert.equal(anim.isPlaying(), false);
    assert.deepEqual(playStates, [true, false]);
});

test('Play bounces within [playLo, playHi] and reverses at bounds', () => {
    const { clock, anim, getZoom } = makeHarness({
        zoom: 9.5,
        animOpts: { playStep: 0.1 },   // big step → hits bounds fast
    });
    anim.togglePlay();
    let sawHi = false, sawLo = false;
    for (let i = 0; i < 100; i++) {
        clock.step(16);
        const z = getZoom();
        assert.ok(z >= 0.5 - 1e-9 && z <= 10 + 1e-9, `out of bounds: ${z}`);
        if (Math.abs(z - 10) < 1e-9) sawHi = true;
        if (Math.abs(z - 0.5) < 1e-9) sawLo = true;
    }
    assert.ok(sawHi && sawLo, 'should touch both bounds');
    anim.stopPlay();
});

test('mutual exclusion: animateTo stops Play; togglePlay stops preset', () => {
    const { clock, anim } = makeHarness({ zoom: 1 });
    anim.togglePlay();
    anim.animateTo(5);
    assert.equal(anim.isPlaying(), false, 'preset must stop Play');
    assert.equal(anim.isAnimating(), true);

    anim.togglePlay();
    assert.equal(anim.isAnimating(), false, 'Play must stop preset');
    assert.equal(anim.isPlaying(), true);
    anim.stopAll();
    assert.equal(anim.isPlaying(), false);
    clock.step(16);
});
