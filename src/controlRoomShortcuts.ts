export type ControlRoomShortcutAction =
  | "model-left"
  | "model-right"
  | "scroll-up"
  | "scroll-down"
  | "chat-cycle"
  | "fast-toggle"
  | "mic-toggle";

export type ControlRoomShortcutFeedbackAction =
  | "model-left"
  | "model-right"
  | "fast-on"
  | "fast-off"
  | "mic-recording"
  | "mic-sending"
  | "unavailable";

export type ControlRoomShortcutFeedback = {
  action: ControlRoomShortcutFeedbackAction;
  label: string;
  detail: string;
};

export function resolveControlRoomShortcut(
  event: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "altKey" | "metaKey">,
  pressedCodes: ReadonlySet<string>
): ControlRoomShortcutAction | null {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;

  const isPressed = (...values: string[]) => values.some((value) => pressedCodes.has(value));
  const key = event.key.toLowerCase();

  if ((event.code === "ArrowRight" || key === "arrowright") && isPressed("Digit3", "3")) return "model-right";
  if ((event.code === "ArrowLeft" || key === "arrowleft") && isPressed("Digit3", "3")) return "model-left";
  if ((event.code === "ArrowRight" || key === "arrowright") && isPressed("Digit2", "2")) return "scroll-up";
  if ((event.code === "ArrowLeft" || key === "arrowleft") && isPressed("Digit2", "2")) return "scroll-down";
  if (((event.code === "Digit2" || key === "2") && isPressed("KeyB", "b")) || ((event.code === "KeyB" || key === "b") && isPressed("Digit2", "2"))) {
    return "chat-cycle";
  }
  if (((event.code === "Digit3" || key === "3") && isPressed("KeyB", "b")) || ((event.code === "KeyB" || key === "b") && isPressed("Digit3", "3"))) {
    return "fast-toggle";
  }
  if (((event.code === "Digit1" || key === "1") && isPressed("KeyB", "b")) || ((event.code === "KeyB" || key === "b") && isPressed("Digit1", "1"))) {
    return "mic-toggle";
  }

  return null;
}

export function adjacentPowerSettingIndex(currentIndex: number, direction: "left" | "right", count: number) {
  if (count <= 0) return -1;
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  return Math.min(count - 1, Math.max(0, safeCurrentIndex + (direction === "left" ? -1 : 1)));
}
