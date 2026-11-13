# CLAUDE.md

KDE Plasma 6 wallpaper plugin (`local.mandelbrot`): animated Mandelbrot spanning all
screens. QML/JS + one GLSL shader, no C++. See README.md for features and architecture.

## Build / deploy

- `make plugin` — compile `mandel.frag` → `mandel.frag.qsb` (needed after every shader edit; the .qsb is what's loaded).
- `make install` — upgrade the installed package and restart plasmashell (QML is cached; a restart is required to see changes).
- Errors: `journalctl --user -u plasma-plasmashell --since "-1min" | grep -i mandel`

## Testing outside Plasma

`main.qml` needs `WallpaperItem`, but `MandelView.qml` is a plain Item. Test it with
`/usr/lib/qt6/bin/qml harness.qml`, instantiating two `MandelView`s side by side with
explicit `screenX/screenY/bbox` (simulate the two screens, e.g. at 1/4 scale), then
`grabToImage` frames and inspect them. Set `brightness: 1` when judging images
(default 20 % looks black), short `intervalMs` to see several shots.

## Gotchas (learned the hard way)

- Qt 6 `ShaderEffect` does **not** support uniform arrays → reference orbit goes through a texture.
- QML `Canvas.putImageData` silently does nothing here; write pixels with `fillRect` + `"rgb(r,g,b)"` (exact bytes).
- A QML load error in `config.qml` (e.g. using `Layout.*` without `import QtQuick.Layouts`) just shows an **empty** settings page, no visible error. Verify the page by loading it in a `Loader` in the harness and grabbing a screenshot (console output isn't visible there).
- Don't name QML functions/properties after `Item` members (`layer`, `data`, …) — silently breaks.
- `layer.enabled` caches a ShaderEffect's output; parent transforms (x/y/scale) don't re-render it. That's what makes keyframing cheap. Items with `visible: false` don't render their layers — hidden buffers are "parked" at scale 0.0001 instead.
- All screens must derive state only from wall-clock time + slot seed; never from per-instance randomness or frame counts, or the screens desync.
- Colour normalisation (`vbase`) = min escape iteration on the view **perimeter** (escape potential is harmonic, so the min is on the border). A coarse interior grid misses it and causes black wedges.
- Keep float precision in mind: view width ≥ ~1e-11 (double centre precision); deltas are float in the shader.

## Performance

User cares about GPU load. Frame rate dominates power (full-screen redraws by plasmashell + KWin);
measure with `/sys/class/drm/card1/device/hwmon/hwmon2/power1_average` and `gpu_busy_percent`,
always against a plain-colour baseline (`org.kde.color`) taken at the same time — background load varies a lot.
Never render the fractal every frame.

## Config

Settings live in `~/.config/plasma-org.kde.plasma.desktop-appletsrc` under
`[Containments][N][Wallpaper][local.mandelbrot][General]`. Edit with `kwriteconfig6` only
while plasmashell is stopped (it rewrites the file), or via the PlasmaShell `evaluateScript` D-Bus API.
When adding/removing a setting, update `config/main.xml`, `ui/config.qml`, `ui/main.qml` and README.
