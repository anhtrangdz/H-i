#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('responsive_smoke',ROOT/'tests'/'responsive_smoke.py')
smoke=importlib.util.module_from_spec(spec); assert spec and spec.loader; spec.loader.exec_module(smoke)
VIEWPORTS=[(320,568),(375,667),(390,844),(440,956),(667,375)]

def main():
  from playwright.sync_api import sync_playwright
  html=smoke.rendered_html(); failures=[]; checks=0
  with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
      for w,h in VIEWPORTS:
        for mode in ('login','setup'):
          page=browser.new_page(viewport={'width':w,'height':h})
          errors=[];page.on('pageerror',lambda e,errors=errors:errors.append(str(e)))
          page.set_content(html,wait_until='load');page.wait_for_function("()=>document.querySelector('#appShell').hidden===false")
          page.evaluate("""mode=>{
            const auth=document.querySelector('#authScreen'),app=document.querySelector('#appShell'),nav=document.querySelector('#mobileNav');
            auth.hidden=false;app.hidden=true;nav.hidden=true;
            document.querySelector('#loginForm').hidden=mode!=='login';
            document.querySelector('#setupForm').hidden=mode!=='setup';
          }""",mode)
          m=page.evaluate("""()=>({w:innerWidth,doc:document.documentElement.scrollWidth,fields:[...document.querySelectorAll('#authScreen input:not([hidden]),#authScreen button:not([hidden])')].filter(x=>{const r=x.getBoundingClientRect();return getComputedStyle(x).display!=='none'&&r.width>0&&r.height>0}).map(x=>{const r=x.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,r:r.right}})})""")
          checks+=1
          if m['doc']>m['w']+1: failures.append(f'{w}x{h} {mode}: overflow {m["doc"]}>{m["w"]}')
          for f in m['fields']:
            if f['l']<-1 or f['r']>m['w']+1 or f['h']<44: failures.append(f'{w}x{h} {mode}: bad field {f}')
          if errors: failures.append(f'{w}x{h} {mode}: JS {errors[:3]}')
          page.close()
    finally: browser.close()
  if failures:
    print('AUTH_RESPONSIVE=FAIL');[print(' -',x) for x in failures[:60]];raise SystemExit(1)
  print(f'AUTH_RESPONSIVE=PASS ({checks} renders)')
if __name__=='__main__':main()
