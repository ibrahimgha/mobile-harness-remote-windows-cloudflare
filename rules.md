# Project operating rules

- Always commit and push completed code changes to the repository. Before any deployment, verify that every source change included in the release is committed and that its commit was successfully pushed; record that commit SHA in release metadata. Never deploy uncommitted or unpushed fixes. If committing or pushing is blocked, hold the deployment and report the blocker.

- Never leave a Control Room instance in a testing or temporary state. Before any test, restart, reinstall, or migration that can affect persisted UI state, record the exact instance layout and every square's position, machine, project, chat, custom URL, view mode, display-off state, terminated state, and menu state. Restore that exact state after the operation and visually verify it before declaring the work complete.
- Never minimize, resize, or move the user's Control Room windows while controlling or testing them unless the user explicitly asks for that exact window operation.
