import assert from "node:assert/strict";
import {
  deleteTextBackward,
  insertTextAtSelection,
  sentenceCapitalizedInsertion,
  shouldCapitalizeAtSelection
} from "../src/composerEditing";

assert.deepEqual(insertTextAtSelection("abcdef", { start: 3, end: 3 }, " "), {
  text: "abc def",
  selection: { start: 4, end: 4 }
});

assert.deepEqual(insertTextAtSelection("abcdef", { start: 4, end: 2 }, "X"), {
  text: "abXef",
  selection: { start: 3, end: 3 }
});

assert.deepEqual(deleteTextBackward("abc def", { start: 4, end: 4 }), {
  text: "abcdef",
  selection: { start: 3, end: 3 }
});

assert.deepEqual(deleteTextBackward("abcdef", { start: 2, end: 4 }), {
  text: "abef",
  selection: { start: 2, end: 2 }
});

assert.deepEqual(deleteTextBackward("first\nsecond\nthird", { start: 3, end: 15 }), {
  text: "firird",
  selection: { start: 3, end: 3 }
});

assert.deepEqual(deleteTextBackward("a\u{1F642}b", { start: 3, end: 3 }), {
  text: "ab",
  selection: { start: 1, end: 1 }
});

assert.deepEqual(deleteTextBackward("abcdef", { start: 0, end: 0 }), {
  text: "abcdef",
  selection: { start: 0, end: 0 }
});

const withNewline = insertTextAtSelection("first", { start: 5, end: 5 }, "\n");
assert.deepEqual(insertTextAtSelection(withNewline.text, withNewline.selection, "second"), {
  text: "first\nsecond",
  selection: { start: 12, end: 12 }
});

assert.equal(sentenceCapitalizedInsertion("", { start: 0, end: 0 }, "a"), "A");
assert.equal(sentenceCapitalizedInsertion("Done.", { start: 5, end: 5 }, "a"), "A");
assert.equal(sentenceCapitalizedInsertion("Done.   ", { start: 8, end: 8 }, "a"), "A");
assert.equal(sentenceCapitalizedInsertion("Really? ", { start: 8, end: 8 }, "w"), "W");
assert.equal(sentenceCapitalizedInsertion("first\n", { start: 6, end: 6 }, "s"), "S");
assert.equal(sentenceCapitalizedInsertion("alpha", { start: 5, end: 5 }, "b"), "b");
assert.equal(sentenceCapitalizedInsertion("Done. ", { start: 6, end: 6 }, "."), ".");
assert.equal(shouldCapitalizeAtSelection("Done.  next", { start: 7, end: 11 }), true);

const longMultilinePrompt = Array.from({ length: 16 }, (_, index) => `line ${index + 1}`).join("\n");
assert.equal(longMultilinePrompt.split("\n").length, 16);
assert.deepEqual(
  insertTextAtSelection(longMultilinePrompt, { start: 7, end: 7 }, " inserted"),
  {
    text: `${longMultilinePrompt.slice(0, 7)} inserted${longMultilinePrompt.slice(7)}`,
    selection: { start: 16, end: 16 }
  }
);

let burst = { text: "", selection: { start: 0, end: 0 } };
for (let index = 0; index < 1000; index += 1) {
  burst = insertTextAtSelection(burst.text, burst.selection, index % 2 === 0 ? "q" : "p");
}
assert.equal(burst.text.length, 1000);
assert.equal(burst.text, "qp".repeat(500));
for (let index = 0; index < 500; index += 1) {
  burst = deleteTextBackward(burst.text, burst.selection);
}
assert.equal(burst.text, "qp".repeat(250));
assert.deepEqual(burst.selection, { start: 500, end: 500 });

console.log("Composer editing checks passed.");
