"""Checks the app when accounts or billing are not configured, and when there is no server at all."""
import json, urllib.request
from playwright.sync_api import sync_playwright
def ready(page): page.wait_for_function("document.querySelector('#stats b') && !document.querySelector('#stats b').textContent.startsWith('–')",timeout=10000)
errs=[]
with sync_playwright() as pw:
    b=pw.chromium.launch()
    # accounts on, Stripe key missing
    c=b.new_context(); p=c.new_page(); p.on('pageerror',lambda e:errs.append(str(e)))
    p.goto('http://localhost:3001'); ready(p)
    assert p.inner_text('#acctBtn').strip()=='Sign in'
    p.click('.tab[data-view=plans]'); assert 'Create an account to subscribe' in p.inner_text('#view-plans')
    p.click('#acctBtn'); p.click('[data-act=dlgMode][data-m=signup]'); p.fill('#aEmail','x@example.com'); p.fill('#aPass','password123'); p.click('#dlgBody button[type=submit]')
    p.wait_for_function("document.querySelector('#acctBtn').textContent.trim()==='Account'",timeout=8000)
    p.click('.tab[data-view=plans]'); p.wait_for_timeout(300)
    assert 'Payments are not switched on yet' in p.inner_text('#view-plans'), p.inner_text('#view-plans'); print('PASS  accounts on, Stripe missing: sign-in works, subscribe button explains payments are off')
    # accounts missing
    p2=b.new_context().new_page(); p2.on('pageerror',lambda e:errs.append(str(e)))
    p2.goto('http://localhost:3002'); ready(p2)
    assert not p2.is_visible('#acctBtn'); p2.click('.tab[data-view=plans]'); assert 'Subscriptions open soon' in p2.inner_text('#view-plans')
    p2.click('.tab[data-view=atlas]'); p2.click('[data-act=clearExample]'); p2.fill('#countrySearch','Japan'); p2.keyboard.press('Enter'); p2.click('#sheet [data-act=mark][data-s=been]')
    p2.wait_for_function("localStorage.getItem('waymark.v1')&&localStorage.getItem('waymark.v1').includes('JPN')",timeout=5000)
    print('PASS  accounts not configured: no Sign in button, guest mode works, membership says "open soon"')
    # plain static hosting, no /api at all
    p3=b.new_context().new_page(); p3.on('pageerror',lambda e:errs.append(str(e)))
    p3.goto('http://localhost:3003/index.html'); ready(p3)
    assert not p3.is_visible('#acctBtn'); print('PASS  static hosting with no server functions: app still opens as a guest')
    b.close()
assert not errs, errs
print('MODES OK')
