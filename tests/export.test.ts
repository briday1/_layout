import { afterEach, describe, expect, it, vi } from 'vitest';
import { svgToPng } from '../packages/layout/src/export.js';

afterEach(() => vi.restoreAllMocks());

describe('shared SVG raster export', () => {
  it('rejects invalid SVG and unbounded canvas allocation', async () => {
    await expect(svgToPng('<html/>')).rejects.toThrow('valid SVG');
    await expect(svgToPng('<svg viewBox="0 0 100000 100000"/>')).rejects.toThrow('16 megapixels');
    await expect(svgToPng('<svg viewBox="0 0 10 10"/>', 0)).rejects.toThrow('positive');
  });

  it('releases object URLs when image decoding fails', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: revoke });
    vi.stubGlobal('Image', class {
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    });
    try {
      await expect(svgToPng('<svg viewBox="0 0 10 10"/>')).rejects.toThrow('rasterize');
      expect(revoke).toHaveBeenCalledWith('blob:test');
    } finally { vi.unstubAllGlobals(); }
  });
});
