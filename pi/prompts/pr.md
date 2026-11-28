---
description: "Cria Pull Request com descrição estruturada via GitHub CLI"
argument-hint: "[branch base]"
---

Use o GitHub CLI (`gh`) para criar um Pull Request da branch atual para a branch default, com título no padrão Conventional Commits e descrição estruturada (Resumo / Mudanças / Como testar).

Base: ${@:-branch default}
