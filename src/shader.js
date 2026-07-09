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
 * | `tS1`  | sampler | Secondary 1 (wide) render target texture |
 * | `tM`   | sampler | Main camera render target texture |
 * | `tS2`  | sampler | Secondary 2 (tele) render target texture |
 * | `uSrc` | int     | Source selector: 0 = sec1, 1 = main, 2 = sec2 |
 * | `uHi`  | mat3    | Pixel-space sampling matrix (output px → source px) |
 * | `uR`   | vec2    | Render target resolution [width, height] |
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
varying vec2 vUv;
void main(){
    // Output pixel coords (y-down image convention)
    vec2 px = vec2(vUv.x * uR.x, (1. - vUv.y) * uR.y);
    vec3 sp = uHi * vec3(px, 1.);
    vec2 s = vec2(sp.x / sp.z / uR.x, 1. - sp.y / sp.z / uR.y);
    vec4 col;
    if(s.x >= 0. && s.x <= 1. && s.y >= 0. && s.y <= 1.){
        if(uSrc == 0)      col = texture2D(tS1, s);
        else if(uSrc == 2) col = texture2D(tS2, s);
        else               col = texture2D(tM, s);
    } else {
        col = vec4(.06, .06, .12, 1.);
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
 * @param {THREE.Texture} texS1 - Secondary 1 (wide) RT texture
 * @param {THREE.Texture} texM  - Main camera RT texture
 * @param {THREE.Texture} texS2 - Secondary 2 (tele) RT texture
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
        },
    });
}
