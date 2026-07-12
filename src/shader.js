/**
 * @module shader
 * @description
 * GLSL warp shader and material factory for the Combined panel.
 *
 * The Combined panel implements a continuous 0.5x–10x zoom pipeline over the
 * three-camera rig (sec1 = wide 0.5x, main = 1x, sec2 = tele 5x). All zoom /
 * homography-interpolation / prewarp logic is composed **on the CPU** into a
 * single pixel-space sampling matrix per frame (see `refreshH` in index.html):
 *
 * | Zoom segment | Source | Warp ON                          | Warp OFF              |
 * |--------------|--------|----------------------------------|-----------------------|
 * | 0.5–1.0x     | sec1   | lerp(I → H1⁻¹), t log-scale      | prewarp1 · crop(z)    |
 * | 1.0–2.0x     | main   | crop(z)                          | crop(z)               |
 * | 2.0–5.0x     | main   | lerp(crop(2) → H2⁻¹), t log     | prewarp2 · crop(z)    |
 * | 5.0–10x      | sec2   | crop(z/5)                        | crop(z/5)             |
 *
 * H1: sec1→main plane-induced homography; H2: main→sec2. Both share the same
 * focus-plane depth D. The shader itself is dumb: for each output pixel it
 * applies the sampling matrix `uHi` (output px → source px) and samples the
 * texture selected by `uSrc`.
 *
 * **Uniforms:**
 * | Name   | Type    | Description |
 * |--------|---------|-------------|
 * | `tS1`  | sampler | UW camera (ultra wide) render target texture |
 * | `tM`   | sampler | Main camera render target texture |
 * | `tS2`  | sampler | Tele camera (telescope) render target texture |
 * | `uSrc` | int     | Source selector: 0 = UW, 1 = main, 2 = Tele |
 * | `uHi`  | mat3    | Pixel-space sampling matrix (output px → source px) |
 * | `uR`   | vec2    | Render target resolution [width, height] |
 * | `uPrevSrc` | int  | Previous-layer source during a transition blend (single: outgoing camera; dual: live follower) |
 * | `uPrevHi`  | mat3 | Previous-layer sampling matrix (single: frozen last frame; dual: live follower matrix) |
 * | `uBlend`   | float| Weight of the current frame (n/X); 1.0 disables blending |
 * | `uBlendRadial` | int | 0 = flat blend (uniform alpha), 1 = radial blend (center-out) |
 *
 * Out-of-bounds pixels render as dark background `(0.06, 0.06, 0.12)`.
 *
 * Pure data + factory — no DOM, no side effects.
 *
 * @requires three (passed as dependency to `createWarpMaterial`)
 *
 * @example
 * import { createWarpMaterial } from './shader.js';
 * const material = createWarpMaterial(THREE, rtS1.texture, rtM.texture, rtS2.texture, 1080, 1920);
 * quad.material = material;
 * material.uniforms.uHi.value.set(...samplingMatrixElements);
 * material.uniforms.uSrc.value = 1;
 */

export const VS = `
varying vec2 vUv;
void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;

export const FS = `
uniform sampler2D tS1, tM, tS2;
uniform int uSrc;
uniform mat3 uHi;
uniform vec2 uR;
uniform int uPrevSrc;    // outgoing camera during a transition blend
uniform mat3 uPrevHi;    // its frozen sampling matrix (last displayed frame)
uniform float uBlend;    // weight of the CURRENT frame: n/X; 1.0 = no blend
uniform int uBlendRadial; // 0 = flat (uniform alpha), 1 = radial (center-out)
varying vec2 vUv;

// Warp-sample one camera texture: apply the pixel-space sampling matrix M
// (output px -> source px) and fetch from the selected source.
vec4 warpSample(int src, mat3 M, vec2 px){
    vec3 sp = M * vec3(px, 1.);
    vec2 s = vec2(sp.x / sp.z / uR.x, 1. - sp.y / sp.z / uR.y);
    if(s.x >= 0. && s.x <= 1. && s.y >= 0. && s.y <= 1.){
        if(src == 0)      return texture2D(tS1, s);
        else if(src == 2) return texture2D(tS2, s);
        else              return texture2D(tM, s);
    }
    return vec4(.06, .06, .12, 1.);
}

void main(){
    // Output pixel coords (y-down image convention)
    vec2 px = vec2(vUv.x * uR.x, (1. - vUv.y) * uR.y);
    vec4 col = warpSample(uSrc, uHi, px);
    // Camera-transition blending: cross-fade from the outgoing camera's
    // frozen last frame to the live incoming camera over X frames.
    if(uBlend < 1.){
        vec4 prev = warpSample(uPrevSrc, uPrevHi, px);
        float w = uBlend;
        if(uBlendRadial == 1){
            // Radial blend: center stays on the outgoing (small-FOV) image
            // longer, edges reveal the incoming (large-FOV) image first.
            // This avoids blank edges when going from tele → wide.
            vec2 center = uR * 0.5;
            float dist = length((px - center) / center); // 0 at center, ~1 at corners
            // Bias the blend weight outward: edges reach full blend earlier
            w = smoothstep(0.0, 1.0, uBlend + dist * (1.0 - uBlend));
        }
        col = mix(prev, col, w);
    }
    gl_FragColor = col;
    // RT textures hold linear values; direct-rendered panels get the
    // renderer's linear->sRGB output transform. Apply the same transform
    // here so the Combined panel matches their brightness.
    #include <colorspace_fragment>
}`;

/**
 * Create the ShaderMaterial for the Combined warp panel.
 * @param {THREE} THREE - Three.js namespace
 * @param {THREE.Texture} texS1 - UW camera (ultra wide) RT texture
 * @param {THREE.Texture} texM  - Main camera RT texture
 * @param {THREE.Texture} texS2 - Tele camera (telescope) RT texture
 * @param {number} rtW - RT width
 * @param {number} rtH - RT height
 */
export function createWarpMaterial(THREE, texS1, texM, texS2, rtW, rtH) {
    return new THREE.ShaderMaterial({
        vertexShader: VS,
        fragmentShader: FS,
        uniforms: {
            tS1: { value: texS1 },
            tM: { value: texM },
            tS2: { value: texS2 },
            uSrc: { value: 1 },
            uHi: { value: new THREE.Matrix3() },
            uR: { value: new THREE.Vector2(rtW, rtH) },
            uPrevSrc: { value: 1 },
            uPrevHi: { value: new THREE.Matrix3() },
            uBlend: { value: 1.0 },
            uBlendRadial: { value: 0 },
        },
    });
}
