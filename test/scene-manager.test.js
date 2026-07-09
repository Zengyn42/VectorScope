import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSceneManager } from '../src/scene-manager.js';

/** Build a manager with scriptable loader + fallback mocks. */
function mk({ loaded = false } = {}) {
    const calls = { clearAll: 0, fbAdd: 0, fbRemove: 0, logs: [] };
    const loader = { loaded, objs: ['a'], origPos: new Map([['a', 1]]) };
    let pending = null;   // captured loadScene opts, resolved by the test
    const S = { objs: [], origPos: new Map() };
    const mgr = createSceneManager({
        S,
        sceneAnim: { clearAll: () => calls.clearAll++ },
        loadScene: (url, opts) => { pending = { url, opts }; },
        getLoaderState: () => loader,
        fallback: { add: () => calls.fbAdd++, remove: () => calls.fbRemove++ },
        log: (m) => calls.logs.push(m),
    });
    return { mgr, S, calls, loader, getPending: () => pending };
}

describe('createSceneManager', () => {
    it('doLoadScene clears animations before objects are replaced', () => {
        const { mgr, calls, getPending } = mk();
        mgr.doLoadScene('x.glb');
        assert.equal(calls.clearAll, 1);
        assert.equal(getPending().url, 'x.glb');
        assert.equal(getPending().opts.isDefault, false);
    });

    it('onComplete removes the fallback and syncs S from the loader registry', () => {
        const { mgr, S, calls, loader, getPending } = mk();
        mgr.doLoadScene('x.glb', true);
        getPending().opts.onComplete(7);
        assert.equal(calls.fbRemove, 1);
        assert.equal(S.objs, loader.objs);
        assert.equal(S.origPos, loader.origPos);
        assert.ok(calls.logs.at(-1).includes('7 objects'));
    });

    it('onError shows the fallback only for the default scene when nothing loaded', () => {
        const a = mk();
        a.mgr.doLoadScene('x.glb', true);
        a.getPending().opts.onError();
        assert.equal(a.calls.fbAdd, 1);

        const b = mk();                       // non-default: no fallback
        b.mgr.doLoadScene('x.glb', false);
        b.getPending().opts.onError();
        assert.equal(b.calls.fbAdd, 0);

        const c = mk({ loaded: true });       // already loaded: no fallback
        c.mgr.doLoadScene('x.glb', true);
        c.getPending().opts.onError();
        assert.equal(c.calls.fbAdd, 0);
    });

    it('add/removeFallback keep S in sync with the loader registry', () => {
        const { mgr, S, calls, loader } = mk();
        mgr.addFallback();
        assert.equal(calls.fbAdd, 1);
        assert.equal(S.objs, loader.objs);
        mgr.removeFallback();
        assert.equal(calls.fbRemove, 1);
    });

    it('armFallbackTimer fires only if nothing has loaded by the deadline', async () => {
        const a = mk();
        a.mgr.armFallbackTimer(1);
        await new Promise(r => setTimeout(r, 15));
        assert.equal(a.calls.fbAdd, 1);

        const b = mk({ loaded: true });
        b.mgr.armFallbackTimer(1);
        await new Promise(r => setTimeout(r, 15));
        assert.equal(b.calls.fbAdd, 0);
    });
});
