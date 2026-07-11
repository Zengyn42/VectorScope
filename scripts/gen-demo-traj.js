#!/usr/bin/env node
/**
 * Generate a demo camera trajectory: 240 frames @ 30 fps (8 seconds).
 *
 * Sweep:
 *   - Zoom from 0.5x → 10x over the whole duration (tests all segments)
 *   - Lead/follower switch at segment boundaries (rule-consistent)
 *   - blend:true for 15 frames around each handover
 *   - sceneCam does a gentle dolly-in + pan
 *   - focusD oscillates slowly (2.0 → 4.0 → 2.0)
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../assets/trajectories/demo.json');

const FPS = 30;
const N = 240;

function lerp(a, b, t) { return a + (b - a) * t; }

function leadFollower(z) {
    if (z < 1.0) return { lead: 'uw', follower: 'main' };
    if (z < 5.0) return { lead: 'main', follower: 'uw' };
    return { lead: 'tele', follower: 'main' };
}

// Build dense frames first
const dense = [];
for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const zoom = 0.5 * Math.pow(20, t);
    const { lead, follower } = leadFollower(zoom);
    const focusD = 3.0 + Math.sin(t * Math.PI * 2) * 1.0;
    const position = [Math.sin(t * 0.3) * 0.2, 1.4, 4.0 - t * 1.5];
    const rotation_euler_deg = [0, Math.sin(t * 0.5) * 3, 0];
    dense.push({ lead, follower, zoom: +zoom.toFixed(4), focusD: +focusD.toFixed(3),
        blend: false, sceneCam: { position: position.map(v => +v.toFixed(4)), rotation_euler_deg: rotation_euler_deg.map(v => +v.toFixed(2)) } });
}

// Extend blend runs: 15 frames after each lead handover
for (let i = 1; i < N; i++) {
    if (dense[i].lead !== dense[i - 1].lead) {
        for (let j = i; j < Math.min(N, i + 15); j++) dense[j].blend = true;
    }
}

// Delta encode
const output = [];
for (let i = 0; i < N; i++) {
    if (i === 0) { output.push(dense[i]); continue; }
    const delta = {};
    for (const [k, v] of Object.entries(dense[i])) {
        if (JSON.stringify(v) !== JSON.stringify(dense[i - 1][k])) delta[k] = v;
    }
    output.push(Object.keys(delta).length > 0 ? delta : { zoom: dense[i].zoom });
}

const traj = { version: 1, name: 'demo-sweep', fps: FPS, frames: output };
writeFileSync(OUT, JSON.stringify(traj, null, 2));
console.log(`Written ${OUT} — ${N} frames @ ${FPS} fps`);
