const metadataPattern = /(?:^|\n)[ \t]*<!--\s*codex-notification:\s*([^<>\r\n]{1,240}?)\s*-->\s*$/i;
const generic = /^(?:done|completed|finished|fixed|implemented|updated|ready|success|task|run|work|changes|summary|results?)[.!\s-]*$/i;

function plain(value: string): string {
  return value.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]*>/g, " ").replace(/[`*_#>|]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function shortNotificationSummary(value: string | undefined): string | undefined {
  const cleaned = plain(value ?? "").replace(/^[\s.!,:;–—-]+|[\s.!,:;–—-]+$/g, "");
  if (!cleaned || generic.test(cleaned)) return undefined;
  const words = cleaned.split(/\s+/).slice(0, 4);
  while (words.length > 1 && words.join(" ").length > 64) words.pop();
  const result = words.join(" ").slice(0, 64);
  return result && !generic.test(result) ? result : undefined;
}

export function splitNotificationMetadata(text: string): { text: string; summary?: string } {
  const match = text.match(metadataPattern);
  if (!match) return { text };
  return { text: text.slice(0, match.index).trimEnd(), summary: shortNotificationSummary(match[1]) };
}

export function taskNotificationSummary(options: { summary?: string; response?: string; prompt?: string; chatName?: string }): string {
  const explicit = shortNotificationSummary(options.summary) ?? splitNotificationMetadata(options.response ?? "").summary;
  if (explicit) return explicit;
  const response = splitNotificationMetadata(options.response ?? "").text.replace(/```[\s\S]*?```/g, "");
  for (const line of response.split(/\n/)) {
    const content = plain(line).replace(/^(?:done|completed|finished)[.!\s:–—-]+/i, "")
      .replace(/^(?:I(?:'ve| have)?|we(?:'ve| have)?)\s+/i, "");
    if (!content || /^(?:here(?:'s| is| are)|\{)/i.test(content)) continue;
    const summary = shortNotificationSummary(content);
    if (summary && summary.split(/\s+/).length >= 3) return summary;
  }
  const prompt = plain(options.prompt ?? "")
    .replace(/^(?:(?:please|can you|could you|would you|I want you to|I want to|now|also)\s+)+/i, "")
    .replace(/\b(?:the|a|an|this|that|my|our|your|to|for|of|it|is|are)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  const task = shortNotificationSummary(prompt);
  if (task && !/^(?:resume|continue|proceed|fix|test|ping)$/i.test(task)) return task;
  return shortNotificationSummary(`${options.chatName || "Codex task"} finished`) || "Codex task finished";
}

function label(value: string | undefined, fallback: string, max: number): string {
  const text = plain(value || fallback);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function notificationCopy(
  job: { chatId: string; projectPath: string; promptPreview?: string; notificationSummary?: string },
  event: "completed" | "failed",
  context: { projectName?: string; chatName?: string; response?: string } = {}
): { title: string; body: string } {
  const project = label(context.projectName, job.projectPath.split(/[\\/]/).filter(Boolean).at(-1) || "Codex", 48);
  const chat = label(context.chatName, `Chat ${job.chatId.slice(0, 8)}`, 42);
  return {
    title: event === "completed" ? taskNotificationSummary({ summary: job.notificationSummary, response: context.response, prompt: job.promptPreview, chatName: chat }) : "Task needs attention",
    body: `${project} · ${chat}${event === "failed" ? " · Failed" : ""}`
  };
}
