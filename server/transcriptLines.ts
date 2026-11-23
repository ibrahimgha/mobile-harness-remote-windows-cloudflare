import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Stream a rollout or a byte window without converting the entire file to a string. */
export async function* transcriptLines(filePath: string, start = 0, length?: number) {
  if (length !== undefined && length <= 0) return;
  const input = createReadStream(filePath, {
    encoding: "utf8", start,
    ...(length === undefined ? {} : { end: start + length - 1 })
  });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield line;
  } finally {
    lines.close();
    input.destroy();
  }
}
