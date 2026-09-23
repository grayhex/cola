import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const fallback = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#f6f7f8"/><g fill="none" stroke="#253446" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
<circle cx="480" cy="240" r="65"/><circle cx="720" cy="240" r="65"/><path d="M480 240l65-100 80 100H480l125-90h60l55 90M535 130h45M655 125h35"/></g>
<text x="600" y="425" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="70" fill="#253446">ColaBike</text></svg>`);

// Single replaceable image strategy. A future branded 1200x630 compositor can
// consume the same preview descriptor without changing routes or metadata.
export async function renderSocialImage(preview, { uploadDir = process.env.UPLOAD_DIR || 'uploads' } = {}) {
  const filename = preview.image?.filename;
  if (filename && filename === path.basename(filename) && /^[a-zA-Z0-9_-]+\.(?:webp|png|jpe?g)$/i.test(filename)) {
    try {
      const bytes = await readFile(path.join(uploadDir, filename));
      return await sharp(bytes, { limitInputPixels: 40000000 }).rotate()
        .resize({ width: 1200, height: 630, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
    }
  }
  return sharp(fallback).jpeg({ quality: 88 }).toBuffer();
}
