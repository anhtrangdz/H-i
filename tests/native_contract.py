#!/usr/bin/env python3
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
app=(ROOT/'SoreRelax'/'Web'/'app.js').read_text()
local=(ROOT/'SoreRelax'/'Web'/'local-api.js').read_text()
native=(ROOT/'SoreRelax'/'NativeBridge.swift').read_text()
vc=(ROOT/'SoreRelax'/'ViewController.swift').read_text()
checks={
  'route_guard': "r && r!==pageWrap" in app,
  'journal_create_api': "'/api/journal'" in local,
  'journal_id_api': "p.startsWith('/api/journal/')" in local,
  'native_picker_js': "NativeBridge.call('pickPhotos'" in local,
  'native_picker_bridge': 'method == "pickPhotos"' in native,
  'photosui_import': 'import PhotosUI' in vc,
  'phpicker_delegate': 'PHPickerViewControllerDelegate' in vc,
  'phpicker_present': 'presentPhotoPicker' in vc,
  'no_web_file_input': 'id="dailyPhotos"' not in app,
  'journal_new_flow': 'data-new-journal' in app and 'dailyComposerOpen=false' in app,
}
failed=[k for k,v in checks.items() if not v]
if failed:
  print('NATIVE_CONTRACT=FAIL',*failed,sep='\n - ');sys.exit(1)
print('NATIVE_CONTRACT=PASS')
