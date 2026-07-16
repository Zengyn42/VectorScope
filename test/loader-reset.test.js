import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getLoaderState, resetPositions, registerModel, initLoader } from '../src/loader.js';

/** Minimal Vector3/Euler stand-in (copy/clone/set — all resetPositions needs). */
function vec(x = 0, y = 0, z = 0) {
    return {
        x, y, z,
        set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
        copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; },
        clone() { return vec(this.x, this.y, this.z); },
    };
}

function fakeObj(uuid, pos = [0, 0, 0], rot = [0, 0, 0]) {
    return { uuid, name: uuid, position: vec(...pos), rotation: vec(...rot), userData: {} };
}

describe('resetPositions', () => {
    const state = getLoaderState();

    beforeEach(() => {
        state.objs = [];
        state.origPos.clear();
    });

    /** Register a fake object the way the loader does at load time. */
    const register = (o) => {
        state.objs.push(o);
        state.origPos.set(o.uuid, o.position.clone());
        o.userData._baseRot = o.rotation.clone();
    };

    it('restores positions to their snapshot', () => {
        const o = fakeObj('a', [1, 2, 3]);
        register(o);
        o.position.set(9, 9, 9);
        resetPositions();
        assert.deepEqual([o.position.x, o.position.y, o.position.z], [1, 2, 3]);
    });

    it('restores rotations to their snapshot (Reset All bug fix)', () => {
        const o = fakeObj('a', [0, 0, 0], [0.1, 0.2, 0.3]);
        register(o);
        o.rotation.set(1.5, -0.7, 3.0);   // user edited rotation via selection panel
        resetPositions();
        assert.deepEqual(
            [o.rotation.x, o.rotation.y, o.rotation.z].map(v => +v.toFixed(6)),
            [0.1, 0.2, 0.3]);
    });

    it('non-identity load-time rotation is preserved as the reset target', () => {
        const o = fakeObj('floor', [0, 0, 0], [-Math.PI / 2, 0, 0]);
        register(o);
        o.rotation.set(0, 0, 0);
        resetPositions();
        assert.equal(o.rotation.x, -Math.PI / 2);
    });

    it('objects without a rotation snapshot keep their current rotation', () => {
        const o = fakeObj('legacy', [1, 1, 1], [0, 0, 0]);
        state.objs.push(o);
        state.origPos.set(o.uuid, o.position.clone());   // old-style registration
        o.rotation.set(0.5, 0.5, 0.5);
        resetPositions();
        assert.equal(o.rotation.x, 0.5);                 // untouched (no _baseRot)
        assert.equal(o.position.x, 1);                   // position still resets
    });
});

describe('registerModel snapshots _baseRot', () => {
    it('records rotation at registration time', () => {
        initLoader({
            scene: { add: () => {}, children: [] },
            GLTFLoader: class { setDRACOLoader() {} },
            DRACOLoader: class { setDecoderPath() {} },
            dracoPath: '',
        });
        const child = fakeObj('c1', [1, 0, 0], [0, 1.25, 0]);
        child.type = 'Mesh'; child.isMesh = true; child.children = [];
        const root = { userData: {}, children: [child], traverse: () => {} };
        const added = registerModel(root);
        assert.equal(added.length, 1);
        assert.equal(child.userData._baseRot.y, 1.25);
    });
});
