#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('responsive_smoke',ROOT/'tests'/'responsive_smoke.py')
smoke=importlib.util.module_from_spec(spec); assert spec and spec.loader; spec.loader.exec_module(smoke)


def modal_metrics(page):
    return page.evaluate("""() => {
      const el=[...document.querySelectorAll('.modal-sheet')].find(x=>!x.closest('[hidden]') && getComputedStyle(x).display!=='none');
      if(!el) return null;
      const r=el.getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight,scrollW:el.scrollWidth,clientW:el.clientWidth};
    }""")

def assert_modal(page, label):
    m=modal_metrics(page); assert m, f'{label}: modal missing'
    assert m['left'] >= -1 and m['right'] <= m['w']+1, (label,m)
    assert m['scrollW'] <= m['clientW']+1, (label,m)

def main():
  from playwright.sync_api import sync_playwright
  html=smoke.rendered_html()
  with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
      for viewport in ({'width':375,'height':667},{'width':390,'height':844}):
        page=browser.new_page(viewport=viewport)
        errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html,wait_until='load');page.wait_for_function("() => document.querySelector('#appShell').hidden===false")

        # Quick add: every mode must reveal the correct fields without page navigation.
        page.click('#mobileQuickAdd');assert_modal(page,'quick-expense')
        page.click('.quick-tab[data-type="income"]');assert not page.locator('.income-only').first.is_hidden();assert_modal(page,'quick-income')
        page.click('.quick-tab[data-type="transfer"]');assert not page.locator('.transfer-only').first.is_hidden();assert_modal(page,'quick-transfer')
        page.click('[data-close="quick"]')

        # Finance input sheet.
        page.evaluate("()=>render('money',false)");page.click('[data-set-month-total]');assert_modal(page,'month-plan');page.click('[data-close="form"]')
        page.click('[data-add-account]');assert page.locator('#accountName').count()==1;assert_modal(page,'account');page.click('[data-close="form"]')

        # Budget editor.
        page.evaluate("()=>render('budgets',false)");page.click('[data-add-budget]');assert page.locator('#budgetLimit').count()==1;assert_modal(page,'budget');page.click('[data-close="form"]')

        # Goal editor.
        page.evaluate("()=>render('goals',false)");page.click('[data-add-goal]');assert page.locator('#goalName').count()==1;assert_modal(page,'goal');page.click('[data-close="form"]')

        # Settings forms.
        page.evaluate("()=>render('settings',false)");page.click('[data-edit-profile]');assert_modal(page,'profile');page.click('[data-close="form"]')
        page.click('[data-settings-section="security"]');page.click('[data-auto-lock]');assert_modal(page,'autolock');page.click('[data-close="form"]')
        page.click('[data-change-password]');assert_modal(page,'password');page.click('[data-close="form"]')
        page.click('[data-settings-section="backup"]');page.click('[data-export-backup]');assert_modal(page,'backup-export');page.click('[data-close="form"]')
        page.click('[data-restore-backup]');assert_modal(page,'backup-restore');page.click('[data-close="form"]')

        if errors: raise AssertionError((viewport,errors))
        page.close()
      print('FORM_WORKFLOW_SMOKE=PASS')
    finally: browser.close()
if __name__=='__main__': main()
