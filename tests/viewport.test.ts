import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewport } from '../packages/layout/src/viewport.js';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach(destroy => destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function mount(styles = false) {
  const viewport = document.createElement('div');
  const content = document.createElement('div');
  const controls = document.createElement('div');
  const target = document.createElement('button');
  target.textContent = 'Preview object';
  content.append(target);
  viewport.append(content);
  document.body.append(controls, viewport);
  if (styles) {
    content.style.setProperty('transform', 'rotate(1deg)', 'important');
    content.style.transformOrigin = 'center';
    viewport.style.cursor = 'crosshair';
    viewport.style.touchAction = 'pan-y';
    viewport.style.userSelect = 'text';
  }
  Object.defineProperties(viewport, {
    clientWidth: { value: 400 },
    clientHeight: { value: 300 },
    clientLeft: { value: 2 },
    clientTop: { value: 2 },
  });
  viewport.getBoundingClientRect = () => ({ left: 10, top: 20 } as DOMRect);
  const transform = () => {
    const values = content.style.transform.match(/translate\(([-.\de+]+)px, ([-.\de+]+)px\) scale\(([-.\de+]+)\)/);
    return values ? values.slice(1).map(Number) : [0, 0, 1];
  };
  content.getBoundingClientRect = () => ({
    left: 32 - viewport.scrollLeft + transform()[0],
    top: 52 - viewport.scrollTop + transform()[1],
  } as DOMRect);
  viewport.setPointerCapture = vi.fn();
  viewport.releasePointerCapture = vi.fn();
  const api = createViewport(viewport, content, controls);
  cleanup.push(api.destroy);
  const button = (label: string) => [...controls.querySelectorAll('button')].find(node => node.textContent === label)!;
  const wheel = (init: WheelEventInit = {}) => {
    const deltaY = init.deltaY ?? -100;
    const event = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, ...init, deltaY: Number.isFinite(deltaY) ? deltaY : 0,
    });
    if (!Number.isFinite(deltaY)) Object.defineProperty(event, 'deltaY', { value: deltaY });
    viewport.dispatchEvent(event);
    return event;
  };
  const pointer = (type: string, init: MouseEventInit & { pointerId?: number } = {}, node: HTMLElement = target) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
    Object.defineProperties(event, {
      pointerId: { value: init.pointerId ?? 1 },
      isPrimary: { value: true },
    });
    node.dispatchEvent(event);
    return event;
  };
  return { viewport, content, controls, target, api, button, wheel, pointer, transform };
}

describe('opt-in canvas viewport', () => {
  it('provides accessible controls, identity transform and bounded zoom', () => {
    const { controls, content, button, transform } = mount();
    expect(controls.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Canvas view');
    expect(content.style.transformOrigin).toBe('0 0');
    expect(transform()).toEqual([0, 0, 1]);
    expect(button('Pan').getAttribute('aria-pressed')).toBe('false');
    for (let i = 0; i < 100; i++) button('Zoom in').click();
    expect(transform()[2]).toBe(8);
    expect(button('Zoom in').disabled).toBe(true);
    expect(controls.querySelector('[role="status"]')?.textContent).toBe('800%');
    for (let i = 0; i < 100; i++) button('Zoom out').click();
    expect(transform()[2]).toBe(0.1);
    expect(button('Zoom out').disabled).toBe(true);
    button('Reset view').click();
    expect(transform()).toEqual([0, 0, 1]);
    expect(button('Zoom out').disabled).toBe(false);
  });

  it('zooms about the viewport center including borders, content offset and scrolling', () => {
    const { viewport, button, transform } = mount();
    viewport.scrollLeft = 50;
    viewport.scrollTop = 25;
    button('Zoom in').click();
    expect(transform()).toEqual([-57.5, -36.25, 1.25]);
    button('Zoom out').click();
    expect(transform()[0]).toBeCloseTo(0);
    expect(transform()[1]).toBeCloseTo(0);
    expect(transform()[2]).toBe(1);
  });

  it('preserves native scrolling and only handles unmodified Ctrl/Meta wheel zoom', () => {
    const { wheel, transform } = mount();
    expect(wheel().defaultPrevented).toBe(false);
    expect(wheel({ shiftKey: true }).defaultPrevented).toBe(false);
    expect(wheel({ ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(transform()[2]).toBe(1);
    expect(wheel({ ctrlKey: true }).defaultPrevented).toBe(true);
    expect(transform()[2]).toBeGreaterThan(1);
    expect(wheel({ metaKey: true, deltaY: 100 }).defaultPrevented).toBe(true);
    expect(transform()[2]).toBeCloseTo(1);
  });

  it('rejects nonfinite wheel input and bounds extreme finite input', () => {
    const { wheel, transform } = mount();
    for (const deltaY of [NaN, Infinity, -Infinity]) {
      expect(wheel({ ctrlKey: true, deltaY }).defaultPrevented).toBe(false);
    }
    expect(transform()).toEqual([0, 0, 1]);
    for (let i = 0; i < 10; i++) wheel({ ctrlKey: true, deltaY: -Number.MAX_VALUE, deltaMode: 1 });
    expect(transform()[2]).toBe(8);
    for (let i = 0; i < 10; i++) wheel({ ctrlKey: true, deltaY: Number.MAX_VALUE, deltaMode: 2 });
    expect(transform()[2]).toBe(0.1);
    expect(transform().every(Number.isFinite)).toBe(true);
  });

  it('leaves normal preview clicks and pointer gestures untouched', () => {
    const { target, pointer, viewport, transform } = mount();
    const clicked = vi.fn();
    target.addEventListener('click', clicked);
    expect(pointer('pointerdown', { clientX: 10, clientY: 20 }).defaultPrevented).toBe(false);
    pointer('pointermove', { clientX: 40, clientY: 60 });
    pointer('pointerup');
    target.click();
    expect(clicked).toHaveBeenCalledOnce();
    expect(viewport.setPointerCapture).not.toHaveBeenCalled();
    expect(transform()).toEqual([0, 0, 1]);
  });

  it('captures only explicit Pan gestures and suppresses preview selection', () => {
    const { target, pointer, viewport, transform, button } = mount();
    const clicked = vi.fn();
    target.addEventListener('click', clicked);
    button('Pan').click();
    expect(viewport.style.touchAction).toBe('none');
    expect(pointer('pointerdown', { clientX: 10, clientY: 20 }).defaultPrevented).toBe(true);
    expect(viewport.setPointerCapture).toHaveBeenCalledWith(1);
    pointer('pointermove', { clientX: 40, clientY: 60, pointerId: 2 });
    expect(transform()).toEqual([0, 0, 1]);
    pointer('pointermove', { clientX: 40, clientY: 60 });
    pointer('pointerup');
    target.click();
    expect(clicked).not.toHaveBeenCalled();
    expect(transform()).toEqual([30, 40, 1]);
    expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1);
    button('Pan').click();
    pointer('pointerdown');
    target.click();
    expect(clicked).toHaveBeenCalledOnce();
    expect(viewport.style.touchAction).toBe('');
  });

  it.each(['pointercancel', 'lostpointercapture', 'blur'])('ends pointer state on %s', type => {
    const { pointer, viewport, transform, button } = mount();
    button('Pan').click();
    pointer('pointerdown', { clientX: 10, clientY: 20 });
    if (type === 'blur') window.dispatchEvent(new Event('blur'));
    else pointer(type);
    pointer('pointermove', { clientX: 40, clientY: 60 });
    expect(transform()).toEqual([0, 0, 1]);
    expect(viewport.style.cursor).toBe('grab');
  });

  it('ignores modified or secondary controls and pointer interactions', () => {
    const { button, pointer, transform, viewport } = mount();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      button('Zoom in').dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
      button('Pan').dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
    }
    expect(transform()).toEqual([0, 0, 1]);
    expect(button('Pan').getAttribute('aria-pressed')).toBe('false');
    button('Pan').click();
    expect(pointer('pointerdown', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(pointer('pointerdown', { button: 2 }).defaultPrevented).toBe(false);
    expect(viewport.setPointerCapture).not.toHaveBeenCalled();
  });

  it('bounds extreme panning and rejects invalid coordinates', () => {
    const { button, pointer, transform, target } = mount();
    button('Pan').click();
    pointer('pointerdown', { clientX: 0, clientY: 0 });
    pointer('pointermove', { clientX: 1e20, clientY: -1e20 });
    expect(transform()).toEqual([10_000_000, -10_000_000, 1]);
    const event = new MouseEvent('pointermove', { bubbles: true });
    Object.defineProperties(event, { clientX: { value: NaN }, pointerId: { value: 1 } });
    target.dispatchEvent(event);
    expect(transform()).toEqual([10_000_000, -10_000_000, 1]);
    button('Reset view').click();
    pointer('pointermove', { clientX: 10, clientY: 20 });
    expect(transform()).toEqual([0, 0, 1]);
  });

  it('does not start a drag when pointer capture fails', () => {
    const { button, pointer, viewport, transform } = mount();
    viewport.setPointerCapture = () => { throw new Error('Pointer no longer active'); };
    button('Pan').click();
    expect(pointer('pointerdown').defaultPrevented).toBe(false);
    pointer('pointermove', { clientX: 10, clientY: 20 });
    expect(transform()).toEqual([0, 0, 1]);
  });

  it('pans with unmodified arrow keys in controls only while Pan is active', () => {
    const { button, transform, viewport } = mount();
    const key = (node: HTMLElement, value: string, shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      return event;
    };
    expect(key(button('Pan'), 'ArrowRight').defaultPrevented).toBe(false);
    button('Pan').click();
    expect(key(button('Pan'), 'ArrowRight', true).defaultPrevented).toBe(false);
    expect(key(viewport, 'ArrowRight').defaultPrevented).toBe(false);
    expect(key(button('Pan'), 'ArrowRight').defaultPrevented).toBe(true);
    key(button('Pan'), 'ArrowUp');
    expect(transform()).toEqual([20, -20, 1]);
    key(button('Pan'), 'Escape');
    expect(button('Pan').getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps state across arbitrary replacement HTML, SVG and canvas children', () => {
    const { content, button, pointer, transform } = mount();
    button('Zoom in').click();
    button('Pan').click();
    pointer('pointerdown', { clientX: 0, clientY: 0 });
    pointer('pointermove', { clientX: 50, clientY: 25 });
    pointer('pointerup');
    const initial = transform();
    for (const node of [
      document.createElement('article'),
      document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
      document.createElement('canvas'),
    ]) {
      content.replaceChildren(node);
      expect(transform()).toEqual(initial);
    }
  });

  it('does not intercept its own toolbar when controls are within viewport', () => {
    const { viewport, controls, button, pointer, transform } = mount();
    viewport.append(controls);
    button('Pan').click();
    expect(pointer('pointerdown', {}, button('Zoom in')).defaultPrevented).toBe(false);
    button('Zoom in').click();
    expect(transform()[2]).toBe(1.25);
  });

  it('restores owned styles, releases capture and removes listeners on idempotent destroy', () => {
    const { viewport, content, controls, target, button, pointer, wheel, api } = mount(true);
    const unrelated = document.createElement('span');
    controls.prepend(unrelated);
    const retainedButton = button('Zoom in');
    button('Pan').click();
    pointer('pointerdown', { clientX: 10, clientY: 20 });
    content.style.color = 'red';
    api.destroy();
    api.destroy();
    expect(viewport.releasePointerCapture).toHaveBeenCalledTimes(1);
    expect(controls.children).toHaveLength(1);
    expect(controls.firstChild).toBe(unrelated);
    expect(content.style.transform).toBe('rotate(1deg)');
    expect(content.style.getPropertyPriority('transform')).toBe('important');
    expect(content.style.transformOrigin).toBe('center');
    expect(content.style.color).toBe('red');
    expect(viewport.style.cursor).toBe('crosshair');
    expect(viewport.style.touchAction).toBe('pan-y');
    expect(viewport.style.userSelect).toBe('text');
    expect(wheel({ ctrlKey: true }).defaultPrevented).toBe(false);
    pointer('pointermove', { clientX: 40, clientY: 60 });
    retainedButton.click();
    api.reset();
    expect(content.style.transform).toBe('rotate(1deg)');
    const clicked = vi.fn();
    target.addEventListener('click', clicked);
    target.click();
    expect(clicked).toHaveBeenCalledOnce();
  });
});
