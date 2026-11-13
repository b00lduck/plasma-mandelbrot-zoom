import QtQuick
import org.kde.plasma.plasmoid

WallpaperItem {
    id: root

    MandelView {
        anchors.fill: parent
        intervalMs: Math.max(5, root.configuration.Interval) * 1000
        fadeMs: Math.min(root.configuration.Fade * 1000, intervalMs * 0.5)
        zoomPerSlot: Math.max(1, root.configuration.ZoomPerSlot / 10)
        maxZoomExp: root.configuration.MaxZoom
        brightness: root.configuration.Brightness / 100
        saturation: root.configuration.Saturation / 100
        keyframeMs: Math.max(1, root.configuration.Rerender) * 1000
        maxFps: root.configuration.MaxFps
        speed: root.configuration.Speed / 100
        aa: Math.max(1, Math.min(3, root.configuration.Antialiasing))
    }
}
