import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const failures = [];

if (!/const customKeyboardEnabled = false/.test(source)) {
  failures.push("Main must keep the archived custom keyboard disabled.");
}

if (
  /function shouldUseCustomKeyboard/.test(source) ||
  /URLSearchParams\(window\.location\.search\)\.get\("customKeyboard"\)/.test(source)
) {
  failures.push("Main must not expose an override that can reactivate the archived custom keyboard.");
}

if (!/inputMode="text"/.test(source)) {
  failures.push("The composer must request the native device text keyboard.");
}

if (/inputMode=\{customKeyboardEnabled \? "none" : "text"\}/.test(source)) {
  failures.push("The composer must not suppress the native device keyboard.");
}

if (!/contentEditable=\{Boolean\(selectedChatId && !sending\)\}/.test(source)) {
  failures.push("The native composer must remain directly editable.");
}

if (!/autoCapitalize="sentences"/.test(source) || !/autoCorrect="on"/.test(source)) {
  failures.push("The native composer must retain device capitalization and autocorrect semantics.");
}

if (!/onInput=\{\(event\) => \{\s*commitComposerEditorState\(event\.currentTarget\);\s*\}\}/.test(source)) {
  failures.push("Native input must persist the active chat draft.");
}

if (!/onKeyDown=\{sendPromptFromKeyboard\}/.test(source)) {
  failures.push("The native composer must retain keyboard send handling.");
}

if (/id="custom-chat-keyboard"/.test(source)) {
  failures.push("Main must not render the archived custom keyboard.");
}

if (/data-custom-keyboard=|aria-controls=\{customKeyboardEnabled/.test(source)) {
  failures.push("The native editor must not expose archived keyboard wiring.");
}

if (!/\.composer:focus-within/.test(styles)) {
  failures.push("Native focus must expand the mobile composer.");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Native iOS composer checks passed.");
