import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const fix = readFileSync(new URL("../public/mobile-composer-layout.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const screenshotIndex=process.argv.indexOf("--screenshot");
const screenshot=screenshotIndex<0?null:process.argv[screenshotIndex+1];
const observer = ts.transpileModule(readFileSync(new URL("../src/composerOverlap.ts", import.meta.url), "utf8"), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
assert.match(html, /href="\/mobile-composer-layout\.css\?v=20261022"/);
for (const engine of process.argv.includes("--webkit") ? [webkit] : [chromium]) {
const browser = await engine.launch({ headless: true });
try {
  for (const [width,height] of [[390,844],[390,420],[320,568],[430,932],[844,390]]) {
    for (const lines of [1, 30]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const draft = Array.from({ length: lines }, (_, i) => `Unsent draft line ${i + 1}`).join("\n");
      const fixture = `<style>${styles}\n${fix}</style><main class="chat-workspace"><header class="chat-topbar">Chat</header><div class="chat-content"><div class="chat-thread">${Array.from({ length: 50 }, (_, i) => `<article class="chat-bubble is-assistant"><p>Chat message ${i + 1}: content should remain visible through the floating fade.</p></article>`).join("")}<p id="latest">Latest message</p></div></div><div class="composer ${lines>1?'is-expanded':''}"><div class="composer-field"><button>+</button><button>Mic</button><div class="composer-editor" contenteditable="true"></div><button>Send</button></div></div></main>`;
      await page.setContent(fixture);
      await page.addScriptTag({type:"module",content:`${observer}\nwindow.startOverlap=()=>installComposerOverlap(document.querySelector('.chat-workspace'),document.querySelector('.composer'),document.querySelector('.chat-content'));window.stopOverlap=window.startOverlap();`});
      await page.waitForFunction(()=>document.querySelector('.chat-workspace').hasAttribute('data-composer-overlap'));
      await page.locator(".composer-editor").fill(draft);
      await page.locator(".composer-editor").blur();
      await page.waitForTimeout(250);
      const result = await page.evaluate(() => {
        const chat = document.querySelector(".chat-content");
        chat.scrollTop = chat.scrollHeight;
        const composer = document.querySelector(".composer");
        const latest = document.querySelector("#latest");
        return { chatBottom: chat.getBoundingClientRect().bottom, composerTop: composer.getBoundingClientRect().top, latestBottom: latest.getBoundingClientRect().bottom, draft: document.querySelector(".composer-editor").innerText, scrollRemaining: chat.scrollHeight - chat.clientHeight - chat.scrollTop, gradient:getComputedStyle(composer,'::before').backgroundImage };
      });
      assert.ok(result.chatBottom > result.composerTop + 30, "Transcript must continue behind the floating fade");
      assert.ok(result.latestBottom <= result.composerTop - 8, "Latest message must clear the entire real composer at scroll bottom");
      assert.match(result.gradient,/linear-gradient/);
      assert.match(result.gradient,/rgba\(245, 246, 241, 0\)/,"Fade must start fully transparent");
      assert.ok(result.scrollRemaining <= 1, "Transcript must reach its true bottom");
      assert.equal(result.draft, draft, "Unsent multiline draft must survive chat scrolling");
      const hittable=await page.locator('.composer-field').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
      assert.ok(hittable,"Transparent fade must not intercept the editor or controls");
      if(screenshot&&width===390&&height===844&&lines===1){
        await page.locator('.chat-content').evaluate(el=>{el.scrollTop-=180;});
        await page.screenshot({path:screenshot});
      }
      // While reading history, growing the draft must not jump the transcript.
      const scrollBefore=await page.evaluate(()=>{const chat=document.querySelector('.chat-content');chat.scrollTop=chat.scrollHeight/2;return chat.scrollTop;});
      await page.evaluate(()=>{const extra=document.createElement('div');extra.id='attachment-fixture';extra.style.height='60px';document.querySelector('.composer').append(extra);});
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.chat-content').evaluate(el=>el.scrollTop),scrollBefore);
      const overlaps=await page.evaluate(()=>{const r=document.querySelector('.composer').getBoundingClientRect();return [...document.querySelectorAll('.chat-bubble')].some(el=>{const b=el.getBoundingClientRect();return b.bottom>r.top&&b.top<r.bottom;});});
      assert.ok(overlaps,"Real message content must pass underneath the transparent gradient");
      // At the bottom, new attachment/confirmation height must be reserved too.
      await page.evaluate(()=>{const chat=document.querySelector('.chat-content');chat.scrollTop=chat.scrollHeight;document.querySelector('#attachment-fixture').style.height='90px';});
      await page.waitForTimeout(100);
      assert.ok(await page.evaluate(()=>document.querySelector('#latest').getBoundingClientRect().bottom<=document.querySelector('.composer').getBoundingClientRect().top-8));
      assert.equal(await page.locator('.composer-editor').innerText(),draft);
      if(width===390&&height===844&&lines===30){
        await page.setViewportSize({width:1280,height:900});
        await page.waitForFunction(()=>!document.querySelector('.chat-workspace').hasAttribute('data-composer-overlap'));
        assert.equal(await page.locator('.chat-workspace').evaluate(el=>el.style.getPropertyValue('--mobile-composer-height')),'');
        await page.setViewportSize({width,height});
        await page.waitForFunction(()=>document.querySelector('.chat-workspace').hasAttribute('data-composer-overlap'));
      }
      await page.evaluate(()=>window.stopOverlap());
      assert.equal(await page.locator('.chat-workspace').getAttribute('data-composer-overlap'),null);
      assert.ok(await page.evaluate(()=>document.querySelector('.chat-content').getBoundingClientRect().bottom<=document.querySelector('.composer').getBoundingClientRect().top+1),"Cleanup restores non-overlap fallback");
      await page.evaluate(()=>{const original=window.ResizeObserver;window.ResizeObserver=undefined;window.startOverlap()();window.ResizeObserver=original;});
      assert.equal(await page.locator('.chat-workspace').getAttribute('data-composer-overlap'),null,'unsupported engines retain the safe reserved-space layout');
      console.log(`PASS ${engine.name()} ${width}x${height}, ${lines}-line draft: fade, true bottom, dynamic attachments, reading position and draft preserved`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
}
