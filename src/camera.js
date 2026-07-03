/**
 * @module camera
 * @description
 * Default camera parameter definitions for VectorScope.
 *
 * Contains two exports:
 * - `SCENE_CAM` — the world-space position/rotation of the Three.js scene camera
 *   (mutable, updated by the camera dialog)
 * - `DEF_CAM` — default stereo camera parameters used for homography computation
 *
 * **Stereo camera model:**
 * - **Main camera** has identity extrinsics (position [0,0,0], rotation [0,0,0]),
 *   meaning it coincides with the scene camera in 3D space.
 * - **Secondary camera** extrinsics are *relative to the main camera*.
 *   Default: 0.5m rightward offset, no rotation (parallel stereo rig).
 * - Focal lengths differ: main = 1500px, secondary = 750px (2x wider FOV).
 *   This simulates a common real-world setup where the secondary camera
 *   captures a wider field of view for context.
 *
 * Pure data — no DOM, no THREE.js dependency.
 *
 * @example
 * import { SCENE_CAM, DEF_CAM } from './camera.js';
 *
 * // Access main camera intrinsics
 * const { fx, fy, cx, cy } = DEF_CAM.main_camera.intrinsics;
 *
 * // Update scene camera position (mutable)
 * SCENE_CAM.position = [2.0, 1.0, 5.0];
 */

/**
 * Scene camera world-space pose.
 * This is mutable — the camera settings dialog updates it in-place.
 * @type {{ position: number[], rotation_euler_deg: number[] }}
 */
export let SCENE_CAM = { position: [1.7, 0.8, 4.5], rotation_euler_deg: [0, 0, 0] };

/**
 * Default stereo camera parameters for homography computation.
 * Main camera: identity extrinsics, fx/fy = 1500.
 * Secondary camera: 0.5m rightward offset, fx/fy = 750 (wider FOV).
 * @type {{ main_camera: object, secondary_camera: object }}
 */
export const DEF_CAM = {
    main_camera: {
        intrinsics: { fx: 1500, fy: 1500, cx: 960, cy: 540 },
        extrinsics: { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [1920, 1080],
    },
    secondary_camera: {
        intrinsics: { fx: 750, fy: 750, cx: 960, cy: 540 },
        extrinsics: { position: [0.5, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [1920, 1080],
    },
    secondary_camera_2: {
        intrinsics: { fx: 750, fy: 750, cx: 960, cy: 540 },
        extrinsics: { position: [-0.5, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [1920, 1080],
    },
};
