// WorkerScript: picks a deterministic (seeded by time slot) interesting
// Mandelbrot location and computes its double-precision reference orbit.
// Every screen runs its own copy; same seed => identical result.

const FULL = 3.5;

function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function maxIterFor(w, cap) {
    return Math.min(cap, Math.floor(200 + 140 * Math.max(0, Math.log10(FULL / w))));
}

function smoothIter(cr, ci, maxiter) {
    const q = (cr - 0.25) * (cr - 0.25) + ci * ci;
    if (q * (q + (cr - 0.25)) <= 0.25 * ci * ci) return -1;
    if ((cr + 1) * (cr + 1) + ci * ci <= 0.0625) return -1;
    let zr = 0, zi = 0, zr2 = 0, zi2 = 0;
    for (let n = 0; n < maxiter; n++) {
        zi = 2 * zr * zi + ci;
        zr = zr2 - zi2 + cr;
        zr2 = zr * zr;
        zi2 = zi * zi;
        if (zr2 + zi2 > 256) {
            const logZn = Math.log(zr2 + zi2) / 2;
            return n + 1 - Math.log2(logZn / Math.LN2);
        }
    }
    return -1;
}

function probe(cx, cy, w, pw, ph, cap) {
    const px = w / pw, mi = maxIterFor(w, cap);
    const it = new Float64Array(pw * ph);
    for (let y = 0; y < ph; y++)
        for (let x = 0; x < pw; x++)
            it[y * pw + x] = smoothIter(cx + (x + 0.5 - pw / 2) * px, cy + (ph / 2 - y - 0.5) * px, mi);
    return it;
}

function interesting(it) {
    const ext = [];
    for (const v of it) if (v >= 0) ext.push(v);
    if (ext.length < it.length * 0.45) return false;
    ext.sort((a, b) => a - b);
    return ext[Math.floor(ext.length * 0.9)] - ext[Math.floor(ext.length * 0.1)] > 6;
}

function pick(rng, aspect, minExp, maxExp, cap) {
    const pw = 64, ph = Math.max(8, Math.round(pw / aspect));
    let cx = -0.6, cy = 0, w = FULL;
    for (let attempt = 0; attempt < 10; attempt++) {
        const target = FULL * Math.pow(10, -(minExp + rng() * (maxExp - minExp)));
        cx = -0.6; cy = 0; w = FULL;
        let it;
        for (;;) {
            it = probe(cx, cy, w, pw, ph, cap);
            if (w <= target * 1.0001) break;
            // move towards high-iteration (= near-boundary) pixels
            let total = 0;
            const wgt = new Float64Array(it.length);
            const m = 3;
            for (let y = m; y < ph - m; y++)
                for (let x = m; x < pw - m; x++) {
                    const v = it[y * pw + x];
                    if (v >= 0) { wgt[y * pw + x] = v * v * v; total += v * v * v; }
                }
            if (total <= 0) break;
            let r = rng() * total, idx = 0;
            for (; idx < wgt.length - 1; idx++) { r -= wgt[idx]; if (r <= 0 && wgt[idx] > 0) break; }
            const x = idx % pw, y = Math.floor(idx / pw), px = w / pw;
            cx += (x + 0.5 - pw / 2) * px;
            cy += (ph / 2 - y - 0.5) * px;
            w = Math.max(target, w / 4);
        }
        if (interesting(it)) break;
    }
    return { cx: cx, cy: cy, w: w };
}

function orbit(cr, ci, maxiter) {
    // Z_0 .. Z_N, stopping after the first |Z|^2 > 256
    const out = [0, 0];
    let zr = 0, zi = 0;
    for (let n = 0; n < maxiter; n++) {
        const t = zr * zr - zi * zi + cr;
        zi = 2 * zr * zi + ci;
        zr = t;
        out.push(zr, zi);
        if (zr * zr + zi * zi > 256) break;
    }
    return out;
}

function hsl(h, sat, l) {
    h = ((h % 1) + 1) % 1;
    const k = n => (n + h * 12) % 12;
    const a = sat * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)];
}

// Three-colour cyclic gradient.  The base hue steps by the golden angle from
// slot to slot, so consecutive shots always differ clearly.
function palette(rng, slot) {
    const h = (slot * 0.381966 + rng() * 0.08) % 1;
    const schemes = [
        [0, 0.08, 0.16],        // analogous
        [0, 0.33, 0.67],        // triadic
        [0, 0.5, 0.08],         // complementary
        [0, 0.42, 0.58],        // split complementary
    ];
    const sc = schemes[Math.floor(rng() * schemes.length)];
    const light = [0.22, 0.5, 0.78];
    // shuffle which colour is dark / mid / light
    for (let i = 2; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [light[i], light[j]] = [light[j], light[i]]; }
    const cols = sc.map((dh, i) => hsl(h + dh, 0.45 + rng() * 0.35, light[i]));
    return { cols: cols, freq: 0.12 + rng() * 0.12, offset: rng() };
}

// Lowest iteration count in a view. Outside the set the escape potential is
// harmonic, so its minimum lies on the view border: sample the perimeter.
function vbaseFor(cx, cy, w, aspect, maxit) {
    const h = w / aspect, nx = 128, ny = Math.max(8, Math.round(nx / aspect));
    let mn = 1e9;
    const test = (fx, fy) => {
        const v = smoothIter(cx + (fx - 0.5) * w, cy + (fy - 0.5) * h, maxit);
        if (v >= 0 && v < mn) mn = v;
    };
    for (let i = 0; i <= nx; i++) { test(i / nx, 0); test(i / nx, 1); }
    for (let j = 1; j < ny; j++) { test(0, j / ny); test(1, j / ny); }
    return mn > 1e8 ? 0 : Math.max(0, mn - 1);
}

WorkerScript.onMessage = function (msg) {
    const rng = mulberry32((msg.slot * 2654435761) ^ 0x5bd1e995);
    // leave room for the slow zoom-in during the slot
    const maxExp = Math.max(msg.minZoomExp + 0.5, msg.maxZoomExp - Math.log10(msg.zoom));
    const loc = pick(rng, msg.aspect, msg.minZoomExp, maxExp, msg.cap);
    const pal = palette(rng, msg.slot);
    const ang = rng() * 2 * Math.PI;
    const pan = msg.pan * loc.w;                    // total drift over the slot
    const panX = Math.cos(ang) * pan, panY = Math.sin(ang) * pan;
    const wEnd = loc.w / msg.zoom;
    const maxIter = maxIterFor(wEnd, msg.cap);
    const orb = orbit(loc.cx, loc.cy, msg.cap);
    WorkerScript.sendMessage({
        slot: msg.slot, cx: loc.cx, cy: loc.cy, w: loc.w, zoom: msg.zoom,
        panX: panX, panY: panY, maxIter: maxIter, pal: pal,
        vbase0: vbaseFor(loc.cx, loc.cy, loc.w, msg.aspect, Math.min(maxIter, 3000)),
        vbase1: vbaseFor(loc.cx + panX, loc.cy + panY, wEnd, msg.aspect, Math.min(maxIter, 3000)),
        orbit: orb, refLen: orb.length / 2 - 1,
    });
};
