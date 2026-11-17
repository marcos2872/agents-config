---
description: "Auditoria do repositório inteiro: bugs, segurança, carga real, testes e excesso de código (via skill code-review)"
---

Carregue a skill `code-review` no modo repositório inteiro e audite o escopo pedido (pasta, pacote ou o repo todo; nada indicado, o repo todo). Mapeie pontos de entrada, dependências e carga esperada antes de julgar. Liste no máximo 20 achados numerados por severidade, cada um com `arquivo:linha` e as quatro partes (o que é, problema, correção, se não corrigir). Termine com veredito, linhas/dependências removíveis e o que não foi verificado. Não edite arquivos.

!`git status --short && git ls-files | head -200`
