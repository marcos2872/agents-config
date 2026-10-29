---
name: mapa-de-requisitos
description: Gera e reprocessa o mapa de requisitos de um módulo para apresentar ao cliente — um HTML único (docs/diagramas/mapa-<módulo>.html) com a jornada em raias por ator, cada etapa ilustrada com a tela real do sistema e pontos ligados aos RFs — e, sobre os mesmos fluxos, os guias do usuário em PDF (casos de uso com o passo a passo tela a tela). Use quando pedirem para apresentar, ilustrar ou mapear os requisitos com as telas, regenerar o mapa depois de um comitê ou de mudança nas telas, montar o mapa de outro módulo, gerar ou atualizar o tutorial/guia do usuário, ou levar o mapa para outro projeto.
---

# mapa-de-requisitos

Pipeline **fluxo curado + telas reais + requisitos → página navegável**, no mesmo molde da planta do banco
(`er-diagram-generator`): o que pede julgamento fica num JSON curado, e o resto é código determinístico.

```
<projeto>/.agents/mapa-de-requisitos/config.json ─────┐  (sistema, login, formato dos requisitos, cores)
<projeto>/.agents/mapa-de-requisitos/fluxos/<m>.json ─┼─[build.py]──▶ docs/diagramas/mapa-<m>.html
sistema no ar ──────────────[capturar.mjs]────────────┤
documento de requisitos (Markdown) ─[extrair_rfs.py]──┘
```

## Mecanismo × projeto

> **Pasta da skill.** No OpenCode esta skill fica em `~/.config/opencode/skills/mapa-de-requisitos/` (o runtime informa o caminho em
> *Base directory for this skill*). Os comandos abaixo já usam esse caminho; se o `opencode/` for sincronizado em
> outro destino, ajuste para `<destino>/skills/mapa-de-requisitos`.


| Onde | O quê | Muda de projeto para projeto? |
|---|---|---|
| a pasta da skill | scripts, modelo da página, modelo da configuração, este guia | não — é o que se extrai para reutilizar |
| `.agents/mapa-de-requisitos/config.json` | endereço do sistema, portais e login, aviso de carregamento, formato dos requisitos, filtro do texto, cores | sim |
| `.agents/mapa-de-requisitos/fluxos/` | a jornada de cada módulo | sim |
| `.agents/mapa-de-requisitos/capturas/` | as telas fotografadas (fora do git; vão embutidas no HTML) | sim |

A raiz do projeto é a pasta, a partir da atual e sem passar da raiz do git, que tem `.agents/mapa-de-requisitos/`;
sem ela (antes do `--iniciar`), a raiz do repositório git. `MAPA_RAIZ` sobrescreve; `MAPA_DADOS` aponta outra
pasta de dados. O mecanismo não conhece o projeto: nenhum nome, portal ou formato está no código.

## Como executar

De qualquer pasta do repositório:

```bash
S=~/.config/opencode/skills/mapa-de-requisitos/scripts                 # copiada no projeto: .agents/skills/mapa-de-requisitos/scripts
python3 $S/build.py --iniciar                        # uma vez por projeto: cria a configuração a partir do modelo
python3 $S/build.py modulo-a                         # remonta o HTML com as telas já capturadas
python3 $S/build.py modulo-a --capturar              # fotografa todas as telas de novo e monta
python3 $S/build.py modulo-a --capturar --etapas cadastro,lista   # refaz só essas telas
python3 $S/build.py modulo-b --novo --fonte docs/requisitos/modulo-b-pedidos.md --nome Pedidos
```

`--novo` cria o esqueleto do fluxo: fonte, saída, grupos tirados do documento, as raias da configuração, nenhuma etapa
e todos os RFs em "Ainda não ilustrado na jornada". O mapa já sai, só com a aba Requisitos; a jornada se preenche
depois, e cada RF posto num marcador sai da lista de fora.

O índice das capturas (`capturas.json`) se grava a cada tela: se uma etapa cai no meio (o sistema reiniciou, um dado
sumiu), as telas já refeitas ficam, e basta repetir com `--etapas` as que faltaram.

Captura: o sistema no ar, o Chrome instalado (o `playwright-core` usa o navegador da máquina; na primeira vez, o
`npm install` roda sozinho em `~/.cache/skill-kit/mapa-de-requisitos/node`, ou vale o `scripts/node_modules` se já
existir) e as contas de teste. Senha e contas vêm das variáveis de ambiente que a
configuração nomeia (`senha.variavel`, `portais.*.conta.variavel`); um `padrao` na configuração só é aceitável para
conta de teste. `MAPA_BASE` sobrescreve o endereço e `CHROME` o executável.

## O contrato: todo RF do módulo tem destino

O `build.py` **falha** quando um RF do módulo não está em nenhum marcador da jornada **nem** em `fora_da_jornada`,
listando os que faltam. É o equivalente da tabela sem domínio na planta do banco: o RF novo de um comitê pede uma
decisão — entra numa tela ou fica só na aba Requisitos, com o motivo. Também falha quando um marcador cita RF que não
existe no módulo, quando o mesmo RF está na jornada e fora dela, sem configuração e com o filtro configurado mas
ausente.

## A configuração (`config.json`)

| Campo | O que é |
|---|---|
| `rotulo`, `marca` | o nome no topo da página e a cor de destaque |
| `base`, `janela` | o endereço do sistema e o tamanho da janela das capturas |
| `aguarde` | expressão do aviso de carregamento que o sistema mostra nas telas pesadas (a captura espera ele sumir) |
| `senha`, `portais` | cada portal com `caminho`, `conta` e `login` (`rota` e os seletores de usuário, senha e entrar) |
| `raias` | os atores padrão dos fluxos novos: `id`, `nome`, `portal`, `cor` |
| `requisitos` | o leitor (`markdown-headings` ou `markdown-details`), as expressões que ele usa, o mapeamento dos nomes dos campos e a `matriz` de status (opcional) |
| `filtro` | o `padroes.py` que tira referências internas do texto que vai ao cliente (opcional; `MAPA_FILTRO` sobrescreve) |

Dois leitores vêm prontos em `extrair_rfs.py`:

- `markdown-headings` (o padrão do modelo): o formato de `docs/requisitos/_template-modulo.md`, com cada requisito
  num título próprio (`##### RF#A01 — Título #tags`) seguido da lista `- **Campo:** valor`. A expressão
  `requisito` acha o título (grupos `codigo` e `titulo`), e `grupo` acha o assunto que agrupa a aba Requisitos (a
  entidade `### E – Nome` e a seção `## Requisitos Não Funcionais`). Os campos do modelo vão para a página assim:
  Descrição → objetivo, Ator → atores, Fluxo principal → fluxo, Critérios de aceitação → regras, Core → core.
- `markdown-details`: requisitos escritos como `<details id="rf…"><summary>…(RF#X01)</summary>` com uma tabela
  `| **Campo** | valor |`, com as expressões `bloco`, `codigo`, `prefixo_do_titulo` e `grupo`.

Outro formato de Markdown entra como uma função nova em `LEITORES`, devolvendo o mesmo dicionário.

A `matriz` (opcional) é uma tabela Markdown `| RF | Título | Levantamento | Implementação |`; quando existe, o status
de cada RF aparece na página.

## O fluxo (`fluxos/<módulo>.json`)

| Campo | O que é |
|---|---|
| `modulo`, `titulo`, `descricao` | o cabeçalho da página |
| `fonte`, `saida` | o documento dos requisitos e o HTML gerado, relativos à raiz |
| `grupos` | nome de exibição de cada grupo do documento (agrupa a aba Requisitos) |
| `raias` | os atores, na ordem das linhas: `id`, `nome`, `portal`, `cor` |
| `fases` | os blocos da jornada, na ordem |
| `etapas` | uma por tela, na ordem do trabalho — ver abaixo |
| `fora_da_jornada` | motivo → RFs que ficam só na aba Requisitos (o texto antes dos dois-pontos vira o selo) |
| `fora_do_mapa` | motivo → RFs que saem da página inteira, também da aba Requisitos (o motivo fica só no fluxo) |

Cada etapa: `id`, `fase`, `raia`, `titulo`, `resumo`, `rota` e, para chegar à tela:

- `clicar`: textos (ou `{"texto", "exato"}`, ou `{"seletor"}`) clicados em sequência depois da rota; numa lista de opções nativa (`<select>`), `{"seletor", "escolher": "<texto da opção>"}` escolhe a opção, e num campo, `{"seletor", "preencher": "<texto>"}` o preenche (um filtro, por exemplo);
- `esperar`: um elemento que só existe quando a tela terminou de carregar;
- `rolarAte`: a seção que vai para o topo da janela, para mostrar a parte de baixo da tela.

Cada marcador: `texto` (com `exato` opcional) ou `seletor` do Playwright, `rotulo` e `rfs`. **Sempre pelo texto da
tela, nunca por id**: os dados de demonstração são regenerados e os ids mudam. Marcador cujo elemento **não existe** na
tela é erro: a tela mudou e o fluxo quebrou; a captura lista todos no fim e termina com falha, e o build não monta o
mapa enquanto houver um. Elemento que existe, mas fica fora da janela (abaixo da dobra) ou escondido, vira aviso, e o
mapa o lista sem o ponto na tela.

## O que a página tem

- **Jornada** — uma linha por ator, as etapas da esquerda para a direita, agrupadas por fase; arrasta-se com o mouse,
  e os botões de fase levam ao início de cada uma.
- **Tela** — a captura com pontos numerados, inteira na altura da janela; cada ponto lista os RFs que ilustra.
- **Requisito** — a gaveta com objetivo, atores, fluxo do usuário, regras de negócio e as etapas onde o RF aparece.
- **Requisitos** — todos os RFs e RNFs do módulo, por assunto, com a etapa ou o motivo de estarem fora; busca.
- **Apresentar** — tela cheia, etapa a etapa pelas setas do teclado.
- O endereço guarda a visão (`#etapa/<id>`, `#requisitos`).

## Quando reprocessar

- **Depois de um comitê**: `build.py <módulo>`. Se aparecer RF sem destino, decida e registre.
- **Depois de mudar as telas** (rebuild dos contêineres): `--capturar`. Corrija no fluxo os marcadores que não existem
  mais (erro) e confira os avisos de marcador fora da janela.
- **Outro módulo**: `--novo` e, depois, a curadoria da jornada (ler os requisitos e as telas do módulo, montar fases,
  etapas e marcadores, capturar e conferir as telas).

## O guia do usuário (tutorial em PDF)

Os mesmos fluxos e capturas geram um guia por perfil: os casos de uso, cada um com as telas na ordem do trabalho, os
números sobre a tela e o passo a passo logo abaixo. O PDF sai pelo Chrome da captura (`imprimir.mjs`), A4 em retrato,
com capa, sumário com links, marcadores do leitor e rodapé paginado.

```bash
S=~/.config/opencode/skills/mapa-de-requisitos/scripts                 # copiada no projeto: .agents/skills/mapa-de-requisitos/scripts
python3 $S/tutorial.py usuario              # monta o PDF com as capturas que já existem
python3 $S/tutorial.py usuario --capturar   # fotografa de novo só as telas que o guia usa
python3 $S/tutorial.py fornecedor                 # o guia do portal do fornecedor
```

- **O guia** (`tutoriais/<guia>.json`): `titulo`, `subtitulo`, `publico`, `logo`, `saida`, `apresentacao` (parágrafos),
  `portais` (os do perfil: etapa de outro portal é recusada), `cortar_a_esquerda` (px da tela que não entram, o menu
  lateral; a etapa com `"tela_inteira": true` no fluxo sai sem corte) e `secoes` → `casos` → `titulo`, `objetivo`, `etapas` (`"<fluxo>/<etapa>"`, na ordem) e `resultado`.
- **Os passos** ficam na etapa do fluxo (`passos`), para servir a qualquer guia: cada um com o `texto` (`**negrito**`
  para botão, campo e menu) e, opcionalmente, o `alvo` na tela — texto ou seletor, como os marcadores. O número do passo
  vai ao lado do alvo; passo sem alvo (o item do menu lateral, por exemplo) sai com o número vazado. Os rótulos de campo
  com asterisco se apontam por `label:has-text('…')`; num `<label>`, a moldura do passo abraça só o texto, para o
  número não cair sobre o campo vizinho.
- **O contrato** é outro que o do mapa: falha quando o caso de uso não tem etapa, a etapa não existe, não tem captura ou
  não tem passos, a captura é anterior aos passos, a etapa é de um portal que o perfil não usa, ou um texto cai no
  filtro do texto que vai ao cliente, ou o alvo de um passo não existe na tela. Alvo que existe, mas fica fora da
  janela ou escondido, é aviso.
- Uma etapa só para o guia (um formulário rolado até o botão final, uma gaveta aberta por `clicar`) entra no fluxo como
  qualquer outra e aparece também no mapa.
- O HTML intermediário fica em `capturas/tutorial-<guia>.html` (ignorado), útil para conferir no navegador.

## Levar para outro projeto

1. Projeto só seu: instale o plugin `diagramas@skill-kit`. Projeto em equipe: copie a skill para
   `.agents/skills/` com o `instalar.sh` do skill-kit e versione-a no projeto.
2. Na raiz do novo projeto: `python3 $S/build.py --iniciar` — cria
   `.agents/mapa-de-requisitos/config.json` a partir de `config.modelo.json` e o `.gitignore` das capturas.
3. Ajuste a configuração: endereço, portais e login, o formato dos requisitos (as expressões e os nomes dos campos),
   o filtro (ou nenhum) e as cores.
4. `build.py <módulo> --novo --fonte <documento>` e siga com a curadoria.

Se o sistema usar SSO ou segundo fator, o login automático não funciona como está: será preciso reaproveitar uma
sessão salva do navegador na captura.

## Cuidados

- Rótulos e resumos vão ao cliente: sem ADR, comitê, POC nem siglas internas. Se o projeto tiver um verificador de
  referências internas, aponte o `padroes.py` dele em `filtro` (ele precisa expor `RESIDUO`, `PARENTESE`,
  `ITEM_PURO` e `TEM_REF`): as linhas com referência saem do texto, e o build falha se sobrar alguma.
- A captura mostra o que o sistema no ar está rodando e os dados de demonstração: nomes de teste aparecem nas telas.
- A senha e as contas ficam em variáveis de ambiente. Um `padrao` na configuração só serve para conta de teste.
- `capturas/` fica fora do git (o `--iniciar` cria o `.gitignore`): as telas vão embutidas no HTML gerado.
