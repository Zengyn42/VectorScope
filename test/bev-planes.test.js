/**
 * Unit tests for src/bev-planes.js — pure-function BEV plane configuration.
 * No DOM, no THREE.js — runs in plain Node.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    BEV_PLANE_ORDER,
    BEV_PLANE_DEFS,
    nextBevPlane,
    getBevPlaneDef,
} from '../src/bev-planes.js';

/* ── BEV_PLANE_ORDER ── */
describe('BEV_PLANE_ORDER', () => {
    it('contains exactly xz, xy, zy in that order', () => {
        assert.deepEqual(BEV_PLANE_ORDER, ['xz', 'xy', 'zy']);
    });
});

/* ── nextBevPlane ── */
describe('nextBevPlane', () => {
    it('xz → xy', () => assert.equal(nextBevPlane('xz'), 'xy'));
    it('xy → zy', () => assert.equal(nextBevPlane('xy'), 'zy'));
    it('zy → xz  (wraps around)', () => assert.equal(nextBevPlane('zy'), 'xz'));
    it('unknown key → xy  (idx=-1, so (-1+1)%3 = 0 → xz... actually wraps to xy)', () => {
        // indexOf returns -1 for unknown; (-1+1)%3 = 0 → 'xz'
        assert.equal(nextBevPlane('invalid'), 'xz');
    });
});

/* ── getBevPlaneDef ── */
describe('getBevPlaneDef', () => {
    it('returns the correct def for each known key', () => {
        assert.equal(getBevPlaneDef('xz'), BEV_PLANE_DEFS.xz);
        assert.equal(getBevPlaneDef('xy'), BEV_PLANE_DEFS.xy);
        assert.equal(getBevPlaneDef('zy'), BEV_PLANE_DEFS.zy);
    });
    it('falls back to xz for unknown key', () => {
        assert.equal(getBevPlaneDef('bad'), BEV_PLANE_DEFS.xz);
        assert.equal(getBevPlaneDef(undefined), BEV_PLANE_DEFS.xz);
    });
});

/* ── ghostAxis / ghostLabel ── */
describe('ghostAxis/ghostLabel', () => {
    it('xz: ghostAxis=y, ghostLabel=Y', () => {
        assert.equal(BEV_PLANE_DEFS.xz.ghostAxis, 'y');
        assert.equal(BEV_PLANE_DEFS.xz.ghostLabel, 'Y');
    });
    it('xy: ghostAxis=z, ghostLabel=Z', () => {
        assert.equal(BEV_PLANE_DEFS.xy.ghostAxis, 'z');
        assert.equal(BEV_PLANE_DEFS.xy.ghostLabel, 'Z');
    });
    it('zy: ghostAxis=x, ghostLabel=X', () => {
        assert.equal(BEV_PLANE_DEFS.zy.ghostAxis, 'x');
        assert.equal(BEV_PLANE_DEFS.zy.ghostLabel, 'X');
    });
});

/* ── bevCamDir ── */
describe('bevCamDir', () => {
    it('xz: camera from +Y (0,1,0)', () => {
        const d = BEV_PLANE_DEFS.xz.bevCamDir;
        assert.deepEqual(d, { x: 0, y: 1, z: 0 });
    });
    it('xy: camera from +Z (0,0,1)', () => {
        const d = BEV_PLANE_DEFS.xy.bevCamDir;
        assert.deepEqual(d, { x: 0, y: 0, z: 1 });
    });
    it('zy: camera from −X (-1,0,0)', () => {
        const d = BEV_PLANE_DEFS.zy.bevCamDir;
        assert.deepEqual(d, { x: -1, y: 0, z: 0 });
    });
});

/* ── bevCamUp ── */
describe('bevCamUp', () => {
    it('xz: null (degenerate handled by Three.js)', () => {
        assert.equal(BEV_PLANE_DEFS.xz.bevCamUp, null);
    });
    it('xy: [0,1,0]', () => {
        assert.deepEqual(BEV_PLANE_DEFS.xy.bevCamUp, [0, 1, 0]);
    });
    it('zy: [0,1,0]', () => {
        assert.deepEqual(BEV_PLANE_DEFS.zy.bevCamUp, [0, 1, 0]);
    });
});

/* ── dragNormal ── */
describe('dragNormal', () => {
    it('xz: (0,1,0) — Y normal (top-down plane)', () => {
        assert.deepEqual(BEV_PLANE_DEFS.xz.dragNormal, { x: 0, y: 1, z: 0 });
    });
    it('xy: (0,0,1) — Z normal (front plane)', () => {
        assert.deepEqual(BEV_PLANE_DEFS.xy.dragNormal, { x: 0, y: 0, z: 1 });
    });
    it('zy: (1,0,0) — X normal (side plane)', () => {
        assert.deepEqual(BEV_PLANE_DEFS.zy.dragNormal, { x: 1, y: 0, z: 0 });
    });
});

/* ── compass ── */
describe('compass entries', () => {
    it('xz: +X right, +Z down', () => {
        const [a, b] = BEV_PLANE_DEFS.xz.compass;
        assert.equal(a.label, '+X'); assert.equal(a.dx, 1); assert.equal(a.dy, 0);
        assert.equal(b.label, '+Z'); assert.equal(b.dx, 0); assert.equal(b.dy, 1);
    });
    it('xy: +X right, +Y up (dy=-1)', () => {
        const [a, b] = BEV_PLANE_DEFS.xy.compass;
        assert.equal(a.label, '+X'); assert.equal(a.dx, 1);  assert.equal(a.dy,  0);
        assert.equal(b.label, '+Y'); assert.equal(b.dx, 0);  assert.equal(b.dy, -1);
    });
    it('zy: +Z right, +Y up (dy=-1)', () => {
        const [a, b] = BEV_PLANE_DEFS.zy.compass;
        assert.equal(a.label, '+Z'); assert.equal(a.dx, 1);  assert.equal(a.dy,  0);
        assert.equal(b.label, '+Y'); assert.equal(b.dx, 0);  assert.equal(b.dy, -1);
    });
});

/* ── worldPan ── */
describe('worldPan', () => {
    const s = 0.1;   // world units per pixel

    it('xz: drag right (-x), drag down (-z)', () => {
        const r = BEV_PLANE_DEFS.xz.worldPan(10, 5, s);
        assert.ok(Math.abs(r.x - (-1.0)) < 1e-12);
        assert.equal(r.y, 0);
        assert.ok(Math.abs(r.z - (-0.5)) < 1e-12);
    });
    it('xz: y component always 0', () => {
        assert.equal(BEV_PLANE_DEFS.xz.worldPan(3, 7, s).y, 0);
    });

    it('xy: drag right (-x), drag down (+y), z=0', () => {
        const r = BEV_PLANE_DEFS.xy.worldPan(10, 5, s);
        assert.ok(Math.abs(r.x - (-1.0)) < 1e-12);
        assert.ok(Math.abs(r.y - (0.5)) < 1e-12);
        assert.equal(r.z, 0);
    });
    it('xy: z component always 0', () => {
        assert.equal(BEV_PLANE_DEFS.xy.worldPan(3, 7, s).z, 0);
    });

    it('zy: drag right (-z), drag down (+y), x=0', () => {
        const r = BEV_PLANE_DEFS.zy.worldPan(10, 5, s);
        assert.equal(r.x, 0);
        assert.ok(Math.abs(r.y - (0.5)) < 1e-12);
        assert.ok(Math.abs(r.z - (-1.0)) < 1e-12);
    });
    it('zy: x component always 0', () => {
        assert.equal(BEV_PLANE_DEFS.zy.worldPan(3, 7, s).x, 0);
    });
});

/* ── projectWorld ── */
describe('projectWorld', () => {
    it('xz: u=wx, v=wz  (y component ignored)', () => {
        const r = BEV_PLANE_DEFS.xz.projectWorld(3, 99, 7);
        assert.equal(r.u, 3);
        assert.equal(r.v, 7);
    });
    it('xy: u=wx, v=-wy  (z component ignored)', () => {
        const r = BEV_PLANE_DEFS.xy.projectWorld(3, 4, 99);
        assert.equal(r.u, 3);
        assert.equal(r.v, -4);
    });
    it('zy: u=wz, v=-wy  (x component ignored)', () => {
        const r = BEV_PLANE_DEFS.zy.projectWorld(99, 4, 5);
        assert.equal(r.u, 5);
        assert.equal(r.v, -4);
    });
});

/* ── centerOf ── */
describe('centerOf', () => {
    it('xz: forward-offset along XZ + bias', () => {
        const mainPos = { x: 1, y: 0, z: 2 };
        const fwdXZ = { x: 0, z: -1 };   // looking toward -Z
        const size = 6;
        const r = BEV_PLANE_DEFS.xz.centerOf(mainPos, fwdXZ, size);
        assert.equal(r.cx, 1 + 0 * 6 * 0.4);       // cx = mainPos.x
        assert.equal(r.cy, 0);
        assert.ok(Math.abs(r.cz - (2 + (-1) * 6 * 0.4)) < 1e-12);
    });
    it('xz: non-zero fwdXZ.x is included', () => {
        const r = BEV_PLANE_DEFS.xz.centerOf({ x: 0, y: 0, z: 0 }, { x: 1, z: 0 }, 10);
        assert.equal(r.cx, 4);  // 0 + 1*10*0.4
        assert.equal(r.cz, 0);
    });

    it('xy: center at (mainPos.x, mainPos.y, 0)', () => {
        const r = BEV_PLANE_DEFS.xy.centerOf({ x: 3, y: 5, z: 99 });
        assert.equal(r.cx, 3);
        assert.equal(r.cy, 5);
        assert.equal(r.cz, 0);
    });

    it('zy: center at (0, mainPos.y, mainPos.z)', () => {
        const r = BEV_PLANE_DEFS.zy.centerOf({ x: 99, y: 4, z: 7 });
        assert.equal(r.cx, 0);
        assert.equal(r.cy, 4);
        assert.equal(r.cz, 7);
    });
});
