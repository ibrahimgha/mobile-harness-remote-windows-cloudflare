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

if (!/const text = textOverride \?\? rawTextFromComposerEditor\(editor\);[\s\S]{0,100}pendingCustomKeyboardDraftRef\.current = \{ chatId, text \}/.test(source)) {
  failures.push("Custom-key mutations must stage their exact plain text for per-chat draft persistence.");
}

if (!/customKeyboardDraftSyncDelayMs = 240/.test(source)) {
  failures.push("Custom keyboard draft persistence must batch rapid taps into a 240ms idle window.");
}

if (!/customKeyboardEditRef[\s\S]*insertTextAtSelection\(current\.text, current\.selection, text\)/.test(source)) {
  failures.push("Rapid custom-key input must mutate one authoritative text-and-selection model.");
}

if (!/onTouchStart=\{\(event\) => pressOnTouchStart\(event, \(\) => pressText\(key\)\)\}/.test(source)) {
  failures.push("Character keys must commit from touchstart so overlapping iOS taps are not dropped.");
}

if (!/event\.pointerType === "touch"[\s\S]{0,100}return;/.test(source)) {
  failures.push("Touch Pointer Events must not duplicate characters already committed from touchstart.");
}

if (!/insertTextAtSelection[\s\S]*deleteTextBackward[\s\S]*composerSelectionRef/.test(source)) {
  failures.push("Custom keyboard editing must use explicit plain-text selection offsets.");
}

if (/document\.execCommand\(/.test(source)) {
  failures.push("Do not use deprecated execCommand editing; it causes unstable WebKit caret movement.");
}

if (/insertTextAtSelection\(currentText, selectionInsideComposer|deleteTextBackward\(currentText, selectionInsideComposer/.test(source)) {
  failures.push("Custom key presses must use the saved caret offsets instead of re-reading WebKit selection state.");
}

if (/addEventListener\("selectionchange"/.test(source)) {
  failures.push("Do not feed asynchronous WebKit selectionchange events back into the custom keyboard caret model.");
}

if (!/restoreCustomKeyboardComposerFocus[\s\S]{0,360}restoreComposerSelection\(/.test(source)) {
  failures.push("Recovering custom-keyboard focus must restore the saved range without rewriting the editor text.");
}

if (!/else if \(!customKeyboardOpen\) \{\s*rememberComposerSelection\(editor\)/.test(source)) {
  failures.push("Draft state updates must not re-read WebKit selection while the custom keyboard owns the caret.");
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

if (!/const pressOnAccessibleClick[\s\S]{0,420}event\.preventDefault\(\);[\s\S]{0,120}event\.detail !== 0/.test(source)) {
  failures.push("Every synthesized key click must prevent its button from stealing composer focus before pointer clicks are ignored.");
}

if (!/onFocusCapture[\s\S]{0,180}onRequestComposerFocus\(\)/.test(source)) {
  failures.push("If WebKit still focuses a custom key, the keyboard must immediately restore the stable composer focus.");
}

if (!/onPointerDown=\{\(\) => \{[\s\S]{0,180}setCustomKeyboardOpen\(true\)/.test(source)) {
  failures.push("Tapping an already-focused composer must reopen the custom keyboard after an explicit dismissal.");
}

if (!/armOutsideTap[\s\S]*cancelOutsideTapOnMove[\s\S]*finishOutsideTap/.test(source)) {
  failures.push("The custom keyboard must distinguish a completed outside tap from a scrolling pointer gesture.");
}

if (!/Math\.hypot[\s\S]{0,220}customKeyboardTapSlopPx/.test(source)) {
  failures.push("Outside keyboard dismissal must cancel after meaningful pointer movement.");
}

if (!/target\.closest\("\.scroll-bottom-control"\)/.test(source)) {
  failures.push("The scroll-to-bottom control must never dismiss the custom keyboard.");
}

if (/addEventListener\("pointerdown", closeOnOutsidePointer/.test(source)) {
  failures.push("Do not dismiss the custom keyboard on pointerdown; scrolling starts with the same event.");
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

if (!/\.custom-keyboard-row\s*\{[\s\S]{0,260}gap: 0/.test(styles)) {
  failures.push("Custom keyboard touch targets must be contiguous; CSS row gaps create dead tap zones on iOS.");
}

if (!/\.custom-keyboard\s*\{[\s\S]{0,360}touch-action: none/.test(styles)) {
  failures.push("The custom keyboard must opt out of browser touch gestures during rapid typing.");
}

if (!/\.custom-key::before\s*\{[\s\S]{0,360}inset: 0 3px/.test(styles)) {
  failures.push("Visible key spacing must be painted inside contiguous touch targets.");
}

if (!/\.custom-keyboard-row\.row-2\s*\{[\s\S]{0,80}padding-inline: 4\.5%/.test(styles)) {
  failures.push("The home row must retain the measured iOS horizontal offset.");
}

if (!/\.custom-key\.is-modifier\s*\{[\s\S]{0,160}flex-grow: 1\.2/.test(styles)) {
  failures.push("Shift and Backspace must retain the measured iOS width relative to letter keys.");
}

if (!/\.custom-key\.is-space-key\s*\{[\s\S]{0,100}flex-grow: 4\.8/.test(styles)) {
  failures.push("The Space key must retain its measured iOS row proportion.");
}

if (!/\.custom-key\.is-return-key\s*\{[\s\S]{0,80}flex-grow: 2\.7/.test(styles)) {
  failures.push("The Return key must retain its measured iOS row proportion.");
}

if (!/className="custom-keyboard-footer"[\s\S]{0,500}className="custom-keyboard-dismiss"/.test(source)) {
  failures.push("Keyboard dismissal must remain in the iOS-style bottom utility strip.");
}

if (!/className="custom-key-preview"/.test(source)) {
  failures.push("Letter keys must render the iOS-style press preview without React state.");
}

if (!/\.custom-key-preview\s*\{[\s\S]{0,220}bottom: 56px;[\s\S]{0,120}width: calc\(100% \+ 24px\)/.test(styles)) {
  failures.push("The key preview must preserve the compact iOS balloon geometry.");
}

if (!/\.custom-key-preview::after\s*\{[\s\S]{0,180}bottom: -16px;[\s\S]{0,100}height: 24px/.test(styles)) {
  failures.push("The key preview connector must remain short instead of forming a long neck.");
}

if (!/\.custom-key:active \.custom-key-preview[\s\S]{0,140}animation: iosKeyPreviewIn 80ms/.test(styles)) {
  failures.push("Letter previews must use the fast iOS-style keypress animation.");
}

if (!/@keyframes iosKeyPreviewIn/.test(styles)) {
  failures.push("The iOS key preview animation must remain defined.");
}

if (!/\.custom-key:active::before\s*\{[\s\S]{0,120}transform: scale\(0\.97\)/.test(styles)) {
  failures.push("Pressed-key animation must not shrink the real touch hitbox.");
}

const activeKeyBlock = styles.match(/\.custom-key:active\s*\{([^}]*)\}/)?.[1] ?? "";
if (/transform:\s*scale\(/.test(activeKeyBlock)) {
  failures.push("Never transform the custom key element itself; transforms alter rapid-touch hit testing.");
}

if (!/\.chat-workspace\.has-custom-keyboard \.composer\s*\{[\s\S]{0,100}width: 100%/.test(styles)) {
  failures.push("The mobile composer geometry must remain expanded while the custom keyboard is open, even if WebKit moves DOM focus.");
}

if (!/\.composer\s*\{[\s\S]{0,180}width: 70%;[\s\S]{0,420}transition: width 200ms/.test(styles)) {
  failures.push("The idle mobile composer must animate from 70% width over exactly 200ms.");
}

if (!/\.thinking-label\s*\{[\s\S]{0,520}-webkit-text-fill-color: transparent;[\s\S]{0,120}animation: thinking-shine 1\.5s linear infinite;/.test(styles)) {
  failures.push("The live Thinking label must keep its WebKit-safe text shimmer.");
}

if (
  !/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]{0,1400}\.thinking-label\s*\{[\s\S]{0,120}animation: thinking-shine 1\.5s linear infinite !important;[\s\S]{0,240}\.composer\s*\{[\s\S]{0,100}transition-duration: 200ms !important;/.test(
    styles
  )
) {
  failures.push("The requested composer and Thinking microinteractions must survive iOS WebKit reduced-motion overrides.");
}

if (!/customKeyboardMounted[\s\S]*customKeyboardExitDurationMs/.test(source)) {
  failures.push("The custom keyboard must remain mounted long enough to complete its close animation.");
}

if (!/custom-keyboard-slot \$\{customKeyboardOpen \? "is-open" : "is-closing"\}/.test(source)) {
  failures.push("The mounted custom keyboard must expose explicit opening and closing animation states.");
}

if (!/@keyframes customKeyboardIn[\s\S]*@keyframes customKeyboardOut/.test(styles)) {
  failures.push("The custom keyboard must preserve its iOS-style enter and exit slide animations.");
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
