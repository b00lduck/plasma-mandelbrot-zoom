QSB = /usr/lib/qt6/bin/qsb
SHADER = plugin/contents/shaders/mandel.frag

all: plugin

$(SHADER).qsb: $(SHADER)
	$(QSB) --glsl "330,300es" --hlsl 50 --msl 12 -o $@ $<

plugin: $(SHADER).qsb

# install or update the wallpaper plugin, then reload plasmashell to pick up QML changes
install: plugin
	kpackagetool6 -t Plasma/Wallpaper -u plugin 2>/dev/null || kpackagetool6 -t Plasma/Wallpaper -i plugin
	systemctl --user restart plasma-plasmashell

# system-wide copy, needed for the login screen (greeter runs as user plasmalogin)
install-system: plugin
	sudo kpackagetool6 -t Plasma/Wallpaper -g -u plugin 2>/dev/null || sudo kpackagetool6 -t Plasma/Wallpaper -g -i plugin

.PHONY: all plugin install install-system
