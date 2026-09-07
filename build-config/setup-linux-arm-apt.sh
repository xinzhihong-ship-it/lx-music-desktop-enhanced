#!/usr/bin/env bash
# GitHub's Ubuntu x64 archive does not serve ARM packages. Keep native archive
# stanzas restricted to amd64 and fetch ARM packages from Ubuntu ports.
set -euo pipefail
source /etc/os-release
: "${VERSION_CODENAME:?Ubuntu codename is required}"

dpkg --add-architecture arm64
dpkg --add-architecture armhf

python3 - <<'PY'
from pathlib import Path
import re

# Ubuntu runners use deb822 .sources files. Put the architecture field inside
# every stanza; appending text after an incomplete stanza makes apt reject the
# whole file as "Malformed stanza".
for path in Path('/etc/apt/sources.list.d').glob('*.sources'):
    blocks = []
    for block in path.read_text().split('\n\n'):
        if not block.strip():
            continue
        lines = [line for line in block.splitlines() if not line.startswith('Architectures:')]
        insert_at = next((i + 1 for i, line in enumerate(lines) if line.startswith('Types:')), 0)
        lines.insert(insert_at, 'Architectures: amd64')
        blocks.append('\n'.join(lines))
    path.write_text('\n\n'.join(blocks) + '\n')

# Also cover older one-line .list sources without touching deb822 files.
for path in [Path('/etc/apt/sources.list'), *Path('/etc/apt/sources.list.d').glob('*.list')]:
    if not path.exists():
        continue
    lines = []
    for line in path.read_text().splitlines():
        if re.match(r'^\s*deb(?:-src)?\s+', line) and '[arch=' not in line:
            line = re.sub(r'^(\s*deb(?:-src)?\s+)', r'\1[arch=amd64] ', line)
        lines.append(line)
    path.write_text('\n'.join(lines) + '\n')
PY
cat > /etc/apt/sources.list.d/lx-arm-ports.sources <<EOF
Types: deb
URIs: http://ports.ubuntu.com/ubuntu-ports
Suites: ${VERSION_CODENAME} ${VERSION_CODENAME}-updates ${VERSION_CODENAME}-security
Components: main universe restricted multiverse
Architectures: arm64 armhf
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
