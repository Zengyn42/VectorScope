import { test } from 'node:test';
import assert from 'node:assert';
import { createDamping } from '../src/h-damping.js';

const SRC = { SEC1: 1, MAIN: 0 };

test('first update seeds damped D to live D', () => {
    const d = createDamping();
    const out = d.update({ depthD: 3.0, zoom: 1.0, lead: SRC.MAIN, factor: 5 });
    assert.strictEqual(out, 3.0);
});

test('zoom static → D frozen regardless of AF changes', () => {
    const d = createDamping();
    d.update({ depthD: 3.0, zoom: 1.0, lead: SRC.MAIN, factor: 5 });
    // AF moves D to 0.5, zoom unchanged → applied D stays 3.0
    const out = d.update({ depthD: 0.5, zoom: 1.0, lead: SRC.MAIN, factor: 5 });
    assert.strictEqual(out, 3.0);
    // repeat many frames — still frozen
    for (let i = 0; i < 10; i++) {
        assert.strictEqual(d.update({ depthD: 0.5, zoom: 1.0, lead: SRC.MAIN, factor: 5 }), 3.0);
    }
});

test('zoom change → D converges with alpha = |Δzoom| * factor', () => {
    const d = createDamping();
    d.update({ depthD: 3.0, zoom: 1.0, lead: SRC.MAIN, factor: 5 });
    d.update({ depthD: 1.0, zoom: 1.0, lead: SRC.MAIN, factor: 5 });  // frozen at 3.0
    // Δzoom = 0.1, factor 5 → alpha 0.5 → 3.0 + (1.0-3.0)*0.5 = 2.0
    const out = d.update({ depthD: 1.0, zoom: 1.1, lead: SRC.MAIN, factor: 5 });
    assert.ok(Math.abs(out - 2.0) < 1e-12);
});

test('zoom out also triggers convergence (|Δzoom|)', () => {
    const d = createDamping();
    d.update({ depthD: 3.0, zoom: 2.0, lead: SRC.MAIN, factor: 5 });
    // Δzoom = -0.1 → alpha 0.5
    const out = d.update({ depthD: 1.0, zoom: 1.9, lead: SRC.MAIN, factor: 5 });
    assert.ok(Math.abs(out - 2.0) < 1e-12);
});

test('alpha clamps to 1 (snaps to desired on big zoom jump)', () => {
    const d = createDamping();
    d.update({ depthD: 3.0, zoom: 1.0, lead: SRC.MAIN, factor: 5 });
    // Δzoom = 1.0, factor 5 → alpha 5 → clamp 1 → snap to 0.7
    const out = d.update({ depthD: 0.7, zoom: 2.0, lead: SRC.MAIN, factor: 5 });
    assert.strictEqual(out, 0.7);
});

test('factor 0 → never converges', () => {
    const d = createDamping();
    d.update({ depthD: 3.0, zoom: 1.0, lead: SRC.MAIN, factor: 0 });
    const out = d.update({ depthD: 0.5, zoom: 2.0, lead: SRC.MAIN, factor: 0 });
    assert.strictEqual(out, 3.0);
});

test('lead source switch → snap to live D (H_applied resets to H_desired)', () => {
    const d = createDamping();
    d.update({ depthD: 3.0, zoom: 1.5, lead: SRC.SEC1, factor: 5 });
    d.update({ depthD: 0.5, zoom: 1.5, lead: SRC.SEC1, factor: 5 });  // frozen 3.0
    // segment boundary: lead SEC1 → MAIN, zoom unchanged → snap to 0.5
    const out = d.update({ depthD: 0.5, zoom: 1.5, lead: SRC.MAIN, factor: 5 });
    assert.strictEqual(out, 0.5);
});

test('bypass (trajectory/macro) returns live D and resyncs after', () => {
    const d = createDamping();
    d.update({ depthD: 3.0, zoom: 1.0, lead: SRC.MAIN, factor: 5 });
    // macro override: live D passes straight through
    assert.strictEqual(
        d.update({ depthD: 0.4, zoom: 0.8, lead: SRC.SEC1, factor: 5, bypass: true }), 0.4);
    // back to free mode: unseeded → snaps to current live D (no stale 3.0)
    assert.strictEqual(
        d.update({ depthD: 0.9, zoom: 0.8, lead: SRC.SEC1, factor: 5 }), 0.9);
});

test('multi-step convergence approaches desired monotonically', () => {
    const d = createDamping();
    d.update({ depthD: 5.0, zoom: 1.0, lead: SRC.MAIN, factor: 5 });
    let prev = 5.0, z = 1.0;
    for (let i = 0; i < 8; i++) {
        z += 0.05;   // alpha = 0.25 per step
        const out = d.update({ depthD: 1.0, zoom: z, lead: SRC.MAIN, factor: 5 });
        assert.ok(out < prev && out > 1.0);
        prev = out;
    }
    assert.ok(prev < 1.5);  // converged most of the way after 8 steps
});

test('reset unseeds → next update snaps to live D', () => {
    const d = createDamping();
    d.update({ depthD: 3.0, zoom: 1.0, lead: SRC.MAIN, factor: 5 });
    d.reset();
    assert.strictEqual(d.update({ depthD: 1.2, zoom: 1.0, lead: SRC.MAIN, factor: 5 }), 1.2);
});
