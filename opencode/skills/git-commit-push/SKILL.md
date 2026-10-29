---
name: git-commit-push
description: "Sincroniza a branch local com o remoto (fetch/pull, com tratamento de rebase e divergência), analisa mudanças staged/unstaged do Git, gera um resumo e uma descrição no padrão Conventional Commits, executa o commit, faz push para o repositório remoto e, opcionalmente, cria um Pull Request no GitHub. Use quando: puxar ou sincronizar com o remoto, atualizar a branch antes do trabalho, rebasear sobre a branch base, resolver uma branch divergente, commitar código, gerar mensagens de commit, fazer push para o Git, criar mensagens conventional commit a partir de diffs, salvar alterações, preparar um commit Git com resumo e corpo, abrir um pull request, criar um PR após o push."
argument-hint: "Opcionalmente especifique: 'pull'/'sync' para apenas atualizar a partir do remoto, '--rebase' ou '--merge' para forçar a estratégia de integração, substituição do tipo de commit (feat, fix, refactor…), substituição de escopo (pedido, api, requisitos…), branch de destino, ou '--pr' para também criar um Pull Request"
---

# Sincronização, Commit, Push e Pull Request no Git — Gerador de Conventional Commits

Sincronize a branch local com o remoto (`git fetch` / `git pull`, tratando divergência e conflitos de rebase), analise o working tree atual do Git (mudanças staged e unstaged), gere uma mensagem de commit bem estruturada seguindo a especificação **Conventional Commits**, execute `git commit`, `git push` para o repositório remoto e, opcionalmente, crie um **Pull Request no GitHub** via CLI `gh`.

## Quando usar

- Antes de começar o trabalho, para atualizar a branch local com os commits mais recentes do remoto
- Quando um push foi rejeitado porque a branch **divergiu** do remoto
- Quando você precisa rebasear uma branch de feature sobre sua branch base (`dev`)
- Depois de fazer mudanças de código que precisam ser commitadas e enviadas
- Quando você quer uma mensagem de commit conventional automatizada e bem elaborada, derivada do diff real
- Quando você quer commitar, fazer push **e abrir um Pull Request** em um único fluxo
- Antes de uma revisão de código, para garantir um histórico de commits limpo com mensagens significativas
- Sempre que o usuário disser "pull", "sync", "update my branch", "rebase", "commit", "push", "save my changes", "create a PR", "open a pull request" ou similar

## Modos de operação

Esta skill opera em um de três modos — infira-o a partir do pedido do usuário:

| Modo | Gatilho | Etapas executadas |
|------|---------|-------------------|
| **Somente sync** | "pull", "sync", "update my branch", "rebase onto dev" | Somente a Etapa 0 |
| **Fluxo de commit** | "commit", "push", "save my changes" | Etapas 1–9 (Etapa 0 opcional, veja 0a) |
| **Fluxo completo** | "commit and open a PR", `--pr` | Etapas 1–11 |

No modo *Somente sync*, **não** faça staging, commit nem push de nada. Relate o resultado da sincronização e pare.

## Entradas

| Entrada | Obrigatório | Padrão | Exemplo |
|---------|-------------|--------|---------|
| Sincronizar antes do commit | Não | `false` (perguntar se a branch estiver atrás) | `true` |
| Estratégia de integração | Não | conforme 0d (`git config pull.rebase` decide um pull puro) | `rebase`, `merge`, `ff-only` |
| Branch de origem da sincronização | Não | upstream da branch atual | `origin/dev` |
| Autostash na sincronização | Não | perguntar se o working tree estiver sujo | `true` |
| Nome da branch | Não | branch atual | `feat/new-upload` |
| Substituição do tipo de commit | Não | detectado automaticamente a partir do diff | `feat`, `fix`, `refactor` |
| Substituição de escopo | Não | detectado automaticamente a partir do diff | `pedido`, `api`, `requisitos` |
| Push após o commit | Não | `true` | `false` |
| Amend no último commit | Não | `false` | `true` |
| Contexto adicional | Não | — | `"Isto corrige o bug de timeout do login"` |
| Criar Pull Request | Não | `false` (perguntar se o usuário mencionar PR) | `true` |
| Branch base do PR | Não | da estratégia de branching do projeto (`AGENTS.md`), senão `dev` | `dev`, `main` |
| Revisores do PR | Não | — | `username1,username2` |
| Labels do PR | Não | detectados automaticamente a partir do tipo | `enhancement`, `bug` |
| Rascunho do PR | Não | `false` | `true` |

## Especificação Conventional Commits

Esta skill segue a [Conventional Commits v1.0.0](https://www.conventionalcommits.org/). Se o projeto tiver uma config de `commitlint` (`commitlint.config.*`), siga-a também, e verifique se o hook dela realmente roda (`git config core.hooksPath`, `.husky/`): uma config que só roda dentro de um subprojeto não protege commits feitos na raiz, então confira o formato manualmente.

**Idioma:** o resumo e o corpo são escritos em **português**, com acentuação completa, como o resto do histórico do projeto. Só o tipo, o escopo e os trailers permanecem como estão (`feat`, `fix(api)`, `Co-Authored-By:`). Antes de escrever, leia `git log --format=%B -10` para acompanhar o tom atual. Se o `AGENTS.md` do projeto define outras regras para commits (idioma, escopos, trailers), elas prevalecem sobre este guia.

### Formato da mensagem

```
<type>(<scope>): <summary>
                                        ← blank line
<body>
                                        ← blank line
<footer(s)>
```

### Tipos permitidos

| Tipo | Quando usar |
|------|-------------|
| `feat` | Uma nova funcionalidade ou capacidade |
| `fix` | Correção de bug |
| `refactor` | Reestruturação de código sem mudança de comportamento |
| `docs` | Mudanças apenas em documentação |
| `style` | Formatação, espaços em branco — sem mudança de lógica |
| `test` | Adição ou atualização de testes |
| `chore` | Ferramental, configs, atualização de dependências |
| `ci` | Mudanças no pipeline de CI/CD (GitHub Actions, Docker, Nginx) |
| `perf` | Melhorias de performance |
| `build` | Mudanças no sistema de build ou em dependências externas |
| `revert` | Reversão de um commit anterior |

### Detecção de escopo

O escopo é um nome curto em português, minúsculo, kebab-case, sem acentos. Escolha-o nesta ordem:

1. **Domínio de negócio** de que a mudança trata, qualquer que seja a camada (backend, tela, migração, seed): o escopo mais comum
   em um histórico orientado a domínio. Reutilize um nome existente antes de inventar um — liste-os com
   `git log --format=%s | grep -oE '^[a-z]+\([^)]*\)' | sort | uniq -c | sort -rn | head -40`. Use o singular quando
   ambas as formas existirem, e as palavras de domínio dos requisitos, não nomes de classe.
2. **Serviço ou área**, quando nenhum domínio único se encaixa: o serviço como o `AGENTS.md` do projeto o nomeia (por exemplo
   `api`, `functions`, `frontend`, `portal`), ou a área — `seed` (seeders), `infra` (compose, scripts da raiz, proxy),
   `ci` (workflows), `skills` (`.agents/`), `database`.
3. **Documentação** (tipo `docs`), por pasta ou propósito em `docs/`: `requisitos`, `comite`, `adrs`, `diagramas`,
   `relatorios`, `reunioes`, `specs`…

Uma migração não ganha escopo próprio: ela assume o escopo do domínio que atende (`feat(fechamento): …`).

**Omita o escopo** quando o commit toca vários domínios não relacionados (`fix: pendências vistas nos guias do usuário …`).

### Regras da linha de resumo

- **Português**, descrevendo o comportamento como ele fica depois do commit, no tempo presente — a regra ou o resultado,
  não a ação do desenvolvedor:
  - ✅ `fix(api): pedido com id inválido responde 422, e não 500`
  - ✅ `fix(pedido): duplicar o pedido copia só os itens ativos`
  - ❌ `fix(api): corrige erro no pedido` / ❌ `fix(api): add 422 handling`
- **Minúscula** na primeira palavra depois dos dois-pontos, exceto nomes próprios, siglas e rótulos de tela (`ADR-12`, `CPF`,
  `"Salvar rascunho"`).
- **Sem ponto final.**
- Busque **≤ 100 caracteres** na primeira linha inteira (o limite do `config-conventional`). Uma linha mais longa é aceitável
  apenas quando encurtá-la esconderia o que mudou; mova o detalhe para o corpo primeiro.
- Seja específico: cite a tela, entidade ou rota e o efeito, usando as palavras de domínio dos requisitos (pedido,
  fatura, contrato…), não os nomes de classe.

### Regras do corpo

- Separado do resumo por **uma linha em branco**; português; linhas quebradas em cerca de **100–120 caracteres**.
- Opcional para um resumo autoexplicativo (`fix(api): … responde 422, e não 500` dispensa corpo).
- Explique **o que estava errado ou faltando e por que a mudança está certa**, em prosa direta — o diff mostra o como. Um parágrafo curto
  é a norma:
  ```
  A consulta do total juntava os itens do pedido às parcelas de pagamento. Como cada item tem uma
  parcela por mês, o item se repetia uma vez por mês e a soma das quantidades saía multiplicada pelo
  número de parcelas. As parcelas passam a sair de uma subconsulta.
  ```
- Para várias mudanças independentes, use uma lista com `-`, cada item terminando em `;` e o último em `.`.
- Códigos de requisito, ADRs e seções de changelog podem ser citados nos commits (`docs: ADR-12 e changelog §8 — …`): uma
  regra do projeto contra referências internas no código entregue não se aplica ao histórico do git.

### Regras do rodapé

- `BREAKING CHANGE: <descrição>` para mudanças não retrocompatíveis em uma API pública ou DTO compartilhado (marque também o
  resumo com `!`: `feat(api)!: …`). Se uma mudança de banco quebra compatibilidade, isso depende do projeto: se o `AGENTS.md` dele
  diz que os bancos guardam apenas dados de teste recriados a partir de seeds, não quebra.
- `Refs: #<issue>` para issues relacionadas ou work items do Azure DevOps.
- Os trailers de atribuição que o harness pede (ex.: `Co-Authored-By: Claude … <noreply@anthropic.com>`) vão por último.

## Procedimento

### Etapa 0 — Sincronizar com o remoto (Pull / Rebase)

Roda isoladamente no modo *Somente sync*, ou como verificação prévia antes do fluxo de commit.

#### 0a — Quando executar

| Situação | Ação |
|-----------|--------|
| O usuário pediu "pull", "sync", "update", "rebase" | Rodar a Etapa 0 e parar (modo Somente sync) |
| Fluxo de commit e a branch está **atrás** do remoto | **Perguntar ao usuário** se deve sincronizar primeiro |
| Fluxo de commit e a branch está **atualizada** ou **somente à frente** | Pular a Etapa 0 |
| Push foi rejeitado como non-fast-forward (Etapa 9.3) | Rodar a Etapa 0 com `rebase` e tentar o push novamente |

#### 0b — Inspecionar antes de mexer em qualquer coisa

Sempre faça `fetch` primeiro — ele é somente leitura e nunca modifica o working tree:

```bash
git fetch --prune origin
```

Depois, monte o quadro:

```bash
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null   # upstream, if any
git status --short --branch                                        # dirty files + ahead/behind
git rev-list --left-right --count @{u}...HEAD                      # "<behind>  <ahead>"
```

Leia as contagens do `rev-list` como `behind  ahead` e classifique:

| Behind | Ahead | Estado | Significado |
|--------|-------|-------|---------|
| 0 | 0 | **Atualizada** | Nada a fazer — relate e pare |
| >0 | 0 | **Atrás** | Fast-forward é seguro |
| 0 | >0 | **À frente** | Nada a puxar; commits aguardando push |
| >0 | >0 | **Divergente** | Exige uma decisão de estratégia — veja 0e |

**Condições de parada:**
- **Sem upstream configurado** → a branch existe apenas localmente. Relate e ofereça `git push -u origin <branch>` (não faça pull). Pare.
- **HEAD desanexado (detached HEAD)** → avise e sugira `git checkout -b <name>`. Pare.
- **Rebase/merge já em andamento** (`.git/rebase-merge`, `.git/rebase-apply` ou `MERGE_HEAD` existe) → não inicie uma nova operação. Relate o estado em andamento e os comandos de resolução do 0g. Pare.

#### 0c — Lidar com um working tree sujo

Um pull com mudanças não commitadas pode abortar no meio ou deixar conflitos no trabalho não versionado. Se `git status --short` não estiver vazio:

**Pergunte ao usuário** o que fazer — nunca escolha em silêncio:

| Opção | Comando | Quando se aplica |
|--------|---------|--------------|
| Commitar primeiro | Rodar as Etapas 1–8 e então voltar à Etapa 0 | As mudanças estão completas e coerentes |
| Autostash | `git pull --rebase --autostash` | Pequenas edições em andamento |
| Stash manual | `git stash push -u -m "pre-pull <date>"` → pull → `git stash pop` | Você quer controle explícito sobre a restauração |
| Abortar | — | O usuário prefere resolver manualmente |

Com autostash ou stash manual, **sempre confirme que o stash foi restaurado** depois:

```bash
git stash list        # a entrada pré-pull não deve mais aparecer depois do pop
git status --short    # alterações de volta na working tree
```

Se o `git stash pop` der conflito, o stash é **mantido** — avise o usuário de que ele continua em `git stash list` e precisa ser resolvido antes de descartá-lo.

#### 0d — Escolher a estratégia de integração

Verifique `git config pull.rebase`: quando não está definido, um `git pull` puro faz um **merge**. Seja explícito em vez de confiar no padrão:

| Estratégia | Comando | Usar quando |
|----------|---------|----------|
| **Somente fast-forward** | `git pull --ff-only` | A branch está atrás e sem commits locais — mais seguro, falha explicitamente em vez de criar merges inesperados |
| **Rebase** | `git pull --rebase` | Commits locais divergentes **não enviados** — mantém o histórico linear, preferível para branches `feat/*`, `fix/*`, `us*` |
| **Merge** | `git pull --no-rebase` | Commits divergentes que **já foram enviados** ou branch compartilhada com outras pessoas |

**Regra de decisão padrão:**

1. Sem divergência → `--ff-only`.
2. Divergente e commits locais **não** estão em nenhum remoto → `--rebase`.
3. Divergente e commits locais **já** estão em um remoto (ou a branch é compartilhada) → `--no-rebase` (merge), porque rebasear reescreve histórico publicado.

Verifique se os commits locais já foram publicados antes de escolher rebase:

```bash
git log --oneline @{u}..HEAD                    # commits apenas locais
git branch -r --contains <sha>                  # vazio ⇒ nunca publicados ⇒ rebase é seguro
```

Se o usuário passou `--rebase` ou `--merge` explicitamente, respeite — mas, se isso reescrever histórico publicado, avise uma vez e deixe que ele confirme.

#### 0e — Executar a sincronização

```bash
git pull --ff-only                 # ou --rebase / --no-rebase conforme 0d
```

Rebasear uma branch de feature sobre sua **branch base** (não sobre o próprio upstream) é uma operação diferente — use-a quando o usuário disser "rebase onto dev":

```bash
git fetch origin dev
git rebase origin/dev
```

#### 0f — Verificar

```bash
git status --short --branch
git log --oneline -5
git rev-list --left-right --count @{u}...HEAD
```

Esperado após uma sincronização bem-sucedida: behind = 0 e um working tree limpo (a menos que um stash tenha sido deixado de propósito).

#### 0g — Tratamento de conflitos

**Durante um rebase** — o Git para no primeiro commit com conflito:

1. Liste os conflitos: `git status --short` (procure os marcadores `UU`, `AA`, `DU`, `UD`) ou `git diff --name-only --diff-filter=U`.
2. **Não resolva conflitos automaticamente.** Apresente os arquivos em conflito ao usuário e deixe que ele decida, a menos que ele tenha pedido explicitamente para você resolver.
3. Explique as saídas disponíveis:

   | Comando | Efeito |
   |---------|--------|
   | resolver os arquivos → `git add <files>` → `git rebase --continue` | Continuar com a resolução |
   | `git rebase --skip` | Descartar o commit em conflito — **destrutivo**, confirme antes |
   | `git rebase --abort` | Voltar ao estado anterior ao rebase — sempre seguro |

4. Durante um rebase, "ours" e "theirs" ficam **invertidos** em relação a um merge: `--ours` é a branch upstream sobre a qual se está reaplicando, `--theirs` é o seu commit. Diga isso explicitamente sempre que sugerir `git checkout --ours/--theirs`.

**Durante um merge:** resolva → `git add <files>` → `git commit` (o Git fornece a mensagem de merge), ou `git merge --abort` para desfazer.

**Se o rebase der errado depois de concluído:** `git reflog` mostra o HEAD anterior ao rebase, recuperável com `git reset --hard <sha>`. Mencione isso como válvula de escape — nunca rode `reset --hard` sem confirmação explícita do usuário.

#### 0h — Relatar a sincronização

```
✅ Sincronizado com o remoto

  Branch:       dev
  Remoto:       origin/dev
  Estratégia:   fast-forward
  Recebidos:    3 commits (7fe7dcf..a1b2c3d)
  Arquivos:     12 arquivos alterados, 340 inserções(+), 58 remoções(-)
  Working tree: limpa
```

Quando nada mudou, diga isso claramente — `Already up to date` — e mencione quaisquer branches remotas novas que o `--prune` revelou, já que muitas vezes esse é o único sinal útil.

No modo *Somente sync*, **pare aqui.**

### Etapa 1 — Avaliar o estado do repositório

Rode os três comandos para montar um quadro completo:

1. `git status` — identifique arquivos staged, modificações unstaged, arquivos não rastreados e quaisquer conflitos de merge.
2. `git branch --show-current` — identifique a branch ativa.
3. `git log --oneline -5` — histórico recente de commits para continuidade contextual.

**Condições de parada:**
- Se o working tree estiver completamente limpo → informe ao usuário: *"Nada para commitar — o working tree está limpo."* e pare.
- Se houver **conflitos de merge** → liste os arquivos em conflito e instrua o usuário a resolvê-los antes de commitar. Pare.
- Se estiver em **HEAD desanexado** → avise o usuário e sugira `git checkout -b <name>` antes de prosseguir.

### Etapa 2 — Fazer staging dos arquivos

Decida o que colocar em staging:

| Cenário | Ação |
|----------|--------|
| O usuário disse "commit everything" / "commit all" | `git add -A` |
| Já existem arquivos staged e nada mais mudou | Prosseguir com o staging atual |
| Existem arquivos unstaged/não rastreados | **Perguntar ao usuário**: fazer staging de tudo (`git add -A`), de arquivos específicos, ou prosseguir apenas com os arquivos já staged |

Após o staging, rode `git diff --cached --name-only` para confirmar a lista final de arquivos staged.

### Etapa 3 — Analisar o diff

1. Rode `git diff --cached --stat` — resumo de alto nível: arquivos alterados, inserções (+), exclusões (-).
2. Rode `git diff --cached` — diff completo de todas as mudanças staged.
3. **Se o diff passar de ~500 linhas**, analise de forma incremental:
   - Use a saída de `--stat` para identificar os arquivos
   - Rode `git diff --cached -- <file>` para cada arquivo importante
   - Priorize arquivos de lógica de negócio sobre arquivos gerados automaticamente ou de config
4. Para **cada arquivo alterado**, extraia:
   - **O que** mudou (nova classe, método modificado, novo componente, arquivo removido, mudança de config, migração etc.)
   - **Por que** mudou (nova feature, correção de bug, refactor, atualização de dependência etc.)
   - **A qual serviço/domínio** pertence (usando o mapa de caminho→escopo)

### Etapa 4 — Determinar o tipo e o escopo do commit

#### 4a — Detectar o tipo automaticamente

Aplique estas heurísticas **em ordem de prioridade** (a primeira correspondência vence):

| Prioridade | Sinal | Tipo |
|----------|--------|------|
| 1 | `revert` no nome da branch ou na instrução do usuário | `revert` |
| 2 | Novos arquivos com lógica de negócio, endpoints, componentes, migrações | `feat` |
| 3 | Mudanças que corrigem defeitos, checagens de null, tratamento de erro, comportamento errado | `fix` |
| 4 | Mudanças estruturais sem diferença de comportamento | `refactor` |
| 5 | Apenas arquivos de teste (`*Test.java`, `*.test.ts`, `*.spec.ts`) | `test` |
| 6 | Apenas documentação (`.md`, Javadoc, comentários, anotações Swagger) | `docs` |
| 7 | Apenas CI/CD (`.github/workflows/`, `Dockerfile`, `docker-compose*`) | `ci` |
| 8 | Apenas build/config (`build.gradle`, `package.json`, `next.config`, `tsconfig`) | `build` |
| 9 | Apenas formatação, espaços em branco, ponto e vírgula, ordenação de imports | `style` |
| 10 | Cache, otimização de consulta, lazy loading, memoização | `perf` |
| 11 | Atualizações de dependência, ferramental, `.gitignore`, config de lint | `chore` |

#### 4b — Detectar o escopo automaticamente

Siga a ordem de "Detecção de escopo": domínio de negócio primeiro, depois serviço ou área, depois a pasta de documentação.

#### 4c — Substituição

Se o usuário forneceu um tipo ou escopo explicitamente, use o valor dele.

#### 4d — Múltiplos escopos

Se as mudanças abrangem 3 ou mais domínios não relacionados → omita o escopo por completo: `fix: pendências vistas na revisão das telas (formulários, seeders e healthcheck)`.

### Etapa 5 — Verificar mudanças não relacionadas (sugestão de divisão)

Se o diff contém **mudanças lógicas claramente não relacionadas** (por exemplo, uma correção de bug em `api/service/auth/` E uma nova feature em `frontend/src/features/orders/`):

1. **Sugira dividir** em commits separados para um histórico mais limpo.
2. Apresente um plano de divisão proposto:
   ```
   Commit 1: fix(auth): sessão expirada renova o token em vez de deslogar
     - api/src/.../service/auth/TokenService.java
   
   Commit 2: feat(pedido): totais do pedido em gráfico na tela de acompanhamento
     - frontend/src/features/orders/components/TotalsChart.tsx
     - frontend/src/features/orders/services/orders.hooks.ts
   ```
3. **Pergunte ao usuário** se deve dividir ou commitar tudo junto. Se for junto, resuma a intenção geral em uma única mensagem.

### Etapa 6 — Gerar a mensagem de commit

#### 6a — Linha de resumo

```
<type>(<scope>): <comportamento depois do commit, em português>
```

Exemplos:
- `fix(api): total do pedido soma as quantidades sem multiplicar pelas parcelas`
- `feat(pedido): acompanhamento mostra o desconto aplicado por fornecedor`
- `refactor(pedido): consultas da lista deixam de filtrar a linha excluída em SQL puro`
- `docs(requisitos): módulo de pedidos com as regras de cancelamento revistas`
- `chore(scripts): remove as ferramentas de migração de dados, já concluída`

#### 6b — Corpo

**Uma mudança:**
```
<O que estava errado ou faltava, e por que a mudança resolve — um parágrafo curto.>
```

**Várias mudanças independentes:**
```
<Motivação geral, uma ou duas frases.>

- <mudança 1>;
- <mudança 2>;
- <mudança 3>.
```

**Com uma migração:** nomeie o arquivo e o que ele muda no schema. Se o `AGENTS.md` do projeto diz que os dados são
dados de teste regenerados a partir de seeds, pule as notas de migração de dados e rollback e diga se os seeds mudaram.
```
A migração <arquivo> <cria/retira/renomeia …>. <Os seeds passam a … / Os dados existentes …>.
```

#### 6c — Rodapé

- Adicione `BREAKING CHANGE: <description>` se alguma API pública, schema de banco ou DTO compartilhado mudou de forma não retrocompatível.
- Adicione `Refs: #<number>` para issues/work items relacionados.

### Etapa 7 — Apresentar a mensagem e aguardar confirmação

Exiba a mensagem de commit completa ao usuário em um bloco visual claro:

```
┌─────────────────────────────────────────────────────────┐
│  fix(api): pedido com id inválido responde 422          │
│                                                         │
│  As rotas do detalhe e dos itens do pedido convertiam   │
│  o id sem tratar o que não é UUID, e a recusa saía      │
│  como erro 500.                                         │
│                                                         │
│  Co-Authored-By: Claude … <noreply@anthropic.com>       │
└─────────────────────────────────────────────────────────┘
```

Exiba também:
- **Arquivos:** N arquivos staged (liste-os brevemente)
- **Branch:** `<current-branch>`
- **Ação:** commit + push para `origin/<current-branch>` (ou "somente commit" se push=false)

**⚠️ AGUARDE confirmação explícita do usuário antes de executar.** Se o usuário pedir mudanças, ajuste a mensagem e apresente novamente.

### Etapa 8 — Executar o commit

Após a confirmação:

1. Grave a mensagem em um arquivo temporário (preserva a formatação multilinha de forma confiável):
   ```bash
   cat <<'COMMITMSG' > /tmp/commit-msg.txt
   <type>(<scope>): <summary>

   <body>

   <footer>
   COMMITMSG
   ```

2. Execute o commit:
   ```bash
   git commit -F /tmp/commit-msg.txt
   ```

3. Se o amend foi solicitado:
   ```bash
   git commit --amend -F /tmp/commit-msg.txt
   ```

4. Limpe:
   ```bash
   rm -f /tmp/commit-msg.txt
   ```

5. Verifique o sucesso:
   ```bash
   git log --oneline -1
   ```

### Etapa 9 — Push para o remoto

Se o push estiver habilitado (padrão):

1. Determine se existe upstream:
   ```bash
   git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null
   ```

2. Faça o push conforme o caso:
   - **Tem upstream:** `git push`
   - **Sem upstream:** `git push -u origin <current-branch>`

3. **Se o push falhar (non-fast-forward):**
   - Informe o usuário de que o remoto divergiu.
   - Volte à **Etapa 0** e sincronize — para um commit local recém-criado, `--rebase` é a estratégia certa (0d, regra 2). Depois, tente o push novamente.
   - Se o rebase encontrar conflitos, siga o 0g e não tente o push de novo até o rebase concluir ou ser abortado.
   - Só sugira `git push --force-with-lease` se o usuário pedir force-push explicitamente. Nunca use `--force` puro.

4. Verifique o push:
   ```bash
   git log --oneline origin/<branch>..<branch>
   ```
   (Deve mostrar 0 commits à frente após um push bem-sucedido.)

### Etapa 10 — Criar Pull Request (opcional)

Se o usuário pediu um Pull Request (disse "PR", "pull request" ou forneceu `--pr`), **ou** se a branch atual é uma branch de feature/fix e o push foi bem-sucedido, **pergunte ao usuário** se ele quer abrir um PR.

#### 10a — Pré-requisitos

1. Confirme que a CLI `gh` está disponível: `which gh`.
2. Confirme a autenticação: `gh auth status`.
   - Se não estiver autenticado → instrua o usuário a rodar `gh auth login` e pare.
3. Confirme que o push foi concluído com sucesso (Etapa 9).
4. Confirme que a branch atual **não** é a própria branch base (não abra PR de `dev` para `dev`).

#### 10b — Determinar a branch base do PR

Use a estratégia de branching do projeto, conforme descrita no `AGENTS.md` dele (seção de CI/CD) ou nos workflows em `.github/workflows/` — qual branch recebe o trabalho de feature e qual dispara o deploy. Sem essa informação:

| Padrão da branch atual | Base padrão |
|------------------------|-------------|
| `feat/*`, `fix/*`, `refactor/*`, `chore/*`, outras branches de trabalho | `dev` (ou a branch padrão, `gh repo view --json defaultBranchRef`) |
| a própria branch de integração | a branch de release/deploy nomeada no `AGENTS.md`; pergunte se não houver |

Se o usuário forneceu uma branch base explicitamente, use o valor dele.

#### 10c — Verificar PR existente

Antes de criar, verifique se já existe um PR para esta branch:

```bash
gh pr list --head <current-branch> --base <base-branch> --state open --json number,title,url
```

- Se já existir um **PR aberto** → mostre a URL e pergunte se o usuário quer atualizá-lo ou pular.
- Se não houver PR aberto → prossiga para criar.

#### 10d — Gerar o título e o corpo do PR

**Título do PR:** reutilize a linha de resumo do commit (a primeira linha da mensagem de commit):
```
feat(pedido): duplicar o pedido copia os itens
```

**Corpo do PR:** gere um corpo Markdown estruturado:

```markdown
## Descrição

<Versão expandida do corpo do commit — o que mudou e por quê>

## Mudanças

- <Lista das mudanças principais, agrupadas por serviço quando houver mais de um>

## Tipo de mudança

- [ ] 🆕 Nova funcionalidade (`feat`)
- [ ] 🐛 Correção de bug (`fix`)
- [ ] ♻️ Refatoração (`refactor`)
- [ ] 📝 Documentação (`docs`)
- [ ] 🧪 Testes (`test`)
- [ ] 🔧 Manutenção / Config (`chore`, `build`, `ci`)
- [ ] ⚡ Desempenho (`perf`)

> Marque a que se aplica (marcada automaticamente conforme o tipo do commit).

## Serviços afetados

- [ ] <uma linha por serviço do projeto, como o `AGENTS.md` os lista>
- [ ] Infraestrutura / CI

> Marque todas as que se aplicam (marcadas automaticamente conforme os arquivos alterados).

## Testes

- [ ] Testes unitários incluídos ou atualizados
- [ ] Conferido na tela, no ambiente local
- [ ] Sem quebra de contrato nas APIs existentes

## Relacionados

- Refs: #<número> (se houver)
```

Marque automaticamente as caixas aplicáveis com base no tipo de commit e nos arquivos alterados.

#### 10e — Apresentar o PR para confirmação

Exiba os detalhes do PR:

```
┌─────────────────────────────────────────────────────────┐
│  📋 Pull Request                                        │
│                                                         │
│  Título: feat(pedido): duplicar o pedido copia os itens │
│  Base:   dev  ←  feat/duplicar-pedido                  │
│  Rascunho: Não                                          │
│  Labels: enhancement                                    │
│                                                         │
│  Corpo: (veja a descrição gerada acima)                 │
└─────────────────────────────────────────────────────────┘
```

**⚠️ AGUARDE a confirmação do usuário antes de criar.** Se o usuário pedir mudanças, ajuste e apresente novamente.

#### 10f — Criar o PR

Após a confirmação, grave o corpo do PR em um arquivo temporário e execute:

```bash
cat <<'PRBODY' > /tmp/pr-body.md
<generated PR body>
PRBODY

gh pr create \
  --base <base-branch> \
  --head <current-branch> \
  --title "<PR title>" \
  --body-file /tmp/pr-body.md \
  <--draft if requested> \
  <--reviewer user1,user2 if provided> \
  <--label label1,label2 if applicable>

rm -f /tmp/pr-body.md
```

**Mapeamento de labels a partir do tipo de commit:**

| Tipo de commit | Label do GitHub |
|-------------|-------------|
| `feat` | `enhancement` |
| `fix` | `bug` |
| `docs` | `documentation` |
| `perf` | `performance` |
| `ci`, `build` | `ci/cd` |
| `refactor`, `style`, `chore`, `test` | *(sem label ou use o nome do tipo)* |

> Aplique apenas labels que **realmente existem** no repositório. Rode `gh label list --json name` primeiro para conferir. Se uma label não existir, pule-a em silêncio.

#### 10g — Verificar a criação do PR

Após criar:

```bash
gh pr view --json number,title,url,state
```

Confirme que o PR foi criado e capture sua URL e número.

### Etapa 11 — Relatório

Apresente o resumo final:

**Com PR:**
```
✅ Commit feito, push enviado e PR criado

  Commit:   a1b2c3d feat(pedido): duplicar o pedido copia os itens
  Branch:   feat/duplicar-pedido
  Remoto:   origin/feat/duplicar-pedido
  Arquivos: 4 arquivos alterados, 187 inserções(+), 12 remoções(-)
  PR:       #247 — https://github.com/<org>/<repo>/pull/247
  Base:     dev ← feat/duplicar-pedido
```

**Sem PR:**
```
✅ Commit feito e push enviado com sucesso

  Commit:   a1b2c3d feat(pedido): duplicar o pedido copia os itens
  Branch:   feat/duplicar-pedido
  Remoto:   origin/feat/duplicar-pedido
  Arquivos: 4 arquivos alterados, 187 inserções(+), 12 remoções(-)
```

**Somente commit (sem push, sem PR):**
```
✅ Commit feito (sem push)

  Commit:   a1b2c3d feat(pedido): duplicar o pedido copia os itens
  Branch:   feat/duplicar-pedido
  Arquivos: 4 arquivos alterados, 187 inserções(+), 12 remoções(-)
  
  Rode `git push` quando quiser.
```

## Casos de borda

### Branch divergente

`git rev-list --left-right --count @{u}...HEAD` retorna ambas as contagens > 0. Não rode um `git pull` puro — escolha a estratégia conforme 0d com base em se os commits locais já foram publicados, e diga qual escolheu e por quê.

### Nada a puxar, mas commits a enviar

Behind = 0, ahead > 0. A sincronização é uma no-op — diga `Already up to date` e aponte os N commits não enviados em vez de dar a entender que houve trabalho.

### Sem upstream configurado

`git rev-parse --abbrev-ref @{u}` falha. A branch existe apenas localmente: não há nada a puxar. Ofereça `git push -u origin <branch>` para publicá-la e definir o upstream. Nunca invente um upstream com `git branch --set-upstream-to` sem perguntar.

### Working tree sujo no pull

Há mudanças não commitadas. Pergunte antes de prosseguir (0c) — commit, autostash, stash manual ou abortar. Depois de qualquer stash, verifique se ele foi restaurado; um `git stash pop` com conflito mantém o stash, o que deve ser sinalizado ao usuário.

### Conflitos de rebase

Nunca resolva automaticamente. Liste os arquivos em conflito, apresente continue / skip / abort (0g) e lembre que `--ours`/`--theirs` ficam invertidos durante um rebase. `git rebase --abort` é sempre a saída segura.

### Rebase ou merge já em andamento

`.git/rebase-merge`, `.git/rebase-apply` ou `MERGE_HEAD` existe. Não inicie outra operação e não commite — relate o estado em andamento e os comandos para concluir ou abortar.

### Rebasear commits publicados

Os commits locais já existem em um remoto (`git branch -r --contains <sha>` não está vazio). Rebasear reescreve histórico que outros podem ter puxado, e o push seguinte exigirá um force-push. Avise o usuário e use merge por padrão, a menos que ele confirme o rebase.

### Branch upstream excluída

`git fetch --prune` removeu o upstream (por exemplo, o PR foi merged e a branch excluída). O pull vai falhar — relate que a branch remota não existe mais e sugira rebasear sobre a branch base (`git rebase origin/dev`) ou excluir a branch local.

### Pull Request já existe

Se `gh pr list --head <branch>` retorna um PR aberto, informe o usuário e mostre o link. Não crie um duplicado. Ofereça atualizar o corpo do PR existente, se desejado.

### PR para a mesma branch

Se a branch atual é igual à branch base (por exemplo, em `dev` tentando abrir PR para `dev`) → pule a criação do PR e informe o usuário.

### CLI gh não autenticada

Se `gh auth status` falha → imprima instruções claras: `gh auth login --web` e pare. Não tente criar o PR.

### Labels não existem

Se a label detectada automaticamente não existe no repositório, pule-a em silêncio. Nunca faça a criação do PR falhar por causa de uma label ausente.

### Múltiplas mudanças lógicas

Se o diff contém **mudanças lógicas claramente não relacionadas** (por exemplo, uma correção de bug em `api/service/auth/` E uma nova feature em `frontend/src/features/orders/`):

1. **Sugira dividir** em commits separados para um histórico mais limpo.
2. Apresente um plano de divisão proposto:
   ```
   Commit 1: fix(auth): sessão expirada renova o token em vez de deslogar
     - api/src/.../service/auth/TokenService.java
   
   Commit 2: feat(pedido): totais do pedido em gráfico na tela de acompanhamento
     - frontend/src/features/orders/components/TotalsChart.tsx
     - frontend/src/features/orders/services/orders.hooks.ts
   ```
3. **Pergunte ao usuário** se deve dividir ou commitar tudo junto.

### Conflitos de merge

Se `git status` mostra conflitos de merge → liste os arquivos em conflito e instrua o usuário a resolvê-los antes de commitar. Pare.

### Diff vazio

Se `git diff --cached` está vazio após o staging → avise o usuário e sugira que ele confira as mudanças.

### HEAD desanexado

Se estiver em um HEAD desanexado → avise o usuário e sugira `git checkout -b <name>` antes de prosseguir.

### Arquivos binários grandes

Se o diff inclui arquivos binários grandes, mencione-os no corpo do commit, mas observe que eles não aparecem na análise do diff.

## Restrições

- **NUNCA commite segredos**, chaves de API, senhas ou arquivos `.env*` (exceto `.env.production`). Se detectados em arquivos staged → **AVISE o usuário e recuse** o commit até que sejam removidos ou adicionados ao `.gitignore`.
- **NUNCA rode um `git pull` puro em uma branch divergente** — escolha `--ff-only`, `--rebase` ou `--no-rebase` deliberadamente (0d) e diga qual.
- **NUNCA faça pull com o working tree sujo** sem perguntar ao usuário primeiro (0c).
- **NUNCA faça rebase de commits que já foram enviados** a menos que o usuário confirme explicitamente após ser avisado.
- **NUNCA resolva conflitos de rebase ou merge automaticamente** — apresente-os e deixe o usuário decidir.
- **NUNCA rode `git reset --hard`, `git rebase --skip` ou `git checkout --ours/--theirs`** sem confirmação explícita do usuário — todos descartam trabalho.
- **SEMPRE rode `git fetch` antes de decidir** a estratégia de sincronização — é somente leitura e fornece as contagens reais de ahead/behind.
- **NUNCA faça force-push** sem autorização explícita do usuário.
- **NUNCA faça amend** em um commit que já foi enviado (a menos que o usuário peça force-push explicitamente).
- **NUNCA crie um PR sem confirmação do usuário** — sempre apresente o título, a base e o corpo primeiro.
- **NUNCA crie um PR duplicado** — sempre verifique PRs abertos existentes no mesmo par head→base.
- **SEMPRE siga o formato Conventional Commits** — confira-o você mesmo quando nenhum hook de `commitlint` protege o commit.
- **SEMPRE apresente a mensagem de commit completa para revisão** antes de executar.
- **SEMPRE escreva o resumo e o corpo em português**, descrevendo o comportamento após o commit (não o modo imperativo em inglês).
- **SEMPRE verifique** que o commit foi criado com sucesso antes de tentar o push.
- **SEMPRE verifique** que o push foi bem-sucedido antes de tentar criar um PR.

## Critérios de qualidade

- [ ] `git fetch` foi rodado antes de qualquer decisão de sincronização
- [ ] As contagens de ahead/behind foram medidas, não presumidas
- [ ] A estratégia de integração (`--ff-only` / `--rebase` / `--no-rebase`) foi escolhida deliberadamente e informada ao usuário
- [ ] O working tree sujo foi tratado explicitamente (commit, stash ou abortar) com o stash verificado como restaurado
- [ ] Nenhum commit publicado foi rebaseado sem confirmação explícita
- [ ] Conflitos, se houver, foram apresentados ao usuário em vez de resolvidos automaticamente
- [ ] O resultado da sincronização foi verificado (behind = 0, working tree limpo) antes de prosseguir
- [ ] O tipo de commit reflete corretamente a natureza das mudanças
- [ ] O escopo é o domínio de negócio quando existe, reutilizando um nome já presente no histórico
- [ ] A linha de resumo está em português, descreve o comportamento resultante, minúscula após os dois-pontos, sem ponto final, idealmente ≤ 100 caracteres
- [ ] O corpo (quando presente) explica o que estava errado ou faltando e por quê, não o como
- [ ] Nenhum segredo ou dado sensível nos arquivos staged
- [ ] Mudanças não relacionadas foram sinalizadas para possível divisão
- [ ] O commit foi verificado com `git log`
- [ ] O push foi bem-sucedido ou explicitamente pulado por preferência do usuário
- [ ] A mensagem segue o formato Conventional Commits (`type(scope): summary`)
- [ ] A branch base do PR segue a estratégia de branching do projeto (conforme o `AGENTS.md` a descreve)
- [ ] O título do PR corresponde à linha de resumo do commit
- [ ] O corpo do PR inclui descrição, lista de mudanças, checkbox de tipo e serviços afetados
- [ ] Nenhum PR duplicado foi criado
- [ ] A URL do PR foi informada ao usuário

## Saída

Dependendo do modo: uma branch local sincronizada com seu remoto (fast-forward, rebase ou merge, com divergência e conflitos tratados explicitamente) e/ou um commit Git criado e enviado ao repositório remoto com uma mensagem Conventional Commits bem estruturada, opcionalmente seguido de um Pull Request no GitHub — além de um relatório resumido da operação completa.
