import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/mobile-search-focus.css", import.meta.url), "utf8");

assert.match(html, /href="\/mobile-search-focus\.css\?v=20261008"/);
assert.match(css, /\.sidebar-search input\s*\{\s*font-size:\s*16px\s*!important;/);
assert.match(css, /\.sidebar-search,\s*\.sidebar-search input,\s*\.sidebar-search button\s*\{\s*touch-action:\s*manipulation;/);
assert.doesNotMatch(html, /user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:[,"\s])/i);
assert.doesNotMatch(css, /touch-action:\s*none/);
console.log("Sidebar focus zoom guards pass; pinch zoom remains available.");
