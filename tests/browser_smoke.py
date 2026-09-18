"""Optional real-browser checks for the standalone build.

Requires Python + playwright and an installed Chromium. No network or HTTP server
is needed: the built HTML is loaded in memory. CHROME_BIN selects the browser;
set CHROME_NO_SANDBOX=1 only inside a trusted container that requires it.
"""
from pathlib import Path
import json
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test-results"
OUT.mkdir(exist_ok=True)
HTML = (ROOT / "dist/demo.html").read_text()
# Supply the same explicit test switch normally provided by ?test in a URL.
TEST_HTML = HTML.replace("location.search", json.dumps("?test"))
CHROME = os.environ.get("CHROME_BIN") or shutil.which("chromium") or shutil.which("google-chrome")
args = ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
if os.environ.get("CHROME_NO_SANDBOX") == "1":
    args.append("--no-sandbox")

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, headless=True, args=args)
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.set_content(TEST_HTML)
    page.wait_for_function("Boolean(window.__slimeLab)")
    assert not page.locator("#fatal").is_visible()
    page.evaluate("window.__slimeLab.reset(0)")
    state = page.evaluate("window.__slimeLab.advance(120)")
    assert state["contacts"] > 0 and abs(state["volumeRatio"] - 1) < 0.01
    page.wait_for_timeout(250)
    page.screenshot(path=str(OUT / "desktop.png"))

    # Actual DOM keyboard events, not just simulation injection.
    start_x = state["center"][0]
    page.evaluate("window.__slimeLab.resume()")
    page.locator("#scene").focus()
    page.keyboard.down("d")
    page.wait_for_timeout(900)
    page.keyboard.up("d")
    state = page.evaluate("window.__slimeLab.snapshot()")
    assert state["center"][0] > start_x + 1
    page.locator("#pause").click()
    before = page.evaluate("window.__slimeLab.snapshot().particles")
    page.wait_for_timeout(180)
    assert page.evaluate("window.__slimeLab.snapshot().particles") == before
    page.locator("#pause").click()
    page.locator("#stations button").nth(1).click()
    assert page.locator("#station-title").inner_text() == "Load. Release."
    assert page.locator("#scene").evaluate("e => e === document.activeElement")
    page.wait_for_timeout(700)
    page.keyboard.down("Space")
    page.wait_for_timeout(800)
    charged = page.evaluate("window.__slimeLab.snapshot()")
    assert charged["charge"] > 0.7
    page.keyboard.up("Space")
    page.wait_for_timeout(280)
    launched = page.evaluate("window.__slimeLab.snapshot()")
    assert launched["center"][1] > charged["center"][1] + 0.6

    page.evaluate("window.__slimeLab.reset(3)")
    page.evaluate("window.__slimeLab.advance(120)")
    page.evaluate("window.__slimeLab.advance(60,{relax:true})")
    state = page.evaluate("window.__slimeLab.advance(150,{relax:true,z:-1})")
    assert state["height"] < 1.0 and abs(state["volumeRatio"] - 1) < 0.03
    page.locator("#debug").check()
    page.wait_for_timeout(250)
    page.screenshot(path=str(OUT / "squeeze.png"))
    page.locator('[data-preset="spring"]').click()
    assert page.locator("#stiffness-value").inner_text() == "1.80×"

    for i in range(5):
        page.evaluate(f"window.__slimeLab.reset({i})")
        state = page.evaluate("window.__slimeLab.advance(100)")
        assert state["recoveries"] == 0
        assert not page.locator("#fatal").is_visible()
    page.set_viewport_size({"width": 390, "height": 844})
    page.evaluate("window.__slimeLab.reset(0)")
    page.evaluate("window.__slimeLab.advance(120)")
    page.wait_for_timeout(200)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=str(OUT / "mobile.png"))

    # Touch controls, cancellation, and non-test startup.
    touch = browser.new_page(viewport={"width": 390, "height": 844}, has_touch=True)
    touch.on("pageerror", lambda e: errors.append(str(e)))
    touch.set_content(TEST_HTML)
    touch.wait_for_function("Boolean(window.__slimeLab)")
    assert touch.locator(".touch-controls").is_visible()
    touch.locator('[data-key="KeyD"]').click()
    assert touch.locator(".touch-controls button.down").count() == 0
    normal = browser.new_page(viewport={"width": 1280, "height": 720})
    normal.on("pageerror", lambda e: errors.append(str(e)))
    normal.set_content(HTML)
    normal.wait_for_timeout(500)
    assert normal.evaluate("typeof window.__slimeLab") == "undefined"
    assert not normal.locator("#fatal").is_visible()
    assert not errors, errors
    report = {"result": "passed", "browser": browser.version, "errors": errors,
              "checks": ["WebGL rendering", "keyboard movement", "pause", "station buttons",
                         "keyboard charged jump", "squeeze", "debug view", "material presets",
                         "all station spawns", "390px layout", "touch controls", "normal startup"]}
    (OUT / "browser-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    browser.close()
