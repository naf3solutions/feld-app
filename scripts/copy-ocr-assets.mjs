// Kopiert OCR-Engine (tesseract.js Worker + WASM-Core) und Sprachdaten nach
// public/ocr, damit die App sie selbst ausliefert (offline-fähig, kein CDN).
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public', 'ocr');
mkdirSync(out, { recursive: true });

const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const files = [
  [join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['', '-simd', '-relaxedsimd'].map((v) => [
    join(pkgDir('tesseract.js-core'), `tesseract-core${v}-lstm.wasm.js`),
    `tesseract-core${v}-lstm.wasm.js`,
  ]),
  [join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];

for (const [src, name] of files) {
  if (!existsSync(src)) throw new Error(`OCR-Asset fehlt: ${src}`);
  copyFileSync(src, join(out, name));
}
console.log(`OCR-Assets nach ${out} kopiert (${files.length} Dateien).`);
