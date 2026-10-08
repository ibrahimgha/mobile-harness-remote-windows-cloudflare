import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const fix = readFileSync(new URL("../public/mobile-composer-layout.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /href="\/mobile-composer-layout\.css\?v=20261008"/);
const browser = await chromium.launch({ headless: true });
try {
  for (const height of [844, 420]) {
    for (const lines of [1, 30]) {
      const page = await browser.newPage({ viewport: { width: 390, height } });
      const draft = Array.from({ length: lines }, (_, i) => `Unsent draft line ${i + 1}`).join("\n");
      const fixture = `<style>${styles}\n${fix}</style><main class="chat-workspace"><header class="chat-topbar">Chat</header><div class="chat-content"><div class="chat-thread">${Array.from({ length: 50 }, (_, i) => `<p>Chat message ${i + 1}</p>`).join("")}<p id="latest">Latest message</p></div></div><div class="composer is-expanded"><div class="composer-field"><button>+</button><button>Mic</button><div class="composer-editor" contenteditable="true"></div><button>Send</button></div></div></main>`;
      await page.setContent(fixture);
      await page.locator(".composer-editor").fill(draft);
      await page.locator(".composer-editor").blur();
      const result = await page.evaluate(() => {
        const chat = document.querySelector(".chat-content");
        chat.scrollTop = chat.scrollHeight;
        const composer = document.querySelector(".composer");
        const latest = document.querySelector("#latest");
        return { chatBottom: chat.getBoundingClientRect().bottom, composerTop: composer.getBoundingClientRect().top, latestBottom: latest.getBoundingClientRect().bottom, draft: document.querySelector(".composer-editor").innerText, scrollRemaining: chat.scrollHeight - chat.clientHeight - chat.scrollTop };
      });
      assert.ok(result.chatBottom <= result.composerTop + 1, "Composer must not overlap the transcript");
      assert.ok(result.latestBottom <= result.chatBottom + 1, "Latest message must be visible at scroll bottom");
      assert.ok(result.scrollRemaining <= 1, "Transcript must reach its true bottom");
      assert.equal(result.draft, draft, "Unsent multiline draft must survive chat scrolling");
      console.log(`PASS 390x${height}, ${lines}-line draft: latest message reachable, draft preserved`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
