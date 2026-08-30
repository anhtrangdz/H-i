#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('responsive_smoke',ROOT/'tests'/'responsive_smoke.py')
smoke=importlib.util.module_from_spec(spec); assert spec and spec.loader; spec.loader.exec_module(smoke)
VIEWPORTS=[(320,568),(375,667),(390,844),(440,956),(667,375),(844,390),(956,440)]

def main():
    from playwright.sync_api import sync_playwright
    html=smoke.rendered_html(); failures=[]; checks=0
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        try:
            for w,h in VIEWPORTS:
                page=browser.new_page(viewport={'width':w,'height':h},color_scheme='dark')
                errors=[]; page.on('pageerror',lambda e,errors=errors: errors.append(str(e)))
                page.set_content(html,wait_until='load')
                page.wait_for_function("() => document.querySelector('#authScreen').hidden === true && document.querySelector('#pageWrap').dataset.route",timeout=5000)
                for route in smoke.ROUTES:
                    page.evaluate('r=>render(r,false)',route); page.wait_for_timeout(8)
                    m=page.evaluate("""() => ({w:innerWidth,doc:document.documentElement.scrollWidth,body:document.body.scrollWidth})""")
                    checks+=1
                    if m['doc']>m['w']+1 or m['body']>m['w']+1: failures.append(f'{w}x{h} {route}: overflow {m}')
                if errors: failures.append(f'{w}x{h}: JS errors {errors[:5]}')
                page.close()
        finally: browser.close()
    if failures:
        print('DARK_RESPONSIVE=FAIL'); [print(' -',x) for x in failures[:80]]; raise SystemExit(1)
    print(f'DARK_RESPONSIVE=PASS ({checks} renders)')
if __name__=='__main__': main()
