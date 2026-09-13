#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
apt-get update -qq
apt-get install -y -qq ca-certificates curl xz-utils nginx python3-venv build-essential
python3 - <<'PY'
import urllib.request,json,hashlib,tarfile,pathlib,os
items=json.load(urllib.request.urlopen('https://nodejs.org/dist/index.json'))
version=next(x['version'] for x in items if x['version'].startswith('v22.') and x['lts'])
name=f'node-{version}-linux-x64.tar.xz'
base=f'https://nodejs.org/dist/{version}/'
checks=urllib.request.urlopen(base+'SHASUMS256.txt').read().decode()
expected=next(line.split()[0] for line in checks.splitlines() if line.split()[-1]==name)
data=urllib.request.urlopen(base+name).read()
assert hashlib.sha256(data).hexdigest()==expected
archive=pathlib.Path('/tmp')/name;archive.write_bytes(data)
with tarfile.open(archive) as t:t.extractall('/opt')
for tool in ['node','npm','npx']:
 target=pathlib.Path('/usr/local/bin')/tool
 if target.is_symlink():target.unlink()
 elif target.exists():raise RuntimeError('Existing Node installation needs review')
 target.symlink_to(f'/opt/node-{version}-linux-x64/bin/{tool}')
print('Installed verified Node',version)
PY
if ! id spendly >/dev/null 2>&1; then useradd --system --create-home --home-dir /opt/spendly --shell /usr/sbin/nologin spendly; fi
install -d -o spendly -g spendly -m 750 /opt/spendly/releases
install -d -o root -g spendly -m 750 /etc/spendly
install -d -m 755 /var/www/letsencrypt
python3 -m venv /opt/certbot
/opt/certbot/bin/pip install --quiet --upgrade certbot
ufw allow 80/tcp
ufw allow 443/tcp
node --version
/opt/certbot/bin/certbot --version
