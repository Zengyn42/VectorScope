import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createConfigStore } from '../src/config-store.js';

describe('config-store', () => {
    it('register + get returns the defaults as a deep copy', () => {
        const st = createConfigStore();
        st.register('controls', { defaults: { zoom: 1, warp: false } });
        const v = st.get('controls');
        assert.deepEqual(v, { zoom: 1, warp: false });
        v.zoom = 99;                                   // mutation must not leak
        assert.equal(st.get('controls').zoom, 1);
    });

    it('set shallow-merges a patch and runs the apply hook with the merged value', () => {
        const st = createConfigStore();
        const applied = [];
        st.register('controls', { defaults: { zoom: 1, warp: false }, apply: v => applied.push(v) });
        st.set('controls', { zoom: 2.5 });
        assert.deepEqual(st.get('controls'), { zoom: 2.5, warp: false });
        assert.deepEqual(applied, [{ zoom: 2.5, warp: false }]);
    });

    it('subscribe fires on set with a copy; unsubscribe stops notifications', () => {
        const st = createConfigStore();
        st.register('a', { defaults: { x: 0 } });
        const seen = [];
        const un = st.subscribe('a', v => seen.push(v.x));
        st.set('a', { x: 1 });
        st.set('a', { x: 2 });
        un();
        st.set('a', { x: 3 });
        assert.deepEqual(seen, [1, 2]);
    });

    it('get/set on an unknown section throws', () => {
        const st = createConfigStore();
        assert.throws(() => st.get('nope'), /unknown section/);
        assert.throws(() => st.set('nope', {}), /unknown section/);
    });

    it('serialize bundles every registered section', () => {
        const st = createConfigStore();
        st.register('controls', { defaults: { zoom: 1 } });
        st.register('cameras', { defaults: { fov: 60 } });
        st.set('controls', { zoom: 5 });
        assert.deepEqual(st.serialize(), { controls: { zoom: 5 }, cameras: { fov: 60 } });
    });

    it('applyAll resets to defaults then merges saved values, running apply hooks', () => {
        const st = createConfigStore();
        const applied = [];
        st.register('controls', { defaults: { zoom: 1, warp: false }, apply: v => applied.push(v) });
        st.set('controls', { warp: true });            // pre-load dirty state
        applied.length = 0;
        st.applyAll({ controls: { zoom: 3 } });        // saved file lacks 'warp'
        // warp must reset to default false, not keep dirty true
        assert.deepEqual(st.get('controls'), { zoom: 3, warp: false });
        assert.equal(applied.length, 1);
    });

    it('applyAll ignores unknown sections and leaves missing sections untouched', () => {
        const st = createConfigStore();
        st.register('a', { defaults: { x: 0 } });
        st.register('b', { defaults: { y: 0 } });
        st.set('b', { y: 7 });
        st.applyAll({ a: { x: 1 }, future_section: { z: 9 } });
        assert.equal(st.get('a').x, 1);
        assert.equal(st.get('b').y, 7);                // untouched
    });

    it('re-register keeps current value but replaces the apply hook', () => {
        const st = createConfigStore();
        st.register('a', { defaults: { x: 0 } });
        st.set('a', { x: 5 });
        const applied = [];
        st.register('a', { defaults: { x: 0, y: 1 }, apply: v => applied.push(v) });
        assert.deepEqual(st.get('a'), { x: 5, y: 1 }); // value kept, new default key added
        st.set('a', { y: 2 });
        assert.equal(applied.length, 1);
    });
});
