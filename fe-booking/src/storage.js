import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Local disk storage for photos. To move to S3/R2, implement the same three
// methods (save, open, remove) against the bucket.
export function localStorage(rootDir) {
  fs.mkdirSync(rootDir, { recursive: true });
  const resolve = (key) => {
    const full = path.resolve(rootDir, key);
    if (!full.startsWith(path.resolve(rootDir) + path.sep)) throw new Error('Invalid storage key');
    return full;
  };
  return {
    async save(buffer, ext) {
      const month = new Date().toISOString().slice(0, 7);
      const key = `${month}/${crypto.randomUUID()}.${ext}`;
      const full = resolve(key);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, buffer);
      return key;
    },
    open(key) {
      return fs.createReadStream(resolve(key));
    },
    async remove(key) {
      await fs.promises.rm(resolve(key), { force: true });
    },
  };
}

// Identify images by their first bytes rather than trusting the upload's name.
export function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
