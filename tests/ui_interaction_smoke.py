#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('responsive_smoke', ROOT / 'tests' / 'responsive_smoke.py')
smoke = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(smoke)


def main():
    from playwright.sync_api import sync_playwright
    html = smoke.rendered_html()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        try:
            page = browser.new_page(viewport={'width': 393, 'height': 852})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.set_content(html, wait_until='load')
            page.wait_for_function("() => document.querySelector('#authScreen').hidden === true && document.querySelector('#pageWrap').dataset.route", timeout=5000)

            # Critical regression: compose from Home must render Daily and focus the editor
            # in the same user gesture so WKWebView can present the software keyboard.
            page.evaluate("() => render('home', false)")
            page.locator('[data-compose-journal="1"]').first.click()
            page.wait_for_timeout(50)
            state = page.evaluate("""() => ({
              route: document.querySelector('#pageWrap').dataset.route,
              active: document.activeElement?.id || '',
              keyboardClass: document.body.classList.contains('keyboard-open'),
              hasEditor: !!document.querySelector('#dailyBody')
            })""")
            assert state == {'route':'daily','active':'dailyBody','keyboardClass':True,'hasEditor':True}, state

            # Saving the daily entry must persist through LocalAPI and re-render without leaving Daily.
            page.fill('#dailyBody', 'Nội dung kiểm thử R4')
            page.click('[data-save-daily]')
            page.wait_for_function("() => app.data.dailyEntries.some(e => e.date === app.dailyDate && e.body === 'Nội dung kiểm thử R4')", timeout=5000)
            assert page.evaluate("() => document.querySelector('#pageWrap').dataset.route") == 'daily'

            # More sheet should close when routing to another destination.
            page.click('#mobileMenu')
            assert page.evaluate("() => !document.querySelector('#moreBackdrop').hidden")
            page.click('#moreBackdrop [data-route="settings"]')
            assert page.evaluate("() => document.querySelector('#moreBackdrop').hidden && document.querySelector('#pageWrap').dataset.route === 'settings'")

            # Quick-add remains functional after the shell redesign.
            before = page.evaluate("() => app.data.transactions.length")
            page.click('#mobileQuickAdd')
            page.fill('#quickAmount', '99000')
            page.select_option('#quickCategory', label='Ăn uống')
            page.select_option('#quickAccount', index=0)
            page.fill('#quickNote', 'UI smoke transaction')
            page.click('#quickSubmit')
            page.wait_for_function(f"() => app.data.transactions.length === {before + 1}", timeout=5000)
            assert page.evaluate("() => document.querySelector('#quickBackdrop').hidden")

            if errors:
                raise AssertionError(errors)
            print('UI_INTERACTION_SMOKE=PASS')
        finally:
            browser.close()

if __name__ == '__main__':
    main()
