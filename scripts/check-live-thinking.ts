import assert from "node:assert/strict";
import {
  liveThinkingDelayMaxMs,
  liveThinkingDelayMinMs,
  liveThinkingStatuses,
  nextLiveThinkingDelayMs,
  nextLiveThinkingStatus
} from "../src/liveThinking";

assert.equal(liveThinkingStatuses.length, 13, "Thinking should rotate with exactly 12 other statuses");
assert.equal(liveThinkingStatuses[0], "Thinking", "Every run should begin with Thinking");
assert.equal(new Set(liveThinkingStatuses).size, liveThinkingStatuses.length, "Live statuses must be unique");
assert.equal(nextLiveThinkingDelayMs(() => 0), liveThinkingDelayMinMs, "The shortest delay should be 6 seconds");
assert.equal(nextLiveThinkingDelayMs(() => 1), liveThinkingDelayMaxMs, "The longest delay should be 18 seconds");

for (const status of liveThinkingStatuses) {
  assert.notEqual(nextLiveThinkingStatus(status, () => 0), status, `The status should not immediately repeat ${status}`);
  assert.notEqual(nextLiveThinkingStatus(status, () => 1), status, `The status should not immediately repeat ${status}`);
}
