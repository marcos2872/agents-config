---
name: git-commit-push
description: "Analisa mudanças Git (staged/unstaged), gera mensagem Conventional Commits, executa commit, push e opcionalmente cria Pull Request no GitHub. Use ao commitar, gerar mensagens, fazer push, salvar alterações ou criar PR."
argument-hint: "Opcional: tipo de commit (feat, fix, refactor…), escopo (backend, frontend…), branch de destino ou '--pr' para criar Pull Request"
---

# Git Commit, Push & Pull Request — Gerador Conventional Commits

Analisa a árvore de trabalho Git (staged e unstaged), gera mensagem de commit seguindo **Conventional Commits**, executa `git commit`, `git push` e opcionalmente cria **Pull Request** via `gh`.

## Quando Usar

- Após alterações que precisam ser commitadas e enviadas
- Quando quer uma mensagem de commit automatizada a partir do diff real
- Quando quer commit, push **e** Pull Request em um fluxo só
- Quando o usuário disser "commit", "push", "salvar", "criar PR", "pull request" ou similar

## Inputs

| Input | Obrigatório | Padrão | Exemplo |
|-------|-------------|--------|---------|
| Branch | Não | branch atual | `feat/new-upload` |
| Tipo de commit | Não | auto-detectado | `feat`, `fix`, `refactor` |
| Escopo | Não | auto-detectado | `backend`, `frontend` |
| Push após commit | Não | `true` | `false` |
| Amend último commit | Não | `false` | `true` |
| Contexto adicional | Não | — | `"Corrige bug no login"` |
| Criar PR | Não | `false` | `true` |
| Base do PR | Não | `main` | `main`, `dev` |
| Revisores do PR | Não | — | `usuario1,usuario2` |
| Labels do PR | Não | auto-detectado | `enhancement`, `bug` |
| PR como draft | Não | `false` | `true` |

## Especificação Conventional Commits

Segue [Conventional Commits v1.0.0](https://www.conventionalcommits.org/).

### Formato

```
<tipo>(<escopo>): <resumo>
                            ← linha em branco
<corpo>
                            ← linha em branco
<rodapé(s)>
```

### Tipos Permitidos

| Tipo | Quando Usar |
|------|-------------|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `refactor` | Reestruturação sem mudança de comportamento |
| `docs` | Apenas documentação |
| `style` | Formatação, espaços — sem mudança lógica |
| `test` | Testes novos ou atualizados |
| `chore` | Ferramentas, configs, dependências |
| `ci` | Pipeline CI/CD (GitHub Actions, Docker, Nginx) |
| `perf` | Melhoria de performance |
| `build` | Sistema de build ou dependências externas |
| `revert` | Reversão de commit anterior |

### Detecção de Escopo — Mapa Path→Escopo

Derivar escopo dos **diretórios** alterados. Usar a estrutura do **AGENTS.md** como referência primária.

| Padrão de Path | Escopo |
|----------------|--------|
| Lógica de domínio/negócio | `domain` |
| Camada de aplicação/casos de uso | `application` |
| Infraestrutura/adaptadores | `infra` |
| Handlers HTTP/controllers/routers | nome do módulo (`auth`, `users`) |
| Modelos/migrations de banco | `models` ou `migration` |
| Componentes frontend/UI | `ui` |
| Páginas/rotas frontend | `pages` |
| Testes | `tests` |
| CI/CD (`.github/workflows/`, `Dockerfile`) | `ci` |
| Configs de agente (`agents/**`) | `agents` |
| Documentação (`docs/**`) | `docs` |

**Sub-diretório:** se as mudanças estão concentradas em um único feature/módulo, usar esse nome como escopo (`auth`, `checkout`, `dashboard`). Se 3+ escopos diferentes → omitir escopo.

### Regras da Linha de Resumo

- **Modo imperativo**: "add", "fix", "update" — NÃO "added", "fixes", "updated"
- **≤ 72 caracteres** na primeira linha (`tipo(escopo): resumo`)
- **Primeira palavra após o sinal em minúscula**, sem ponto final

### Regras do Corpo

- Separado do resumo por **uma linha em branco**
- Linhas com **até 100 caracteres**
- Explicar **o que** mudou e **por que** — o diff já mostra o como
- Usar marcadores (`-`) para mudanças múltiplas

### Regras do Rodapé

- `BREAKING CHANGE: <descrição>` para mudanças incompatíveis (também marcar resumo com `!`: `feat(backend)!: ...`)
- `Refs: #<issue>` para issues relacionadas
- `Co-authored-by: Nome <email>` para programação em par

## Procedimento

### Passo 1 — Avaliar Estado do Repositório

```bash
git status
git branch --show-current
git log --oneline -5
```

**Parar se:** working tree limpa, conflitos de merge, ou detached HEAD (sugerir `git checkout -b <nome>`).

### Passo 2 — Stagiar Arquivos

| Cenário | Ação |
|---------|------|
| Usuário disse "commit all" / "commit tudo" | `git add -A` |
| Já há arquivos staged e nada mais mudou | Seguir com staging atual |
| Há arquivos unstaged/untracked | **Perguntar ao usuário**: add all, arquivos específicos, ou só o que já está staged |

Após staging: `git diff --cached --name-only` para confirmar lista final.

### Passo 3 — Analisar o Diff

1. `git diff --cached --stat` — visão geral
2. `git diff --cached` — diff completo
3. Se diff > ~500 linhas, analisar incrementalmente por arquivo, priorizando lógica de negócio
4. Para cada arquivo alterado, extrair: **o que** mudou, **por que**, e **qual domínio/serviço**

### Passo 4 — Determinar Tipo e Escopo

#### 4a — Auto-detecção de Tipo (primeiro match vence)

| Prioridade | Sinal | Tipo |
|------------|-------|------|
| 1 | `revert` no branch ou instrução do usuário | `revert` |
| 2 | Novos arquivos com lógica, endpoints, componentes, migrations | `feat` |
| 3 | Correções de defeitos, null checks, tratamento de erro | `fix` |
| 4 | Mudanças estruturais sem alteração de comportamento | `refactor` |
| 5 | Apenas arquivos de teste | `test` |
| 6 | Apenas documentação | `docs` |
| 7 | Apenas CI/CD | `ci` |
| 8 | Apenas build/config | `build` |
| 9 | Apenas formatação/whitespace | `style` |
| 10 | Cache, otimização, lazy loading | `perf` |
| 11 | Dependências, tooling, `.gitignore` | `chore` |

#### 4b — Auto-detecção de Escopo

Usar mapa path→escopo. Se mudanças tocam exatamente **um sub-pacote de domínio**, usar esse domínio.

#### 4c — Sobrescrita

Se o usuário forneceu tipo ou escopo explicitamente, usar o valor dele.

### Passo 5 — Verificar Mudanças Não Relacionadas (Sugestão de Split)

Se o diff contém **mudanças claramente não relacionadas**:

1. Sugerir dividir em commits separados
2. Apresentar plano de split baseado nos arquivos:
   ```
   Commit 1: fix(auth): handle expired token on refresh
     - auth/TokenService.java

   Commit 2: feat(ui): add new feature component
     - ui/components/NewFeature.tsx
   ```
3. **Perguntar ao usuário** se quer dividir ou commitar junto

### Passo 6 — Gerar Mensagem de Commit

#### 6a — Linha de Resumo

```
<tipo>(<escopo>): <verbo imperativo> <descrição concisa>
```

Exemplos:
- `feat(templates): add slide preview endpoint`
- `fix(domain): handle empty placeholder in table renderer`
- `ci: add ruff lint step to PR workflow`

#### 6b — Corpo

```
<Por que essa mudança foi necessária — 1-2 frases>

- <Mudança específica 1>
- <Mudança específica 2>
```

Para mudanças em múltiplas camadas, agrupar por serviço: `[domain]`, `[backend]`, `[frontend]`.

#### 6c — Rodapé

- `BREAKING CHANGE: <descrição>` se API pública, schema de banco ou DTO compartilhado mudou de forma incompatível
- `Refs: #<número>` para issues relacionadas

### Passo 7 — Apresentar Mensagem e Aguardar Confirmação

Exibir a mensagem completa em bloco visual. Incluir: arquivos staged, branch, ação (Commit + Push ou só Commit).

```
┌─────────────────────────────────────────────────────────┐
│  feat(auth): add token refresh endpoint                 │
│                                                         │
│  Allow clients to obtain a new access token using a     │
│  valid refresh token without re-authenticating.         │
│                                                         │
│  - Add POST /auth/refresh route                         │
│  - Rotate refresh token on every use                    │
│                                                         │
│  Refs: #42                                              │
└─────────────────────────────────────────────────────────┘
```

**⚠️ AGUARDAR confirmação explícita do usuário.** Se solicitar alterações, ajustar e reapresentar.

### Passo 8 — Executar Commit

```bash
cat <<'COMMITMSG' > /tmp/pi-commit-msg.txt
<tipo>(<escopo>): <resumo>

<corpo>

<rodapé>
COMMITMSG

git commit -F /tmp/pi-commit-msg.txt
# Se amend: git commit --amend -F /tmp/pi-commit-msg.txt

rm -f /tmp/pi-commit-msg.txt
git log --oneline -1   # verificar sucesso
```

### Passo 9 — Push para Remoto

```bash
# Verificar upstream
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null

# Com upstream: git push
# Sem upstream: git push -u origin <branch>
```

Se push falhar (non-fast-forward): sugerir `git pull --rebase origin <branch>` e retentar. Só sugerir `--force-with-lease` se usuário pedir explicitamente.

Verificar: `git log --oneline origin/<branch>..<branch>` (deve mostrar 0 commits ahead).

### Passo 10 — Criar Pull Request (opcional)

Se o usuário pediu PR (`--pr`, "PR", "pull request") **ou** branch é feature/fix e push foi bem-sucedido, **perguntar** se quer abrir PR.

#### Pré-requisitos

1. `which gh` e `gh auth status` — se não autenticado, instruir `gh auth login --web` e parar
2. Push completou com sucesso
3. Branch atual **não é** a base (não fazer PR de `dev` para `dev`)

#### Determinar Branch Base

| Padrão da Branch Atual | Base Padrão |
|------------------------|-------------|
| `feat/*`, `fix/*`, `refactor/*`, `chore/*`, `test/*`, `docs/*` | `main` |
| Qualquer outra | `main` |

Se usuário forneceu branch base explicitamente, usar o valor dele.

#### Verificar PR Existente

```bash
gh pr list --head <branch> --base <base> --state open --json number,title,url
```

Se já existe PR aberto → mostrar URL e perguntar se quer atualizar ou pular.

#### Gerar Título e Corpo do PR

**Título:** Reutilizar a linha de resumo do commit.

**Corpo:** Markdown estruturado:

```markdown
## Descrição

<Versão expandida do corpo do commit>

## Mudanças

- <Lista de alterações principais>

## Tipo de Mudança

- [ ] Nova funcionalidade (`feat`)
- [ ] Correção de bug (`fix`)
- [ ] Refatoração (`refactor`)
- [ ] Documentação (`docs`)
- [ ] Testes (`test`)
- [ ] Chore / Config (`chore`, `build`, `ci`)
- [ ] Performance (`perf`)

## Camadas Afetadas

- [ ] Domínio / lógica de negócio
- [ ] Aplicação / casos de uso
- [ ] Infraestrutura / adaptadores
- [ ] Backend / API handlers
- [ ] Frontend / UI
- [ ] Banco / migrations
- [ ] CI / Agents / Config

## Testes

- [ ] Testes unitários adicionados/atualizados
- [ ] Testes manuais realizados localmente
- [ ] Sem breaking changes em APIs existentes

## Relacionado

- Refs: #<issue-number> (se houver)
```

Auto-marcar checkboxes aplicáveis baseado no tipo de commit e arquivos alterados.

#### Criar o PR

```bash
cat <<'PRBODY' > /tmp/pi-pr-body.md
<corpo gerado>
PRBODY

gh pr create \
  --base <base> --head <branch> \
  --title "<título>" --body-file /tmp/pi-pr-body.md \
  <--draft se solicitado> \
  <--reviewer user1,user2 se fornecido> \
  <--label label1,label2 se aplicável>

rm -f /tmp/pi-pr-body.md
```

**Mapeamento label por tipo de commit:** `feat`→`enhancement`, `fix`→`bug`, `docs`→`documentation`, `perf`→`performance`, `ci/build`→`ci/cd`. Verificar se a label existe com `gh label list --json name`; se não existir, pular silenciosamente.

#### Verificar Criação

```bash
gh pr view --json number,title,url,state
```

### Passo 11 — Relatório

**Com PR:**
```
Commited, pushed e PR criado

  Commit:   a1b2c3d feat(templates): add slide preview endpoint
  Branch:   feat/slide-preview
  Remote:   origin/feat/slide-preview
  Files:    4 files changed, 187 insertions(+), 12 deletions(-)
  PR:       #42 — https://github.com/<org>/<repo>/pull/42
  Base:     main <- feat/slide-preview
```

**Sem PR:**
```
Commited e pushed com sucesso

  Commit:   a1b2c3d feat(templates): add slide preview endpoint
  Branch:   feat/slide-preview
  Files:    4 files changed, 187 insertions(+), 12 deletions(-)
```

**Só commit (sem push/PR):**
```
Commited (não pusheado)

  Commit:   a1b2c3d feat(templates): add slide preview endpoint
  Branch:   feat/slide-preview
  Files:    4 files changed, 187 insertions(+), 12 deletions(-)

  Execute `git push` quando pronto.
```

## Casos de Borda

| Caso | Ação |
|------|------|
| PR já existe | Mostrar URL, não duplicar. Oferecer atualizar corpo do PR existente |
| Branch = base | Pular criação do PR e informar |
| `gh` não autenticado | Instruir `gh auth login --web` e parar |
| Label não existe | Pular silenciosamente |
| Mudanças não relacionadas | Sugerir split (mesmo procedimento do Passo 5) |
| Conflitos de merge | Listar arquivos conflitados e instruir resolução |
| Diff vazio após staging | Avisar e sugerir verificar alterações |
| Detached HEAD | Sugerir `git checkout -b <nome>` |
| Arquivos binários grandes | Mencionar no corpo do commit que não aparecem no diff |

## Restrições

- **NUNCA** commitar secrets, chaves de API, senhas ou `.env*` — se detectado, **avisar e recusar**
- **NUNCA** force-push sem autorização explícita do usuário
- **NUNCA** alterar (amend) commit já pusheado (a menos que usuário peça force-push)
- **NUNCA** criar PR sem confirmação do usuário — sempre apresentar título, base e corpo antes
- **NUNCA** criar PR duplicado — sempre verificar PRs abertos existentes
- **SEMPRE** seguir formato Conventional Commits
- **SEMPRE** apresentar mensagem completa para revisão antes de executar
- **SEMPRE** usar modo imperativo na linha de resumo
- **SEMPRE** verificar sucesso do commit antes de push, e do push antes de criar PR

## Critérios de Qualidade

- [ ] Tipo reflete a natureza das mudanças
- [ ] Escopo identifica o módulo/domínio afetado
- [ ] Resumo ≤ 72 caracteres, imperativo, minúscula após dois-pontos
- [ ] Corpo explica o que mudou e por que (não como)
- [ ] Nenhum segredo ou dado sensível nos arquivos staged
- [ ] Mudanças não relacionadas foram sinalizadas para split
- [ ] Commit, push e PR verificados com sucesso
- [ ] PR title corresponde ao summary do commit

## Saída

Um commit Git criado e pusheado com mensagem Conventional Commits, opcionalmente com Pull Request — mais um relatório resumido da operação completa.
