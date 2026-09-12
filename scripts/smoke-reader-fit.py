#!/usr/bin/env python3
"""Check PDF reader geometry in the actual packaged Linux WebKit window.

Start a dedicated tauri-driver under dbus-run-session with XDG_DATA_HOME and
XDG_CACHE_HOME below output/reader-fit-smoke. A separate display is recommended.
This script refuses to import anything unless get_library_path is isolated.
"""

import argparse
import base64
import importlib.util
import json
from pathlib import Path
import time
import uuid


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "reader-fit-smoke"
SPEC = importlib.util.spec_from_file_location("desktop_smoke", ROOT / "scripts" / "smoke-desktop.py")
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)
ZOOM = '[aria-label="Yakınlaştırma ve sığdırma"]'


def make_mixed_pdf(path, title):
    """Two vector pages with known portrait and landscape sizes, no dependencies."""
    sizes = [(595, 842), (842, 595)]
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    ]
    for index, (width, height) in enumerate(sizes):
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
            f"/Resources << /Font << /F1 5 0 R >> >> /Contents {6 + index} 0 R >>".encode()
        )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for index, (width, height) in enumerate(sizes):
        stream = (
            f"0.2 0.35 0.2 RG 4 w 12 12 {width - 24} {height - 24} re S "
            f"BT /F1 22 Tf 40 {height - 60} Td ({title}) Tj "
            f"0 -35 Td /F1 14 Tf (Page {index + 1}: {width} x {height}) Tj ET"
        ).encode()
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    content = b"%PDF-1.4\n"
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(content))
        content += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(content)
    content += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    content += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    content += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(content)


def geometry(driver):
    return driver.js("""
        const stage = document.querySelector('.reader-stage');
        const canvas = stage?.querySelector('canvas');
        if (!stage || !canvas) return null;
        const css = getComputedStyle(stage);
        const bounds = canvas.getBoundingClientRect();
        return {
          width: bounds.width, height: bounds.height,
          availableWidth: stage.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
          availableHeight: stage.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom),
          scrollWidth: stage.scrollWidth, clientWidth: stage.clientWidth,
          scrollHeight: stage.scrollHeight, clientHeight: stage.clientHeight,
          scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop,
          page: document.querySelector('[aria-label="Sayfa numarası"]')?.value,
          mode: document.querySelector('[aria-label="Yakınlaştırma ve sığdırma"]')?.value,
          busy: !!document.querySelector('.pdf-loading') || canvas.classList.contains('canvas-loading'),
          error: document.querySelector('.reader-stage [role="alert"]')?.innerText || '',
        };
    """)


def wait_render(driver, page=None, mode=None, timeout=20):
    deadline = time.monotonic() + timeout
    previous = None
    stable = 0
    while time.monotonic() < deadline:
        value = geometry(driver)
        if value and value["error"]:
            raise AssertionError(value["error"])
        ready = value and not value["busy"] and value["width"] > 0
        ready = ready and (page is None or value["page"] == str(page))
        ready = ready and (mode is None or value["mode"] == str(mode))
        stable = stable + 1 if ready and value == previous else 0
        if stable >= 3:
            return value
        previous = value
        time.sleep(0.1)
    raise AssertionError(f"Reader did not settle: {previous}")


def select_zoom(driver, value):
    driver.js("""
        const select = document.querySelector(arguments[0]);
        if (!select || !Array.from(select.options).some(option => option.value === arguments[1])) {
          throw new Error('Missing zoom option: ' + arguments[1]);
        }
        select.value = arguments[1];
        select.dispatchEvent(new Event('change', {bubbles: true}));
    """, ZOOM, str(value))
    return wait_render(driver, mode=value)


def assert_fit(value, page_fit=False):
    base_width, base_height = (595, 842) if value["page"] == "1" else (842, 595)
    expected = value["availableWidth"] / base_width
    if page_fit:
        expected = min(expected, value["availableHeight"] / base_height)
    assert abs(value["width"] - base_width * expected) <= 2, value
    assert abs(value["height"] - base_height * expected) <= 2, value
    assert value["scrollWidth"] <= value["clientWidth"] + 2, value
    if page_fit:
        assert value["scrollHeight"] <= value["clientHeight"] + 2, value


def screenshot(driver, name):
    (OUTPUT / name).write_bytes(base64.b64decode(driver.command('/screenshot', method='GET')))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--driver-url', default='http://127.0.0.1:4451')
    parser.add_argument('--application', type=Path, default=ROOT / 'src-tauri/target/release/folio')
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    driver = SMOKE.Driver(args.driver_url, application=args.application)
    report = {"application": str(args.application.resolve()), "passed": [], "geometry": {}}
    try:
        driver.wait('document.body.innerText.includes("Yerel kütüphane")')
        assert driver.js('return location.origin') == 'tauri://localhost'
        library = Path(driver.invoke('get_library_path')).resolve()
        assert library.is_relative_to(OUTPUT), f'Refusing to modify a real library: {library}'
        report['libraryPath'] = str(library)
        driver.command('/window/rect', {'width': 1440, 'height': 960})
        title = 'Reader fit QA ' + uuid.uuid4().hex[:8]
        pdf = OUTPUT / (title + '.pdf')
        make_mixed_pdf(pdf, title)
        imported = driver.invoke('import_file', path=str(pdf), itemId=None, categoryIds=[])
        item_id = imported['itemId']
        driver.command('/refresh', {})
        driver.wait('document.querySelectorAll(".resource-table tbody tr").length > 0')
        driver.js("const row=Array.from(document.querySelectorAll('.resource-text strong')).find(e=>e.textContent===arguments[0]); if(!row) throw new Error('Imported item missing'); row.click();", title)
        driver.wait('!!document.querySelector(".open-primary")')
        driver.click('.open-primary')
        initial = wait_render(driver, page=1, mode='fit-page')
        assert_fit(initial, page_fit=True)
        report['passed'].append('Reader opens with the whole portrait page visible')
        value = select_zoom(driver, 'fit-width')
        assert_fit(value)
        report['geometry']['portraitWidth'] = value
        report['passed'].append('Portrait fit-width uses the entire available stage width')
        screenshot(driver, 'portrait-fit-width.png')

        fit_page = select_zoom(driver, 'fit-page')
        assert_fit(fit_page, page_fit=True)
        report['geometry']['portraitPage'] = fit_page
        report['passed'].append('Portrait fit-page fits both width and height without scrollbars')
        screenshot(driver, 'portrait-fit-page.png')

        driver.click('[aria-label="Yakınlaştır"]')
        zoomed_in = wait_render(driver)
        assert zoomed_in['width'] > fit_page['width'], (fit_page, zoomed_in)
        select_zoom(driver, 'fit-page')
        driver.click('[aria-label="Uzaklaştır"]')
        zoomed_out = wait_render(driver)
        assert zoomed_out['width'] < fit_page['width'], (fit_page, zoomed_out)
        report['passed'].append('Zoom plus/minus move in the right direction from the actual fit-page scale')

        wide = select_zoom(driver, 'fit-width')
        driver.click('.reader-actions [aria-pressed]')
        driver.wait('!!document.querySelector(".reader-notes textarea")')
        with_notes = wait_render(driver, mode='fit-width')
        assert_fit(with_notes)
        assert with_notes['width'] < wide['width'], (wide, with_notes)
        report['geometry']['portraitWithNotes'] = with_notes
        driver.click('.reader-actions [aria-pressed]')
        without_notes = wait_render(driver, mode='fit-width')
        assert_fit(without_notes)
        assert abs(without_notes['width'] - wide['width']) <= 2
        report['passed'].append('Opening and closing notes recomputes fit-width without stale size')

        driver.command('/window/rect', {'width': 1024, 'height': 760})
        smaller = wait_render(driver, mode='fit-width')
        assert_fit(smaller)
        assert smaller['width'] < wide['width'], (wide, smaller)
        smaller_page = select_zoom(driver, 'fit-page')
        assert_fit(smaller_page, page_fit=True)
        report['geometry']['smallWindowPage'] = smaller_page
        driver.command('/window/rect', {'width': 1440, 'height': 960})
        restored_page = wait_render(driver, mode='fit-page')
        assert_fit(restored_page, page_fit=True)
        assert restored_page['width'] > smaller_page['width'], (smaller_page, restored_page)
        report['passed'].append('Window resize recomputes fit-width and fit-page')

        driver.click('[aria-label="Sonraki sayfa"]')
        landscape_page = wait_render(driver, page=2, mode='fit-page')
        assert_fit(landscape_page, page_fit=True)
        report['geometry']['landscapePage'] = landscape_page
        screenshot(driver, 'landscape-fit-page.png')
        landscape_width = select_zoom(driver, 'fit-width')
        assert_fit(landscape_width)
        report['passed'].append('Page orientation changes recompute both fit modes correctly')

        driver.click('[aria-label="Önceki sayfa"]')
        wait_render(driver, page=1, mode='fit-width')
        driver.js("document.querySelector('.reader-stage').scrollTop=280")
        assert geometry(driver)['scrollTop'] > 0
        driver.click('[aria-label="Genişliğe sığdır"]')
        reset = wait_render(driver, page=1, mode='fit-width')
        assert reset['scrollTop'] == 0 and reset['scrollLeft'] == 0, reset
        report['passed'].append('Clicking the active fit-width button resets scroll position')

        for _ in range(3):
            for action in ['Yakınlaştır', 'Yakınlaştır', 'Sonraki sayfa', 'Uzaklaştır', 'Önceki sayfa']:
                driver.click(f'[aria-label="{action}"]')
        rapid = wait_render(driver, page=1)
        assert not rapid['error']
        select_zoom(driver, 'fit-page')
        report['passed'].append('Rapid zoom and page switches finish rendering without canvas errors')

        driver.click('.reader-actions [aria-pressed]')
        driver.wait('!!document.querySelector(".reader-notes textarea")')
        note = 'Okuyucu sığdırma kontrolü: ışık ve örneklem. ' + uuid.uuid4().hex[:8]
        driver.fill('.reader-notes textarea', note)
        driver.click('[aria-label="Pencereyi kapat"]')
        driver.wait('!document.querySelector(".reader-dialog")')
        assert driver.invoke('get_item', id=item_id)['notes'] == note
        report['passed'].append('Closing the reader immediately after typing persists the last note')
        driver.click('.open-primary')
        wait_render(driver, page=1, mode='fit-page')
        driver.click('.reader-actions [aria-pressed]')
        driver.wait('!!document.querySelector(".reader-notes textarea")')
        assert driver.js('return document.querySelector(".reader-notes textarea").value') == note
        assert_fit(wait_render(driver, mode='fit-page'), page_fit=True)
        report['passed'].append('Reopening the reader restores notes and starts in valid fit-page mode')
        screenshot(driver, 'reopened-notes.png')
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except Exception:
        try:
            screenshot(driver, 'failure.png')
            report['lastGeometry'] = geometry(driver)
            (OUTPUT / 'failure.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        except Exception:
            pass
        raise
    finally:
        try:
            driver.close()
        except RuntimeError:
            pass


if __name__ == '__main__':
    main()
