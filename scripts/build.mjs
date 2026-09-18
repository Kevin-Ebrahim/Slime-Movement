import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'style.css']) await copyFile(file, `dist/${file}`);
// Closed, dependency-ordered module set; also produce a double-clickable demo.
// The normal application still uses standard ES modules, not this concatenation.
let bundle = '';
for (const name of ['math', 'world', 'physics', 'renderer', 'main']) {
  const code = await readFile(`dist/js/${name}.js`, 'utf8');
  bundle += code.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '').replace(/^\/\/# sourceMappingURL=.*$/gm, '') + '\n';
}
const html = await readFile('index.html', 'utf8');
const css = await readFile('style.css', 'utf8');
const standalone = html.replace('<link rel="stylesheet" href="./style.css" />', `<style>${css}</style>`)
  .replace('<script type="module" src="./js/main.js"></script>', `<script type="module">${bundle.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile('dist/demo.html', standalone);
console.log('Built dist/ and dist/demo.html — no runtime dependencies.');
