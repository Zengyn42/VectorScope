import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    bezierAt, bezierDerivAt, solveBezierT, evalCurve, sampleCurve, DEFAULT_CURVE,
} from '../src/bezier-curve.js';

const EPS = 1e-6;

describe('bezierAt', () => {
    it('t=0 returns v0', () => {
        assert.ok(Math.abs(bezierAt(0, 10, 20, 30, 40) - 10) < EPS);
    });

    it('t=1 returns v3', () => {
        assert.ok(Math.abs(bezierAt(1, 10, 20, 30, 40) - 40) < EPS);
    });

    it('t=0.5 on linear curve returns midpoint', () => {
        // Linear: v0=0, v1=0.33, v2=0.67, v3=1 → midpoint ≈ 0.5
        const v = bezierAt(0.5, 0, 1/3, 2/3, 1);
        assert.ok(Math.abs(v - 0.5) < 0.01);
    });
});

describe('bezierDerivAt', () => {
    it('derivative of linear curve is constant', () => {
        // Linear: P = [0, 1/3, 2/3, 1]
        const d0 = bezierDerivAt(0, 0, 1/3, 2/3, 1);
        const d5 = bezierDerivAt(0.5, 0, 1/3, 2/3, 1);
        const d1 = bezierDerivAt(1, 0, 1/3, 2/3, 1);
        assert.ok(Math.abs(d0 - d5) < EPS);
        assert.ok(Math.abs(d5 - d1) < EPS);
    });
});

describe('solveBezierT', () => {
    it('finds t for x on linear curve', () => {
        const t = solveBezierT(0.5, 0, 1/3, 2/3, 1);
        assert.ok(Math.abs(t - 0.5) < 1e-4);
    });

    it('finds t=0 for x=x0', () => {
        const t = solveBezierT(0, 0, 0.33, 0.67, 1);
        assert.ok(Math.abs(t) < 1e-4);
    });

    it('finds t=1 for x=x3', () => {
        const t = solveBezierT(1, 0, 0.33, 0.67, 1);
        assert.ok(Math.abs(t - 1) < 1e-4);
    });

    it('handles non-[0,1] range', () => {
        const t = solveBezierT(0.5, 0.2, 0.4, 0.6, 0.8);
        // x=0.5 is midpoint of [0.2, 0.8] → t ≈ 0.5
        assert.ok(Math.abs(t - 0.5) < 1e-3);
    });
});

describe('evalCurve', () => {
    it('default linear curve: y ≈ x', () => {
        for (const x of [0, 0.25, 0.5, 0.75, 1.0]) {
            const y = evalCurve(x, DEFAULT_CURVE);
            assert.ok(Math.abs(y - x) < 0.02, `x=${x} y=${y}`);
        }
    });

    it('x < P1.x returns 0', () => {
        const curve = { p1: { x: 0.2, y: 0.1 }, p2: { x: 0.4, y: 0.3 }, p3: { x: 0.6, y: 0.7 }, p4: { x: 0.8, y: 0.9 } };
        assert.equal(evalCurve(0.1, curve), 0);
        assert.equal(evalCurve(0, curve), 0);
    });

    it('x > P4.x returns 1', () => {
        const curve = { p1: { x: 0.2, y: 0.1 }, p2: { x: 0.4, y: 0.3 }, p3: { x: 0.6, y: 0.7 }, p4: { x: 0.8, y: 0.9 } };
        assert.equal(evalCurve(0.9, curve), 1);
        assert.equal(evalCurve(1.0, curve), 1);
    });

    it('x = P1.x returns 0 (clamp)', () => {
        assert.equal(evalCurve(0, DEFAULT_CURVE), 0);
    });

    it('x = P4.x returns 1 (clamp)', () => {
        assert.equal(evalCurve(1, DEFAULT_CURVE), 1);
    });

    it('ease-in curve: y < x at midpoint', () => {
        // Strong ease-in: P2 pulled down
        const curve = {
            p1: { x: 0, y: 0 },
            p2: { x: 0.8, y: 0.0 },  // late start
            p3: { x: 1.0, y: 0.8 },
            p4: { x: 1, y: 1 },
        };
        const y = evalCurve(0.5, curve);
        assert.ok(y < 0.4, `ease-in at 0.5: y=${y} should be < 0.4`);
    });

    it('ease-out curve: y > x at midpoint', () => {
        // Strong ease-out: P2 pulled up
        const curve = {
            p1: { x: 0, y: 0 },
            p2: { x: 0.0, y: 0.8 },  // early rise
            p3: { x: 0.2, y: 1.0 },
            p4: { x: 1, y: 1 },
        };
        const y = evalCurve(0.5, curve);
        assert.ok(y > 0.6, `ease-out at 0.5: y=${y} should be > 0.6`);
    });
});

describe('sampleCurve', () => {
    it('returns n+1 points', () => {
        const pts = sampleCurve(DEFAULT_CURVE, 10);
        assert.equal(pts.length, 11);
    });

    it('first point is P1, last is P4', () => {
        const pts = sampleCurve(DEFAULT_CURVE, 10);
        assert.ok(Math.abs(pts[0].x - 0) < EPS);
        assert.ok(Math.abs(pts[0].y - 0) < EPS);
        assert.ok(Math.abs(pts[10].x - 1) < EPS);
        assert.ok(Math.abs(pts[10].y - 1) < EPS);
    });

    it('monotonically increasing x for default curve', () => {
        const pts = sampleCurve(DEFAULT_CURVE, 32);
        for (let i = 1; i < pts.length; i++) {
            assert.ok(pts[i].x >= pts[i - 1].x - EPS, `x not monotonic at ${i}`);
        }
    });
});
