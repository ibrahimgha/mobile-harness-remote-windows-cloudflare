import assert from "node:assert/strict";
import { isSubagentSessionMeta } from "../server/codexSessions";

assert.equal(
  isSubagentSessionMeta({
    thread_source: "subagent",
    source: {
      subagent: {
        thread_spawn: {
          parent_thread_id: "parent-chat",
          depth: 1
        }
      }
    }
  }),
  true
);

assert.equal(isSubagentSessionMeta({ thread_source: "subagent", source: "exec" }), true);
assert.equal(isSubagentSessionMeta({ thread_source: "user", source: "vscode" }), false);
assert.equal(isSubagentSessionMeta({ thread_source: "user", source: "exec" }), false);
