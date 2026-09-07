#!/usr/bin/env bash
# GitHub's Ubuntu x64 archive does not serve ARM packages. Keep its native
# sources restricted and fetch ARM packages from the Ubuntu ports archive.
set -euo pipefail
source /etc/os-release
: "${VERSION_CODENAME:?Ubuntu codename is required}"
python3 - <<'PY'
from pathlib import Path
import re
for path in Path('/etc/apt/sources.list.d').glob('*.sources'):
    blocks = path.read_text().split('\n\n')
    for i, block in enumerate(blocks):
        if not block.strip():
            continue
        if re.search(r'^Architectures:', block, re.M):
            continue
        blocks[i] = block.rstrip() + '\nArchitectures: amd64\n'
    path.write_text('\n\n'.join(blocks))
for path in [Path('/etc/apt/sources.list'), *Path('/etc/apt/sources.list.d').glob('*.list')]:
    if not path.exists():
        continue
    text = re.sub(r'^(deb\s+)(?!\[)', r'\1[arch=amd64] ', path.read_text(), flags=re.M)
    text = re.sub(r'^(deb\s+\[)(?![^\]\n]*arch=)', r'\1arch=amd64 ', text, flags=re.M)
    path.write_text(text)
PY
printf '%s\n' \
  'Types: deb' \
  'URIs: http://ports.ubuntu.com/ubuntu-ports' \
  "Suites: ${VERSION_CODENAME} ${VERSION_CODENAME}-updates ${VERSION_CODENAME}-security" \
  'Components: main universe restricted multiverse' \
  'Architectures: arm64 armhf' \
  'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' \
  > /etc/apt/sources.list.d/lx-arm-ports.sources
dpkg --add-architecture arm64
dpkg --add-architecture armhf
