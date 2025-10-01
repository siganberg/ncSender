./.scripts/build-pi.sh \
&& scp releases/pi/ncsender_0.1.0_arm64.deb pi@altmill:~/Downloads \
&& ssh pi@altmill "sudo dpkg -i ~/Downloads/ncsender_0.1.0_arm64.deb