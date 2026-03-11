#!/bin/bash
# Allow passwordless dpkg for in-app updates (matches Alpine sudoers pattern)
cat > /etc/sudoers.d/ncsender << 'EOF'
ALL ALL=(ALL) NOPASSWD: /usr/bin/dpkg -i /tmp/ncsender-update-*
EOF
chmod 440 /etc/sudoers.d/ncsender
