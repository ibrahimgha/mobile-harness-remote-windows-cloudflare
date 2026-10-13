import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { messageBubbleContent } from "../src/messageAttachments.js";

const heading = "Attached files saved on the target laptop:";
const footer = "Use these local file paths when working on this request.";
const files = "1. screenshot (final).png (55.9 KB)\n   C:\\Users\\ibrah\\my project\\01-image.png\n2. تقرير.md (512 B)\n   /home/ubuntu/my project/تقرير.md";
const original = `Please check **both** files.\n\n${heading}\n${files}\n\n${footer}`;
const prompt = (text: string) => ({ role: "user", kind: "user_prompt", text });

assert.deepEqual(messageBubbleContent(prompt(original)), { text: "Please check **both** files.", attachmentCount: 2 });
assert.equal(prompt(original).text, original, "Display projection leaves the full runner prompt unchanged");
assert.deepEqual(messageBubbleContent(prompt(original.replaceAll("\n", "\r\n"))), { text: "Please check **both** files.", attachmentCount: 2 });
const single = `Please review the attached file(s).\n\n${heading}\n1. video.mov (18.6 MB)\n   \\\\laptop\\share\\video.mov\n\n${footer}`;
assert.deepEqual(messageBubbleContent(prompt(single)), { text: "Please review the attached file(s).", attachmentCount: 1 });
assert.equal(messageBubbleContent({ role: "user", text: single }).attachmentCount, 1, "Legacy user messages also collapse");
assert.deepEqual(messageBubbleContent(prompt(original + "\n\n")), { text: "Please check **both** files.", attachmentCount: 2 });
const earlierMention = `Explain the heading ${heading}\n\n${original}`;
assert.equal(messageBubbleContent(prompt(earlierMention)).text, `Explain the heading ${heading}\n\nPlease check **both** files.`);

for (const text of [
  "Plain typed prompt",
  "Review C:\\Projects\\report.md and [the PDF](/tmp/report.pdf).",
  `${original}\n\nAlso consider this instruction.`,
  `\`\`\`text\n${original}\n\`\`\``,
  original.replace(footer, ""),
  original.replace("2. تقرير", "3. تقرير"),
  original.replace("   /home/ubuntu/my project/تقرير.md", "   https://example.com/report.md"),
  original.replace("   C:\\Users\\ibrah\\my project\\01-image.png\n", ""),
  `${heading}\n\n${footer}`
]) {
  assert.deepEqual(messageBubbleContent(prompt(text)), { text, attachmentCount: 0 }, "Keep ordinary or incomplete content intact");
}
for (const role of ["assistant", "tool", "system"]) {
  assert.deepEqual(messageBubbleContent({ role, text: original }), { text: original, attachmentCount: 0 });
}
assert.deepEqual(messageBubbleContent({ ...prompt(original), kind: "voice_note" }), { text: original, attachmentCount: 0 });

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(app, /const bubbleContent = messageBubbleContent\(message\)/);
assert.match(app, /<FormattedMessage\s+text=\{bubbleContent\.text\}/);
assert.match(app, /className="bubble-attachments" role="img" aria-label=\{attachmentLabel\} title=\{attachmentLabel\}/);
assert.match(app, /<Paperclip size=\{14\} aria-hidden="true"/);
assert.match(app, /CopyButton className="bubble-copy-button" text=\{message\.text\}/, "Copy retains the full prompt");
assert.match(app, /const promptText = promptWithUploadedFiles\(/, "Uploads still send file details to the agent");
assert.match(app, /attachedVoiceNote \? <VoiceNotePlayer message=\{attachedVoiceNote\}/, "Voice playback stays in the same bubble");
console.log("Attachment bubble projection: Windows/Linux/UNC paths, history, counts, plain messages, full prompts, and voice playback passed.");
