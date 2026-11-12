# Screw Drivers dedicated server (Windows build) on Linux via Wine,
# plus the BepInEx admin API plugin so the server can be controlled remotely.
#
# The game ships its dedicated server as "Dedicated Server/Screw Drivers Server.exe"
# inside the paid Steam depot 1279510 (Windows only, no Linux build, no public
# dedicated-server AppID). So the runtime is Wine, and the game files have to be
# placed into the volume by someone who owns the game.
FROM ghcr.io/parkervcp/yolks:wine_10

# Trixie + wine 10 + Xvfb + tini, all already in the base image.
ENV SERVER_DIR=/home/container \
    WINEPREFIX=/home/container/.wine \
    WINEDEBUG=-all \
    WINEDLLOVERRIDES="winhttp=n,b;mscoree,mshtml=;winemenubuilder.exe=d" \
    DISPLAY=:0 \
    DISPLAY_WIDTH=1024 \
    DISPLAY_HEIGHT=768 \
    DISPLAY_DEPTH=16 \
    AUTO_UPDATE=0 \
    XVFB=1 \
    SD_ADMIN_ENABLED=1 \
    SD_ADMIN_BIND=0.0.0.0 \
    SD_ADMIN_PORT=38080 \
    BEPINEX_SRC=/opt/bepinex

# Pre-bake a fresh wine prefix so the first start does not have to run wineboot
# against the (possibly slow) server volume. start.sh copies it on first boot.
RUN mkdir -p /opt/wineprefix \
 && WINEPREFIX=/opt/wineprefix WINEDEBUG=-all wineboot --init > /dev/null 2>&1 || true
RUN WINEPREFIX=/opt/wineprefix wineserver -w > /dev/null 2>&1 || true

# BepInEx is copied into the server volume by start.sh on first boot.
ARG BEPINEX_VERSION=5.4.23.6
RUN mkdir -p /opt/bepinex /tmp/bepinex \
 && curl -fsSL -o /tmp/bepinex/bepinex.zip \
      "https://github.com/BepInEx/BepInEx/releases/download/v${BEPINEX_VERSION}/BepInEx_win_x64_${BEPINEX_VERSION}.zip" \
 && unzip -q /tmp/bepinex/bepinex.zip -d /opt/bepinex \
 && rm -rf /tmp/bepinex \
 && echo "${BEPINEX_VERSION}" > /opt/bepinex/.version

# Server mod: ModTheIsland (crash/exploit/DoS guards + bans) with the admin HTTP API.
# Built from ../mti -> dist/ModTheIsland.dll.
COPY dist/ModTheIsland.dll /opt/bepinex/plugins/ModTheIsland.dll

COPY start.sh /usr/local/bin/sd-start.sh
RUN chmod 0755 /usr/local/bin/sd-start.sh

# 38000/udp is the game port, 38080/tcp the admin API.
EXPOSE 38000/udp 38080/tcp

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/sd-start.sh"]
