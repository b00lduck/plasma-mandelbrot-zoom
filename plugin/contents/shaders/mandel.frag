#version 440
// Mandelbrot via perturbation theory: a high-precision reference orbit Z_n
// (computed in double precision on the CPU, packed into a texture) plus a
// per-pixel float delta.  Rebasing (Zhuoran) avoids glitches.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;       // item size in px
    vec2 screenOff;  // item top-left relative to the multi-screen bbox center, px
    vec2 off;        // view center minus reference point (complex units)
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

// smooth iteration count for one sample, -1 = inside the set
float iterAt(vec2 dc) {
    vec2 Z = vec2(0.0);
    vec2 dz = vec2(0.0);
    int m = 0;
    for (int n = 0; n < maxIter; n++) {
        dz = vec2(2.0 * (Z.x * dz.x - Z.y * dz.y) + dz.x * dz.x - dz.y * dz.y,
                  2.0 * (Z.x * dz.y + Z.y * dz.x) + 2.0 * dz.x * dz.y) + dc;
        m++;
        Z = fetchZ(m);
        vec2 z = Z + dz;
        float r2 = dot(z, z);
        if (r2 > 256.0)
            return float(n) + 1.0 - log2(0.5 * log(r2) / log(2.0));
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
    float fade = min(1.0, v / 8.0);
    float u = fract(t) * 3.0;
    float k = smoothstep(0.0, 1.0, fract(u));
    vec3 col = u < 1.0 ? mix(c0, c1, k) : (u < 2.0 ? mix(c1, c2, k) : mix(c2, c0, k));
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    return mix(vec3(lum), col, sat) * fade;
}

void main() {
    vec2 p = qt_TexCoord0 * size + screenOff;
    int n = max(aa, 1);
    vec3 col = vec3(0.0);
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++) {
            vec2 q = p + (vec2(float(i), float(j)) + 0.5) / float(n) - 0.5;
            col += colorFor(iterAt(off + vec2(q.x, -q.y) * ps));
        }
    col *= bright / float(n * n);
    // dither so the dim gradients don't band in 8 bit
    float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    col += (h - 0.5) / 255.0;
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
