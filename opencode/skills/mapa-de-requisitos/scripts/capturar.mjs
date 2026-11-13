/**
 * Fotografa as telas de um fluxo do mapa de requisitos e mede onde fica cada marcador.
 *
 * Entra em cada portal do sistema com a conta de teste da configuração do projeto (o portal com `anonimo: true` não
 * entra: serve às telas de quem ainda não fez login, como o próprio login), percorre cada etapa (rota e cliques
 * pelo texto ou por seletor, para sobreviver à regeneração dos dados, que troca os ids) e grava, para cada tela, a
 * captura em JPEG e a caixa de cada marcador em pixels da janela.
 *
 * Marcador cujo elemento **não existe** na tela é erro: a tela mudou (um texto ou um componente trocado) e o fluxo
 * quebrou. A captura segue até o fim, para listar todos de uma vez, grava o índice com os ausentes e termina com
 * falha; o build também se recusa a montar o mapa enquanto houver um. Elemento que existe, mas fica fora da janela
 * (abaixo da dobra) ou escondido, pode ser legítimo: vira aviso, e o mapa o lista sem o ponto na tela.
 *
 * Os passos do tutorial (`passos`, cada um com o `alvo` opcional) também são medidos, para o número do passo ir sobre
 * o que se clica ou preenche.
 *
 * Uso: node capturar.mjs <fluxo.json> <pasta das capturas> <config.json>
 * Ambiente: MAPA_NODE (a pasta com o node_modules do playwright-core), MAPA_ETAPAS (refaz só as etapas listadas, separadas por vírgula), MAPA_BASE (sobrescreve o endereço),
 *           CHROME (o executável do Chrome); a senha e as contas vêm das variáveis que a configuração nomeia.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// O playwright-core vem de MAPA_NODE (a pasta que build.py e tutorial.py preparam: ao lado dos scripts ou no cache do
// usuário), para a skill funcionar também instalada como plugin.
const exigir = createRequire(path.join(process.env.MAPA_NODE ?? path.dirname(fileURLToPath(import.meta.url)), 'package.json'));
const { chromium } = exigir('playwright-core');

const [, , arquivoDoFluxo, pastaDeSaida, arquivoDeConfiguracao] = process.argv;
const fluxo = JSON.parse(fs.readFileSync(arquivoDoFluxo, 'utf8'));
const config = JSON.parse(fs.readFileSync(arquivoDeConfiguracao, 'utf8'));
const BASE = process.env.MAPA_BASE ?? config.base;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const JANELA = { width: config.janela?.largura ?? 1440, height: config.janela?.altura ?? 900 };
const AGUARDE = config.aguarde ? new RegExp(config.aguarde) : null;

/** Valor de `{ variavel, padrao }`: a variável de ambiente, ou o padrão que o projeto aceita deixar na configuração. */
function segredo(origem, descricao) {
  const valor = (origem?.variavel && process.env[origem.variavel]) ?? origem?.padrao;
  if (!valor) throw new Error(`Informe ${descricao} na variável ${origem?.variavel ?? '(sem variável na configuração)'}`);
  return valor;
}

const SENHA = Object.values(config.portais).every((portal) => portal.anonimo)
  ? null : segredo(config.senha, 'a senha das contas de teste');
const PORTAIS = Object.fromEntries(Object.entries(config.portais).map(([nome, portal]) => [nome, {
  base: BASE + (portal.caminho ?? ''),
  anonimo: Boolean(portal.anonimo),
  conta: portal.anonimo ? null : segredo(portal.conta, `a conta do portal ${nome}`),
  login: portal.login,
  armazenamento: portal.armazenamento,
}]));

fs.mkdirSync(pastaDeSaida, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const paginas = {};

async function entrar(portal) {
  if (paginas[portal]) return paginas[portal];
  if (!PORTAIS[portal]) throw new Error(`O portal "${portal}" não está na configuração do projeto`);
  const { base, anonimo, conta, login, armazenamento } = PORTAIS[portal];
  const pagina = await (await browser.newContext({ viewport: JANELA, locale: 'pt-BR' })).newPage();
  if (armazenamento) {
    // O perfil ou cenário da demonstração que o portal precisa (por exemplo, o perfil de administração da plataforma),
    // gravado no localStorage da origem antes do login.
    await pagina.goto(base + (login?.rota ?? '/'));
    await pagina.evaluate((itens) => {
      for (const [chave, valor] of Object.entries(itens)) {
        localStorage.setItem(chave, typeof valor === 'string' ? valor : JSON.stringify(valor));
      }
    }, armazenamento);
  }
  if (anonimo) {
    // Sem login: cada etapa abre a rota dela numa sessão limpa.
    paginas[portal] = pagina;
    return pagina;
  }
  await pagina.goto(base + login.rota);
  await pagina.fill(login.usuario, conta);
  await pagina.fill(login.senha, SENHA);
  await pagina.click(login.entrar);
  await pagina.waitForURL((url) => !url.toString().includes(login.rota), { timeout: 60000 });
  paginas[portal] = pagina;
  return pagina;
}

async function aguardar(pagina) {
  await pagina.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
  await pagina.waitForTimeout(800);
  // O aviso de espera que o sistema mostra nas telas pesadas: a foto só sai depois que ele some.
  if (AGUARDE) await pagina.getByText(AGUARDE).first().waitFor({ state: 'hidden', timeout: 180000 }).catch(() => {});
  await pagina.waitForTimeout(600);
}

function alvo(pagina, marcador) {
  return marcador.seletor
    ? pagina.locator(marcador.seletor).first()
    : pagina.getByText(marcador.texto, { exact: Boolean(marcador.exato) }).first();
}

// MAPA_ETAPAS=a,b refaz só essas etapas e mantém as demais capturas, para ajustar um marcador sem refotografar tudo.
// O índice parte do anterior e se grava a cada tela: se uma etapa cai no meio, as telas já refeitas não se perdem.
const SO = process.env.MAPA_ETAPAS ? new Set(process.env.MAPA_ETAPAS.split(',')) : null;
const anterior = path.join(pastaDeSaida, 'capturas.json');
const resultado = fs.existsSync(anterior)
  ? JSON.parse(fs.readFileSync(anterior, 'utf8'))
  : { janela: JANELA, etapas: {} };
const gravar = () => fs.writeFileSync(anterior, JSON.stringify(resultado, null, 1));
const avisos = [];
const ausentes = [];
const raiaPortal = Object.fromEntries((fluxo.raias ?? config.raias ?? []).map((raia) => [raia.id, raia.portal]));

for (const etapa of fluxo.etapas) {
  if (SO && !SO.has(etapa.id)) continue;
  const portal = raiaPortal[etapa.raia];
  const pagina = await entrar(portal);
  await pagina.goto(PORTAIS[portal].base + etapa.rota, { timeout: 120000 });
  await aguardar(pagina);
  for (const passo of etapa.clicar ?? []) {
    const clicavel = typeof passo === 'string' ? { texto: passo } : passo;
    if (clicavel.escolher) {
      // Lista de opções nativa (<select>): a opção não se clica, escolhe-se pelo texto dela.
      await alvo(pagina, clicavel).selectOption({ label: clicavel.escolher }, { timeout: 30000 });
    } else if (clicavel.preencher !== undefined) {
      // Um campo de busca ou filtro: chega-se à linha certa pelo texto, sem depender da posição na lista.
      await alvo(pagina, clicavel).fill(clicavel.preencher, { timeout: 30000 });
    } else {
      await alvo(pagina, clicavel).click({ timeout: 30000 });
    }
    await aguardar(pagina);
  }
  if (etapa.esperar) {
    await alvo(pagina, typeof etapa.esperar === 'string' ? { texto: etapa.esperar } : etapa.esperar)
      .waitFor({ state: 'visible', timeout: 180000 });
    await aguardar(pagina);
  }
  if (etapa.rolarAte) {
    // A seção vai para o topo da janela: a parte de baixo da tela também se mostra, sem foto da página inteira.
    await alvo(pagina, typeof etapa.rolarAte === 'string' ? { texto: etapa.rolarAte } : etapa.rolarAte)
      .evaluate((no) => no.scrollIntoView({ block: 'start' }));
    await pagina.waitForTimeout(500);
  }
  await pagina.mouse.move(0, 0);
  const imagem = `${etapa.id}.jpg`;
  await pagina.screenshot({ path: path.join(pastaDeSaida, imagem), type: 'jpeg', quality: 82 });

  async function medir(marcador, rotulo, justo = false) {
    let caixa = await alvo(pagina, marcador).boundingBox({ timeout: 5000 }).catch(() => null);
    if (!caixa && (await alvo(pagina, marcador).count()) === 0) {
      ausentes.push(`${etapa.id}: ${rotulo}"${marcador.texto ?? marcador.seletor}" não existe na tela`);
      return { ausente: true };
    }
    if (caixa && justo) {
      // O rótulo de campo ocupa a coluna inteira: a moldura do passo abraça só o texto dele, para o número não cair
      // sobre o campo vizinho.
      const texto = await alvo(pagina, marcador).evaluate((no) => {
        if (no.tagName !== 'LABEL') return null;
        const faixa = document.createRange();
        faixa.selectNodeContents(no);
        const { x, y, width, height } = faixa.getBoundingClientRect();
        return width > 0 ? { x, y, width, height } : null;
      }).catch(() => null);
      if (texto) caixa = texto;
    }
    const visivel = caixa && caixa.y >= 0 && caixa.y + caixa.height <= JANELA.height && caixa.width > 0;
    if (!visivel) {
      avisos.push(`${etapa.id}: ${rotulo}"${marcador.texto ?? marcador.seletor}" ${caixa ? 'fora da janela' : 'escondido'}`);
    }
    return visivel ? {
      x: Math.round(caixa.x), y: Math.round(caixa.y), w: Math.round(caixa.width), h: Math.round(caixa.height),
    } : null;
  }
  // A caixa de cada marcador, ou null quando não há lugar na janela; os ausentes vão à parte, pela posição.
  const medidos = [];
  for (const marcador of etapa.marcadores) medidos.push(await medir(marcador, ''));
  // Os passos do tutorial apontam o que se clica ou preenche: o número do passo vai sobre o alvo na tela.
  const passosMedidos = [];
  for (const passo of etapa.passos ?? []) passosMedidos.push(passo.alvo ? await medir(passo.alvo, 'passo ', true) : null);
  const caixas = (medidas) => medidas.map((medida) => (medida?.ausente ? null : medida));
  const posicoesAusentes = (medidas) => medidas.flatMap((medida, i) => (medida?.ausente ? [i] : []));
  resultado.etapas[etapa.id] = {
    imagem, url: pagina.url().replace(BASE, ''), marcadores: caixas(medidos), passos: caixas(passosMedidos),
    marcadoresAusentes: posicoesAusentes(medidos), passosAusentes: posicoesAusentes(passosMedidos),
  };
  gravar();
  console.log(`ok ${etapa.id}`);
}

await browser.close();
// A captura completa tira do índice as etapas que saíram do fluxo.
if (!SO) {
  const atuais = new Set(fluxo.etapas.map((etapa) => etapa.id));
  for (const id of Object.keys(resultado.etapas)) if (!atuais.has(id)) delete resultado.etapas[id];
}
gravar();
for (const aviso of avisos) console.warn(`aviso: ${aviso}`);
if (ausentes.length) {
  console.error(`erro: ${ausentes.length} elemento(s) não existe(m) na tela — ajuste o texto ou o seletor no fluxo:`);
  for (const ausente of ausentes) console.error(`  ${ausente}`);
  process.exitCode = 1;
}
