/**
 * @module camera-preset
 * @description
 * Camera preset load logic (resource/camera_setting/*.json).
 *
 * **Convention** (five-layer coordinate chain):
 * - Main camera extrinsics represent the RIG offset from SCENE_CAM.
 *   A canonical preset has main extrinsics = identity (rig at SCENE_CAM).
 * - UW/Tele extrinsics are stored RELATIVE TO THE RIG FRAME (not main).
 *   Sensor long edge is always x: image_size = [1920, 1080].
 *
 * **Load rules:**
 * 1. If the file's main extrinsics IS identity → keep the current scene's
 *    main pose (rig stays where it is); only intrinsics + UW/Tele
 *    rig-relative extrinsics come from the file.
 * 2. If NOT identity → the caller must ask the user:
 *    - 'absolute': place the rig at the file's main pose
 *    - 'relative': keep the current scene's main pose
 * 3. UW/Tele extrinsics are used as-is (already rig-relative in the file).
 *
 * Rotation convention: euler degrees, THREE 'ZYX' order (matches
 * camera-rig.js eulerQuat). Implemented with pure quaternion math —
 * no THREE dependency, unit-testable.
 */

/* ── quaternion helpers (x, y, z, w), THREE 'ZYX' euler order ── */

/** Euler degrees [rx,ry,rz] ('ZYX' order, R = Rz·Ry·Rx) → quaternion. */
export function eulerToQuat(deg) {
    const [rx, ry, rz] = deg.map(d => d * Math.PI / 360);   // half angles
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    // q = qz ⊗ qy ⊗ qx
    return [
        sx * cy * cz - cx * sy * sz,
        cx * sy * cz + sx * cy * sz,
        cx * cy * sz - sx * sy * cz,
        cx * cy * cz + sx * sy * sz,
    ];
}

/** Quaternion → euler degrees [rx,ry,rz] in 'ZYX' order. */
export function quatToEuler(q) {
    const [x, y, z, w] = q;
    const rx = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    const sy = 2 * (w * y - z * x);
    const ry = Math.asin(Math.max(-1, Math.min(1, sy)));
    const rz = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    return [rx, ry, rz].map(r => r * 180 / Math.PI);
}

/** Hamilton product a ⊗ b. */
export function quatMul(a, b) {
    const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
}

/** Conjugate (inverse for unit quaternions). */
export function quatConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }

/** Rotate vector v by quaternion q. */
export function quatRotate(q, v) {
    const p = [v[0], v[1], v[2], 0];
    const r = quatMul(quatMul(q, p), quatConj(q));
    return [r[0], r[1], r[2]];
}

/* ── extrinsics helpers ── */

const EXT_EPS = 1e-6;

/** Whether an extrinsics block is (numerically) the identity pose. */
export function isIdentityExt(ext) {
    if (!ext) return true;
    const p = ext.position || [0, 0, 0];
    const r = ext.rotation_euler_deg || [0, 0, 0];
    return p.every(v => Math.abs(v) < EXT_EPS) && r.every(v => Math.abs(v) < EXT_EPS);
}

/**
 * Extrinsics of `sec` RELATIVE to `base`:
 *   rel_rot = inv(q_base) ⊗ q_sec
 *   rel_pos = inv(q_base) · (p_sec − p_base)
 * Inverse of camera-rig.js composition
 * (p_abs = p_base + q_base·rel_pos; q_abs = q_base ⊗ q_rel).
 */
export function relativeExt(baseExt, secExt) {
    const bp = baseExt?.position || [0, 0, 0];
    const bq = eulerToQuat(baseExt?.rotation_euler_deg || [0, 0, 0]);
    const sp = secExt?.position || [0, 0, 0];
    const sq = eulerToQuat(secExt?.rotation_euler_deg || [0, 0, 0]);
    const inv = quatConj(bq);
    const relPos = quatRotate(inv, [sp[0] - bp[0], sp[1] - bp[1], sp[2] - bp[2]]);
    const relRot = quatToEuler(quatMul(inv, sq));
    const clean = v => Math.abs(v) < 1e-12 ? 0 : v;
    return { position: relPos.map(clean), rotation_euler_deg: relRot.map(clean) };
}

/* ── preset load planning ── */

/**
 * Inspect a preset file's camera params.
 * @returns {{mainIsIdentity: boolean}} — when false, the caller must ask
 *          the user for 'absolute' or 'relative' placement before applying.
 */
export function planPresetLoad(fileParams) {
    return { mainIsIdentity: isIdentityExt(fileParams?.main_camera?.extrinsics) };
}

/**
 * Build the `{camParams, sceneCam}` store payload for a preset load.
 *
 * @param {object} fileParams - the preset's camera params (file content)
 * @param {'relative'|'absolute'} mode
 *        'relative' — keep the current scene's main pose (also the forced
 *        behaviour when the file main extrinsics is identity)
 *        'absolute' — place the rig (SCENE_CAM) at the file's main pose
 * @param {object} current - { sceneCam: {position, rotation_euler_deg},
 *                             mainExt: current main_camera.extrinsics }
 * @returns {{camParams: object, sceneCam: object}}
 */
export function applyPreset(fileParams, mode, current) {
    const fileMainExt = fileParams.main_camera?.extrinsics
        || { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] };

    const camParams = JSON.parse(JSON.stringify(fileParams));

    if (mode === 'absolute') {
        // Rig base ← file's main pose; main extrinsics ← identity.
        camParams.main_camera.extrinsics =
            { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] };
        var sceneCam = {
            position: [...(fileMainExt.position || [0, 0, 0])],
            rotation_euler_deg: [...(fileMainExt.rotation_euler_deg || [0, 0, 0])],
        };
    } else {
        // Keep the current scene's main pose: SCENE_CAM and the current
        // main extrinsics stay untouched.
        camParams.main_camera.extrinsics =
            JSON.parse(JSON.stringify(current.mainExt
                || { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] }));
        var sceneCam = {
            position: [...current.sceneCam.position],
            rotation_euler_deg: [...current.sceneCam.rotation_euler_deg],
        };
    }

    // UW/Tele extrinsics are rig-relative in the file — use as-is.
    return { camParams, sceneCam };
}

/**
 * Build a canonical preset JSON from the live state: main extrinsics =
 * identity (the rig pose is NOT saved — presets are position-independent
 * unless hand-authored otherwise), UW/Tele extrinsics relative to rig
 * (already the system convention, saved as-is).
 */
export function buildPresetJson(camParams) {
    const out = JSON.parse(JSON.stringify(camParams));
    out.main_camera.extrinsics = { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] };
    return out;
}
