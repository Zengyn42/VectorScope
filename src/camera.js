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
 * - **UW camera** (ultra wide, `secondary_camera`) extrinsics are *relative
 *   to the main camera*. Default: 0.5m rightward offset, no rotation
 *   (parallel stereo rig). See docs/CAMERAS.md for the naming convention.
 * - Focal lengths differ: main = 1500px, UW = 750px (2x wider FOV).
 *   This simulates a common real-world setup where the UW camera
 *   captures a wider field of view for context.
 *
 * Also defines the **canonical camera identity constants** used across all
 * UI modules — display names, label colors, and SRC index lookups.
 * Every module that needs a camera name or color MUST import from here
 * (single source of truth — never hardcode camera colors elsewhere).
 *
 * Pure data — no DOM, no THREE.js dependency.
 *
 * @example
 * import { SCENE_CAM, DEF_CAM, CAM_DISPLAY, camColor } from './camera.js';
 *
 * // Access main camera intrinsics
 * const { fx, fy, cx, cy } = DEF_CAM.main_camera.intrinsics;
 *
 * // Update scene camera position (mutable)
 * SCENE_CAM.position = [2.0, 1.0, 5.0];
 */

import { SRC } from './zoom-pipeline.js';

/* ═══════════════════════════════════════════════════════════════
   CAMERA IDENTITY CONSTANTS — single source of truth
   Every module that displays a camera name or color imports from here.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Canonical display names for each camera.
 * Short form used in labels, HUD, grid overlay, etc.
 */
export const CAM_DISPLAY = {
    [SRC.SEC1]: 'UW',
    [SRC.MAIN]: 'Main',
    [SRC.SEC2]: 'Tele',
};

/**
 * Canonical label colors for each camera.
 * Must match the panel label colors in index.html.
 */
export const CAM_COLORS = {
    [SRC.SEC1]: '#81c784',   // green  — UW Camera
    [SRC.MAIN]: '#4fc3f7',   // blue   — Main Camera
    [SRC.SEC2]: '#fff176',   // yellow — Tele Camera
};

/** Get display name for a SRC index. */
export function camDisplayName(src) { return CAM_DISPLAY[src] || '?'; }

/** Get label color for a SRC index. */
export function camColor(src) { return CAM_COLORS[src] || '#e0e0e0'; }

/**
 * Camera display names indexed by human-readable panel name.
 * Used by selection-panel.js to color camera info by name.
 */
export const CAM_NAME_TO_SRC = {
    'Main Camera': SRC.MAIN,
    'UW Camera': SRC.SEC1,
    'Tele Camera': SRC.SEC2,
};

/**
 * Scene camera world-space pose.
 * This is mutable — the camera settings dialog updates it in-place.
 * @type {{ position: number[], rotation_euler_deg: number[] }}
 */
export let SCENE_CAM = { position: [1.7, 0.8, 4.5], rotation_euler_deg: [0, 0, 0] };

/**
 * Default stereo camera parameters for homography computation.
 * Main camera: identity extrinsics, fx/fy = 1500.
 * UW camera (`secondary_camera`): 0.5m rightward offset, fx/fy = 750 (ultra-wide FOV).
 * @type {{ main_camera: object, secondary_camera: object }}
 */
export const DEF_CAM = {
    main_camera: {
        intrinsics: { fx: 1500, fy: 1500, cx: 540, cy: 960 },
        extrinsics: { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [1080, 1920],
    },
    secondary_camera: {
        intrinsics: { fx: 750, fy: 750, cx: 540, cy: 960 },
        extrinsics: { position: [0.5, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [1080, 1920],
    },
    secondary_camera_2: {
        // Telephoto: 5x the main focal length → 1/5 FOV. The combined-view
        // zoom pipeline hands over from main to sec2 exactly at 5.0x.
        intrinsics: { fx: 7500, fy: 7500, cx: 540, cy: 960 },
        extrinsics: { position: [-0.5, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [1080, 1920],
    },
};
