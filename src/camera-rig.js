/**
 * @module camera-rig
 * @description
 * Camera rig manager: builds and owns the three physical cameras
 * (main / sec1 / sec2), the orthographic Bird's Eye camera, and the
 * BEV camera markers (colored sphere + direction line + FOV wedge).
 *
 * Pose model:
 * - `SCENE_CAM` gives the rig's base pose in world space.
 * - `main_camera.extrinsics` is an offset relative to the scene camera.
 * - Secondary cameras' extrinsics are relative to the **main camera**.
 * - Euler order 'ZYX' throughout (matches the CV-side convention).
 *
 * The returned `rig` object's fields are live — `init()` reassigns them,
 * so callers should access `rig.main` etc. by property, not destructure.
 *
 * @param {object} opts
 * @param {object} opts.THREE - Three.js namespace
 * @param {object} opts.scene - scene the cameras/markers are added to
 * @param {object} opts.SCENE_CAM - `{ position, rotation_euler_deg }` base pose (read live)
 * @param {number} [opts.bevSize=6] - BEV ortho half-extent (m)
 * @param {Function} [opts.getWinSize] - returns `[winW, winH]`, the shared
 *        display/RT window size. `image_size` is the SENSOR extent; each
 *        camera renders the 1:1 center-anchored winW×winH window of its
 *        sensor (FOV derives from the WINDOW height, so enlarging the
 *        sensor never rescales the display). Omitted → window = each
 *        camera's own image_size (legacy behavior, used by unit tests).
 * @returns {{ rig, init, updateBevAspect, syncMarkers }}
 */
import { getBevPlaneDef } from './bev-planes.js';

export function createCameraRig({ THREE, scene, SCENE_CAM, bevSize: bevSizeInit = 6,
        getWinSize = null }) {
    let bevSize = bevSizeInit;
    let bevPlane = 'xz';   // current BEV view plane: 'xz' | 'xy' | 'zy'
    /** Effective render window for a camera: shared RT window, or the
     *  camera's own sensor size when no window provider is configured. */
    const winOf = (imageSize) => (getWinSize ? getWinSize() : imageSize);
    const rig = {
        main: null, sec1: null, sec2: null, bev: null,
        markers: [],                 // Group objects for BEV camera indicators
        markerMap: new Map(),        // Map<Group, camName> for BEV click detection
    };

    /** Create a PerspectiveCamera from intrinsic parameters.
     *  Portrait: FOV from fx (sensor x = display vertical); aspect = winW/winH.
     *  Landscape / legacy: FOV from fy; aspect = winW/winH. */
    function makeCamFromIntrinsics(intrinsics, imageSize) {
        const { fx, fy } = intrinsics;
        const [winW, winH] = winOf(imageSize);
        const isPortrait = getWinSize && winW < winH;
        const fov = 2 * Math.atan(winH / (2 * (isPortrait ? fx : fy))) * 180 / Math.PI;
        return new THREE.PerspectiveCamera(fov, winW / winH, 0.01, 500);
    }

    /** Compute horizontal FOV in radians from intrinsics (window width —
     *  what is actually displayed, not the full sensor). */
    function hfovFromIntrinsics(intrinsics, imageSize) {
        return 2 * Math.atan(winOf(imageSize)[0] / (2 * intrinsics.fx));
    }

    /** Colored camera marker (sphere + direction line + FOV wedge), layer 1 (BEV-only). */
    function createCamMarker(color, label, hfovRad) {
        const group = new THREE.Group();
        group.userData.camLabel = label;
        // Clickable sphere — large radius so the BEV raycaster can hit it
        group.add(new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 16, 16),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false })
        ));
        // Direction line
        const lineLen = 3.0;
        group.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(
                [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -lineLen)]),
            new THREE.LineBasicMaterial({ color })
        ));
        // FOV wedge — computed from actual horizontal FOV
        const halfW = lineLen * Math.tan((hfovRad || 0.6) / 2);
        group.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(-halfW, 0, -lineLen),
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(halfW, 0, -lineLen),
            ]),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })
        ));
        group.traverse(c => c.layers.set(1));
        return group;
    }

    const eulerQuat = (deg) => {
        const [rx, ry, rz] = deg.map(d => d * Math.PI / 180);
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'ZYX'));
    };

    /* Portrait orientation = the rig rotated 90° COUNTER-CLOCKWISE (on screen)
       about the optical axis. Sensor long edge is always along x (image_size
       = [1920, 1080]). In portrait the rig's +x axis maps to world +y, so the
       extrinsic x baseline becomes a vertical (up-down) parallax.
       Active Rz(+90°): +x (right) → +y (up). Landscape → null (identity). */
    const rigQuat = () => {
        if (!getWinSize) return null;       // legacy mode: no orientation semantics
        const [w, h] = getWinSize();
        return w < h
            ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
            : null;
    };

    /** Five-layer chain: world = SCENE_CAM ∘ qRig ∘ ext.
     *  baseQuat/basePos = SCENE_CAM pose. rigQuat() is applied inside so
     *  ALL cameras (main and sec) are called with the same (baseQuat, basePos).
     *
     *  Portrait DISPLAY model (phone rotated CCW): the sensor image is
     *  rotated back +90° (CCW) on screen so world content stays upright.
     *  That display rotation is equivalent to an extra camera roll
     *  qRig⁻¹ applied on the right, which cancels the rig's body roll for
     *  the ORIENTATION: q_render = qRig·qExt·qRig⁻¹ (identity ext →
     *  unrolled camera, upright content). The POSITION offset keeps the
     *  full rig rotation (physical baseline really is vertical in
     *  portrait). Homography side implements the same display rotation in
     *  computeHPairWin — render/H consistency is verified numerically.
     *  Shared by init() and applyPose(). */
    function poseCam(cam, cp, baseQuat, basePos) {
        const qR = rigQuat();
        const off = new THREE.Vector3(...(cp.extrinsics?.position || [0, 0, 0]));
        let qExt = eulerQuat(cp.extrinsics?.rotation_euler_deg || [0, 0, 0]);
        if (qR) {
            off.applyQuaternion(qR);
            qExt = qR.clone().multiply(qExt).multiply(qR.clone().invert());
        }
        cam.position.copy(off.applyQuaternion(baseQuat).add(basePos));
        cam.quaternion.copy(baseQuat).multiply(qExt);
    }

    /**
     * Fast per-frame update for trajectory playback: reposition the existing
     * cameras from a rig base pose + camera params WITHOUT rebuilding camera
     * objects or markers (init() allocates geometry — far too heavy per frame).
     * Also refreshes intrinsics-driven FOV, so per-frame focal changes work.
     *
     * @param {object} p - camera params (same shape as init)
     * @param {object} basePose - `{ position, rotation_euler_deg }` rig base
     *        pose in world (defaults to the live SCENE_CAM)
     */
    function applyPose(p, basePose = SCENE_CAM) {
        if (!rig.main) return;
        const basePos = new THREE.Vector3(...basePose.position);
        const baseQuat = eulerQuat(basePose.rotation_euler_deg);

        const setCam = (cam, cp, refQuat, refPos) => {
            poseCam(cam, cp, refQuat, refPos);
            const { fx, fy, cx, cy } = cp.intrinsics;
            const [imgW, imgH] = cp.image_size;
            const [winW, winH] = winOf(cp.image_size);
            /* Portrait: sensor x (imgW) is displayed vertically (winH),
               so FOV comes from fx and aspect = winW/winH.
               Landscape / legacy: FOV from fy, same aspect formula. */
            const isPortrait = getWinSize && winW < winH;
            const fov = 2 * Math.atan(winH / (2 * (isPortrait ? fx : fy))) * 180 / Math.PI;
            if (Math.abs(cam.fov - fov) > 1e-9) { cam.fov = fov; }
            /* Aspect = window aspect (portrait < 1, landscape > 1). */
            cam.aspect = winW / winH;
            /* Apply optical-center offset as asymmetric frustum.
               Sensor→window mapping: center-aligned translation, composed
               with the +90° CCW display rotation in portrait
               (u_w − winW/2 = v_s − imgH/2, v_w − winH/2 = −(u_s − imgW/2)),
               so the sensor principal offset (dx, dy) = (cx − imgW/2,
               cy − imgH/2) lands at window offset (dy, −dx).
               Sign convention: setViewOffset(+ox) shifts the rendered window
               RIGHT within the full frame → optical axis moves LEFT in output
               → negate the window-space offset. */
            const dx = cx - imgW / 2;
            const dy = cy - imgH / 2;
            const ox = isPortrait ? -dy : -dx;
            const oy = isPortrait ?  dx : -dy;
            if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) {
                cam.setViewOffset(winW, winH, ox, oy, winW, winH);
            } else {
                cam.clearViewOffset();
            }
            cam.updateProjectionMatrix();
        };
        /* Five-layer chain: all cameras relative to rig frame (baseQuat, basePos).
           poseCam() applies rigQuat() internally. */
        setCam(rig.main, p.main_camera, baseQuat, basePos);
        setCam(rig.sec1, p.secondary_camera, baseQuat, basePos);
        if (rig.sec2 && p.secondary_camera_2) {
            setCam(rig.sec2, p.secondary_camera_2, baseQuat, basePos);
        }
        recenterBev();
    }

    /** User-applied BEV pan offset (world XYZ). Reset when bevPlane changes
     *  or explicitly via resetBevPan(). */
    const bevPan = { x: 0, y: 0, z: 0 };

    /** BEV camera distance from view center (world units).
     *  Orthographic cameras are insensitive to distance along the view axis,
     *  but near/far (0.1–100) must encompass the scene. */
    const BEV_DIST = 20;

    /** Center the BEV camera for the current bevPlane, adding any user pan. */
    function recenterBev() {
        if (!rig.bev || !rig.main) return;
        const planeDef = getBevPlaneDef(bevPlane);

        let cx, cy, cz;
        if (bevPlane === 'xz') {
            // Top-down: offset center slightly ahead of main camera on XZ
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.main.quaternion);
            fwd.y = 0;
            if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
            fwd.normalize();
            const r = planeDef.centerOf(rig.main.position, fwd, bevSize);
            cx = r.cx; cy = r.cy; cz = r.cz;
        } else {
            const r = planeDef.centerOf(rig.main.position);
            cx = r.cx; cy = r.cy; cz = r.cz;
        }
        // Add user pan
        cx += bevPan.x; cy += bevPan.y; cz += bevPan.z;

        const dir = planeDef.bevCamDir;
        rig.bev.position.set(
            cx + dir.x * BEV_DIST,
            cy + dir.y * BEV_DIST,
            cz + dir.z * BEV_DIST,
        );
        if (planeDef.bevCamUp) {
            rig.bev.up.set(planeDef.bevCamUp[0], planeDef.bevCamUp[1], planeDef.bevCamUp[2]);
        }
        rig.bev.lookAt(cx, cy, cz);
    }

    /** Shift the BEV view by a world-space delta (XYZ) and immediately
     *  update the camera position (recenterBev is only called during
     *  trajectory playback, so we must move the camera here). */
    function panBev(dx, dy, dz) {
        bevPan.x += dx; bevPan.y += dy; bevPan.z += dz;
        if (rig.bev) {
            const planeDef = getBevPlaneDef(bevPlane);
            const dir = planeDef.bevCamDir;
            rig.bev.position.x += dx;
            rig.bev.position.y += dy;
            rig.bev.position.z += dz;
            // Re-derive lookAt target: camera is bevCamDir*BEV_DIST away from center
            rig.bev.lookAt(
                rig.bev.position.x - dir.x * BEV_DIST,
                rig.bev.position.y - dir.y * BEV_DIST,
                rig.bev.position.z - dir.z * BEV_DIST,
            );
        }
    }

    /** Reset BEV pan offset to zero and re-center. */
    function resetBevPan() { bevPan.x = 0; bevPan.y = 0; bevPan.z = 0; recenterBev(); }

    /** (Re)build all cameras + BEV camera + markers from camera params. */
    function init(p) {
        if (rig.main) { scene.remove(rig.main); scene.remove(rig.sec1); }
        if (rig.sec2) { scene.remove(rig.sec2); rig.sec2 = null; }
        rig.markers.forEach(m => scene.remove(m));
        rig.markers = [];
        rig.markerMap.clear();

        // Main camera: SCENE_CAM base pose + main_camera.extrinsics offset
        rig.main = makeCamFromIntrinsics(p.main_camera.intrinsics, p.main_camera.image_size);
        const basePos = new THREE.Vector3(...SCENE_CAM.position);
        const baseQuat = eulerQuat(SCENE_CAM.rotation_euler_deg);
        poseCam(rig.main, p.main_camera, baseQuat, basePos);
        scene.add(rig.main);

        // Secondary cameras (extrinsics relative to the rig frame)
        const makeSec = (sp) => {
            const cam = makeCamFromIntrinsics(sp.intrinsics, sp.image_size);
            poseCam(cam, sp, baseQuat, basePos);
            scene.add(cam);
            return cam;
        };
        rig.sec1 = makeSec(p.secondary_camera);
        if (p.secondary_camera_2) rig.sec2 = makeSec(p.secondary_camera_2);

        // Bird's Eye camera (orthographic, straight down)
        if (!rig.bev) {
            rig.bev = new THREE.OrthographicCamera(-bevSize, bevSize, bevSize, -bevSize, 0.1, 100);
            rig.bev.layers.enable(1);   // see camera markers on layer 1
        }
        recenterBev();

        // Camera markers — FOV wedge matches actual HFOV
        const addMarker = (color, label, cp) => {
            const mk = createCamMarker(color, label, hfovFromIntrinsics(cp.intrinsics, cp.image_size));
            scene.add(mk);
            rig.markers.push(mk);
            rig.markerMap.set(mk, label);
        };
        addMarker(0x4fc3f7, 'Main Camera', p.main_camera);
        addMarker(0x81c784, 'UW Camera', p.secondary_camera);
        if (rig.sec2) addMarker(0xfff176, 'Tele Camera', p.secondary_camera_2);
    }

    /** Update BEV camera bounds from current bevSize + panel aspect ({w, h}). */
    function updateBevAspect(bevPanel) {
        if (!rig.bev || !bevPanel || !bevPanel.w) return;
        const aspect = bevPanel.w / bevPanel.h;
        rig.bev.left   = -bevSize * aspect;
        rig.bev.right  =  bevSize * aspect;
        rig.bev.top    =  bevSize;
        rig.bev.bottom = -bevSize;
        rig.bev.updateProjectionMatrix();
    }

    /** Sync marker poses to their cameras (call once per frame).
     *  Also scales markers so they appear constant-size on screen
     *  regardless of BEV zoom: scale = bevSize / 6 (6 = default half-extent). */
    function syncMarkers() {
        const cams = [rig.main, rig.sec1, rig.sec2];
        const scale = bevSize / 6;
        for (let i = 0; i < rig.markers.length; i++) {
            if (!cams[i]) continue;
            const group = rig.markers[i];
            group.position.copy(cams[i].position);
            group.quaternion.copy(cams[i].quaternion);
            group.scale.setScalar(scale);
        }
    }

    /**
     * Set the BEV orthographic half-extent (metres).
     * Clamps to [1, 30]. Call `updateBevAspect(P.bev)` after to refresh.
     * @param {number} s
     */
    function setBevSize(s) { bevSize = Math.max(1, Math.min(30, s)); }

    /** Return the current BEV half-extent. */
    function getBevSize() { return bevSize; }

    /**
     * Switch the active BEV view plane.
     * Resets pan and re-centers immediately.
     * @param {string} plane - 'xz' | 'xy' | 'zy'
     */
    function setBevPlane(plane) {
        if (plane === bevPlane) return;
        bevPlane = plane;
        resetBevPan();
    }

    /** Return the current BEV view plane name. */
    function getBevPlane() { return bevPlane; }

    /**
     * Return the combined rig world quaternion: SCENE_CAM.rot ∘ qRig.
     * For landscape: qRig = identity → result = SCENE_CAM quaternion.
     * For portrait: qRig = Rz(+90°) → result = SCENE_CAM ∘ Rz(+90°).
     * Returns a new THREE.Quaternion.
     */
    function getRigQuat() {
        const baseQuat = eulerQuat(SCENE_CAM.rotation_euler_deg);
        const qR = rigQuat();
        if (qR) return baseQuat.multiply(qR);
        return baseQuat;
    }

    return {
        rig, init, applyPose, updateBevAspect, syncMarkers,
        setBevSize, getBevSize,
        setBevPlane, getBevPlane, getRigQuat,
        panBev, resetBevPan,
    };
}
