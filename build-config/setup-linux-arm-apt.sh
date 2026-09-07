#!/usr/bin/env bash
# GitHub's Ubuntu x64 archive does not serve ARM packages. In CI, replace the
# image's source list with explicit one-line sources so no amd64 archive is
# queried for arm64/armhf packages and no deb822 stanza is rewritten.
set -euo pipefail
source /etc/os-release
: "${VERSION_CODENAME:?Ubuntu codename is required}"

dpkg --add-architecture arm64
dpkg --add-architecture armhf

backup="$(mktemp -d)"
# The runner image currently uses ubuntu.sources, but moving every existing
# source makes this independent of that implementation detail. This script is
# used only on disposable CI runners.
for file in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
  [ -e "$file" ] || continue
  mv "$file" "$backup/"
done

cat > /etc/apt/sources.list <<EOF
# Native packages for the x64 GitHub runner.
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ ${VERSION_CODENAME} main universe restricted multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu/ ${VERSION_CODENAME}-updates main universe restricted multiverse
deb [arch=amd64] http://security.ubuntu.com/ubuntu/ ${VERSION_CODENAME}-security main universe restricted multiverse
# Target packages for the cross compilers and XCB headers.
deb [arch=arm64,armhf] http://ports.ubuntu.com/ubuntu-ports/ ${VERSION_CODENAME} main universe restricted multiverse
deb [arch=arm64,armhf] http://ports.ubuntu.com/ubuntu-ports/ ${VERSION_CODENAME}-updates main universe restricted multiverse
deb [arch=arm64,armhf] http://ports.ubuntu.com/ubuntu-ports/ ${VERSION_CODENAME}-security main universe restricted multiverse
EOF
