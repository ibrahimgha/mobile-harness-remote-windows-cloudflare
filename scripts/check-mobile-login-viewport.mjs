import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
// Production emits the compiled stylesheet after the public patch links.
const css = readFileSync(new URL("../public/mobile-login-viewport.css", import.meta.url), "utf8") + readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<style>${css} #root { position:fixed; height:var(--app-height); min-height:0; }</style><div id="root"><main class="auth-shell"><form class="auth-panel"><div class="auth-mark">Lock</div><h1>Codex Remote</h1><label for="control-token">Control token</label><div class="auth-row"><input id="control-token" type="password"><button type="button">Unlock</button></div><p class="auth-error">Example authentication error</p></form></main></div>`);
  for (const height of [844, 410, 320, 240, 844]) {
    await page.evaluate(height => document.documentElement.style.setProperty("--app-height", `${height}px`), height);
    await page.locator("#control-token").focus();
    await page.locator("#control-token").fill("example-pasted-token");
    await page.locator("#control-token").evaluate(input => input.scrollIntoView({ block: "nearest" }));
    const result = await page.evaluate(() => {
      const shell = document.querySelector(".auth-shell");
      const input = document.querySelector("#control-token");
      const a = shell.getBoundingClientRect(), b = input.getBoundingClientRect();
      return { top:b.top, bottom:b.bottom, visibleTop:a.top, visibleBottom:a.bottom, token:input.value, focused:document.activeElement === input, font:getComputedStyle(input).fontSize };
    });
    assert.ok(result.top >= result.visibleTop && result.bottom <= result.visibleBottom, `Input must remain inside ${height}px visible viewport`);
    assert.equal(result.token, "example-pasted-token");
    assert.equal(result.focused, true);
    assert.equal(result.font, "16px");
    console.log(`PASS: ${height}px visible login viewport; focused input visible and pasted value preserved`);
  }
} finally { await browser.close(); }
