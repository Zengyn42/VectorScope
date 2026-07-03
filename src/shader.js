/**
 * @module shader
 * @description
 * GLSL warp shader and material factory for the Combined panel.
 *
 * The Combined panel displays a warped view that blends the main and secondary
 * camera feeds based on the current zoom level:
 * - **Zoom ≤ 1.0**: Shows the secondary (wider FOV) camera, optionally warped
 *   by the inverse homography `H⁻¹` to align it with the main camera's perspective.
 * - **Zoom > 1.0**: Shows the main camera (narrower FOV, higher detail).
 *
 * **Shader pipeline:**
 * 1. Apply zoom crop: `z = 0.5 + (uv - 0.5) / zoom` — maps visible region
 * 2. If warp enabled and zoom ≤ 1: apply `uHi` (inverse homography) in pixel space
 *    to transform secondary camera pixels → main camera pixel coordinates
 * 3. Sample the appropriate texture (`tM` for main, `tS` for secondary)
 * 4. Out-of-bounds pixels render as dark background `(0.06, 0.06, 0.12)`
 *
 * **Uniforms:**
 * | Name   | Type    | Description |
 * |--------|---------|-------------|
 * | `tM`   | sampler | Main camera render target texture |
 * | `tS`   | sampler | Secondary camera render target texture |
 * | `uHi`  | mat3    | Inverse homography (or prewarp scale when warp off) |
 * | `uZ`   | float   | Current zoom level |
 * | `uCrop`| float   | Crop factor (= zoom, for viewport cropping) |
 * | `uW`   | bool    | Whether warping is active |
 * | `uR`   | vec2    | Render target resolution [width, height] |
 *
 * Pure data + factory — no DOM, no side effects.
 *
 * @requires three (passed as dependency to `createWarpMaterial`)
 *
 * @example
 * import { createWarpMaterial } from './shader.js';
 * const material = createWarpMaterial(THREE, rtMain.texture, rtSec.texture, 1920, 1080);
 * quad.material = material;
 * material.uniforms.uHi.value.set(...inverseHomographyElements);
 */

export const VS = `
varying vec2 vUv;
void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;

export const FS = `
uniform sampler2D tM, tS;
uniform mat3 uHi;
uniform float uZ;
uniform float uCrop;
uniform bool uW;
uniform vec2 uR;
varying vec2 vUv;
void main(){
    vec2 z = .5 + (vUv - .5) / uCrop;
    vec4 col;
    if(uZ <= 1.){
        if(uW){
            vec2 px = vec2(z.x * uR.x, (1. - z.y) * uR.y);
            vec3 sp = uHi * vec3(px, 1.);
            vec2 s = vec2(sp.x / sp.z / uR.x, 1. - sp.y / sp.z / uR.y);
            col = (s.x >= 0. && s.x <= 1. && s.y >= 0. && s.y <= 1.)
                ? texture2D(tS, s) : vec4(.06, .06, .12, 1.);
        } else {
            col = (z.x >= 0. && z.x <= 1. && z.y >= 0. && z.y <= 1.)
                ? texture2D(tS, z) : vec4(.06, .06, .12, 1.);
        }
    } else {
        col = (z.x >= 0. && z.x <= 1. && z.y >= 0. && z.y <= 1.)
            ? texture2D(tM, z) : vec4(.06, .06, .12, 1.);
    }
    gl_FragColor = col;
}`;

/**
 * Create the ShaderMaterial for the Combined warp panel.
 * @param {THREE} THREE - Three.js namespace
 * @param {THREE.Texture} texM - Main camera RT texture
 * @param {THREE.Texture} texS - Secondary camera RT texture
 * @param {number} rtW - RT width
 * @param {number} rtH - RT height
 */
export function createWarpMaterial(THREE, texM, texS, rtW, rtH) {
    return new THREE.ShaderMaterial({
        vertexShader: VS,
        fragmentShader: FS,
        uniforms: {
            tM: { value: texM },
            tS: { value: texS },
            uHi: { value: new THREE.Matrix3() },
            uZ: { value: 1.0 },
            uCrop: { value: 1.0 },
            uW: { value: false },
            uR: { value: new THREE.Vector2(rtW, rtH) },
        },
    });
}
