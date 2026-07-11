export type TextSelection = {
  start: number;
  end: number;
};

export type TextMutation = {
  text: string;
  selection: TextSelection;
};

export function normalizeTextSelection(text: string, selection: TextSelection): TextSelection {
  const clamp = (offset: number) => Math.max(0, Math.min(text.length, Math.trunc(offset)));
  const start = clamp(selection.start);
  const end = clamp(selection.end);

  return start <= end ? { start, end } : { start: end, end: start };
}

export function insertTextAtSelection(text: string, selection: TextSelection, insertedText: string): TextMutation {
  const normalized = normalizeTextSelection(text, selection);
  const nextCaret = normalized.start + insertedText.length;

  return {
    text: `${text.slice(0, normalized.start)}${insertedText}${text.slice(normalized.end)}`,
    selection: { start: nextCaret, end: nextCaret }
  };
}

function previousCodePointStart(text: string, offset: number) {
  const prefix = text.slice(0, offset);
  const previousCodePoint = Array.from(prefix).at(-1) ?? "";
  return Math.max(0, offset - previousCodePoint.length);
}

export function deleteTextBackward(text: string, selection: TextSelection): TextMutation {
  const normalized = normalizeTextSelection(text, selection);

  if (normalized.start !== normalized.end) {
    return {
      text: `${text.slice(0, normalized.start)}${text.slice(normalized.end)}`,
      selection: { start: normalized.start, end: normalized.start }
    };
  }

  if (normalized.start === 0) {
    return { text, selection: normalized };
  }

  const deleteFrom = previousCodePointStart(text, normalized.start);
  return {
    text: `${text.slice(0, deleteFrom)}${text.slice(normalized.end)}`,
    selection: { start: deleteFrom, end: deleteFrom }
  };
}
