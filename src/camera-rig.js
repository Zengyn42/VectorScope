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
 * @returns {{ rig, init, updateBevAspect, syncMarkers }}
 */
export function createCameraRig({ THREE, scene, SCENE_CAM, bevSize: bevSizeInit = 6 }) {
    let bevSize = bevSizeInit;
    const rig = {
        main: null, sec1: null, sec2: null, bev: null,
        markers: [],                 // Group objects for BEV camera indicators
        markerMap: new Map(),        // Map<Group, camName> for BEV click detection
    };

    /** Create a PerspectiveCamera from intrinsic parameters. */
    function makeCamFromIntrinsics(intrinsics, imageSize) {
        const { fy } = intrinsics;
        const [, h] = imageSize;
        const fov = 2 * Math.atan(h / (2 * fy)) * 180 / Math.PI;
        return new THREE.PerspectiveCamera(fov, 4 / 3, 0.01, 500);
    }

    /** Compute horizontal FOV in radians from intrinsics. */
    function hfovFromIntrinsics(intrinsics, imageSize) {
        return 2 * Math.atan(imageSize[0] / (2 * intrinsics.fx));
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
            const off = new THREE.Vector3(...(cp.extrinsics?.position || [0, 0, 0]));
            cam.position.copy(off.applyQuaternion(refQuat).add(refPos));
            cam.quaternion.copy(refQuat).multiply(eulerQuat(cp.extrinsics?.rotation_euler_deg || [0, 0, 0]));
            const { fx, fy, cx, cy } = cp.intrinsics;
            const [imgW, imgH] = cp.image_size;
            const fov = 2 * Math.atan(imgH / (2 * fy)) * 180 / Math.PI;
            if (Math.abs(cam.fov - fov) > 1e-9) { cam.fov = fov; }
            /* Apply optical-center offset as an asymmetric frustum.
               setViewOffset shifts the rendered sub-region of the full
               sensor: offset = (cx - imgW/2, cy - imgH/2). */
            const ox = cx - imgW / 2;
            const oy = cy - imgH / 2;
            if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) {
                cam.setViewOffset(imgW, imgH, ox, oy, imgW, imgH);
            } else {
                cam.clearViewOffset();
            }
            cam.updateProjectionMatrix();
        };
        setCam(rig.main, p.main_camera, baseQuat, basePos);
        setCam(rig.sec1, p.secondary_camera, rig.main.quaternion, rig.main.position);
        if (rig.sec2 && p.secondary_camera_2) {
            setCam(rig.sec2, p.secondary_camera_2, rig.main.quaternion, rig.main.position);
        }
        recenterBev();
    }

    /** User-applied BEV pan offset (world XZ). Reset when setBevSize is called
     *  or explicitly via resetBevPan(). */
    const bevPan = { x: 0, z: 0 };

    /** Center BEV slightly ahead of the main camera (along its forward
     *  direction on XZ), so the rig sits in the lower part of the window.
     *  Adds the user pan offset on top. */
    function recenterBev() {
        if (!rig.bev) return;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.main.quaternion);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
        fwd.normalize();
        const cx = rig.main.position.x + fwd.x * bevSize * 0.4 + bevPan.x;
        const cz = rig.main.position.z + fwd.z * bevSize * 0.4 + bevPan.z;
        rig.bev.position.set(cx, 20, cz);
        rig.bev.lookAt(cx, 0, cz);
    }

    /** Shift the BEV view by a world-space delta (XZ) and immediately
     *  update the camera position (recenterBev is only called during
     *  trajectory playback, so we must move the camera here). */
    function panBev(dx, dz) {
        bevPan.x += dx;
        bevPan.z += dz;
        if (rig.bev) {
            rig.bev.position.x += dx;
            rig.bev.position.z += dz;
            rig.bev.lookAt(rig.bev.position.x, 0, rig.bev.position.z);
        }
    }

    /** Reset BEV pan offset to zero and re-center. */
    function resetBevPan() { bevPan.x = 0; bevPan.z = 0; recenterBev(); }

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
        const mainOff = new THREE.Vector3(...(p.main_camera.extrinsics?.position || [0, 0, 0]));
        rig.main.position.copy(mainOff.applyQuaternion(baseQuat).add(basePos));
        rig.main.quaternion.copy(baseQuat)
            .multiply(eulerQuat(p.main_camera.extrinsics?.rotation_euler_deg || [0, 0, 0]));
        scene.add(rig.main);

        // Secondary cameras (extrinsics relative to the main camera)
        const makeSec = (sp) => {
            const cam = makeCamFromIntrinsics(sp.intrinsics, sp.image_size);
            const relPos = new THREE.Vector3(...sp.extrinsics.position);
            cam.position.copy(relPos.applyQuaternion(rig.main.quaternion).add(rig.main.position));
            cam.quaternion.copy(rig.main.quaternion).multiply(eulerQuat(sp.extrinsics.rotation_euler_deg));
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

    /** Sync marker poses to their cameras (call once per frame). */
    function syncMarkers() {
        const cams = [rig.main, rig.sec1, rig.sec2];
        for (let i = 0; i < rig.markers.length; i++) {
            if (!cams[i]) continue;
            rig.markers[i].position.copy(cams[i].position);
            rig.markers[i].quaternion.copy(cams[i].quaternion);
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

    return { rig, init, applyPose, updateBevAspect, syncMarkers, setBevSize, getBevSize, panBev, resetBevPan };
}
