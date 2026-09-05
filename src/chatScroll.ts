export type PrependScrollSnapshot = {
  chatId: string;
  scrollHeight: number;
  scrollTop: number;
  anchorRenderKey?: string;
  anchorOffset?: number;
};

export function restoredPrependScrollTop(
  snapshot: Pick<PrependScrollSnapshot, "scrollHeight" | "scrollTop" | "anchorOffset">,
  currentScrollTop: number,
  currentScrollHeight: number,
  currentAnchorOffset?: number
) {
  if (snapshot.anchorOffset !== undefined && currentAnchorOffset !== undefined) {
    return Math.max(0, currentScrollTop + currentAnchorOffset - snapshot.anchorOffset);
  }

  return Math.max(0, snapshot.scrollTop + currentScrollHeight - snapshot.scrollHeight);
}

function renderedMessageElements(scroller: HTMLElement) {
  return Array.from(scroller.querySelectorAll<HTMLElement>("[data-render-key]"))
    .filter((element) => element.getBoundingClientRect().height > 0);
}

export function capturePrependScrollSnapshot(scroller: HTMLElement, chatId: string): PrependScrollSnapshot {
  const scrollerTop = scroller.getBoundingClientRect().top;
  const anchor = renderedMessageElements(scroller)
    .find((element) => element.getBoundingClientRect().bottom > scrollerTop + 1);

  return {
    chatId,
    scrollHeight: scroller.scrollHeight,
    scrollTop: scroller.scrollTop,
    anchorRenderKey: anchor?.dataset.renderKey,
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - scrollerTop : undefined
  };
}

export function restorePrependScrollSnapshot(scroller: HTMLElement, snapshot: PrependScrollSnapshot) {
  const scrollerTop = scroller.getBoundingClientRect().top;
  const anchor = snapshot.anchorRenderKey
    ? renderedMessageElements(scroller).find((element) => element.dataset.renderKey === snapshot.anchorRenderKey)
    : undefined;
  const currentAnchorOffset = anchor ? anchor.getBoundingClientRect().top - scrollerTop : undefined;

  scroller.scrollTop = restoredPrependScrollTop(
    snapshot,
    scroller.scrollTop,
    scroller.scrollHeight,
    currentAnchorOffset
  );
}
