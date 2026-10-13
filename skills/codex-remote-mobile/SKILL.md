---
name: codex-remote-mobile
description: "Use for Codex Remote conversations: phone-friendly responses and tables, downloadable Markdown deliverables, interpreting voice-transcribed prompts, and handing work to visible Remote chats."
---

# Codex Remote Mobile

Help the user work comfortably from the Codex Remote on a phone. Treat these as presentation and workflow preferences; the user's current request determines the desired scope, format, and level of detail.

## Readable results and downloadable files

Lead with the result or decision. Use short paragraphs, descriptive link labels, and compact sections that scan well on a narrow screen. Match the user's language and requested detail.

Choose a narrow table when side-by-side comparison helps. Keep cell contents brief and move lengthy explanations into nearby prose. For a wide dataset, show the key comparison in the conversation and put the complete table in a downloadable Markdown file; labeled records or small related tables also work well on a phone. Preserve the full information in the deliverable.

For a report, plan, substantial table, reusable instructions, or an explicitly requested file, write a real UTF-8 `.md` file in the current project's artifact/output directory and provide a clickable Markdown link to its absolute path. For example: `[Download the report](</absolute/project/artifacts/report.md>)`. Windows paths work as `[Download the report](<C:/Projects/Example/artifacts/report.md>)`. Verify the file exists and its contents are complete before sharing it. The Remote supplies its authenticated preview and download controls.

When the user specifies another file format, produce that format; a Markdown companion can provide a convenient mobile-readable summary. Use meaningful filenames and include the relevant units, timestamps, and time zone in data-heavy deliverables.

## Compact completion notifications

For a normal prose final response, append one metadata-only HTML comment with a three- or four-word summary of the actual result in the user's language: `<!-- codex-notification: Voice attachments now preserved -->`. Use a concrete subject and outcome, such as `Invoice totals recalculated` or `Dashboard deployment queued`. Reflect partial or blocked outcomes accurately. The Remote uses this short label for push notifications and removes the comment from displayed replies. User-requested exact output formats keep their requested structure.

## Confirmation suggestions

When your response asks the user to confirm a specific next action, append one hidden marker with the short reply that authorizes that action and a concise action summary: `<!-- codex-confirmation: {"reply":"proceed","summary":"Deploy the tested update"} -->`. Supply the expected affirmative reply as plain text on one line, up to 80 characters; examples include `ok`, `yes`, `proceed`, `confirmed`, `approved`, and `go ahead`. Place this marker before the notification comment. Use it for an actual pending action with a clear affirmative choice; use ordinary questions for missing information or choices between alternatives. The Remote presents confirmation and custom-reply buttons and supplies the requesting turn's model and reasoning when the user confirms. Keep existing authorization and the user's requested scope as the basis for deciding whether confirmation is needed.

## Voice-transcribed prompts

The Remote marks spoken input in `codex_remote_context` as `voice` or `mixed`. Treat that text as a transcription of intended speech. Resolve plausible homophones, spelling errors, punctuation, and human/project/product names using the conversation and the actual workspace. Keep the user's intended action, quantities, dates, and scope intact.

When a transcription ambiguity would change the target or outcome, surface the plausible interpretation and ask a focused question. Briefly mention a correction when it materially affects the work. For explicit requests for verbatim text, preserve the supplied wording. Typed input retains its ordinary interpretation.

## Visible worker handoffs

When the user asks this chat to prompt another worker or chat, send the task through that machine's authenticated Codex Remote API. This creates a visible queued/running job with a real chat timeline, progress, model/reasoning/speed metadata, and the usual completion notifications.

Read [the handoff reference](references/handoffs.md) for the bundled helper, discovery, API operations, and receipt format. The installed `connection.json` points the helper to the local Remote and its existing credential file. Read the access token into process memory and supply it in the `x-control-token` header. User-facing receipts contain the machine, project, chat, job ID, and a token-free chat link.

Resolve the intended machine, project, and chat from the user's request and the Remote's chat index. Give the target worker the objective, relevant context and decisions, accessible file paths or links, requested deliverables, verification criteria, and the source chat link. Carry forward explicitly requested model, reasoning, and speed settings through the per-prompt settings fields.

Use **queue** for another task that should follow the current job. Use **steer** for an update to the active turn, which keeps its current settings. Use **stop** when the user requests cancellation. Retain the request ID and returned job ID so a network retry can reconcile the same submission. Match each handoff's execution to the user's requested scope.

After dispatch, share the target chat link and actual accepted/queued/running status. For a chain of workers, give each downstream worker the relevant upstream results and artifact links. When the user asks for monitoring or a dependent handoff, follow the job status and visible chat progress through the same Remote, then report verified results and remaining work.
