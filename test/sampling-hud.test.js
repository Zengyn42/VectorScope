import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatHMatrix, createSamplingRefresh } from '../src/sampling-hud.js';
import { SRC, computeSampleMatrix, computeFollowerMatrix, computeSampleMatrixExplicit } from '../src/zoom-pipeline.js';
import { DEF_CAM } from '../src/camera.js';
import { createSegmentConfig } from '../src/segment-config.js';

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
            S, R: { sec2: '__sec2' in over ? over.__sec2 : {} }, matWarp, rtW: 1920, rtH: 1080,
            onHud: (html) => { hud = html; },
            ...(over.__getOverride ? { getOverride: over.__getOverride } : {}),
            ...(over.__segCfg ? { getSegCfg: () => over.__segCfg } : {}),
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
        const opts = { z: 1.5, warp: false, D: 3, params: DEF_CAM, prewarp1: 1, prewarp2: 1, w: 1920, h: 1080 };
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

    describe('trajectory override respects per-segment warp flag', () => {
        const base = { z: 0, warp: false, D: 3, params: DEF_CAM, prewarp1: 1, prewarp2: 1, w: 1920, h: 1080 };

        it('plain-crop segment (Main 1-2x, warp:false) stays a crop during playback', () => {
            const segCfg = createSegmentConfig();
            const { S, refreshH } = mk({
                zoom: 1.5, warp: true, __segCfg: segCfg,
                __getOverride: () => ({ leadSrc: SRC.MAIN, followerSrc: SRC.SEC1, label: 'TRAJ' }),
            });
            refreshH();
            // Segment [1,2) has warp:false → applied matrix must be the plain
            // crop, NOT a warp interpolation toward the file's follower (UW).
            const crop = computeSampleMatrixExplicit({ ...base, z: 1.5, leadSrc: SRC.MAIN });
            assert.deepEqual(S.sampleM, crop.m);
        });

        it('warp segment (UW 0.5-1x, warp:true) still interpolates during playback', () => {
            const segCfg = createSegmentConfig();
            const { S, refreshH } = mk({
                zoom: 0.8, warp: true, __segCfg: segCfg,
                __getOverride: () => ({ leadSrc: SRC.SEC1, followerSrc: SRC.MAIN, label: 'TRAJ' }),
            });
            refreshH();
            const warped = computeSampleMatrixExplicit({
                ...base, z: 0.8, warp: true, leadSrc: SRC.SEC1, followerSrc: SRC.MAIN,
                segRange: segCfg.getSegmentRange(0.8),
            });
            assert.deepEqual(S.sampleM, warped.m);
        });

        it('macro override (warpT set) keeps its forced warp in a plain-crop segment', () => {
            const segCfg = createSegmentConfig();
            const { S, refreshH } = mk({
                zoom: 1.5, warp: true, __segCfg: segCfg,
                __getOverride: () => ({ leadSrc: SRC.SEC1, warpT: 1, damp: true }),
            });
            refreshH();
            const crop = computeSampleMatrixExplicit({ ...base, z: 1.5, leadSrc: SRC.SEC1 });
            assert.notDeepEqual(S.sampleM, crop.m);   // warped, not a plain UW crop
        });
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
            const opts = { z: 1.5, warp: false, D: 3, params: DEF_CAM, prewarp1: 1, prewarp2: 1, w: 1920, h: 1080 };
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
