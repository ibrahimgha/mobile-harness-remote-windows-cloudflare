import assert from "node:assert/strict";
import { applySidebarOrder, captureSidebarOrder } from "../src/sidebarOrder";

const openedProjects = [
  {
    projectPath: "C:\\projects\\alpha",
    label: "Alpha",
    chats: [
      { id: "alpha-1", title: "First" },
      { id: "alpha-2", title: "Second" }
    ]
  },
  {
    projectPath: "C:\\projects\\beta",
    label: "Beta",
    chats: [{ id: "beta-1", title: "Only" }]
  }
];

const snapshot = captureSidebarOrder(openedProjects);
const refreshedProjects = [
  {
    projectPath: "C:\\projects\\beta",
    label: "Beta updated",
    chats: [{ id: "beta-1", title: "Only updated" }]
  },
  {
    projectPath: "C:\\projects\\alpha",
    label: "Alpha updated",
    chats: [
      { id: "alpha-3", title: "New chat" },
      { id: "alpha-2", title: "Second updated" },
      { id: "alpha-1", title: "First updated" }
    ]
  },
  {
    projectPath: "C:\\projects\\gamma",
    label: "New project",
    chats: [{ id: "gamma-1", title: "New project chat" }]
  }
];

const orderedProjects = applySidebarOrder(refreshedProjects, snapshot);

assert.deepEqual(
  orderedProjects.map((project) => project.projectPath),
  ["C:\\projects\\alpha", "C:\\projects\\beta", "C:\\projects\\gamma"],
  "known projects keep their drawer-open order and new projects append"
);
assert.deepEqual(
  orderedProjects[0]?.chats.map((chat) => chat.id),
  ["alpha-1", "alpha-2", "alpha-3"],
  "known chats keep their drawer-open order and new chats append"
);
assert.equal(orderedProjects[0]?.label, "Alpha updated", "fresh project data remains visible while order is frozen");
assert.equal(orderedProjects[0]?.chats[0]?.title, "First updated", "fresh chat data remains visible while order is frozen");
