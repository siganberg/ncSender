#!/bin/bash
set -e

# Remove any old .deb files from previous builds
rm -rf releases/pi/*.deb

# Build the new package
./.scripts/build-pi.sh

# Copy and install on the remote Pi
ssh ncsender@altfinity "rm -f ~/Downloads/*.deb" && \
scp releases/pi/*.deb ncsender@altfinity:~/Downloads/ && \
ssh ncsender@altfinity "sudo dpkg -i ~/Downloads/*.deb"