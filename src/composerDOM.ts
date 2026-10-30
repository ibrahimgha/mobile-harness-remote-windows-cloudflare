import { normalizeTextSelection, type TextSelection } from "./composerEditing";

/** One coordinate system for both contenteditable text and DOM selection points.
 * Range.toString() ignores the DIV/BR line breaks produced by native keyboards.
 */
export function composerDOMSnapshot(editor: HTMLElement) {
  let text = "";
  const offsets = new Map<Node, number[]>();
  const block = (node: Node) => node.nodeType === 1 && /^(DIV|P|LI|PRE|BLOCKQUOTE|H[1-6])$/.test((node as Element).tagName);
  const normalize = (value: string) => value.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
  function visit(node: Node) {
    const positions: number[] = [];
    offsets.set(node, positions);
    if (node.nodeType === 3) {
      const value = node.textContent ?? "";
      let length = 0;
      positions[0] = text.length;
      for (let i = 0; i < value.length; i++) {
        if (!(value[i] === "\n" && value[i - 1] === "\r")) length++;
        positions[i + 1] = text.length + length;
      }
      text += normalize(value);
      return;
    }
    positions[0] = text.length;
    const children = Array.from(node.childNodes);
    children.forEach((child, index) => {
      if (index > 0 && (block(child) || block(children[index - 1]))) text += "\n";
      if (child.nodeType === 1 && (child as Element).tagName === "BR") {
        offsets.set(child, [text.length]);
        // The final BR in a native editing line is a caret placeholder, not
        // another character. Real newlines in text nodes are never trimmed.
        if (index < children.length - 1) text += "\n";
      } else visit(child);
      positions[index + 1] = text.length;
    });
  }
  visit(editor);
  return {
    text,
    offsetAt(node: Node, offset: number) {
      const positions = offsets.get(node);
      return positions?.[Math.max(0, Math.min(positions.length - 1, offset))] ?? null;
    },
    pointAt(offset: number): {node:Node; offset:number} {
      const target = Math.max(0, Math.min(text.length, offset));
      let match = {node:editor as Node, offset:editor.childNodes.length};
      for (const [node, positions] of offsets) {
        const index = positions.indexOf(target);
        if (index < 0) continue;
        match = {node, offset:index};
        if (node.nodeType === 3) return match;
      }
      return match;
    }
  };
}

export function composerDOMSelection(editor: HTMLElement): TextSelection | null {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
  const snapshot = composerDOMSnapshot(editor);
  const start = snapshot.offsetAt(range.startContainer, range.startOffset);
  const end = snapshot.offsetAt(range.endContainer, range.endOffset);
  return start === null || end === null ? null : normalizeTextSelection(snapshot.text, {start,end});
}
