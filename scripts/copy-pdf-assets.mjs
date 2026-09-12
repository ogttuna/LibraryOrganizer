import { cp, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const target = new URL(`public/pdfjs/${name}/`, root);
  await mkdir(target, { recursive: true });
  await cp(new URL(`node_modules/pdfjs-dist/${name}/`, root), target, { recursive: true });
}
