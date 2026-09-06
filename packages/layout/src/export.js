/** Rasterize trusted, self-contained renderer SVG without a server dependency. */
export function svgToPng(svg, scale = 2) {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.localName !== 'svg' || parsed.querySelector('parsererror')) {
        return Promise.reject(new Error('Export requires a valid SVG document.'));
    }
    const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const width = (viewBox?.[2] ?? Number(root.getAttribute('width'))) * scale;
    const height = (viewBox?.[3] ?? Number(root.getAttribute('height'))) * scale;
    if (![scale, width, height].every(value => Number.isFinite(value) && value > 0) ||
        width * height > 16_777_216) {
        return Promise.reject(new Error('PNG dimensions must be positive and at most 16 megapixels.'));
    }
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        const image = new Image();
        const release = () => URL.revokeObjectURL(url);
        image.onerror = () => { release(); reject(new Error('The browser could not rasterize this SVG.')); };
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(width);
                canvas.height = Math.ceil(height);
                const context = canvas.getContext('2d');
                if (!context)
                    throw new Error('Canvas export is unavailable in this browser.');
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    release();
                    if (blob)
                        resolve(blob);
                    else
                        reject(new Error('The browser could not encode the PNG.'));
                }, 'image/png');
            }
            catch (error) {
                release();
                reject(error);
            }
        };
        image.src = url;
    });
}
