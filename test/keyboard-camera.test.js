import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyCameraKey } from '../src/keyboard-camera.js';
import { eulerToQuat } from '../src/camera-preset.js';

const IDENT = { x: 0, y: 0, z: 0, w: 1 };   // THREE.Quaternion-like identity

function cam(pos = [0, 0, 0], rot = [0, 0, 0]) {
    return { position: [...pos], rotation_euler_deg: [...rot] };
}

function assertVecClose(a, b, eps = 1e-9) {
    for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(a[i] - b[i]) < eps, `component ${i}: ${a[i]} vs ${b[i]}`);
    }
}

describe('keyboard-camera applyCameraKey', () => {
    it('ignores non-WASDQE keys and multi-char keys', () => {
        const c = cam();
        assert.equal(applyCameraKey('x', false, c, IDENT), false);
        assert.equal(applyCameraKey('Escape', false, c, IDENT), false);
        assert.equal(applyCameraKey('z', true, c, IDENT), false);
        assert.deepEqual(c.position, [0, 0, 0]);
        assert.deepEqual(c.rotation_euler_deg, [0, 0, 0]);
    });

    it('translates along identity-quat axes (W fwd = -Z, D right = +X, E up = +Y)', () => {
        const c = cam();
        assert.equal(applyCameraKey('w', false, c, IDENT), true);
        assertVecClose(c.position, [0, 0, -0.1]);
        applyCameraKey('d', false, c, IDENT);
        assertVecClose(c.position, [0.1, 0, -0.1]);
        applyCameraKey('e', false, c, IDENT);
        assertVecClose(c.position, [0.1, 0.1, -0.1]);
        // Inverses cancel
        applyCameraKey('s', false, c, IDENT);
        applyCameraKey('a', false, c, IDENT);
        applyCameraKey('q', false, c, IDENT);
        assertVecClose(c.position, [0, 0, 0]);
    });

    it('translation follows the main camera quaternion (yaw 90° → fwd = -X)', () => {
        // yaw +90° about Y: forward (0,0,-1) → (-1,0,0)
        const q = eulerToQuat([0, 90, 0]);   // [x,y,z,w] array form accepted
        const c = cam();
        applyCameraKey('w', false, c, q);
        assertVecClose(c.position, [-0.1, 0, 0], 1e-9);
        // right (1,0,0) → (0,0,-1)
        applyCameraKey('d', false, c, q);
        assertVecClose(c.position, [-0.1, 0, -0.1], 1e-9);
        // Q/E stay world-vertical regardless of orientation
        applyCameraKey('e', false, c, q);
        assertVecClose(c.position, [-0.1, 0.1, -0.1], 1e-9);
    });

    it('shift rotates euler degrees (A yaw+, W pitch+, Q roll+, 2° steps)', () => {
        const c = cam();
        assert.equal(applyCameraKey('a', true, c, IDENT), true);
        assert.deepEqual(c.rotation_euler_deg, [0, 2, 0]);
        applyCameraKey('w', true, c, IDENT);
        applyCameraKey('q', true, c, IDENT);
        assert.deepEqual(c.rotation_euler_deg, [2, 2, 2]);
        applyCameraKey('d', true, c, IDENT);
        applyCameraKey('s', true, c, IDENT);
        applyCameraKey('e', true, c, IDENT);
        assert.deepEqual(c.rotation_euler_deg, [0, 0, 0]);
        // Rotation never touches position
        assert.deepEqual(c.position, [0, 0, 0]);
    });

    it('accepts uppercase keys and custom step sizes', () => {
        const c = cam();
        assert.equal(applyCameraKey('W', false, c, IDENT, { step: 1 }), true);
        assertVecClose(c.position, [0, 0, -1]);
        assert.equal(applyCameraKey('A', true, c, IDENT, { deg: 10 }), true);
        assert.deepEqual(c.rotation_euler_deg, [0, 10, 0]);
    });
});
