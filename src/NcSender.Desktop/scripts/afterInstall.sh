#!/bin/bash
# Allow passwordless dpkg for in-app updates (matches Alpine sudoers pattern)
cat > /etc/sudoers.d/ncsender << 'EOF'
ALL ALL=(ALL) NOPASSWD: /usr/bin/dpkg -i /tmp/ncsender-update-*
EOF
chmod 440 /etc/sudoers.d/ncsender

# Make launch.sh executable and update .desktop to use it.
# launch.sh starts the .NET server before Electron to avoid fork() overhead.
INSTALL_DIR="/opt/${productName:-ncSender}"
if [ -f "$INSTALL_DIR/launch.sh" ]; then
  chmod +x "$INSTALL_DIR/launch.sh"

  DESKTOP_FILE="/usr/share/applications/ncsender-desktop.desktop"
  if [ -f "$DESKTOP_FILE" ]; then
    sed -i "s|Exec=.*ncsender-desktop|Exec=$INSTALL_DIR/launch.sh|" "$DESKTOP_FILE"
  fi
fi
