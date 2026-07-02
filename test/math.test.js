import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { M } from '../src/math.js';

const EPS = 1e-9;

function assertVecClose(actual, expected, msg) {
    assert.equal(actual.length, expected.length, `${msg}: length mismatch`);
    for (let i = 0; i < actual.length; i++) {
        assert.ok(Math.abs(actual[i] - expected[i]) < EPS,
            `${msg}: [${i}] got ${actual[i]}, expected ${expected[i]}`);
    }
}

describe('M.id', () => {
    it('returns 3x3 identity', () => {
        assertVecClose(M.id(), [1,0,0, 0,1,0, 0,0,1], 'identity');
    });
});

describe('M.mul', () => {
    it('A * I = A', () => {
        const A = [1,2,3, 4,5,6, 7,8,9];
        assertVecClose(M.mul(A, M.id()), A, 'A*I');
    });

    it('I * A = A', () => {
        const A = [1,2,3, 4,5,6, 7,8,9];
        assertVecClose(M.mul(M.id(), A), A, 'I*A');
    });

    it('known product', () => {
        const A = [1,2,0, 0,1,0, 0,0,1];
        const B = [1,0,3, 0,1,0, 0,0,1];
        // Row 0: [1*1+2*0+0*0, 1*0+2*1+0*0, 1*3+2*0+0*1] = [1, 2, 3]
        // Row 1: [0,1,0] * B = [0,1,0]
        // Row 2: [0,0,1] * B = [0,0,1]
        assertVecClose(M.mul(A, B), [1,2,3, 0,1,0, 0,0,1], 'known product');
    });
});

describe('M.inv', () => {
    it('inv(I) = I', () => {
        assertVecClose(M.inv(M.id()), M.id(), 'inv(I)');
    });

    it('A * inv(A) = I', () => {
        const A = [2,1,0, 0,3,1, 1,0,2];
        const Ai = M.inv(A);
        assert.ok(Ai !== null, 'should be invertible');
        assertVecClose(M.mul(A, Ai), M.id(), 'A*inv(A)');
    });

    it('inv(A) * A = I', () => {
        const A = [2,1,0, 0,3,1, 1,0,2];
        const Ai = M.inv(A);
        assertVecClose(M.mul(Ai, A), M.id(), 'inv(A)*A');
    });

    it('singular matrix returns null', () => {
        const S = [1,2,3, 4,5,6, 7,8,9]; // rank 2
        assert.equal(M.inv(S), null, 'singular');
    });
});

describe('M.T', () => {
    it('transpose identity = identity', () => {
        assertVecClose(M.T(M.id()), M.id(), 'T(I)');
    });

    it('transpose swaps off-diagonal', () => {
        const A = [1,2,3, 4,5,6, 7,8,9];
        assertVecClose(M.T(A), [1,4,7, 2,5,8, 3,6,9], 'transpose');
    });

    it('T(T(A)) = A', () => {
        const A = [1,2,3, 4,5,6, 7,8,9];
        assertVecClose(M.T(M.T(A)), A, 'double transpose');
    });
});

describe('M.v', () => {
    it('I * v = v', () => {
        assertVecClose(M.v(M.id(), [3,4,5]), [3,4,5], 'I*v');
    });

    it('known product', () => {
        const A = [1,0,2, 0,1,0, 0,0,1];
        assertVecClose(M.v(A, [1,1,1]), [3,1,1], 'Av');
    });
});

describe('M.out', () => {
    it('outer product', () => {
        assertVecClose(M.out([1,0,0], [0,0,1]),
            [0,0,1, 0,0,0, 0,0,0], 'outer [1,0,0]x[0,0,1]');
    });

    it('outer product general', () => {
        assertVecClose(M.out([2,3,0], [1,4,0]),
            [2,8,0, 3,12,0, 0,0,0], 'outer general');
    });
});

describe('M.add / M.sc', () => {
    it('add two matrices', () => {
        assertVecClose(M.add(M.id(), M.id()), [2,0,0, 0,2,0, 0,0,2], 'I+I');
    });

    it('scalar multiply', () => {
        assertVecClose(M.sc(M.id(), 3), [3,0,0, 0,3,0, 0,0,3], '3*I');
    });
});

describe('M.lerp', () => {
    it('lerp(A,B,0) = A', () => {
        const A = [1,0,0, 0,1,0, 0,0,1];
        const B = [2,0,0, 0,2,0, 0,0,2];
        assertVecClose(M.lerp(A, B, 0), A, 'lerp t=0');
    });

    it('lerp(A,B,1) = B', () => {
        const A = [1,0,0, 0,1,0, 0,0,1];
        const B = [2,0,0, 0,2,0, 0,0,2];
        assertVecClose(M.lerp(A, B, 1), B, 'lerp t=1');
    });

    it('lerp(A,B,0.5) = midpoint', () => {
        const A = [0,0,0, 0,0,0, 0,0,0];
        const B = [2,4,6, 8,10,12, 14,16,18];
        assertVecClose(M.lerp(A, B, 0.5), [1,2,3, 4,5,6, 7,8,9], 'lerp t=0.5');
    });
});

describe('M.K', () => {
    it('builds intrinsic matrix', () => {
        assertVecClose(M.K(1500, 1500, 960, 540),
            [1500,0,960, 0,1500,540, 0,0,1], 'K matrix');
    });

    it('K * [0,0,1] = [cx,cy,1]', () => {
        const K = M.K(1500, 1500, 960, 540);
        assertVecClose(M.v(K, [0,0,1]), [960,540,1], 'K*[0,0,1]');
    });
});

describe('M.inv(M.mul(A,B)) = M.mul(M.inv(B), M.inv(A))', () => {
    it('inverse of product', () => {
        const A = [2,1,0, 0,3,1, 1,0,2];
        const B = [1,0,1, 2,1,0, 0,1,3];
        const AB = M.mul(A, B);
        const invAB = M.inv(AB);
        const invB_invA = M.mul(M.inv(B), M.inv(A));
        assertVecClose(invAB, invB_invA, 'inv(AB) = inv(B)*inv(A)');
    });
});
