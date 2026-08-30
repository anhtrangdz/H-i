#!/usr/bin/env python3
from pathlib import Path
import re, sys, json
root=Path(__file__).resolve().parents[1]
web=root/'SoreRelax'/'Web'
required=[
  web/'index.html',web/'styles.css',web/'app.js',web/'native-bridge.js',web/'local-api.js',
  root/'SoreRelax'/'SecureVault.swift',root/'SoreRelax'/'NativeBridge.swift',root/'SoreRelax'/'ViewController.swift',
  root/'SoreRelax'/'Info.plist',root/'project.yml'
]
missing=[str(p.relative_to(root)) for p in required if not p.exists()]
if missing:
    print('MISSING:',*missing,sep='\n');sys.exit(1)
html=(web/'index.html').read_text()
for asset in re.findall(r'(?:src|href)="(\./[^"?#]+)"',html):
    p=(web/asset[2:]).resolve()
    if not p.exists():
        print('BROKEN_HTML_ASSET',asset);sys.exit(1)
for f in web.rglob('*'):
    if f.is_file() and f.stat().st_size==0:
        print('EMPTY_FILE',f.relative_to(root));sys.exit(1)
# Reject old online-server copy or plaintext credential patterns in shipped Web code.
joined='\n'.join((web/n).read_text() for n in ['index.html','app.js','local-api.js'])
for bad in ['npm start','127.0.0.1:4173','so_session=','SO_SECURE_COOKIE']:
    if bad in joined:
        print('LEGACY_SERVER_REFERENCE',bad);sys.exit(1)
if 'connect-src \'none\'' not in html:
    print('CSP_CONNECT_NOT_LOCKED');sys.exit(1)
# Validate icon catalog files.
cat=json.loads((root/'SoreRelax'/'Assets.xcassets'/'AppIcon.appiconset'/'Contents.json').read_text())
for item in cat['images']:
    if 'filename' in item and not (root/'SoreRelax'/'Assets.xcassets'/'AppIcon.appiconset'/item['filename']).exists():
        print('MISSING_ICON',item['filename']);sys.exit(1)

# CI packaging must force the Web directory into the final .app bundle because
# the runtime resolves resources from Bundle.main/Web.
workflow=(root/'.github'/'workflows'/'build-ipa.yml').read_text()
for needle in [
    '/usr/bin/ditto "$PWD/SoreRelax/Web" "$APP/Web"',
    'test -f "$APP/Web/index.html"',
    "grep -Fq 'Payload/SoreRelax.app/Web/index.html' ipa-contents.txt",
]:
    if needle not in workflow:
        print('MISSING_WEB_BUNDLE_GUARD',needle);sys.exit(1)

print('REPO_QA=PASS')
