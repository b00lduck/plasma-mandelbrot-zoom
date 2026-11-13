import QtQuick
import QtQuick.Window

// One screen's share of a Mandelbrot view that spans all screens.
//
// Each location drifts slowly (zoom + pan) for its whole slot, then the next
// location fades in on top.  Everything is derived from the wall clock, so all
// screens stay in sync without talking to each other.
//
// GPU budget: the fractal is only rendered at keyframes (every keyframeMs).
// Each keyframe is rendered ahead of time into a hidden buffer, a few strips per
// frame, so no single frame has to carry the full render.  Every vsync'd frame
// only moves/scales the cached keyframe texture to follow the motion.
Item {
    id: view
    clip: true

    property int intervalMs: 30000     // time per location
    property int fadeMs: 3000          // crossfade to the next location
    property real zoomPerSlot: 2       // zoom factor over one location's lifetime at 100% speed
    property real speed: 0.15          // movement speed multiplier (zoom and pan)
    readonly property real effZoom: Math.pow(zoomPerSlot, speed)
    readonly property real panFrac: 0.15 * speed   // pan over a location's lifetime, in view widths
    property real minZoomExp: 0.3
    property real maxZoomExp: 10
    property real brightness: 0.2
    property real saturation: 0.6
    property int keyframeMs: 10000     // full re-render interval
    property int aa: 2                 // supersampling, samples per axis
    readonly property int strips: 8 * aa * aa   // keyframe render is spread over this many frames
    property int maxFps: 10            // motion updates on every Nth vsync to stay near this rate
    readonly property int frameDiv: Math.max(1, Math.round((Screen.refreshRate > 0 ? Screen.refreshRate : 60) / Math.max(1, maxFps)))

    // this item's top-left in virtual-desktop coords + bbox of all screens
    property real screenX: Screen.virtualX
    property real screenY: Screen.virtualY
    property rect bbox: {
        const s = Qt.application.screens;
        if (!s || s.length === 0)
            return Qt.rect(screenX, screenY, width, height);
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (let i = 0; i < s.length; i++) {
            x0 = Math.min(x0, s[i].virtualX);
            y0 = Math.min(y0, s[i].virtualY);
            x1 = Math.max(x1, s[i].virtualX + s[i].width);
            y1 = Math.max(y1, s[i].virtualY + s[i].height);
        }
        return Qt.rect(x0, y0, x1 - x0, y1 - y0);
    }
    // this screen's top-left relative to the multi-screen bbox center
    readonly property vector2d screenOff: Qt.vector2d(screenX - (bbox.x + bbox.width / 2),
                                                      screenY - (bbox.y + bbox.height / 2))

    // extra border rendered around each keyframe so the moving texture never shows an edge
    // (x1.5 slack in case a keyframe finishes a little late)
    readonly property int margin: {
        const T = intervalMs + fadeMs;
        const shrink = 1 - Math.pow(effZoom, -1.5 * keyframeMs / T);
        const far = Math.max(bbox.width, bbox.height) / 2;
        return Math.ceil(far * shrink + panFrac * effZoom * bbox.width * 1.5 * keyframeMs / T) + 16;
    }

    readonly property int iterCap: 6000   // orbit texture holds 512*12 entries

    property var cur: null      // shown location {slot, cx, cy, w, ..., buf}
    property var nxt: null      // upcoming location, orbit already uploaded
    property int requested: -1

    function slotNow() { return Math.floor(Date.now() / intervalMs); }
    function nextSlot() { return Math.max(cur.slot + 1, slotNow()); }
    function tFor(L, time) {
        return Math.min(1, Math.max(0, (time - L.slot * intervalMs) / (intervalMs + fadeMs)));
    }

    function request(slot) {
        if (!worker.ready || requested === slot || bbox.width <= 0)
            return;
        requested = slot;
        worker.sendMessage({ slot: slot, aspect: bbox.width / bbox.height, minZoomExp: minZoomExp,
                             maxZoomExp: maxZoomExp, zoom: effZoom, pan: panFrac, cap: iterCap });
    }

    function restart() {
        cur = null; nxt = null; requested = -1;
        loc0.visible = false; loc1.visible = false;
        request(slotNow());
    }
    onIntervalMsChanged: restart()
    onMaxZoomExpChanged: restart()
    onZoomPerSlotChanged: restart()
    onSpeedChanged: restart()
    onAaChanged: restart()
    onKeyframeMsChanged: restart()

    function locFor(i) { return i === 0 ? loc0 : loc1; }

    WorkerScript {
        id: worker
        source: "finder.mjs"
        onReadyChanged: if (ready && !view.cur) view.request(view.slotNow())
        onMessage: msg => {
            if (msg.slot !== view.requested)
                return;
            view.requested = -1;
            msg.buf = view.cur ? 1 - view.cur.buf : 0;
            (msg.buf === 0 ? cv0 : cv1).load(msg.orbit);
            const lc = view.locFor(msg.buf);
            lc.assign(msg, !view.cur);
            if (!view.cur) {
                view.cur = msg;
                lc.z = 1; lc.opacity = 1;
            } else {
                view.nxt = msg;
                lc.z = 0; lc.opacity = 1;    // hidden under the current location until its fade starts
            }
            lc.visible = true;
        }
    }

    // vsync-driven: runs once per frame of this screen; we act on every Nth one
    // so the cadence stays even (no judder) while limiting redraws
    FrameAnimation {
        running: view.cur !== null
        onTriggered: if (currentFrame % view.frameDiv === 0) view.tick()
    }

    function tick() {
        const now = Date.now();
        if (nxt) {
            const start = nxt.slot * intervalMs;
            const fin = locFor(nxt.buf), fout = locFor(cur.buf);
            if (now >= start && fin.ready) {
                const a = fadeMs > 0 ? (now - start) / fadeMs : 1;
                if (a >= 1) {
                    fout.visible = false;
                    fin.z = 1; fin.opacity = 1;
                    cur = nxt; nxt = null;
                    request(nextSlot());
                } else {
                    fout.z = 0;
                    fin.z = 1; fin.opacity = a;
                }
            }
        } else if (requested < 0 && cur) {
            request(nextSlot());
        }
        if (loc0.visible) loc0.update(now);
        if (loc1.visible) loc1.update(now);
    }

    // ---- one location: two keyframe buffers (shown + being rendered) ----
    component Loc: Item {
        id: lc
        property var loc: null
        property var orbitTex
        property bool urgent: false      // render the first keyframe in one go
        property int active: -1          // buffer index on screen
        property int pend: -1            // buffer index being rendered
        property real pendTime: 0
        property int pendStrip: 0
        readonly property bool ready: active >= 0

        width: view.width
        height: view.height
        visible: false

        function buf(i) { return i === 0 ? kb0 : kb1; }

        function assign(L, isUrgent) {
            loc = L; urgent = isUrgent;
            active = -1; pend = -1;
            kb0.park(); kb1.park();
        }

        function update(now) {
            const K = view.keyframeMs;
            if (pend < 0) {
                let target;
                if (active < 0)
                    target = urgent ? now : Math.max(now, loc.slot * view.intervalMs);
                else
                    target = (Math.floor(now / K) + 1) * K;
                if (active < 0 || target > buf(active).keyTime) {
                    pend = active < 0 ? 0 : 1 - active;
                    pendTime = target;
                    pendStrip = 0;
                    buf(pend).prepare(loc, target);
                }
            }
            if (pend >= 0 && pendStrip < view.strips) {
                const n = (active < 0 && urgent) ? view.strips : 1;
                for (let i = 0; i < n && pendStrip < view.strips; i++)
                    buf(pend).renderStrip(pendStrip++);
            }
            if (pend >= 0 && pendStrip >= view.strips && (active < 0 || now >= pendTime)) {
                const old = active;
                active = pend;
                pend = -1;
                if (old >= 0) buf(old).park();
            }
            if (active >= 0)
                buf(active).follow(loc, now);
        }

        KeyBuf { id: kb0; orbitTex: lc.orbitTex; loc: lc.loc }
        KeyBuf { id: kb1; orbitTex: lc.orbitTex; loc: lc.loc }
    }

    // ---- one keyframe: the fractal rendered (in strips) for one point in time ----
    component KeyBuf: Item {
        id: kb
        property var orbitTex
        property var loc: null
        property real keyTime: -1
        property real keyT: 0
        property real keyPs: 1e-3
        property vector2d keyOff
        property real keyVbase: 0

        width: view.width + 2 * view.margin
        height: view.height + 2 * view.margin
        transformOrigin: Item.TopLeft
        readonly property int stripH: Math.ceil(height / view.strips)

        // not on screen, but still part of the scene so its layers keep rendering
        function park() { scale = 0.0001; x = 0; y = 0; z = -1; }

        function prepare(L, time) {
            keyTime = time;
            keyT = view.tFor(L, time);
            keyOff = Qt.vector2d(L.panX * keyT, L.panY * keyT);   // reference = start center
            keyPs = L.w * Math.pow(L.zoom, -keyT) / view.bbox.width;
            keyVbase = L.vbase0 + (L.vbase1 - L.vbase0) * keyT;
        }

        function renderStrip(i) {
            const s = rep.itemAt(i);
            if (!s) return;
            s.off = keyOff;
            s.ps = keyPs;
            s.vbase = keyVbase;
        }

        // place the cached keyframe so it shows the view at `now`
        // keyframe pixel Q = s * P + (center_now - center_key) / ps_key   (P, Q relative to bbox center)
        function follow(L, now) {
            const dt = view.tFor(L, now) - keyT;
            const s = Math.pow(L.zoom, -dt);
            const so = view.screenOff;
            const bx = L.panX * dt / keyPs + so.x * (s - 1);
            const by = -L.panY * dt / keyPs + so.y * (s - 1);
            z = 0;
            scale = 1 / s;
            x = -(view.margin + bx) / s;
            y = -(view.margin + by) / s;
        }

        Repeater {
            id: rep
            model: view.strips
            delegate: ShaderEffect {
                y: index * kb.stripH
                width: kb.width
                height: Math.min(kb.stripH, kb.height - index * kb.stripH)
                fragmentShader: Qt.resolvedUrl("../shaders/mandel.frag.qsb")

                property var orbit: kb.orbitTex
                property vector2d size: Qt.vector2d(width, height)
                property vector2d screenOff: Qt.vector2d(view.screenOff.x - view.margin,
                                                         view.screenOff.y - view.margin + y)
                property vector2d off
                property real ps: 1e-3
                property int refLen: kb.loc ? kb.loc.refLen : 0
                property int maxIter: kb.loc ? kb.loc.maxIter : 300
                property vector3d c0: kb.loc ? Qt.vector3d(...kb.loc.pal.cols[0]) : Qt.vector3d(0, 0, 0)
                property vector3d c1: kb.loc ? Qt.vector3d(...kb.loc.pal.cols[1]) : Qt.vector3d(0, 0, 0)
                property vector3d c2: kb.loc ? Qt.vector3d(...kb.loc.pal.cols[2]) : Qt.vector3d(0, 0, 0)
                property real freq: kb.loc ? kb.loc.pal.freq : 0.2
                property real poff: kb.loc ? kb.loc.pal.offset : 0
                property real vbase: 0
                property real sat: view.saturation
                property real bright: view.brightness
                property int aa: view.aa

                // cached texture: re-renders only when this strip's uniforms change
                layer.enabled: true
                layer.smooth: true
            }
        }
    }

    // ---- reference orbits, packed as raw float32 bytes into RGB pixels ----
    // (3 px per complex entry, 512 entries per row)
    component OrbitCanvas: Canvas {
        property var data_: []
        width: 1536
        height: 12
        smooth: false
        function load(o) { data_ = o; requestPaint(); }
        onPaint: {
            const ctx = getContext("2d");
            ctx.clearRect(0, 0, width, height);
            const f = new Float32Array(data_.length);
            for (let i = 0; i < data_.length; i++) f[i] = data_[i];
            const u = new Uint8Array(f.buffer);
            const n = data_.length / 2;
            for (let i = 0; i < n; i++) {
                const b = i * 8, row = Math.floor(i / 512), col = (i % 512) * 3;
                ctx.fillStyle = "rgb(" + u[b] + "," + u[b + 1] + "," + u[b + 2] + ")";
                ctx.fillRect(col, row, 1, 1);
                ctx.fillStyle = "rgb(" + u[b + 3] + "," + u[b + 4] + "," + u[b + 5] + ")";
                ctx.fillRect(col + 1, row, 1, 1);
                ctx.fillStyle = "rgb(" + u[b + 6] + "," + u[b + 7] + ",0)";
                ctx.fillRect(col + 2, row, 1, 1);
            }
        }
    }
    OrbitCanvas { id: cv0 }
    OrbitCanvas { id: cv1 }
    ShaderEffectSource { id: tex0; sourceItem: cv0; hideSource: true; smooth: false; visible: false }
    ShaderEffectSource { id: tex1; sourceItem: cv1; hideSource: true; smooth: false; visible: false }

    Rectangle { anchors.fill: parent; color: "black"; z: -2 }
    Loc { id: loc0; orbitTex: tex0 }
    Loc { id: loc1; orbitTex: tex1 }
}
