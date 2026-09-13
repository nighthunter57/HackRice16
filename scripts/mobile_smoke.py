"""Optional Expo web smoke test using installed Python Playwright and Chrome.

Run against `npm run mobile:web` or an HTTP-served Expo web export.
Set MOBILE_PREVIEW_URL to override http://127.0.0.1:8081.
Analysis failures and recognition responses are mocked; explicit demo results use the real engine.
Checks pending-request input locks and scan match selection/reselection/manual entry.
Screenshots and the upload fixture are generated in /tmp.
"""
from auth_fixture import authenticated_fixture
from playwright.sync_api import sync_playwright, expect
import re
import os
import json
import base64
import io
from PIL import Image

base_url = os.environ.get('MOBILE_PREVIEW_URL', 'http://127.0.0.1:8081')
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=2)
    errors=[]
    analysis_requests=[]
    scan_uploads=[]
    def inspect_upload(request):
        if request.url.endswith('/api/extract') and request.method=='POST':
            body=request.post_data_json
            assert body['mimeType']=='image/jpeg'
            raw=base64.b64decode(body['imageBase64'],validate=True)
            photo=Image.open(io.BytesIO(raw));photo.load()
            assert photo.format=='JPEG' and max(photo.size)<=1600
            assert 0<len(raw)<=4*1024*1024
            scan_uploads.append((len(raw),photo.size))
    page.on('request',inspect_upload)
    authenticated_fixture(page)
    page.on('pageerror',lambda e: errors.append(str(e)))
    def fail_analysis(route):
        analysis_requests.append(route.request.method)
        route.fulfill(status=503, content_type='application/json', headers={'Access-Control-Allow-Origin':base_url,'Access-Control-Allow-Credentials':'true'}, body='{"error":"Unavailable"}')
    page.route('**/api/analyze', fail_analysis)
    page.goto(base_url,wait_until='networkidle')
    page.screenshot(path='/tmp/canibuyit-mobile-home.png')
    page.get_by_role('tab',name='History',exact=True).click()
    expect(page.get_by_text('Your next decision starts here.',exact=True)).to_be_visible()
    page.get_by_role('button',name='Check a purchase',exact=True).click()
    page.get_by_role('textbox',name='Price · USD',exact=True).fill('1.001')
    page.get_by_role('button',name='Check Purchase',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('two decimal places')
    page.get_by_role('textbox',name='Price · USD',exact=True).fill('449')
    pending=[]
    page.route('**/api/analyze', lambda route: pending.append(route))
    page.get_by_role('button',name='Check Purchase',exact=True).click()
    expect(page.get_by_role('textbox',name='Price · USD',exact=True)).not_to_be_editable()
    expect(page.get_by_role('textbox',name='Product',exact=True)).not_to_be_editable()
    expect(page.get_by_role('button',name='Try $100',exact=True)).to_be_disabled()
    expect(page.get_by_role('button',name='Checking…',exact=True)).to_be_disabled()
    page.wait_for_timeout(200)
    assert len(pending) == 1, 'Expected one purchase request'
    fail_analysis(pending[0])
    page.unroute('**/api/analyze')
    page.route('**/api/analyze', fail_analysis)
    expect(page.get_by_role('button',name='Use sample finances',exact=True)).to_be_visible()
    page.get_by_role('button',name='Use sample finances',exact=True).click()
    expect(page.get_by_text('Wait',exact=True)).to_be_visible()
    expect(page.get_by_text('September 17',exact=True)).to_be_visible()
    page.screenshot(path='/tmp/canibuyit-mobile-result.png')
    page.get_by_role('button',name='Save plan: wait for it',exact=True).click()
    expect(page.get_by_text('Saved to History: wait for it.',exact=True)).to_be_visible()
    page.get_by_role('button',name='Explore my FutureMe',exact=True).click()
    page.get_by_role('tab',name='Wait until safe',exact=True).click()
    page.screenshot(path='/tmp/canibuyit-mobile-future.png')
    page.get_by_role('button',name='Add unexpected expense',exact=True).click()
    expect(page.get_by_text(re.compile('New Safe Date: September 24'))).to_be_visible()
    page.get_by_role('button',name='Remove car repair',exact=True).click()
    expect(page.get_by_text(re.compile('New Safe Date: September 17'))).to_be_visible()
    page.go_back()
    page.get_by_role('button',name='Check something else',exact=True).click()
    page.get_by_role('tab',name='History',exact=True).click()
    expect(page.get_by_text(re.compile('Wait for it ·'))).to_be_visible()
    page.screenshot(path='/tmp/canibuyit-mobile-history.png')
    page.get_by_role('tab',name='Goals',exact=True).click()
    expect(page.get_by_role('progressbar').first).to_have_attribute('aria-valuenow','63')
    page.screenshot(path='/tmp/canibuyit-mobile-goals.png')
    page.get_by_role('tab',name='Home',exact=True).click()
    for price,label in [('50','Safe'),('999999','Not Safe Yet')]:
        page.get_by_role('textbox',name='Price · USD',exact=True).fill(price)
        page.get_by_role('button',name='Check Purchase',exact=True).click()
        page.get_by_role('button',name='Use sample finances',exact=True).click()
        expect(page.get_by_text(label,exact=True)).to_be_visible()
        page.get_by_role('button',name='Check something else',exact=True).click()
    page.get_by_role('button',name='Scan Something',exact=True).click()
    expect(page.get_by_role('button',name='Take Photo',exact=True)).to_be_visible()
    page.screenshot(path='/tmp/canibuyit-mobile-scan.png')
    page.route('**/api/extract',lambda route: route.fulfill(status=503,content_type='application/json',headers={'Access-Control-Allow-Origin':base_url,'Access-Control-Allow-Credentials':'true'},body='{"error":"Unavailable"}'))
    with page.expect_file_chooser() as chooser:
        page.get_by_role('button',name='Choose From Library',exact=True).click()
    chooser.value.set_files('/tmp/canibuyit-mobile-home.png')
    expect(page.get_by_role('alert')).to_contain_text('Recognition is unavailable')
    request_count = len(analysis_requests)
    page.get_by_role('button',name='Try scanning again',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('Recognition is unavailable')
    candidate = {'productName':'Test headphones','brand':None,'category':'Electronics',
                 'confidence':0.9,'searchQuery':'headphones','evidence':'visual',
                 'imageUrl':None,'priceCents':24900,'priceRange':None,'priceSource':'visible'}
    scan_result = {'status':'FULL_SUCCESS','state':'VISUAL_CANDIDATES',
                   'productFamily':'Headphones','candidates':[candidate],'warnings':[]}
    page.unroute('**/api/extract')
    page.route('**/api/extract', lambda route: route.fulfill(status=200,content_type='application/json',
               headers={'Access-Control-Allow-Origin':base_url,'Access-Control-Allow-Credentials':'true'},body=json.dumps(scan_result)))
    page.get_by_role('button',name='Try scanning again',exact=True).click()
    expect(page.get_by_text('Found it',exact=True)).to_be_visible()
    assert len(scan_uploads)==3, 'Expected one upload for each explicit scan/retry'
    assert len(analysis_requests)==request_count, 'Recognition triggered financial analysis'
    page.screenshot(path='/tmp/canibuyit-recognition-found.png')
    page.get_by_role('button',name='Select',exact=True).click()
    expect(page.get_by_role('textbox',name='Product',exact=True)).to_have_value('Test headphones')
    expect(page.get_by_role('textbox',name='Price · USD',exact=True)).to_have_value('249.00')
    page.get_by_role('button',name='Choose another match',exact=True).click()
    page.get_by_role('button',name='None of these',exact=True).click()
    expect(page.get_by_role('textbox',name='Product',exact=True)).to_have_value('')
    page.get_by_role('textbox',name='Product',exact=True).fill('Manual fallback item')
    page.get_by_role('textbox',name='Price · USD',exact=True).fill('20')
    page.get_by_role('button',name='Check Purchase',exact=True).click()
    page.get_by_role('button',name='Use sample finances',exact=True).click()
    expect(page.get_by_text('Safe',exact=True)).to_be_visible()
    page.get_by_role('button',name='Check something else',exact=True).click()
    page.goto(base_url,wait_until='networkidle')
    page.get_by_role('tab',name='History',exact=True).click()
    expect(page.get_by_role('button',name='Open Manual fallback item, $20',exact=True)).to_be_visible()
    page.get_by_role('button',name='Open Manual fallback item, $20',exact=True).click()
    page.get_by_role('button',name='Explore my FutureMe',exact=True).click()
    expect(page.get_by_role('button',name='Previous day',exact=True)).to_be_disabled()
    page.get_by_role('button',name='Next day',exact=True).click()
    expect(page.get_by_role('button',name='Previous day',exact=True)).to_be_enabled()
    page.get_by_role('button',name='Previous day',exact=True).click()
    expect(page.get_by_role('button',name='Previous day',exact=True)).to_be_disabled()
    request_count = len(analysis_requests)
    page.get_by_role('button',name='Add unexpected expense',exact=True).click()
    expect(page.get_by_role('button',name='Remove car repair',exact=True)).to_be_visible()
    assert len(analysis_requests) == request_count, 'Saved demo simulation contacted the backend'
    page.get_by_role('button',name='Remove car repair',exact=True).click()
    expect(page.get_by_role('button',name='Add unexpected expense',exact=True)).to_be_visible()
    # Exercise source-dependent UI with a saved snapshot fixture; this is not a live Nessie test.
    page.evaluate('''() => {
      const key = 'canibuyit.mobile.history.v1:00000000-0000-4000-8000-000000000001';
      const entries = JSON.parse(localStorage.getItem(key));
      entries[0].dataSource = 'nessie';
      localStorage.setItem(key, JSON.stringify(entries));
    }''')
    page.goto(base_url,wait_until='networkidle')
    page.get_by_role('tab',name='History',exact=True).click()
    expect(page.get_by_text('Saved forecast',exact=True)).to_be_visible()
    page.get_by_role('button',name='Open Manual fallback item, $20',exact=True).first.click()
    page.get_by_role('button',name='Explore my FutureMe',exact=True).click()
    expect(page.get_by_role('button',name='Add unexpected expense',exact=True)).to_have_count(0)
    for width in [320,390,768]:
        page.set_viewport_size({'width':width,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}'
    print('Verified JPEG uploads (bytes, dimensions):',scan_uploads,flush=True)
    assert not errors, errors
    print('PASS: pending-request input locks, scan selection/reselection/rejection, empty history, invalid input, all verdicts, safe dates, repair reversal, saved decision, goals, scan failure/retry/manual fallback, history after reload, saved demo simulation, source labels, day navigation, 320/390/768 widths; no runtime errors.')
    browser.close()
