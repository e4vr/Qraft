function nativeTextInteraction(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
  if (element.closest(`${editable}, .select-text, .q-text-highlight`)) return true;
  const label = element.closest('label');
  return label instanceof HTMLLabelElement && Boolean(label.control?.matches(editable));
}

/** Keep installed-shell gestures controlled without cancelling native editing/selection. */
export function installStandaloneTouchGuards() {
  let startX = 0, startY = 0;
  let nativeGesture = false;
  const cancel = (event: Event) => { if (event.cancelable) event.preventDefault(); };
  const prevent = (event: Event) => { if (!nativeTextInteraction(event.target)) cancel(event); };
  const onTouchStart = (event: TouchEvent) => {
    nativeGesture = nativeTextInteraction(event.target);
    if (event.touches.length === 1) {
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    }
  };
  const onTouchMove = (event: TouchEvent) => {
    if (nativeGesture || nativeTextInteraction(event.target)) return;
    if (event.touches.length > 1) { cancel(event); return; }
    if (event.touches.length !== 1) return;
    const deltaY = event.touches[0].clientY - startY;
    const deltaX = event.touches[0].clientX - startX;
    // Finger jitter must not cancel the compatibility click that focuses inputs.
    if (deltaY < 8 || deltaY <= Math.abs(deltaX)) return;
    let element = event.target instanceof Element ? event.target : null;
    while (element && element !== document.documentElement) {
      if (element.scrollHeight > element.clientHeight + 1 && element.scrollTop > 0) return;
      element = element.parentElement;
    }
    cancel(event);
  };
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) prevent(event);
  };
  const passive = { passive: false } as const;
  const listeners: Array<[string, EventListener]> = [
    ['gesturestart', prevent], ['gesturechange', prevent], ['gestureend', prevent],
    ['dblclick', prevent], ['touchstart', onTouchStart as EventListener],
    ['touchmove', onTouchMove as EventListener], ['wheel', onWheel as EventListener],
  ];
  for (const [name, listener] of listeners) document.addEventListener(name, listener, passive);
  return () => { for (const [name, listener] of listeners) document.removeEventListener(name, listener); };
}
