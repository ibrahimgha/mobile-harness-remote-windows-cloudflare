import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
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

if (!/customKeyboardDraftSyncDelayMs = 750/.test(source)) {
  failures.push("Custom keyboard draft persistence must leave a 750ms quiet window around rapid typing.");
}

if (!/customKeyboardEditRef[\s\S]*insertTextAtSelection\(current\.text, current\.selection, text\)/.test(source)) {
  failures.push("Rapid custom-key input must mutate one authoritative text-and-selection model.");
}

if (
  !/const commitComposerEditorState[\s\S]{0,900}pendingCustomKeyboardDraftRef\.current = null;[\s\S]{0,260}customKeyboardEditRef\.current = \{ chatId, text, selection \}/.test(
    source
  )
) {
  failures.push("Paste and native input must cancel stale draft timers and replace the authoritative editor model.");
}

if (!/onPaste=[\s\S]{0,900}commitComposerEditorState\(event\.currentTarget, selection\)/.test(source)) {
  failures.push("Pasted text must be adopted before the next custom-key mutation.");
}

if (!/const composerSnapshot = preserveComposerForTransientFocus\(\)[\s\S]{0,1800}restoreComposerAfterTransientFocus\(composerSnapshot, reopenKeyboard\)/.test(source)) {
  failures.push("Attachment picking must preserve and restore the live composer model and caret.");
}

if (!/addEventListener\("touchstart", handleTouchStart, \{ passive: false \}\)/.test(source)) {
  failures.push("The keyboard must track iOS contacts from one non-passive native touch listener.");
}

if (!/addEventListener\("touchend", handleTouchEnd, \{ passive: false \}\)/.test(source)) {
  failures.push("The keyboard must release tracked contacts from native touch events.");
}

if (!/handleTouchStart[\s\S]{0,3000}commitTouchAction\(tracked\.action, tracked\.value\)/.test(source)) {
  failures.push("Touch characters must commit in contact-start order before overlapping fingers release.");
}

if (/handleTouchEnd[\s\S]{0,500}commitTouchAction\(/.test(source)) {
  failures.push("Do not commit characters on touchend; release order transposes fast overlapping taps.");
}

if (!/Character order is the order fingers land, not the order they lift/.test(source)) {
  failures.push("The touch-order invariant needs an inline regression warning for future keyboard changes.");
}

if (!/const CustomKeyboard = memo\(function CustomKeyboard/.test(source)) {
  failures.push("App timers and polling must not rerender the custom keyboard.");
}

if (!/Touch\.target is fixed at contact start[\s\S]{0,300}touch\.target instanceof Element/.test(source)) {
  failures.push("Touch resolution must prefer the contact's stable target over a synchronous animated hit-test.");
}

if (
  !/scheduleCustomKeyboardDomSync[\s\S]{0,700}requestAnimationFrame/.test(source) ||
  !/customKeyboardEditRef\.current = \{ chatId, \.\.\.mutation \};[\s\S]{0,700}scheduleCustomKeyboardDomSync\(\)/.test(source)
) {
  failures.push("Rapid key contacts must update the model synchronously and batch DOM/caret work by animation frame.");
}

const insertHotPath = source.match(/const insertCustomKeyboardText = useCallback\(([\s\S]*?)const backspaceCustomKeyboardText/)?.[1] ?? "";
const backspaceHotPath = source.match(/const backspaceCustomKeyboardText = useCallback\(([\s\S]*?)const closeCustomKeyboard/)?.[1] ?? "";
if (/applyComposerMutation|restoreComposerSelection|setDraftForChat/.test(insertHotPath + backspaceHotPath)) {
  failures.push("The per-key hot path must not synchronously rewrite DOM, restore a Range, or rerender the app.");
}

if (
  !/patchComposerInsertion\(editor, current\.text, current\.selection, text, mutation\.text\)/.test(insertHotPath) ||
  !/patchComposerDeletion\(editor, current\.text, current\.selection, mutation\)/.test(backspaceHotPath)
) {
  failures.push("Visible text must patch only the exact inserted or deleted range during each key contact.");
}

if (/const hasContent = Boolean\(text\.trim\(\)\)/.test(source)) {
  failures.push("The per-key draft path must not scan a large pasted string with trim().");
}

if (/capturedAt: new Date\(\)\.toISOString\(\)/.test(source)) {
  failures.push("Real-device tracing must not allocate ISO timestamps in the touch hot path.");
}

if (!/onlyChild\.replaceData\([\s\S]{0,180}text\.slice\(prefixLength, newSuffixStart\)/.test(source)) {
  failures.push("Large pasted drafts must patch only their changed text segment instead of replacing the entire editor.");
}

if (!/app\.post\("\/api\/debug\/keyboard-events"[\s\S]{0,2200}action: "ios-keyboard-trace"/.test(serverSource)) {
  failures.push("Real-device keyboard traces must be accepted without broadcasting a state refresh.");
}

if (!/flushKeyboardTrace\("prompt-send"\)/.test(source)) {
  failures.push("Real-device keyboard traces must flush after typing, outside the touch hot path.");
}

if (!/const stale = activeTouches\.get\(touch\.identifier\)[\s\S]{0,500}activeTouches\.delete\(touch\.identifier\)/.test(source)) {
  failures.push("Reused iOS touch identifiers must replace stale contacts instead of dropping a key.");
}

if (!/onPointerDown=\{preserveComposerForTransientFocus\}/.test(source)) {
  failures.push("The attachment control must snapshot text and caret before the picker steals focus.");
}

if (!/activeCustomModel[\s\S]{0,900}custom keyboard model remains authoritative while focus temporarily/.test(source)) {
  failures.push("Draft rerenders must not replace the custom keyboard model during attachment focus transfer.");
}

if (
  !/document\.elementFromPoint\(touch\.clientX, touch\.clientY\)/.test(source) ||
  !/activeTouches\.set\(touch\.identifier, tracked\)/.test(source)
) {
  failures.push("Touch tracking must resolve physical coordinates and retain each independent touch identifier.");
}

if (/onTouchStart=\{\(event\) => pressOnTouchStart/.test(source)) {
  failures.push("Do not return character entry to per-button React touch handlers; overlapping contacts can be reordered.");
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

if (
  !/const adoptSelectionFromExplicitGesture[\s\S]{0,260}!customKeyboardSelectionAdoptionPendingRef\.current/.test(source) ||
  !/addEventListener\("selectionchange", adoptSelectionFromExplicitGesture\)/.test(source)
) {
  failures.push("WebKit selection changes must be adopted only behind an explicit composer-gesture gate.");
}

if (!/const adoptPendingBrowserComposerSelection[\s\S]{0,420}customKeyboardSelectionAdoptionPendingRef\.current = false/.test(source)) {
  failures.push("The first custom-key mutation must close the browser-selection gate before changing DOM.");
}

if (
  !/const insertCustomKeyboardText[\s\S]{0,500}adoptPendingBrowserComposerSelection\(editor\)[\s\S]{0,300}insertTextAtSelection/.test(source) ||
  !/const backspaceCustomKeyboardText[\s\S]{0,500}adoptPendingBrowserComposerSelection\(editor\)[\s\S]{0,300}deleteTextBackward/.test(source)
) {
  failures.push("Insertion and Backspace must adopt a newly tapped caret or selected range before mutating text.");
}

if (!/restoreCustomKeyboardComposerFocus[\s\S]{0,360}restoreComposerSelection\(/.test(source)) {
  failures.push("Recovering custom-keyboard focus must restore the saved range without rewriting the editor text.");
}

if (!/function scrollComposerCaretIntoView[\s\S]{0,500}normalized\.end === text\.length[\s\S]{0,180}editor\.scrollTop = editor\.scrollHeight/.test(source)) {
  failures.push("An overflowing prompt must follow a newly created line when the caret is at the end.");
}

if (!/browserSelection\.addRange\(range\);\s*scrollComposerCaretIntoView\(editor, text, normalized\)/.test(source)) {
  failures.push("Every restored custom-keyboard caret must be revealed inside an overflowing composer.");
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

if (!/onFocusCapture[\s\S]{0,220}dataset\.keyboardAction !== "close"[\s\S]{0,120}onRequestComposerFocus\(\)/.test(source)) {
  failures.push("Keyboard focus recovery must not refocus the composer after the dismiss control is pressed.");
}

if (!/onPointerDown=\{\(event\) => \{[\s\S]{0,420}setCustomKeyboardOpen\(true\)/.test(source)) {
  failures.push("Tapping an already-focused composer must reopen the custom keyboard after an explicit dismissal.");
}

if (!/closeCustomKeyboard[\s\S]{0,260}customKeyboardFocusOpenSuppressedRef\.current = true;[\s\S]{0,100}setCustomKeyboardOpen\(false\)/.test(source)) {
  failures.push("Explicit keyboard dismissal must suppress late composer focus events from reopening it.");
}

if (!/const closeCustomKeyboard[\s\S]{0,360}setCustomKeyboardOpen\(false\);[\s\S]{0,180}setComposerExpanded\(false\);[\s\S]{0,160}editor\?\.blur\(\)/.test(source)) {
  failures.push("Keyboard dismissal must collapse the prompt bar and hide its compact power slider.");
}

if (!/customKeyboardEnabled && !customKeyboardOpen \? false : composerShouldExpand\(editor\)/.test(source)) {
  failures.push("Draft synchronization must not re-expand a dismissed custom-keyboard composer.");
}

if (!/editor\.dataset\.customKeyboard === "true" \? false : composerShouldExpand\(editor\)/.test(source)) {
  failures.push("A restored custom-keyboard draft must initially mount in the compact idle composer state.");
}

if (!/onPointerDown=\{\(event\) => \{[\s\S]{0,180}customKeyboardFocusOpenSuppressedRef\.current = false;[\s\S]{0,180}setCustomKeyboardOpen\(true\)/.test(source)) {
  failures.push("A fresh composer tap must clear explicit keyboard-dismissal suppression.");
}

if (!/onPointerDown=\{\(event\) => \{[\s\S]{0,360}setComposerExpanded\(composerShouldExpand\(event\.currentTarget\)\);[\s\S]{0,100}setCustomKeyboardOpen\(true\)/.test(source)) {
  failures.push("Reopening the custom keyboard must restore the prompt bar's content-driven expanded state.");
}

if (!/onFocus=\{\(event\) => \{[\s\S]{0,260}!customKeyboardFocusOpenSuppressedRef\.current[\s\S]{0,100}setCustomKeyboardOpen\(true\)/.test(source)) {
  failures.push("Late composer focus must respect explicit custom-keyboard dismissal.");
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

if (!/data-keyboard-action="close"[\s\S]{0,520}onPointerDown=\{\(event\) => \{[\s\S]{0,300}phase: "close-pointer"[\s\S]{0,180}onClose\(\)/.test(source)) {
  failures.push("The keyboard dismiss button needs its own immediate Pointer Event handler instead of character-key filtering.");
}

if (!/data-keyboard-action="close"[\s\S]{0,850}onClick=\{\(event\) => \{\s*event\.preventDefault\(\);\s*onClose\(\);/.test(source)) {
  failures.push("The idempotent keyboard dismiss command must also accept synthesized click activation without filtering event detail.");
}

if (!/tracked\.action !== "close"[\s\S]{0,320}commitTouchAction\(tracked\.action, tracked\.value\)/.test(source)) {
  failures.push("Delegated touch handling must skip Close so the dedicated dismiss handler cannot fire twice.");
}

if (!/const openMobileMenu = useCallback\(\(\) => \{\s*closeCustomKeyboard\(\);\s*setMenuOpen\(true\);/.test(source)) {
  failures.push("Opening the mobile menu must synchronously flush and close the custom keyboard first.");
}

if (!/className="icon-button mobile-menu-button"[\s\S]{0,180}onClick=\{openMobileMenu\}/.test(source)) {
  failures.push("The mobile menu button must use the keyboard-aware menu opener.");
}

if (!/deltaX > 72[\s\S]{0,160}openMobileMenu\(\)/.test(source)) {
  failures.push("Edge-swipe menu opening must use the keyboard-aware menu opener.");
}

if (!/className="composer-power-model" title=\{`\$\{previewPowerSetting\.effortLabel\} reasoning`\}[\s\S]{0,100}\{previewPowerSetting\.effortLabel\}/.test(source)) {
  failures.push("The compact power slider must display its selected reasoning effort instead of repeating the model name.");
}

if (!/className="custom-key-preview"/.test(source)) {
  failures.push("Letter keys must render the iOS-style press preview without React state.");
}

if (!/\.custom-key-preview\s*\{[\s\S]{0,220}bottom: 56px;[\s\S]{0,120}width: calc\(100% \+ 24px\)/.test(styles)) {
  failures.push("The key preview must preserve the compact iOS balloon geometry.");
}

if (!/\.custom-key-preview\s*\{[\s\S]{0,520}pointer-events: none/.test(styles)) {
  failures.push("Key previews must stay transparent to touch hit-testing over neighboring rows.");
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

if (!/\.custom-key:active::before,\s*\.custom-key\.is-touch-active::before\s*\{[\s\S]{0,120}transform: scale\(0\.97\)/.test(styles)) {
  failures.push("Pressed-key animation must not shrink the real touch hitbox.");
}

const activeKeyBlock = styles.match(/\.custom-key:active\s*\{([^}]*)\}/)?.[1] ?? "";
if (/transform:\s*scale\(/.test(activeKeyBlock)) {
  failures.push("Never transform the custom key element itself; transforms alter rapid-touch hit testing.");
}

if (!/\.composer\.is-custom-keyboard-open\s*\{[\s\S]{0,100}width: 100%/.test(styles)) {
  failures.push("The mobile composer geometry must follow the keyboard's open state instead of stale WebKit focus.");
}

if (/\.chat-workspace\.has-custom-keyboard \.composer(?: \.composer-power-control)?\s*\{/.test(styles)) {
  failures.push("The composer and slider must not remain expanded merely because the closing keyboard is still mounted for animation.");
}

if (!/\.composer:not\(\.uses-custom-keyboard\)\.is-expanded \.composer-power-control,[\s\S]{0,100}\.composer\.is-custom-keyboard-open \.composer-power-control/.test(styles)) {
  failures.push("Multiline draft state must not keep the custom keyboard power slider visible after dismissal.");
}

if (!/\.composer\s*\{[\s\S]{0,180}width: 70%;[\s\S]{0,420}transition: width 200ms/.test(styles)) {
  failures.push("The idle mobile composer must animate from 70% width over exactly 200ms.");
}

if (!/\.composer-editor\s*\{\s*display: block;[\s\S]{0,360}caret-color: var\(--ink\)/.test(styles)) {
  failures.push("The contentEditable composer must keep an explicit visible caret color.");
}

if (!/@media \(max-width: 920px\)[\s\S]*\.composer-editor\s*\{[\s\S]{0,140}max-height: min\(40dvh, 320px\)/.test(styles)) {
  failures.push("The mobile prompt must grow well beyond six lines before it becomes internally scrollable.");
}

if (!/\.composer-editor::after\s*\{[\s\S]{0,220}content: "\\200B"/.test(styles)) {
  failures.push("A trailing custom-keyboard newline must render a visible final line without changing text offsets.");
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

if (!/aria-label="Cancel voice recording"/.test(source)) {
  failures.push("Voice recording must expose a clear cancel action in the composer.");
}

const cancelDictationBlock = source.match(/function cancelDictation\(\) \{[\s\S]*?\n  \}\n\n  async function startDictation/)?.[0] ?? "";
if (
  !/dictationSessionRef\.current \+= 1;[\s\S]*dictationRecognitionRef\.current\?\.abort\(\)[\s\S]*recorder\.stop\(\)/.test(
    cancelDictationBlock
  )
) {
  failures.push("Cancelling dictation must invalidate late callbacks before stopping browser media APIs.");
}

if (!/setDraftForChat\(composerSnapshot\.chatId, composerSnapshot\.text\)/.test(cancelDictationBlock)) {
  failures.push("Cancelling dictation must restore the exact per-chat draft snapshot.");
}

if (!/if \(dictationSessionRef\.current !== dictationSessionId\) \{\s*return;\s*\}[\s\S]*new Blob/.test(source)) {
  failures.push("The recorder stop handler must ignore cancelled dictation sessions before creating or sending audio.");
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
