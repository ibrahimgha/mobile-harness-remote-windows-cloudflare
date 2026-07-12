import assert from "node:assert/strict";

import {
  deleteTextBackward,
  insertTextAtSelection,
  normalizeTextSelection,
  type TextMutation,
  type TextSelection
} from "../src/composerEditing.js";

type ComposerSnapshot = TextMutation & { chatId: string };

class ComposerScenario {
  private activeTouches = new Set<number>();
  private pendingDraft: string | null = null;
  private nextTouchId = 1;
  private state: TextMutation = { text: "", selection: { start: 0, end: 0 } };

  get text() {
    return this.state.text;
  }

  setSelection(selection: TextSelection) {
    this.state.selection = normalizeTextSelection(this.state.text, selection);
  }

  touchStart(value: string) {
    const identifier = this.nextTouchId;
    this.nextTouchId += 1;
    assert.equal(this.activeTouches.has(identifier), false);
    this.activeTouches.add(identifier);
    this.state = insertTextAtSelection(this.state.text, this.state.selection, value);
    this.pendingDraft = this.state.text;
    return identifier;
  }

  touchEnd(identifier: number) {
    this.activeTouches.delete(identifier);
  }

  typeWithOverlappingTouches(text: string) {
    for (let index = 0; index < text.length; index += 2) {
      const first = this.touchStart(text[index]);
      const second = index + 1 < text.length ? this.touchStart(text[index + 1]) : null;

      // Deliberately lift the second finger first. Text must still follow landing order.
      if (second !== null) {
        this.touchEnd(second);
      }
      this.touchEnd(first);
    }
  }

  paste(text: string) {
    this.state = insertTextAtSelection(this.state.text, this.state.selection, text);
    // Native edits replace the authoritative model and cancel pre-paste debounce work.
    this.pendingDraft = null;
  }

  backspace() {
    this.state = deleteTextBackward(this.state.text, this.state.selection);
    this.pendingDraft = this.state.text;
  }

  snapshot(chatId = "scenario-chat"): ComposerSnapshot {
    this.pendingDraft = null;
    return { chatId, text: this.state.text, selection: { ...this.state.selection } };
  }

  restore(snapshot: ComposerSnapshot) {
    this.state = {
      text: snapshot.text,
      selection: normalizeTextSelection(snapshot.text, snapshot.selection)
    };
  }

  flushPendingDraft() {
    return this.pendingDraft;
  }
}

const phrase = "the quick brown fox jumps over the lazy dog";
const rapid = new ComposerScenario();
rapid.typeWithOverlappingTouches(phrase.repeat(5));
assert.equal(rapid.text, phrase.repeat(5), "reversed release order must not transpose or drop rapid keys");

const pasted = new ComposerScenario();
pasted.typeWithOverlappingTouches("before  after");
pasted.setSelection({ start: 7, end: 7 });
pasted.paste("pasted context\nwith a second line");
pasted.typeWithOverlappingTouches(" + continued");
assert.equal(
  pasted.text,
  "before pasted context\nwith a second line + continued after",
  "typing after paste must extend the pasted model instead of restoring a stale pre-paste draft"
);
assert.equal(pasted.flushPendingDraft(), pasted.text);

const attached = new ComposerScenario();
attached.typeWithOverlappingTouches("draft before attachment");
attached.setSelection({ start: 6, end: 6 });
const attachmentSnapshot = attached.snapshot();

// File selection and attachment-chip renders do not own or mutate composer text.
const selectedAttachments = ["requirements.pdf", "reference image.png"];
assert.equal(selectedAttachments.length, 2);
attached.restore(attachmentSnapshot);
attached.typeWithOverlappingTouches(" with files");
assert.equal(attached.text, "draft  with filesbefore attachment");

const pasteThenAttach = new ComposerScenario();
pasteThenAttach.paste("pasted requirements");
pasteThenAttach.typeWithOverlappingTouches(" plus notes");
const combinedSnapshot = pasteThenAttach.snapshot();
pasteThenAttach.restore(combinedSnapshot);
pasteThenAttach.typeWithOverlappingTouches(" after picker");
pasteThenAttach.backspace();
pasteThenAttach.typeWithOverlappingTouches("r");
assert.equal(pasteThenAttach.text, "pasted requirements plus notes after picker");

console.log("Composer interaction scenarios passed.");
