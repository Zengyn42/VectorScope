/**
 * Tests for the slide-deck tooling:
 *   tools/capture-slides.js  — Playwright screenshot automation
 *   tools/build-pptx.py      — PowerPoint export
 *   docs/slides/index.html   — the HTML deck itself
 *
 * The capture script needs a live server + headless Chrome, so it is not
 * executed here. Instead these tests verify the *contract* between the
 * three artifacts:
 *
 * 1. Both scripts are syntactically valid (node --check / py_compile).
 * 2. Every image the HTML deck references exists on disk (.webp).
 * 3. Every image the PPTX builder references exists on disk (.webp).
 * 4. Every deck/pptx image is actually produced by the capture script,
 *    so re-running capture-slides.js can never leave the deck stale.
 * 5. tools/build-pptx.py runs end-to-end and produces a valid .pptx
 *    with the expected slide count and embedded pictures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURE = path.join(ROOT, 'tools', 'capture-slides.js');
const BUILD_PPTX = path.join(ROOT, 'tools', 'build-pptx.py');
const DECK = path.join(ROOT, 'docs', 'slides', 'index.html');
const IMG_DIR = path.join(ROOT, 'docs', 'slides', 'img');

/* ── helpers ─────────────────────────────────────────────────────── */

/** Base names of every screenshot the capture script writes.
 *  Covers: shot('name'), cropShot('sel', 'name'), and direct
 *  path.join(OUT, 'name.png') screenshot calls. */
function captureScriptShots() {
    const src = fs.readFileSync(CAPTURE, 'utf8');
    const names = new Set();
    for (const m of src.matchAll(/\bshot\('([^']+)'\)/g)) names.add(m[1]);
    for (const m of src.matchAll(/cropShot\('[^']+',\s*'([^']+)'\)/g)) names.add(m[1]);
    for (const m of src.matchAll(/path\.join\(OUT,\s*'([^']+)\.png'\)/g)) names.add(m[1]);
    return names;
}

/** Image base names referenced by the HTML deck (src="img/xxx.webp"). */
function deckImages() {
    const html = fs.readFileSync(DECK, 'utf8');
    const names = new Set();
    for (const m of html.matchAll(/src="img\/([^"]+)\.webp"/g)) names.add(m[1]);
    return names;
}

/** Image base names referenced by the PPTX builder. */
function pptxImages() {
    const py = fs.readFileSync(BUILD_PPTX, 'utf8');
    const names = new Set();
    // Entries inside SLIDES: ("tag", "basename") tuples, and the
    // explicit title-slide call webp_to_png_stream("00_overview").
    for (const m of py.matchAll(/\(\s*"[^"]*",\s*"(\d{2}_[\w]+)"\s*\)/g)) names.add(m[1]);
    for (const m of py.matchAll(/webp_to_png_stream\(\s*"([^"]+)"\s*\)/g)) {
        if (m[1] !== 'basename') names.add(m[1]);
    }
    return names;
}

/* ── 1. syntax validity ──────────────────────────────────────────── */

describe('script validity', () => {
    it('capture-slides.js parses (node --check)', () => {
        execFileSync(process.execPath, ['--check', CAPTURE]);
    });

    it('build-pptx.py compiles (py_compile)', () => {
        execFileSync('python3', ['-m', 'py_compile', BUILD_PPTX]);
    });
});

/* ── 2–4. artifact consistency ───────────────────────────────────── */

describe('deck / capture / pptx consistency', () => {
    const shots = captureScriptShots();
    const deck = deckImages();
    const pptx = pptxImages();

    it('capture script defines at least 40 screenshots', () => {
        assert.ok(shots.size >= 40, `only ${shots.size} shots found in capture script`);
    });

    it('HTML deck references at least 30 images', () => {
        assert.ok(deck.size >= 30, `only ${deck.size} images referenced by deck`);
    });

    it('PPTX builder references at least 30 images', () => {
        assert.ok(pptx.size >= 30, `only ${pptx.size} images referenced by build-pptx.py`);
    });

    it('every deck image exists on disk as .webp', () => {
        for (const name of deck) {
            const p = path.join(IMG_DIR, name + '.webp');
            assert.ok(fs.existsSync(p), `deck references missing image: ${name}.webp`);
        }
    });

    it('every pptx image exists on disk as .webp', () => {
        for (const name of pptx) {
            const p = path.join(IMG_DIR, name + '.webp');
            assert.ok(fs.existsSync(p), `build-pptx.py references missing image: ${name}.webp`);
        }
    });

    it('every deck image is produced by capture-slides.js', () => {
        for (const name of deck) {
            assert.ok(shots.has(name),
                `deck image "${name}" is not written by capture-slides.js — re-capture would leave it stale`);
        }
    });

    it('every pptx image is produced by capture-slides.js', () => {
        for (const name of pptx) {
            assert.ok(shots.has(name),
                `pptx image "${name}" is not written by capture-slides.js — re-capture would leave it stale`);
        }
    });
});

/* ── deck structure sanity ───────────────────────────────────────── */

describe('HTML deck structure', () => {
    const html = fs.readFileSync(DECK, 'utf8');

    it('has slide sections and exactly one current slide', () => {
        const sections = html.match(/<section class="slide/g) || [];
        assert.ok(sections.length >= 15, `only ${sections.length} slides`);
        const current = html.match(/class="slide[^"]*\bcurrent\b/g) || [];
        assert.equal(current.length, 1, 'exactly one slide must start visible');
    });

    it('has keyboard navigation wired', () => {
        assert.match(html, /ArrowRight/);
        assert.match(html, /ArrowLeft/);
    });
});

/* ── 5. PPTX end-to-end build ────────────────────────────────────── */

describe('build-pptx.py end-to-end', () => {
    it('produces a valid deck with expected slides and pictures', () => {
        const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vs-pptx-')), 'deck.pptx');
        execFileSync('python3', [BUILD_PPTX, out], { timeout: 120_000 });
        assert.ok(fs.existsSync(out), 'pptx not written');
        assert.ok(fs.statSync(out).size > 1_000_000, 'pptx suspiciously small');

        // Introspect with python-pptx: slide count + total embedded pictures.
        const report = execFileSync('python3', ['-c', `
import sys
from pptx import Presentation
p = Presentation(sys.argv[1])
pics = sum(1 for s in p.slides for sh in s.shapes if sh.shape_type == 13)
print(len(list(p.slides)), pics)
`, out], { encoding: 'utf8' }).trim();
        const [slides, pics] = report.split(/\s+/).map(Number);

        // 1 title + content slides + 1 end slide; every content image embedded.
        const expectedImages = pptxImages().size;
        assert.ok(slides >= 17, `only ${slides} slides in pptx`);
        assert.ok(pics >= expectedImages, `pptx embeds ${pics} pictures, expected >= ${expectedImages}`);

        fs.rmSync(path.dirname(out), { recursive: true, force: true });
    });
});
