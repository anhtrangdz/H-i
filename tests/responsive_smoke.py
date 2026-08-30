#!/usr/bin/env python3
"""Optional browser-level responsive smoke test.
Uses Python Playwright + a local Chromium when available. It does not run in GitHub Actions;
CI keeps dependency-free QA, while this script is useful for local release validation.
"""
from __future__ import annotations
import contextlib
import json
import os
from pathlib import Path
import socket
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "SoreRelax" / "Web"

STATE = {
    "version": 5,
    "settings": {"displayName": "Prix", "currency": "VND", "privacy": False, "evening": False, "autoLockMinutes": 15, "createdAt": "2026-08-30T00:00:00Z"},
    "monthPlans": {"2026-08": {"total": 10_000_000, "updatedAt": "2026-08-30T00:00:00Z"}},
    "accounts": [
        {"id":"11111111-1111-4111-8111-111111111111","name":"Tiền mặt","institution":"Tiền mặt","openingBalance":2_000_000,"archived":False},
        {"id":"22222222-2222-4222-8222-222222222222","name":"Vietcombank","institution":"Vietcombank","openingBalance":8_000_000,"archived":False},
    ],
    "transactions": [
        {"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","type":"expense","amount":125000,"date":"2026-08-30","category":"Ăn uống","accountId":"11111111-1111-4111-8111-111111111111","toAccountId":None,"note":"Cà phê sáng","addToMonth":False,"createdAt":"2026-08-30T01:00:00Z","updatedAt":"2026-08-30T01:00:00Z"},
        {"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","type":"income","amount":500000,"date":"2026-08-29","category":"Làm thêm","accountId":"22222222-2222-4222-8222-222222222222","toAccountId":None,"note":"Freelance","addToMonth":True,"createdAt":"2026-08-29T01:00:00Z","updatedAt":"2026-08-29T01:00:00Z"},
    ],
    "budgets": [{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","month":"2026-08","category":"Ăn uống","limit":3000000,"createdAt":"2026-08-01T00:00:00Z"}],
    "dailyEntries": [{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","date":"2026-08-30","title":"Một ngày nhẹ nhàng","body":"Responsive smoke test content.","mood":"Bình yên","mediaIds":[],"tags":["test"],"createdAt":"2026-08-30T00:00:00Z","updatedAt":"2026-08-30T00:00:00Z"}],
    "privateEntries": [{"id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","title":"Ghi chú riêng","body":"Nội dung riêng.","createdAt":"2026-08-30T00:00:00Z","updatedAt":"2026-08-30T00:00:00Z"}],
    "goals": [{"id":"ffffffff-ffff-4fff-8fff-ffffffffffff","name":"Laptop","target":30000000,"current":12000000,"deadline":"2026-12-31","note":"","createdAt":"2026-08-01T00:00:00Z"}],
    "media": [],
}

VIEWPORTS = [
    (320,568), (350,700), (360,780), (375,812), (390,844), (393,852),
    (402,874), (420,912), (430,932), (440,956),
    (844,390), (874,402), (932,430), (956,440),
]
ROUTES = ["home","money","transactions","budgets","daily","private","calendar","goals","insights","settings"]

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

@contextlib.contextmanager
def server():
    old = os.getcwd()
    os.chdir(WEB)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    th = threading.Thread(target=httpd.serve_forever, daemon=True)
    th.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}/index.html"
    finally:
        httpd.shutdown(); th.join(timeout=3); os.chdir(old)

def init_script():
    state_json = json.dumps(STATE, ensure_ascii=False)
    template = r"""
    (() => {
      if (!crypto.randomUUID) { crypto.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r=Math.random()*16|0, v=c==='x'?r:(r&3|8); return v.toString(16); }); }
      let state = __STATE_JSON_STRING__;
      const native = {configured:true,unlocked:true,biometricAvailable:true,biometricEnabled:false};
      const respond = (id, result, error) => setTimeout(() => {
        if (window.NativeBridge && window.NativeBridge._receive) window.NativeBridge._receive({id,result,error});
      }, 0);
      Object.defineProperty(window, 'webkit', {value: {messageHandlers: {sorelax: {postMessage(msg) {
        try {
          let result = {ok:true};
          switch (msg.method) {
            case 'status': result = native; break;
            case 'loadState': result = {json: state}; break;
            case 'saveState': state = msg.params.json; result = {ok:true}; break;
            case 'lock': native.unlocked=false; result={ok:true}; break;
            case 'unlock': native.unlocked=true; result={ok:true}; break;
            case 'setBiometric': native.biometricEnabled=!!msg.params.enabled; result=native; break;
            case 'unlockBiometric': native.unlocked=true; result={ok:true}; break;
          }
          respond(msg.id, result, null);
        } catch (e) { respond(msg.id, null, String(e)); }
      }}}}, configurable:true});
    })();
    """
    return template.replace('__STATE_JSON_STRING__', json.dumps(state_json))

def rendered_html():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    css = (WEB / "styles.css").read_text(encoding="utf-8")
    bridge = (WEB / "native-bridge.js").read_text(encoding="utf-8")
    local_api = (WEB / "local-api.js").read_text(encoding="utf-8")
    app = (WEB / "app.js").read_text(encoding="utf-8")
    # Browser smoke test has to inline assets because this execution environment blocks
    # browser navigation, including localhost/file URLs. The native app still ships the
    # original CSP and external bundled files; this only exercises layout/JS in Chromium.
    import re
    html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>\s*', '', html)
    html = html.replace('<link rel="stylesheet" href="./styles.css">', f'<style>{css}</style>')
    prep = '<script>' + init_script() + '</script>'
    html = html.replace('<script src="./native-bridge.js" defer></script>', prep + '<script>' + bridge + '</script>')
    html = html.replace('<script src="./local-api.js" defer></script>', '<script>' + local_api + '</script>')
    html = html.replace('<script src="./app.js" defer></script>', '<script>' + app + '</script>')
    return html

def main():
    from playwright.sync_api import sync_playwright
    browser_path = os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium")
    failures = []
    checks = 0
    html = rendered_html()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=browser_path, args=["--no-sandbox"])
        try:
            for w,h in VIEWPORTS:
                page = browser.new_page(viewport={"width":w,"height":h}, device_scale_factor=1)
                errors=[]
                page.on("pageerror", lambda e, errors=errors: errors.append(str(e)))
                page.set_content(html, wait_until="load")
                page.wait_for_selector("#appShell:not([hidden])", timeout=5000)
                for route in ROUTES:
                    page.evaluate("r => render(r, false)", route)
                    page.wait_for_timeout(10)
                    m=page.evaluate("""() => ({
                      innerWidth: window.innerWidth,
                      docWidth: document.documentElement.scrollWidth,
                      bodyWidth: document.body.scrollWidth,
                      tiny: [...document.querySelectorAll('button:not([hidden])')]
                        .filter(el => { const s=getComputedStyle(el), r=el.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0 && (r.width<28 || r.height<28); })
                        .map(el => ({text:(el.textContent||'').trim().slice(0,40),w:Math.round(el.getBoundingClientRect().width),h:Math.round(el.getBoundingClientRect().height)})).slice(0,8)
                    })""")
                    checks += 1
                    if m["docWidth"] > m["innerWidth"] + 1 or m["bodyWidth"] > m["innerWidth"] + 1:
                        failures.append(f"{w}x{h} {route}: horizontal overflow doc={m['docWidth']} body={m['bodyWidth']} viewport={m['innerWidth']}")
                    if m["tiny"]:
                        failures.append(f"{w}x{h} {route}: tap target below 28pt: {m['tiny']}")
                if errors:
                    failures.append(f"{w}x{h}: JS errors: {errors[:5]}")
                page.close()
        finally:
            browser.close()
    if failures:
        print("RESPONSIVE_SMOKE=FAIL")
        for f in failures[:80]: print(" -", f)
        raise SystemExit(1)
    print(f"RESPONSIVE_SMOKE=PASS ({checks} route/viewport renders across {len(VIEWPORTS)} viewports)")

if __name__ == '__main__':
    main()
