// Packs everything into one self-contained file: autofill.html
import { readFileSync, writeFileSync } from 'node:fs';

const nm = (p) => readFileSync(new URL('./node_modules/' + p, import.meta.url), 'utf8');
const src = (p) => readFileSync(new URL('./src/' + p, import.meta.url), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const vendor = [
  nm('jszip/dist/jszip.min.js'),
  nm('pdf-lib/dist/pdf-lib.min.js'),
  nm('@pdf-lib/fontkit/dist/fontkit.umd.min.js'),
  // pdf.js runs on the page itself (no separate worker file needed)
  nm('pdfjs-dist/build/pdf.worker.min.js'),
  nm('pdfjs-dist/build/pdf.min.js'),
];
const font = readFileSync(new URL('./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf', import.meta.url)).toString('base64');
const app = ['util', 'fields', 'engine', 'fmt-office', 'fmt-text', 'fmt-pdf', 'vault', 'app'].map((f) => src(`js/${f}.js`));

const scripts = [
  ...vendor.map((v) => `<script>${safe(v)}</script>`),
  `<script>const FONT_B64 = "${font}";</script>`,
  `<script>\n${safe(app.join('\n\n'))}\n</script>`,
].join('\n');

const html = src('index.html')
  .replace('/*CSS*/', () => src('app.css'))
  .replace('<!--SCRIPTS-->', () => scripts);
writeFileSync(new URL('./autofill.html', import.meta.url), html);
console.log(`autofill.html: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
