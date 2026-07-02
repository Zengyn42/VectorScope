/**
 * Camera parameter defaults and helpers.
 * Pure data + logic — no DOM, no THREE.js dependency.
 */

/** Fixed scene camera position — where the Three.js cameras are placed in the 3D world */
export let SCENE_CAM = { position: [1.7, 0.8, 4.5], rotation_euler_deg: [0, 0, 0] };

/** Camera params for homography:
 *  - main_camera extrinsics = identity (coincides with scene camera)
 *  - secondary_camera extrinsics = relative to main camera */
export const DEF_CAM = {
    main_camera: {
        intrinsics: { fx: 1500, fy: 1500, cx: 960, cy: 540 },
        extrinsics: { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [1920, 1080],
    },
    secondary_camera: {
        intrinsics: { fx: 1500, fy: 1500, cx: 960, cy: 540 },
        extrinsics: { position: [0.5, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [1920, 1080],
    },
};
