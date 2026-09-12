#!/usr/bin/env python3
"""Exercise the actual Linux Tauri/WebKit window using an isolated tauri-driver.

Start the driver with XDG_DATA_HOME=<repo>/output/native-smoke/data before running.
The script refuses to mutate a library outside output/native-smoke.
"""
import argparse
import base64
import json
import sqlite3
from pathlib import Path
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output' / 'native-smoke'
ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'


def make_pdf(path, title):
    streams = [f'BT /F1 26 Tf 60 720 Td ({title}) Tj 0 -45 Td /F1 16 Tf (Page {i} - Local library smoke test) Tj ET'.encode() for i in (1, 2)]
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    objects += [b'<< /Length ' + str(len(s)).encode() + b' >>\nstream\n' + s + b'\nendstream' for s in streams]
    content = b'%PDF-1.4\n'
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(content))
        content += f'{number} 0 obj\n'.encode() + obj + b'\nendobj\n'
    xref = len(content)
    content += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    content += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    content += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    path.write_bytes(content)


class Driver:
    def __init__(self, base, existing=None):
        self.base = base.rstrip('/')
        self.session = existing
        if not existing:
            result = self.request('POST', '/session', {'capabilities': {'alwaysMatch': {'tauri:options': {'application': str(ROOT / 'src-tauri/target/debug/folio')}}}})
            self.session = result['sessionId']

    def request(self, method, path, data=None):
        request = urllib.request.Request(self.base + path, data=None if data is None else json.dumps(data).encode(), headers={'Content-Type': 'application/json'}, method=method)
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                result = json.load(response).get('value')
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode()) from error
        if isinstance(result, dict) and result.get('error'):
            raise RuntimeError(str(result))
        return result

    def command(self, path, data=None, method='POST'):
        return self.request(method, f'/session/{self.session}{path}', data)

    def js(self, script, *args):
        return self.command('/execute/sync', {'script': script, 'args': list(args)})

    def invoke(self, command, **params):
        result = self.command('/execute/async', {'script': 'const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({ok:true,value})).catch(error=>done({ok:false,error:String(error)}));', 'args': [command, params]})
        assert result['ok'], result
        return result.get('value')

    def wait(self, predicate, timeout=15):
        start = time.monotonic()
        while time.monotonic() - start < timeout:
            if self.js('return ' + predicate):
                return
            time.sleep(0.1)
        raise AssertionError('Timed out: ' + predicate + '\n' + self.js('return document.body.innerText'))

    def find(self, selector):
        return self.command('/element', {'using': 'css selector', 'value': selector})[ELEMENT]

    def click(self, selector):
        # WebKitWebDriver pointer coordinates are offset under fractional Wayland scaling.
        # Dispatch the DOM click in the real native WebView; backend and rendering stay native.
        self.js('const element=document.querySelector(arguments[0]); if (!element) throw new Error(arguments[0]); element.focus(); element.click();', selector)

    def fill(self, selector, value):
        self.js('const element=document.querySelector(arguments[0]); element.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(element,arguments[1]); element.dispatchEvent(new Event("input",{bubbles:true}));', selector, value)

    def screenshot(self, name):
        (OUTPUT / name).write_bytes(base64.b64decode(self.command('/screenshot', method='GET')))

    def close(self):
        self.command('', method='DELETE')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--driver-url', default='http://127.0.0.1:4445')
    parser.add_argument('--existing-session')
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    driver = Driver(args.driver_url, args.existing_session)
    report = []
    try:
        driver.wait('document.body.innerText.includes("Yerel kütüphane")')
        assert driver.js('return location.origin') == 'tauri://localhost'
        root = Path(driver.invoke('get_library_path')).resolve()
        assert root.is_relative_to(OUTPUT), f'Refusing to modify a real library: {root}'
        driver.command('/window/rect', {'width': 1440, 'height': 960})
        report.append('Packaged native WebKit shell; isolated SQLite storage')
        title = 'Folio Smoke ' + uuid.uuid4().hex[:8]
        pdf = OUTPUT / (title + '.pdf')
        make_pdf(pdf, title)
        imported = driver.invoke('import_file', path=str(pdf), itemId=None, categoryIds=[])
        item_id = imported['itemId']
        duplicate = driver.invoke('import_file', path=str(pdf), itemId=None, categoryIds=[])
        assert duplicate['status'] == 'duplicate' and duplicate['itemId'] == item_id
        cat = driver.invoke('save_category', input={'name': title, 'parentId': None})
        driver.invoke('update_item', id=item_id, patch={'title': title, 'categoryIds': [cat], 'tagNames': ['metodoloji'], 'notes': 'Öğrenme Işık İstanbul', 'readingStatus': 'reading'})
        page = driver.invoke('query_library', query={'q': 'ogrenme isik istanbul', 'categoryIds': [cat]})
        assert page['total'] == 1
        report.append('Real IPC import, duplicate detection, taxonomy, Turkish FTS5')
        driver.command('/refresh', {})
        driver.wait('document.querySelectorAll(".resource-table tbody tr").length > 0')
        driver.click('.resource-text strong')
        driver.wait('!!document.querySelector("#tab-notes")')
        driver.click('#tab-notes')
        note = 'Kalıcı masaüstü notu: örneklem ve ışık.'
        driver.fill('[aria-label="Kişisel notlar"]', note)
        driver.wait('document.querySelector(".save-status")?.innerText.includes("kaydedildi")')
        assert driver.invoke('get_item', id=item_id)['notes'] == note
        report.append('WebKit UI autosave persisted to SQLite')
        driver.click('.open-primary')
        driver.wait('!!document.querySelector(".reader-stage canvas")?.width && !document.querySelector(".pdf-loading")', timeout=25)
        assert not driver.js('return !!document.querySelector(".reader-stage [role=alert]")')
        driver.screenshot('pdf-page-1.png')
        driver.click('[aria-label="Sonraki sayfa"]')
        driver.wait('document.querySelector("[aria-label=\\"Sayfa numarası\\"]")?.value === "2" && !document.querySelector(".pdf-loading")')
        assert driver.invoke('get_item', id=item_id)['attachments'][0]['lastPage'] == 2
        driver.click('[aria-label="Pencereyi kapat"]')
        driver.wait('!document.querySelector(".reader-dialog")')
        driver.screenshot('native-library.png')
        report.append('PDF.js rendered two native asset-protocol pages and saved position')
        destination = OUTPUT / (title + '.folio')
        driver.invoke('create_backup', destination=str(destination))
        assert destination.exists() and destination.stat().st_size > 0
        report.append('Native consistent ZIP/SQLite backup export')
        preview = driver.invoke('prepare_restore', source=str(destination))
        assert preview['itemCount'] >= 1 and preview['attachmentCount'] >= 1
        driver.invoke('cancel_restore', id=preview['id'])
        assert driver.invoke('get_item', id=item_id)['notes'] == note
        report.append('Native backup validation and cancel preserve active archive')
        driver.close()
        driver = Driver(args.driver_url)
        driver.wait('document.body.innerText.includes("Yerel kütüphane")')
        item = driver.invoke('get_item', id=item_id)
        assert item['notes'] == note and item['attachments'][0]['lastPage'] == 2
        report.append('Application restart retains notes, files and reading position')
        driver.command('/refresh', {})
        driver.wait('document.querySelectorAll(".resource-table tbody tr").length > 0')
        driver.click('.resource-text strong')
        driver.wait('!!document.querySelector("#tab-notes")')
        driver.click('#tab-notes')
        final_note = note + ' Kapatırken son karakter.'
        driver.fill('[aria-label="Kişisel notlar"]', final_note)
        # Exercise the native Quit event bridge immediately, before debounce expiry.
        driver.js('window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {event:"folio-close-requested", payload:null});')
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with sqlite3.connect(root / 'library.sqlite') as connection:
                saved = connection.execute('SELECT notes FROM items WHERE id=?', (item_id,)).fetchone()[0]
            if saved == final_note:
                break
            time.sleep(0.05)
        assert saved == final_note
        report.append('Native Quit event bridge persists final keystrokes before exiting')
        (OUTPUT / 'report.json').write_text(json.dumps({'passed': report, 'libraryPath': str(root)}, ensure_ascii=False, indent=2))
        print(json.dumps({'passed': report}, ensure_ascii=False, indent=2))
    finally:
        try:
            driver.close()
        except RuntimeError:
            pass  # A successful Quit request may already have closed the WebDriver session.


if __name__ == '__main__':
    main()
