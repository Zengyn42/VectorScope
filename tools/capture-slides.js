/**
 * capture-slides.js — automated before/after screenshots of every UI control.
 *
 * Drives the VectorScope app in headless Chrome (system binary, WebGL via
 * ANGLE) and saves PNGs to docs/slides/img/. Each control gets a "before"
 * and "after" shot demonstrating its on-screen effect.
 *
 * Usage: node tools/capture-slides.js [baseURL]
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8096/index.html';
const OUT = path.join(__dirname, '..', 'docs', 'slides', 'img');
fs.mkdirSync(OUT, { recursive: true });

const VP = { width: 1600, height: 900 };

async function main() {
    const browser = await chromium.launch({
        executablePath: '/usr/bin/google-chrome',
        args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'],
    });
    const page = await browser.newPage({ viewport: VP });

    const shot = async (name) => {
        await page.screenshot({ path: path.join(OUT, name + '.png') });
        console.log('  shot:', name);
    };
    const fresh = async () => {
        await page.goto(BASE, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2500); // let WebGL warm up + first frames render
    };
    // Set a range slider value and fire the app's input handler
    const setSlider = async (id, value) => {
        await page.evaluate(([id, value]) => {
            const el = document.getElementById(id);
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, [id, value]);
    };
    const setZoom = async (z) => setSlider('sld-z', Math.log10(z));
    const clickPreset = async (z) => page.click(`#zoom-presets .zp-btn[data-z="${z}"]`);
    const settle = (ms = 500) => page.waitForTimeout(ms);
    // Element crop via viewport clip (locator.screenshot waits for element
    // stability, which never happens while the render loop updates text).
    const cropShot = async (selector, name) => {
        const box = await page.locator(selector).boundingBox();
        await page.screenshot({ path: path.join(OUT, name + '.png'), clip: box });
        console.log('  shot:', name, '(crop)');
    };

    /* ── 00 Overview ─────────────────────────────────────────── */
    console.log('[overview]');
    await fresh();
    await shot('00_overview');
    // Controls panel crop
    await cropShot('#panel-controls', '00_controls_panel');

    /* ── Set Camera dialog ───────────────────────────────────── */
    console.log('[set camera]');
    await shot('01_setcam_before');
    await page.click('#btn-setcam');
    await settle(400);
    await shot('01_setcam_after');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.getElementById('cam-dialog').classList.remove('open'));

    /* ── Help dialog ─────────────────────────────────────────── */
    console.log('[help]');
    await fresh();
    await shot('02_help_before');
    await page.click('#btn-help');
    await settle(600);
    await shot('02_help_after');
    await page.evaluate(() => document.getElementById('help-dialog').classList.remove('open'));

    /* ── Seg dialog ──────────────────────────────────────────── */
    console.log('[segments]');
    await shot('03_seg_before');
    await page.click('#btn-segments');
    await settle(400);
    await shot('03_seg_after');
    await page.click('#seg-close');

    /* ── Zoom curve dialog ───────────────────────────────────── */
    console.log('[zoom curve]');
    await shot('04_zoomcurve_before');
    await page.click('#btn-zoom-curve');
    await settle(400);
    await shot('04_zoomcurve_after');
    await page.click('#curve-close');

    /* ── Warp curve dialog ───────────────────────────────────── */
    console.log('[warp curve]');
    await shot('05_warpcurve_before');
    await page.click('#btn-warp-curve');
    await settle(400);
    await shot('05_warpcurve_after');
    await page.click('#curve-close');

    /* ── Warp toggle at 0.7x (UW segment, warp interpolation) ── */
    console.log('[warp toggle]');
    await fresh();
    await setZoom(0.7);
    await settle(800);
    await shot('06_warp_on');        // warp defaults ON
    await page.click('#btn-warp');
    await settle(800);
    await shot('06_warp_off');
    await page.click('#btn-warp');   // restore
    await settle(300);

    /* ── Grid overlay at 3.0x ────────────────────────────────── */
    console.log('[grid overlay]');
    await setZoom(3.0);
    await settle(800);
    await shot('07_grid_before');
    await page.click('#btn-grid');
    await settle(600);
    await shot('07_grid_after');
    await page.click('#btn-grid');

    /* ── Combined focus mode ─────────────────────────────────── */
    console.log('[combined focus]');
    await setZoom(1.0);
    await settle(600);
    await shot('08_combined_before');
    await page.click('#btn-combined');
    await settle(800);
    await shot('08_combined_after');
    await page.click('#btn-combined');
    await settle(500);

    /* ── FPS toggle (controls crop) ──────────────────────────── */
    console.log('[fps]');
    await cropShot('#panel-controls', '09_fps_before');
    await page.click('#btn-fps');
    await settle(300);
    await cropShot('#panel-controls', '09_fps_after');
    await page.click('#btn-fps');

    /* ── Play (auto zoom sweep) ──────────────────────────────── */
    console.log('[play]');
    await fresh();
    await shot('10_play_before');
    await page.click('#btn-play');
    await page.waitForTimeout(2500);   // mid-sweep
    await shot('10_play_after');
    await page.click('#btn-play');     // stop
    await settle(300);

    /* ── Zoom presets: 1x → 5x (Tele handover) ───────────────── */
    console.log('[zoom presets]');
    await fresh();
    await shot('11_zoom_1x');
    await clickPreset('5');
    await page.waitForTimeout(1600);   // transition + blend done
    await shot('11_zoom_5x');
    await clickPreset('0.5');
    await page.waitForTimeout(1600);
    await shot('11_zoom_05x');

    /* ── Zoom slider manual ──────────────────────────────────── */
    console.log('[zoom slider]');
    await setZoom(1.0); await settle(700);
    await shot('12_slider_1x');
    await setZoom(2.6); await settle(700);
    await shot('12_slider_26x');

    /* ── Radial blend mid-transition (Dual + Radial) ─────────── */
    console.log('[radial blend]');
    await fresh();
    await setSlider('sld-blend', 60); // long blend so we can catch it
    await page.click('#btn-bmode');   // Single → Dual
    await page.click('#btn-bshape');  // Flat → Radial
    await settle(300);
    await clickPreset('5');
    await page.waitForTimeout(1800);
    await shot('13_blend_at5x');
    await clickPreset('1');           // Tele→Main: radial edges-first
    await page.waitForTimeout(650);   // mid-blend
    await shot('13_blend_mid');
    await page.waitForTimeout(1500);
    await shot('13_blend_done');
    // Controls crop showing Dual + Radial button states
    await cropShot('#panel-controls', '13_blend_controls');

    /* ── AF: toggle + drag focus box on Main panel ───────────── */
    console.log('[autofocus]');
    await fresh();
    await shot('14_af_before');
    await page.click('#btn-af');
    await settle(300);
    await shot('14_af_armed');
    // Drag a rect on the Main Camera panel (bottom row, 1st panel)
    const canvas = await page.locator('#main-canvas').boundingBox();
    const x0 = canvas.x + canvas.width * 0.06, y0 = canvas.y + canvas.height * 0.62;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 90, y0 + 90, { steps: 8 });
    await page.mouse.up();
    await settle(800);
    await shot('14_af_after');

    /* ── Sliders: Focus D / Prewarp / Clip ───────────────────── */
    console.log('[sliders]');
    await fresh();
    await setZoom(0.7); await settle(600);
    await page.click('#btn-warp');    // warp OFF → prewarp path visible
    await settle(500);
    await shot('15_focusd_3');
    await setSlider('sld-d', 1.0); await settle(700);
    await shot('15_focusd_1');
    await setSlider('sld-d', 3.0); await settle(400);
    await shot('16_prewarp_before');
    await setSlider('sld-pw', 4.0); await settle(700);
    await shot('16_prewarp_after');
    await fresh();
    await shot('17_clip_before');
    await setSlider('sld-clip', 6.0); await settle(700);
    await shot('17_clip_after');

    /* ── Reset All ───────────────────────────────────────────── */
    console.log('[reset all]');
    await fresh();
    await setZoom(4.0);
    await setSlider('sld-d', 1.2);
    await settle(700);
    await shot('18_reset_before');
    page.once('dialog', d => d.accept());   // confirm() if any
    await page.click('#btn-reset');
    await settle(900);
    await shot('18_reset_after');

    /* ── Trajectory: Rec → transport → Play ──────────────────── */
    console.log('[trajectory]');
    await fresh();
    await shot('19_traj_before');
    await page.click('#btn-traj-rec');       // start recording
    await settle(300);
    await shot('19_traj_recording');
    await clickPreset('2'); await page.waitForTimeout(900);
    await clickPreset('5'); await page.waitForTimeout(900);
    await page.click('#btn-traj-rec');       // stop recording
    await settle(500);
    await shot('19_traj_recorded');
    // Play it back
    await page.click('#btn-traj-play');
    await page.waitForTimeout(700);
    await shot('19_traj_playing');
    await page.click('#btn-traj-stop');
    await settle(300);

    /* ── Save/Load buttons (controls crop only — file dialogs) ─ */
    console.log('[file buttons]');
    await cropShot('#grp-actions', '20_file_buttons');
    await cropShot('#grp-trajectory', '20_traj_buttons');

    await browser.close();
    console.log('DONE →', OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
