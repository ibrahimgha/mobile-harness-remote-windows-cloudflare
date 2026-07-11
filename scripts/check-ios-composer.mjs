import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const failures = [];

if (/<form\s+className=\{?`?composer/.test(source) || /<form\s+className=["']composer/.test(source)) {
  failures.push("The chat composer must not be a <form>; iOS Safari shows the form assistant bar for focused form controls.");
}

if (/<textarea(?=[^>]*className=["']composer-editor["'])/.test(source)) {
  failures.push("The chat composer must not use a native textarea; iOS Safari shows the form navigation accessory bar for it.");
}

if (!/contentEditable=/.test(source)) {
  failures.push("The chat composer should stay on the stable contentEditable surface used for caret-aware custom-keyboard editing.");
}

if (!/inputMode=\{customKeyboardEnabled \? "none" : "text"\}/.test(source)) {
  failures.push('The installed iOS PWA must use inputmode="none" while its custom keyboard is enabled.');
}

if (!/aria-label="On-screen keyboard"/.test(source)) {
  failures.push("The iOS custom keyboard must remain mounted through its accessible keyboard component.");
}

if (!/navigatorWithStandalone\.standalone === true/.test(source)) {
  failures.push("The custom keyboard must remain scoped to installed iOS PWA mode by default.");
}

if (!/setDraftForChat\(chatId, textFromComposerEditor\(editor\)\)/.test(source)) {
  failures.push("Custom-key mutations must immediately persist through the per-chat draft store.");
}

if (!/onPointerDown=\{startBackspaceRepeat\}/.test(source)) {
  failures.push("The custom keyboard must preserve press-and-hold Backspace behavior.");
}

if (!/onPointerDown=\{\(event\) => pressOnPointerDown\(event, \(\) => pressText\(key\)\)\}/.test(source)) {
  failures.push("Custom keyboard character keys must activate immediately on pointerdown so rapid iOS taps are not dropped.");
}

if (/onClick=\{\(\) => pressText\(key\)\}/.test(source)) {
  failures.push("Do not move custom character entry back to delayed synthesized click events.");
}

if (!/event\.detail !== 0[\s\S]{0,120}return/.test(source)) {
  failures.push("Pointer-generated clicks must be ignored after immediate key activation while detail=0 assistive clicks remain supported.");
}

if (!/closeOnOutsidePointer[\s\S]*data-custom-keyboard-root/.test(source)) {
  failures.push("The custom keyboard must dismiss from explicit outside-pointer handling, not editor blur.");
}

if (/onBlur=\{\(\) => \{[\s\S]{0,180}setCustomKeyboardOpen\(false\)/.test(source)) {
  failures.push("Do not close the custom keyboard from composer blur; iOS may blur it while pressing a key.");
}

if (!/\.chat-workspace\.has-custom-keyboard[\s\S]*grid-template-rows: auto auto auto auto minmax\(0, 1fr\) auto auto/.test(styles)) {
  failures.push("The custom keyboard must reserve its own mobile grid row instead of overlaying the composer.");
}

if (!/\.custom-keyboard-slot\s*\{[\s\S]{0,180}padding-top: 8px/.test(styles)) {
  failures.push("The custom keyboard slot must preserve a stable 8px gap below the composer.");
}

if (/className=["']file-input["']/.test(source)) {
  failures.push("Do not keep a hidden file input mounted inside the composer; create it only while opening the picker.");
}

if (/type=["']search["']/.test(source)) {
  failures.push('Avoid type="search" in the remote UI; it can trigger Safari search keyboard semantics.');
}

if (/role=["']search["']/.test(source)) {
  failures.push('Avoid role="search" in the remote UI; the composer must stay plain text.');
}

if (/\benterKeyHint=|\benterkeyhint=/.test(source)) {
  failures.push("Avoid enterkeyhint on the chat composer unless iOS keyboard behavior is re-tested.");
}

if (/window\.find\s*\(/.test(source)) {
  failures.push("window.find() must not be used; it can summon Safari find/navigation UI.");
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
