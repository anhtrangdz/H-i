#!/usr/bin/env python3
from pathlib import Path
import re, sys, json
root=Path(__file__).resolve().parents[1]
web=root/'SoreRelax'/'Web'
required=[
  web/'index.html',web/'styles.css',web/'r4.css',web/'r5.css',web/'app.js',web/'native-bridge.js',web/'local-api.js',
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

# R4 ships real high-resolution bundled visual assets used by the interface.
r4_assets=web/'assets'/'r4'
required_r4=['home-ambient.jpg','finance-ambient.jpg','journal-ambient.jpg','calendar-ambient.jpg','goals-ambient.jpg','insights-ambient.jpg','settings-ambient.jpg','auth-ambient.jpg','welcome.jpg','journal-cover.jpg','goal-cover.jpg','vault-cover.jpg']
for name in required_r4:
    if not (r4_assets/name).exists():
        print('MISSING_R4_ASSET',name);sys.exit(1)
if sum((r4_assets/name).stat().st_size for name in required_r4) < 5_000_000:
    print('R4_ASSET_BUNDLE_TOO_SMALL');sys.exit(1)
r4_refs=(web/'r4.css').read_text()+'\n'+(web/'r5.css').read_text()+'\n'+(web/'index.html').read_text()+'\n'+(web/'app.js').read_text()
for name in required_r4:
    if name not in r4_refs:
        print('R4_ASSET_NOT_REFERENCED',name);sys.exit(1)

# R5 interaction guards: page container must never act as a navigation control,
# and photo selection must go through native PHPicker rather than WebKit file input.
appjs=(web/'app.js').read_text()
localjs=(web/'local-api.js').read_text()
vc=(root/'SoreRelax'/'ViewController.swift').read_text()
if "r && r!==pageWrap" not in appjs:
    print('R5_ROUTE_GUARD_MISSING');sys.exit(1)
if 'data-new-journal' not in appjs or "'/api/journal'" not in localjs:
    print('R5_JOURNAL_FLOW_MISSING');sys.exit(1)
if "NativeBridge.call('pickPhotos'" not in localjs or 'PHPickerViewController' not in vc:
    print('R5_NATIVE_PHOTO_PICKER_MISSING');sys.exit(1)
if 'dailyPhotos' in appjs:
    print('R5_LEGACY_WEB_PHOTO_PICKER_PRESENT');sys.exit(1)

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
    'test -f "$APP/Web/r5.css"',
    "grep -Fq 'Payload/SoreRelax.app/Web/index.html' ipa-contents.txt",
]:
    if needle not in workflow:
        print('MISSING_WEB_BUNDLE_GUARD',needle);sys.exit(1)

print('REPO_QA=PASS')
