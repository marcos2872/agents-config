# agents-config

Skills, prompts e extensões que uso no [Pi](https://pi.dev), empacotadas como um pacote Pi e instaladas por um sync.

## Instalação / sync

```bash
git clone https://github.com/marcos2872/agents-config.git
cd agents-config
./sync.sh
```

O `sync.sh` faz quatro coisas, todas idempotentes:

1. `pi install <este repo>` — o pacote fica **carregado no lugar**, sem cópia; o Pi lê `pi/skills/`, `pi/prompts/` e `pi/extensions/` direto do checkout.
2. `pi install npm:@dietrichgebert/ponytail` — regra de código, revisão e auditoria.
3. `pi mcp add context7` — documentação de bibliotecas e frameworks.
4. Garante o [ai-memory](https://github.com/akitaonrails/ai-memory): instala o binário se faltar, fixa o serviço do usuário em **127.0.0.1:49375** e aplica `ai-memory setup --yes --agent pi` (extensão de captura + ferramentas `memory_*`).

Como o pacote é carregado no lugar, depois de um `git pull` basta **`/reload`** numa sessão aberta (ou abrir o Pi de novo). Rode o sync de novo só quando o script, o `package.json` ou o ai-memory mudarem.

Agent dir customizado (`--agent-dir` do Pi):

```bash
./sync.sh /caminho/do/agente
```

### Windows (PowerShell)

```powershell
.\sync.ps1
# ou, sem depender da execution policy:
.\sync.cmd

# agent dir customizado:
.\sync.ps1 -AgentDir C:\pi\agent
```

> Se você mover ou apagar o checkout, o Pi fica com uma entrada `packages` inválida: o sync avisa e mostra o `pi remove` para limpar; rodar o sync de novo no caminho novo resolve.

## Conteúdo

| Caminho | O que é |
|---|---|
| `package.json` | Manifesto `pi` (extensions, skills, prompts) |
| `pi/skills/` | `er-diagram-generator`, `git-commit-push`, `mapa-de-requisitos`, `planning`, `spec-kit`, `technical-documentation-generator`, `uml-class-diagram-generator` |
| `pi/prompts/` | `/commit`, `/init-agents`, `/memory`, `/pr` — os `/ponytail*` vêm do pacote do ponytail |
| `pi/extensions/guard.ts` | Bloqueia `sudo`, `rm -rf /`, `git push -f/--force`, `.env*` e `.ssh` |
| `pi/lib/` | Regras do guard + teste (`node --test`) |
| `sync.sh` / `sync.ps1` / `sync.cmd` | Instalação no Linux/macOS e no Windows |

## Notas

- **Skills fora do repo:** as do ai-memory e as pessoais (`msbos`, `noctalia-plugin`) ficam em `~/.agents/skills` e o Pi carrega sozinho.
- **Segurança:** o `guard` repete os `deny` que eu usava no OpenCode; ele não é uma sandbox — isolamento de verdade é container ou usuário separado.
- **Aprovações:** o Pi não tem cartão de permissão nem ferramenta `question` embutida; o plano e a confirmação acontecem no chat.
- **Memória:** backend único no ai-memory. A extensão `extensions/ai-memory-pi.ts` é gerada pelo `ai-memory setup` — não versionada.
- **Browser Relay:** era um plugin do OpenCode; a versão para o Pi vive no repo `marcos2872/opencode-browser-extension`.
- **Delegação:** o Pi não tem subagentes embutidos; a antiga skill `subagents` (matriz `explore`/`general`) foi removida junto com o OpenCode.
