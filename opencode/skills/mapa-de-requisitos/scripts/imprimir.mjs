/**
 * Imprime o tutorial (o HTML que tutorial.py monta) em PDF pelo Chrome da máquina, o mesmo da captura.
 *
 * A4 em retrato, com as capturas reamostradas para a página, o fundo das cores, o rodapé com o título do guia e o
 * número da página, e o sumário do PDF (os marcadores do leitor) tirado dos títulos.
 *
 * Uso: node imprimir.mjs <tutorial.html> <saída.pdf> <título do rodapé>
 * Ambiente: CHROME (o executável do Chrome), MAPA_NODE (a pasta com o node_modules do playwright-core).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// O playwright-core vem de MAPA_NODE (a pasta que build.py e tutorial.py preparam: ao lado dos scripts ou no cache do
// usuário), para a skill funcionar também instalada como plugin.
const exigir = createRequire(path.join(process.env.MAPA_NODE ?? path.dirname(fileURLToPath(import.meta.url)), 'package.json'));
const { chromium } = exigir('playwright-core');

const [, , html, pdf, rodape] = process.argv;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const escapar = (texto) => texto.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
// A largura da janela é a de uma folha A4 a 96 dpi: as imagens medem na tela o que medirão no papel.
const pagina = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await pagina.goto(pathToFileURL(html).href, { waitUntil: 'load' });
// Cada captura vai ao PDF só com a parte que aparece (sem a faixa cortada), reamostrada para a resolução da página
// impressa e em JPEG mais leve: a tela fica nítida no papel e o arquivo cabe num e-mail.
await pagina.evaluate(async ({ escala, qualidade }) => {
  for (const imagem of document.querySelectorAll('figure img')) {
    if (!imagem.complete) await new Promise((pronta) => { imagem.onload = pronta; });
    const quadro = imagem.parentElement.getBoundingClientRect();
    const caixa = imagem.getBoundingClientRect();
    const fator = imagem.naturalWidth / caixa.width;
    const origem = { x: (quadro.left - caixa.left) * fator, largura: quadro.width * fator };
    const largura = Math.round(Math.min(origem.largura, quadro.width * escala));
    const altura = Math.round(imagem.naturalHeight * largura / origem.largura);
    const tela = Object.assign(document.createElement('canvas'), { width: largura, height: altura });
    const contexto = tela.getContext('2d');
    contexto.imageSmoothingQuality = 'high';
    contexto.drawImage(imagem, origem.x, 0, origem.largura, imagem.naturalHeight, 0, 0, largura, altura);
    imagem.removeAttribute('style');
    imagem.src = tela.toDataURL('image/jpeg', qualidade);
    await imagem.decode();
  }
}, { escala: 1.4, qualidade: 0.72 });
await pagina.pdf({
  path: pdf,
  format: 'A4',
  printBackground: true,
  outline: true,
  tagged: true,
  margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: `<div style="width:100%;padding:0 14mm;font:8px Helvetica,Arial,sans-serif;color:#6b7280;
    display:flex;justify-content:space-between"><span>${escapar(rodape ?? '')}</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
});
await browser.close();
