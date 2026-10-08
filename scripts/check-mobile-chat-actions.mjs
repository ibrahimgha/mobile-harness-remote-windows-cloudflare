import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8") + readFileSync(new URL("../public/mobile-chat-actions.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../public/mobile-chat-actions.js", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<style>${css}</style><div id="root"><header class="chat-topbar"><button class="icon-button">Menu</button><div class="chat-title-copy"><p class="overline">ThinkCentre 11</p><h2>Dispatching - live chat</h2></div><div class="chat-topbar-actions">${["Rename", "Fork", "View", "Refresh"].map(label => `<button class="icon-button" aria-label="${label}" onclick="window.chosen=this.getAttribute('aria-label')">${label[0]}</button>`).join("")}</div></header><p id="outside">Chat messages</p></div>`);
  await page.addScriptTag({ content: js });
  const toggle = page.getByRole("button", { name: "Chat actions", exact: true });
  const action = page.getByRole("button", { name: "Rename", exact: true });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator(".chat-action-reveal").evaluateAll(buttons => buttons.every(b => b.inert && getComputedStyle(b).visibility === "hidden")), true);
  await toggle.click();
  await action.waitFor({ state: "visible" });
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  for (const label of ["Rename", "Fork", "View", "Refresh"]) {
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await page.getByRole("button", { name: label, exact: true }).click();
    assert.equal(await page.evaluate(() => window.chosen), label);
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  }
  await toggle.click();
  await page.locator("#outside").click();
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.click();
  await toggle.press("Escape");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await page.setViewportSize({ width: 1200, height: 844 });
  await toggle.waitFor({ state: "hidden" });
  await page.waitForFunction(() => [...document.querySelectorAll(".chat-action-reveal")].every(button => !button.inert));
  assert.equal(await page.locator(".chat-action-reveal").evaluateAll(buttons => buttons.every(b => !b.inert && getComputedStyle(b).visibility === "visible")), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await toggle.waitFor({ state: "visible" });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  console.log("PASS: four actions hidden initially, open/close, original handlers, outside tap, Escape, desktop and mobile resize.");
} finally { await browser.close(); }
