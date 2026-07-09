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
export function createCameraRig({ THREE, scene, SCENE_CAM, bevSize = 6 }) {
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
        // Center BEV slightly ahead of the main camera (along its forward
        // direction on XZ), so the camera rig sits in the lower part of the
        // window and the scene fills the middle/upper area.
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.main.quaternion);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
        fwd.normalize();
        const cx = rig.main.position.x + fwd.x * bevSize * 0.4;
        const cz = rig.main.position.z + fwd.z * bevSize * 0.4;
        rig.bev.position.set(cx, 20, cz);
        rig.bev.lookAt(cx, 0, cz);

        // Camera markers — FOV wedge matches actual HFOV
        const addMarker = (color, label, cp) => {
            const mk = createCamMarker(color, label, hfovFromIntrinsics(cp.intrinsics, cp.image_size));
            scene.add(mk);
            rig.markers.push(mk);
            rig.markerMap.set(mk, label);
        };
        addMarker(0x4fc3f7, 'Main Camera', p.main_camera);
        addMarker(0x81c784, 'Secondary 1', p.secondary_camera);
        if (rig.sec2) addMarker(0xfff176, 'Secondary 2', p.secondary_camera_2);
    }

    /** Update BEV camera aspect to match its panel rect ({w, h}). */
    function updateBevAspect(bevPanel) {
        if (!rig.bev || !bevPanel || !bevPanel.w) return;
        const aspect = bevPanel.w / bevPanel.h;
        rig.bev.left = -bevSize * aspect;
        rig.bev.right = bevSize * aspect;
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

    return { rig, init, updateBevAspect, syncMarkers };
}
