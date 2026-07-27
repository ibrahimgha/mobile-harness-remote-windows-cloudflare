import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { messageHtmlSchema } from "../src/messageHtml.js";

const html = renderToStaticMarkup(
  <ReactMarkdown rehypePlugins={[rehypeRaw, [rehypeSanitize, messageHtmlSchema]]}>
    {'<div dir="rtl"><h3>شرح <bdi dir="ltr">REV-001 / DOC-0243</bdi></h3><p><strong>المؤكد:</strong> EGP 39,000</p><script>alert(1)</script><img src="x" onerror="alert(2)"></div>'}
  </ReactMarkdown>
);

assert.match(html, /<div dir="rtl">/);
assert.match(html, /<bdi dir="ltr">REV-001 \/ DOC-0243<\/bdi>/);
assert.match(html, /<strong>المؤكد:<\/strong>/);
assert.doesNotMatch(html, /script|alert|onerror/i);

console.log("Sanitized basic HTML and mixed-direction message checks passed.");
