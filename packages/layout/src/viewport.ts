const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const MAX_OFFSET = 10_000_000;

/** Opt-in canvas navigation; keep content mounted when replacing its rendered children. */
export function createViewport(
  viewport: HTMLElement,
  content: HTMLElement,
  controls: HTMLElement,
): { destroy(): void; reset(): void } {
  const doc = viewport.ownerDocument;
  const disposers: (() => void)[] = [];
  const restorers: (() => void)[] = [];
  let scale = 1;
  let x = 0;
  let y = 0;
  let pan = false;
  let destroyed = false;
  let suppressClick = false;
  let pointer: { id: number; x: number; y: number } | null = null;

  function ownStyle(node: HTMLElement, property: string) {
    const value = node.style.getPropertyValue(property);
    const priority = node.style.getPropertyPriority(property);
    const restore = () => {
      if (value) node.style.setProperty(property, value, priority);
      else node.style.removeProperty(property);
    };
    restorers.push(restore);
    return restore;
  }
  ownStyle(content, 'transform');
  ownStyle(content, 'transform-origin');
  const restoreCursor = ownStyle(viewport, 'cursor');
  const restoreTouch = ownStyle(viewport, 'touch-action');
  const restoreSelection = ownStyle(viewport, 'user-select');
  content.style.transformOrigin = '0 0';

  function listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(type, handler, options);
    disposers.push(() => target.removeEventListener(type, handler, options));
  }
  const modified = (event: MouseEvent | KeyboardEvent) =>
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const offset = (value: number) => Number.isFinite(value) ? clamp(value, -MAX_OFFSET, MAX_OFFSET) : 0;

  const toolbar = doc.createElement('div');
  toolbar.className = 'lw-viewport-controls';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Canvas view');
  function button(label: string, action: () => void) {
    const node = doc.createElement('button');
    node.type = 'button';
    node.className = 'lw-button';
    node.textContent = label;
    listen(node, 'click', event => {
      if (!destroyed && !modified(event) && event.button === 0) action();
    });
    toolbar.append(node);
    return node;
  }
  const zoomIn = button('Zoom in', () => zoom(scale * 1.25));
  const zoomOut = button('Zoom out', () => zoom(scale / 1.25));
  button('Reset view', reset);
  const panButton = button('Pan', () => setPan(!pan));
  panButton.setAttribute('aria-pressed', 'false');
  panButton.title = 'Pan with pointer drag or arrow keys in these controls';
  const status = doc.createElement('output');
  status.className = 'lw-viewport-scale';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Zoom level');
  status.setAttribute('aria-live', 'polite');
  toolbar.append(status);
  controls.append(toolbar);

  function render() {
    content.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    status.textContent = `${Math.round(scale * 100)}%`;
    zoomIn.disabled = scale >= MAX_SCALE;
    zoomOut.disabled = scale <= MIN_SCALE;
  }
  function zoom(value: number) {
    if (destroyed || !Number.isFinite(value)) return;
    const next = clamp(value, MIN_SCALE, MAX_SCALE);
    if (next === scale) return;
    const frame = viewport.getBoundingClientRect();
    const bounds = content.getBoundingClientRect();
    // The rendered bounds account for padding, native scrolling and prior translation.
    const centerX = frame.left + viewport.clientLeft + viewport.clientWidth / 2;
    const centerY = frame.top + viewport.clientTop + viewport.clientHeight / 2;
    x = offset(x - (centerX - bounds.left) * (next / scale - 1));
    y = offset(y - (centerY - bounds.top) * (next / scale - 1));
    scale = next;
    render();
  }
  function endPointer() {
    const active = pointer;
    pointer = null;
    if (active) {
      try { viewport.releasePointerCapture(active.id); } catch { /* Capture may already be lost. */ }
    }
    if (pan) viewport.style.cursor = 'grab';
  }
  function setPan(enabled: boolean) {
    endPointer();
    pan = enabled;
    panButton.setAttribute('aria-pressed', String(pan));
    if (pan) {
      viewport.style.cursor = 'grab';
      viewport.style.touchAction = 'none';
      viewport.style.userSelect = 'none';
    } else {
      restoreCursor();
      restoreTouch();
      restoreSelection();
    }
  }
  function reset() {
    if (destroyed) return;
    endPointer();
    scale = 1;
    x = y = 0;
    render();
  }
  const inToolbar = (event: Event) => event.composedPath().includes(toolbar);
  listen(viewport, 'wheel', event => {
    if (inToolbar(event) || (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey ||
        !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    zoom(scale * Math.exp(-clamp(event.deltaY * unit, -1000, 1000) * 0.002));
  }, { passive: false });
  listen(viewport, 'pointerdown', event => {
    if (inToolbar(event)) return;
    if (!pointer) suppressClick = false;
    if (!pan || pointer || modified(event) || event.button !== 0 || event.isPrimary === false ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    try { viewport.setPointerCapture(event.pointerId); } catch { return; }
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    suppressClick = true;
    viewport.style.cursor = 'grabbing';
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });
  listen(viewport, 'pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    x = offset(x + event.clientX - pointer.x);
    y = offset(y + event.clientY - pointer.y);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    event.preventDefault();
    event.stopPropagation();
    render();
  }, { capture: true });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    listen(viewport, type, event => {
      if (event.pointerId !== pointer?.id) return;
      event.stopPropagation();
      endPointer();
    }, { capture: true });
  }
  listen(viewport, 'click', event => {
    if (inToolbar(event) || modified(event) || (!pan && !suppressClick)) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });
  listen(toolbar, 'keydown', event => {
    if (modified(event)) return;
    if (event.key === 'Escape') {
      setPan(false);
      return;
    }
    if (!pan) return;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20],
    };
    const direction = delta[event.key];
    if (!direction) return;
    event.preventDefault();
    x = offset(x + direction[0]);
    y = offset(y + direction[1]);
    render();
  });
  const onBlur = () => endPointer();
  doc.defaultView?.addEventListener('blur', onBlur);
  disposers.push(() => doc.defaultView?.removeEventListener('blur', onBlur));
  render();

  return {
    reset,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      disposers.forEach(dispose => dispose());
      endPointer();
      suppressClick = false;
      restorers.forEach(restore => restore());
      toolbar.remove();
    },
  };
}
