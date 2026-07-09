/**
 * @module gl-bootstrap
 * @description
 * One-shot WebGL context construction for VectorScope: renderer, scene,
 * lights, off-screen render targets, and the display quad + warp material
 * used by the Combined panel.
 *
 * Pure construction — no per-frame logic (that lives in render-loop.js)
 * and no DOM bindings beyond the canvas itself.
 */

import { createWarpMaterial } from './shader.js';

/**
 * Build the full GL context.
 *
 * @param {object} opts
 * @param {object} opts.THREE  - Three.js namespace
 * @param {HTMLCanvasElement} opts.canvas - target canvas
 * @param {number} opts.rtW    - render target width (px)
 * @param {number} opts.rtH    - render target height (px)
 * @param {Function} [opts.log] - status logger
 * @returns {{
 *   renderer: object, scene: object, aLight: object, dLight: object,
 *   rtM: object, rtS: object, rtS2: object, rtDepth: object,
 *   depthMat: object, dScene: object, dCam: object, quad: object,
 *   matWarp: object
 * }}
 * RT naming: rtS = UW camera, rtM = Main, rtS2 = Tele (docs/CAMERAS.md).
 * @throws re-throws WebGLRenderer construction failure after logging.
 */
export function createGlContext({ THREE, canvas, rtW, rtH, log = () => {} }) {
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({
            canvas, antialias: true, powerPreference: 'default',
            failIfMajorPerformanceCaveat: false,
        });
    } catch (e) {
        log(`WebGL failed: ${e.message}`);
        throw e;
    }
    canvas.addEventListener('webglcontextlost', (e) => { log('WebGL context lost'); e.preventDefault(); });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a1a2e);
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a2a3e);

    const aLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(aLight);
    const dLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dLight.position.set(5, 8, 5);
    scene.add(dLight);

    /* Off-screen render targets for the Combined warp shader + autofocus */
    const rtM = new THREE.WebGLRenderTarget(rtW, rtH);
    const rtS = new THREE.WebGLRenderTarget(rtW, rtH);
    const rtS2 = new THREE.WebGLRenderTarget(rtW, rtH);
    const rtDepth = new THREE.WebGLRenderTarget(rtW, rtH);
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });

    /* Display quad — fullscreen ortho scene the warp shader draws onto */
    const dScene = new THREE.Scene();
    const dCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    dScene.add(quad);
    const matWarp = createWarpMaterial(THREE, rtS.texture, rtM.texture, rtS2.texture, rtW, rtH);

    return { renderer, scene, aLight, dLight, rtM, rtS, rtS2, rtDepth, depthMat, dScene, dCam, quad, matWarp };
}
