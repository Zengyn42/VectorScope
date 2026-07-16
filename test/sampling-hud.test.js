import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatHMatrix, createSamplingRefresh } from '../src/sampling-hud.js';
import { SRC, computeSampleMatrix, computeFollowerMatrix } from '../src/zoom-pipeline.js';
import { DEF_CAM } from '../src/camera.js';

describe('formatHMatrix', () => {
    it('renders the label and box-drawing rows', () => {
        const html = formatHMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1], 'M_test');
        assert.ok(html.includes('M_test'));
        assert.ok(html.includes('\u250C'));   // ┌
        assert.ok(html.includes('\u2514'));   // └
        assert.equal(html.split('\n').length, 4);   // label + 3 rows
    });

    it('pads non-negative values with a leading space, 4 decimals', () => {
        const html = formatHMatrix([1.5, -0.25, 0, 0, 1, 0, 0, 0, 1]);
        assert.ok(html.includes(' 1.5000'));
        assert.ok(html.includes('-0.2500'));
    });

    it('defaults the label to H', () => {
        assert.ok(formatHMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1]).includes('>H</span>'));
    });
});

/** Mock warp material: records what .set() receives. */
function mockMatWarp() {
    const rec = { uSrc: null, uHi: null };
    return {
        rec,
        uniforms: {
            uSrc: { get value() { return rec.uSrc; }, set value(v) { rec.uSrc = v; } },
            uHi: { value: { set: (...v) => { rec.uHi = v; } } },
        },
    };
}

describe('createSamplingRefresh', () => {
    const mk = (over = {}) => {
        const S = {
            zoom: 1, warp: false, depthD: 3, prewarpScale: 1, prewarpScale2: 1,
            camParams: DEF_CAM, sampleSrc: null, sampleM: null,
            followerSrc: null, followerM: null, ...over,
        };
        const matWarp = mockMatWarp();
        let hud = null;
        const refreshH = createSamplingRefresh({
            S, R: { sec2: '__sec2' in over ? over.__sec2 : {} }, matWarp, rtW: 1080, rtH: 1920,
            onHud: (html) => { hud = html; },
        });
        return { S, matWarp, refreshH, getHud: () => hud };
    };

    it('is a no-op before camera params exist', () => {
        const { matWarp, refreshH, getHud } = mk({ camParams: null });
        refreshH();
        assert.equal(matWarp.rec.uSrc, null);
        assert.equal(getHud(), null);
    });

    it('pushes uniforms, stashes sample + follower state, and emits the HUD', () => {
        const { S, matWarp, refreshH, getHud } = mk({ zoom: 1.5 });
        refreshH();
        const opts = { z: 1.5, warp: false, D: 3, params: DEF_CAM, prewarp1: 1, prewarp2: 1, w: 1080, h: 1920 };
        const expect = computeSampleMatrix(opts);
        const fol = computeFollowerMatrix(opts);
        assert.equal(matWarp.rec.uSrc, expect.src);
        assert.deepEqual(matWarp.rec.uHi, expect.m);
        assert.equal(S.sampleSrc, expect.src);
        assert.deepEqual(S.sampleM, expect.m);
        assert.equal(S.followerSrc, fol.src);
        assert.deepEqual(S.followerM, fol.m);
        assert.ok(getHud().includes('Lead:'));
        assert.ok(getHud().includes('Z=1.50'));
        assert.ok(getHud().includes('raw'));   // warp off
    });

    it('hides sec2 from the pipeline when the rig has no Tele camera', () => {
        const { S, refreshH } = mk({ zoom: 3, __sec2: null });
        refreshH();
        // Segment C with no Tele available must stay on the Main camera path
        assert.equal(S.sampleSrc, SRC.MAIN);
        assert.equal(S.followerSrc, SRC.SEC1);
    });

    it('normalizes the displayed matrix so H[8] = 1', () => {
        const { refreshH, getHud } = mk({ zoom: 1.2 });
        refreshH();
        assert.ok(getHud().includes(' 1.0000 \u2518'));   // bottom-right corner
    });

    describe('S.liveM (per-source live sampling matrices)', () => {
        it('populates one entry per available camera; lead entry === sampleM', () => {
            const { S, refreshH } = mk({ zoom: 1.5 });
            refreshH();
            const keys = Object.keys(S.liveM).map(Number).sort();
            assert.deepEqual(keys, [SRC.SEC1, SRC.MAIN, SRC.SEC2].sort());
            assert.equal(S.liveM[S.sampleSrc], S.sampleM);
        });

        it('omits the Tele entry when the rig has no Tele camera', () => {
            const { S, refreshH } = mk({ zoom: 1.5, __sec2: null });
            refreshH();
            assert.ok(!(SRC.SEC2 in S.liveM));
            assert.ok(SRC.SEC1 in S.liveM);
            assert.ok(SRC.MAIN in S.liveM);
        });

        it('warp ON: the follower entry equals the dual-mode follower matrix', () => {
            const { S, refreshH } = mk({ zoom: 1.5, warp: true });
            refreshH();
            assert.deepEqual(S.liveM[S.followerSrc], S.followerM);
        });

        it('warp OFF: non-lead entries match computeFollowerMatrix for that source', () => {
            const { S, refreshH } = mk({ zoom: 1.5 });
            refreshH();
            const opts = { z: 1.5, warp: false, D: 3, params: DEF_CAM, prewarp1: 1, prewarp2: 1, w: 1080, h: 1920 };
            for (const s of [SRC.SEC1, SRC.SEC2]) {
                const exp = computeFollowerMatrix({ ...opts, followerSrc: s });
                assert.deepEqual(S.liveM[s], exp.m);
            }
        });

        it('recomputes with zoom — the frozen frame keeps scaling during a blend', () => {
            const { S, refreshH } = mk({ zoom: 1.2, warp: true });
            refreshH();
            const before = S.liveM[SRC.SEC1].slice();
            S.zoom = 1.8;
            refreshH();
            assert.notDeepEqual(S.liveM[SRC.SEC1], before);
        });
    });
});
