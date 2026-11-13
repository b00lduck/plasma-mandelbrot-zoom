import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: root
    twinFormLayouts: parentLayout

    property alias formLayout: root
    property alias cfg_Interval: interval.value
    property alias cfg_Fade: fade.value
    property alias cfg_ZoomPerSlot: zoom.value
    property alias cfg_MaxZoom: maxZoom.value
    property alias cfg_Brightness: brightness.value
    property alias cfg_Saturation: saturation.value
    property alias cfg_Rerender: rerender.value
    property alias cfg_MaxFps: maxFps.value
    property alias cfg_Speed: speed.value
    property alias cfg_Antialiasing: aaBox.value

    QQC2.SpinBox { id: interval; Kirigami.FormData.label: "Seconds per location:"; from: 5; to: 3600 }
    QQC2.SpinBox { id: fade; Kirigami.FormData.label: "Crossfade (s):"; from: 0; to: 60 }
    QQC2.SpinBox { id: speed; Kirigami.FormData.label: "Movement speed (%):"; from: 0; to: 200; stepSize: 5 }
    QQC2.SpinBox {
        id: zoom
        Kirigami.FormData.label: "Zoom per location:"
        from: 10; to: 100
        textFromValue: v => "×" + (v / 10).toFixed(1)
        valueFromText: t => Math.round(parseFloat(t.replace("×", "")) * 10)
    }
    QQC2.SpinBox { id: maxZoom; Kirigami.FormData.label: "Max zoom depth (10^x):"; from: 1; to: 11 }
    QQC2.SpinBox { id: brightness; Kirigami.FormData.label: "Brightness (%):"; from: 5; to: 100; stepSize: 5 }
    QQC2.SpinBox { id: saturation; Kirigami.FormData.label: "Saturation (%):"; from: 0; to: 100; stepSize: 10 }
    QQC2.SpinBox {
        id: aaBox
        Kirigami.FormData.label: "Antialiasing:"
        from: 1; to: 3
        textFromValue: v => v === 1 ? "off" : v + "×" + v
        valueFromText: t => t === "off" ? 1 : parseInt(t)
    }
    QQC2.SpinBox { id: rerender; Kirigami.FormData.label: "Full re-render every (s):"; from: 1; to: 30 }
    QQC2.SpinBox { id: maxFps; Kirigami.FormData.label: "Max frames per second:"; from: 5; to: 144; stepSize: 5 }
    QQC2.Label {
        Layout.fillWidth: true
        wrapMode: Text.Wrap
        text: "Use the same settings on every screen so the screens stay in sync."
    }
}
