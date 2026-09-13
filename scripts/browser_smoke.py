"""Optional browser smoke test; requires existing Python Playwright + Chrome.

Run with the development server already listening on 127.0.0.1:3000.
Screenshots go to /tmp and do not modify the project.
"""
from playwright.sync_api import sync_playwright, expect


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1050})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:3000", wait_until="networkidle")
        expect(page.locator(".safe-date-row strong")).to_have_text("September 18")
        expect(page.locator(".scenario-card.today .minimum-value")).to_have_text("$41.00")
        page.get_by_role("button", name="Add expense & recalculate").click()
        expect(page.locator(".safe-date-row strong")).to_have_text("September 25")
        expect(page.locator(".causal-change")).to_contain_text("7 days")
        page.get_by_role("button", name="Remove expense & restore forecast").click()
        expect(page.locator(".safe-date-row strong")).to_have_text("September 18")
        page.get_by_label("Price ($)", exact=True).fill("50.00")
        page.get_by_role("button", name="See my financial future").click()
        expect(page.locator(".verdict-word")).to_have_text("Go ahead.")
        page.get_by_label("Price ($)", exact=True).fill("999999.00")
        page.get_by_role("button", name="See my financial future").click()
        expect(page.locator(".safe-date-row strong")).to_contain_text("No safe date")
        page.get_by_label("Price ($)", exact=True).fill("449.00")
        page.get_by_role("button", name="See my financial future").click()
        expect(page.locator(".safe-date-row strong")).to_have_text("September 18")
        page.get_by_role("button", name="I’ll wait", exact=True).click()
        page.get_by_role("button", name="Decision history", exact=True).click()
        expect(page.get_by_role("dialog")).to_contain_text("Sony WH-1000XM6")
        page.get_by_role("button", name="Close history").click()
        page.get_by_role("button", name="Describe it", exact=True).click()
        page.get_by_label("Tell us what caught your eye").fill("Headphones for $449")
        page.get_by_role("button", name="Find my item").click()
        expect(page.locator(".message.error")).to_contain_text("manually")
        page.get_by_role("button", name="Dismiss error").click()
        page.screenshot(path="/tmp/canibuyit-desktop-final.png", full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.reload(wait_until="networkidle")
        expect(page.locator(".safe-date-row strong")).to_have_text("September 18")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile horizontal overflow"
        page.screenshot(path="/tmp/canibuyit-mobile-final.png", full_page=True)
        assert not errors, errors
        browser.close()
        print("PASS: analyze, safe purchase, no safe date, repair/restore, saved decision, Gemini fallback, mobile layout; no browser errors.")


if __name__ == "__main__":
    main()
