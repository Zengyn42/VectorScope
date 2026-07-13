import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VS, FS, createWarpMaterial } from '../src/shader.js';

describe('shader GLSL', () => {
    it('VS exports a valid vertex shader string', () => {
        assert.ok(typeof VS === 'string');
        assert.ok(VS.includes('gl_Position'));
        assert.ok(VS.includes('vUv'));
    });

    it('FS exports a valid fragment shader string', () => {
        assert.ok(typeof FS === 'string');
        assert.ok(FS.includes('gl_FragColor'));
    });

    it('FS declares all required uniforms', () => {
        const required = ['tS1', 'tM', 'tS2', 'uSrc', 'uHi', 'uR',
            'uPrevSrc', 'uPrevHi', 'uBlend', 'uBlendRadial', 'uCoverRadius'];
        for (const u of required) {
            assert.ok(FS.includes(`uniform`) && FS.includes(u),
                `FS should declare uniform ${u}`);
        }
    });

    it('FS has warpSample function', () => {
        assert.ok(FS.includes('warpSample'));
    });

    it('FS has inBounds check', () => {
        assert.ok(FS.includes('inBounds'));
    });

    it('FS handles radial blend (both directions)', () => {
        assert.ok(FS.includes('uBlendRadial == 1'), 'radial-in branch');
        assert.ok(FS.includes('uBlendRadial != 0'), 'radial entry guard');
    });

    it('FS handles OOB prev pixels with soft edge falloff (no black edges)', () => {
        assert.ok(FS.includes('edgeWeight'), 'soft edge weight function');
        assert.ok(FS.includes('prevEdge'), 'per-pixel edge weight for prev camera');
    });
});

describe('createWarpMaterial', () => {
    it('is a function that accepts (THREE, tex, tex, tex, w, h)', () => {
        assert.equal(typeof createWarpMaterial, 'function');
        assert.equal(createWarpMaterial.length, 6);
    });

    it('creates a material with all expected uniforms', () => {
        // Minimal THREE mock
        const mockTHREE = {
            ShaderMaterial: class {
                constructor(opts) { this.uniforms = opts.uniforms; this.vertexShader = opts.vertexShader; this.fragmentShader = opts.fragmentShader; }
            },
            Matrix3: class { constructor() {} },
            Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
        };
        const mat = createWarpMaterial(mockTHREE, 'texS1', 'texM', 'texS2', 1080, 1920);
        const uNames = Object.keys(mat.uniforms);
        for (const u of ['tS1', 'tM', 'tS2', 'uSrc', 'uHi', 'uR', 'uPrevSrc', 'uPrevHi', 'uBlend', 'uBlendRadial', 'uCoverRadius']) {
            assert.ok(uNames.includes(u), `missing uniform ${u}`);
        }
    });

    it('sets correct default uniform values', () => {
        const mockTHREE = {
            ShaderMaterial: class { constructor(opts) { this.uniforms = opts.uniforms; } },
            Matrix3: class { constructor() {} },
            Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
        };
        const mat = createWarpMaterial(mockTHREE, 'a', 'b', 'c', 100, 200);
        assert.equal(mat.uniforms.uBlend.value, 1.0);
        assert.equal(mat.uniforms.uBlendRadial.value, 0);
        assert.equal(mat.uniforms.uCoverRadius.value, 1.0);
        assert.equal(mat.uniforms.uSrc.value, 1);  // default = MAIN
    });
});
