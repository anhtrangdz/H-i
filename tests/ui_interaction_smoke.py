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
            # User device first: iPhone SE 2022 logical viewport.
            page = browser.new_page(viewport={'width': 375, 'height': 667})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.set_content(html, wait_until='load')
            page.wait_for_function("() => document.querySelector('#authScreen').hidden === true && document.querySelector('#pageWrap').dataset.route", timeout=5000)

            # Home -> composer must open and focus immediately, so WKWebView can show keyboard.
            page.evaluate("() => render('home', false)")
            before = page.evaluate("() => app.data.dailyEntries.filter(e => e.date === app.dailyDate).length")
            page.locator('[data-compose-journal="1"]').first.click()
            state = page.evaluate("""() => ({
              route: document.querySelector('#pageWrap').dataset.route,
              active: document.activeElement?.id || '',
              composer: app.dailyComposerOpen,
              hasEditor: !!document.querySelector('#journalBody')
            })""")
            assert state == {'route':'daily','active':'journalBody','composer':True,'hasEditor':True}, state

            # Mood is real state, not only a CSS class.
            page.locator('[data-journal-mood="Vui"]').click()
            assert page.evaluate("() => app.dailyDraftMood") == 'Vui'
            assert page.locator('[data-journal-mood="Vui"]').evaluate("el => el.classList.contains('active')")

            # Native photo picker contract: stub returns one photo and composer receives it.
            page.locator('[data-pick-journal-photos]').first.click()
            page.wait_for_function("() => app.dailyMediaIds.includes('photo-smoke-1')", timeout=5000)
            assert page.evaluate("() => app.data.media.some(m => m.id === 'photo-smoke-1')")

            # Save creates a new entry and EXITS composer to the day's list.
            page.fill('#journalTitle', 'Bài kiểm thử')
            page.fill('#journalBody', 'Nội dung kiểm thử R5')
            page.click('[data-save-journal]')
            page.wait_for_function(f"() => app.data.dailyEntries.filter(e => e.date === app.dailyDate).length === {before + 1}", timeout=5000)
            saved = page.evaluate("""() => ({
              composer: app.dailyComposerOpen,
              route: document.querySelector('#pageWrap').dataset.route,
              hasEditor: !!document.querySelector('#journalBody'),
              text: document.querySelector('.r5-journal-list')?.innerText || ''
            })""")
            assert saved['composer'] is False and saved['route'] == 'daily' and saved['hasEditor'] is False, saved
            assert 'Nội dung kiểm thử R5' in saved['text'], saved

            # Save -> Write new must be a blank composer, not the previously saved entry.
            page.locator('[data-new-journal]').first.click()
            blank = page.evaluate("() => ({title:document.querySelector('#journalTitle').value, body:document.querySelector('#journalBody').value, mood:app.dailyDraftMood, media:app.dailyMediaIds.length})")
            assert blank == {'title':'','body':'','mood':'','media':0}, blank
            # Cancelling a draft after native photo selection must clean the unreferenced media metadata/file.
            media_before_cancel = page.evaluate("() => app.data.media.length")
            page.locator('[data-pick-journal-photos]').first.click()
            page.wait_for_function("() => app.dailyNewMediaIds.length === 1", timeout=5000)
            page.click('[data-cancel-journal]')
            page.wait_for_function(f"() => app.data.media.length === {media_before_cancel}", timeout=5000)
            assert page.evaluate("() => app.dailyMediaIds.length === 0 && app.dailyNewMediaIds.length === 0")

            # Existing entry opens in edit mode intentionally.
            page.locator('[data-edit-journal]').first.click()
            assert page.evaluate("() => !!app.dailyEditorId && app.dailyComposerOpen")
            page.click('[data-cancel-journal]')

            # More sheet routing remains functional.
            page.click('#mobileMenu')
            assert page.evaluate("() => !document.querySelector('#moreBackdrop').hidden")
            page.click('#moreBackdrop [data-route="settings"]')
            assert page.evaluate("() => document.querySelector('#moreBackdrop').hidden && document.querySelector('#pageWrap').dataset.route === 'settings'")

            # Password editor has three proper secure fields.
            page.click('[data-settings-section="security"]')
            page.click('[data-change-password]')
            assert page.locator('#pwCurrent').get_attribute('type') == 'password'
            assert page.locator('#pwNext').get_attribute('type') == 'password'
            assert page.locator('#pwConfirm').get_attribute('type') == 'password'
            page.click('[data-close="form"]')

            # Quick-add transaction still mutates data and closes cleanly.
            before_tx = page.evaluate("() => app.data.transactions.length")
            page.click('#mobileQuickAdd')
            page.fill('#quickAmount', '99000')
            page.select_option('#quickCategory', label='Ăn uống')
            page.select_option('#quickAccount', index=0)
            page.fill('#quickNote', 'UI smoke transaction')
            page.click('#quickSubmit')
            page.wait_for_function(f"() => app.data.transactions.length === {before_tx + 1}", timeout=5000)
            assert page.evaluate("() => document.querySelector('#quickBackdrop').hidden")

            if errors:
                raise AssertionError(errors)
            print('UI_INTERACTION_SMOKE=PASS')
        finally:
            browser.close()

if __name__ == '__main__':
    main()
