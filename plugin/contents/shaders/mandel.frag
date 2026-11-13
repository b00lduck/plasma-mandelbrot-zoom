#version 440
// Mandelbrot via perturbation theory: a high-precision reference orbit Z_n
// (computed in double precision on the CPU, packed into a texture) plus a
// per-pixel float delta.  Rebasing (Zhuoran) avoids glitches.
//
// Performance:
//  - interior points exit early: the derivative d z_n / d z_1 = prod 2 z_k shrinks
//    towards 0 once the orbit is caught by an attracting cycle
//  - main cardioid / period-2 bulb are rejected analytically when zoomed out
//  - adaptive antialiasing: a distance estimate tells whether the pixel is far
//    enough from the set to be smooth; only pixels near the boundary get the
//    extra supersamples

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;       // item size in px
    vec2 screenOff;  // item top-left relative to the multi-screen bbox center, px
    vec2 off;        // view center minus reference point (complex units)
    vec2 refC;       // reference point (float approximation, for the cardioid test)
    float ps;        // complex units per px
    int refLen;      // last valid index in the orbit texture
    int maxIter;
    vec3 c0;         // three-colour cyclic gradient
    vec3 c1;
    vec3 c2;
    float freq;      // palette cycles per doubling of the iteration count
    float poff;
    float vbase;     // iteration count subtracted before coloring
    float sat;       // saturation (0 = grey)
    float bright;    // overall brightness
    int aa;          // supersampling: samples per axis
};
layout(binding = 1) uniform sampler2D orbit;

uint B(float x) { return uint(x * 255.0 + 0.5); }

vec2 fetchZ(int m) {
    ivec2 p = ivec2((m % 512) * 3, m / 512);
    vec4 a = texelFetch(orbit, p, 0);
    vec4 b = texelFetch(orbit, p + ivec2(1, 0), 0);
    vec4 c = texelFetch(orbit, p + ivec2(2, 0), 0);
    uint re = B(a.r) | (B(a.g) << 8) | (B(a.b) << 16) | (B(b.r) << 24);
    uint im = B(b.g) | (B(b.b) << 8) | (B(c.r) << 16) | (B(c.g) << 24);
    return vec2(uintBitsToFloat(re), uintBitsToFloat(im));
}

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

// Smooth iteration count for one sample (-1 = inside the set).
// dePx: distance estimate to the set in pixels (0 if unknown / inside).
float iterAt(vec2 dc, out float dePx) {
    dePx = 0.0;

    // analytic interior test, only meaningful while float can resolve c itself
    if (ps > 1e-6) {
        vec2 c = refC + dc;
        float xq = c.x - 0.25;
        float q = xq * xq + c.y * c.y;
        if (q * (q + xq) <= 0.25 * c.y * c.y) return -1.0;
        if ((c.x + 1.0) * (c.x + 1.0) + c.y * c.y <= 0.0625) return -1.0;
    }

    vec2 Z = vec2(0.0);
    vec2 dz = vec2(0.0);
    vec2 z = vec2(0.0);
    vec2 dzdp = vec2(0.0);       // d z / d(pixel) = d z / dc * ps  (stays in float range)
    vec2 dzdz = vec2(1.0, 0.0);  // d z_n / d z_1, for interior detection
    int m = 0;
    for (int n = 0; n < maxIter; n++) {
        dzdp = 2.0 * cmul(z, dzdp) + vec2(ps, 0.0);
        dz = 2.0 * cmul(Z, dz) + cmul(dz, dz) + dc;
        m++;
        Z = fetchZ(m);
        z = Z + dz;
        float r2 = dot(z, z);
        if (r2 > 256.0) {
            float lr = 0.5 * log(r2);
            dePx = sqrt(r2) * lr / max(length(dzdp), 1e-30);
            return float(n) + 1.0 - log2(lr / log(2.0));
        }
        dzdz = 2.0 * cmul(z, dzdz);
        if (dot(dzdz, dzdz) < 1e-24)   // attracted to a cycle: inside
            return -1.0;
        if (r2 < dot(dz, dz) || m >= refLen) {
            dz = z;
            m = 0;
            Z = vec2(0.0);
        }
    }
    return -1.0;
}

vec3 colorFor(float v) {
    if (v < 0.0)
        return vec3(0.0);
    v = max(v - vbase, 0.0);
    float t = log2(1.0 + v) * freq + poff;
    float u = fract(t) * 3.0;
    float k = smoothstep(0.0, 1.0, fract(u));
    vec3 col = u < 1.0 ? mix(c0, c1, k) : (u < 2.0 ? mix(c1, c2, k) : mix(c2, c0, k));
    float fade = min(1.0, v / 8.0);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    return mix(vec3(lum), col, sat) * fade;
}

vec3 sampleAt(vec2 q, out float dePx) {
    return colorFor(iterAt(off + vec2(q.x, -q.y) * ps, dePx));
}

void main() {
    vec2 p = qt_TexCoord0 * size + screenOff;
    int n = max(aa, 1);

    float de;
    vec3 col = sampleAt(p, de);
    // supersample only near the boundary (or inside, where edges may hide);
    // the centre sample is reused, so n*n samples in total
    if (n > 1 && de < 1.5) {
        float d;
        if (n == 2) {
            // centre + 3 samples on a circle (120 degrees apart)
            col += sampleAt(p + vec2(0.0, 0.35), d);
            col += sampleAt(p + vec2(0.303, -0.175), d);
            col += sampleAt(p + vec2(-0.303, -0.175), d);
        } else {
            // odd grid: contains the centre already
            for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++) {
                    vec2 o = (vec2(float(i), float(j)) + 0.5) / float(n) - 0.5;
                    if (o != vec2(0.0))
                        col += sampleAt(p + o, d);
                }
        }
        col /= float(n * n);
    }
    col *= bright;

    // dither so the dim gradients don't band in 8 bit
    float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    col += (h - 0.5) / 255.0;
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
