#!/bin/bash
set -e

# Remove any old .deb files from previous builds
rm -rf releases/pi/*.deb

# Build the new package
./.scripts/build-pi.sh

# Copy and install on the remote Pi
ssh pi@altmill "rm -f ~/Downloads/*.deb" && \
scp releases/pi/*.deb pi@altmill:~/Downloads/ && \
ssh pi@altmill "sudo dpkg -i ~/Downloads/*.deb"