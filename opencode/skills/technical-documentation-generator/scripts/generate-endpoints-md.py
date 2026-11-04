#!/usr/bin/env python3
"""
Generate Markdown table of endpoints from an OpenAPI 3 JSON spec.

Groups endpoints by Swagger tag, then optionally by subdomain (heuristic by tag name).
Each endpoint becomes a row: Method | Path | Summary.

Usage:
    python3 generate-endpoints-md.py --openapi /tmp/openapi.json --output /tmp/endpoints.md
    python3 generate-endpoints-md.py --openapi /tmp/openapi.json --output /tmp/endpoints.md --no-subdomain
    python3 generate-endpoints-md.py --openapi /tmp/openapi.json --output /tmp/endpoints.md \
        --java-root meu-servico/src/main/java/com/empresa/servico
"""
import argparse
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dominios_java  # noqa: E402

# Exemplo ilustrativo. Os domínios do projeto ficam no projeto, num JSON com esta estrutura
# (.agents/technical-documentation-generator/domain-map.json), passado em --domain-map-json;
# --no-subdomain achata a lista. Não ajuste este dicionário: o script é o mesmo para todo projeto.
DEFAULT_DOMAIN_MAP = {
    "auth": ["Auth", "Account", "User"],
    "catalog": ["Product", "Category", "Item"],
    "orders": ["Order", "OrderItem", "Invoice", "Payment"],
    "messaging": ["Event"],
}

# Títulos de exemplo. Os do projeto ficam em .agents/technical-documentation-generator/titles.json
# ({"<domínio>": "<título>", "misc": "<título do que sobra>"}), passado em --titles-json.
DOMAIN_TITLES = {
    "auth": "Autenticação & Usuários",
    "catalog": "Catálogo",
    "orders": "Pedidos & Pagamentos",
    "messaging": "Mensageria & Eventos",
    "misc": "Outros",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--openapi", required=True, help="Path to OpenAPI 3 JSON file")
    parser.add_argument("--output", required=True, help="Path to output Markdown file")
    parser.add_argument(
        "--no-subdomain",
        action="store_true",
        help="Skip subdomain grouping; emit a single flat list grouped by tag only",
    )
    parser.add_argument(
        "--domain-map-json",
        help="Optional JSON file overriding DEFAULT_DOMAIN_MAP (same structure)",
    )
    parser.add_argument(
        "--java-root",
        help="Raiz dos pacotes Java (ex.: meu-servico/src/main/java/com/empresa/servico): o domínio de cada tag sai "
             "do subpacote do controller que a declara (controller/<domínio>/), em vez de DEFAULT_DOMAIN_MAP",
    )
    parser.add_argument(
        "--titles-json",
        help="JSON {domínio: título} com os títulos das seções do projeto; 'misc' é o título do que sobra",
    )
    args = parser.parse_args()

    with open(args.openapi, "r", encoding="utf-8") as f:
        spec = json.load(f)

    paths = spec.get("paths", {})
    by_tag: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for path, methods in paths.items():
        for method, op in methods.items():
            if method.lower() not in ("get", "post", "put", "delete", "patch"):
                continue
            summary = (op.get("summary") or op.get("operationId") or "").strip()
            for tag in op.get("tags", ["(untagged)"]):
                by_tag[tag].append((method.upper(), path, summary))

    out: list[str] = []
    domain_map = DEFAULT_DOMAIN_MAP
    if args.domain_map_json:
        with open(args.domain_map_json, "r", encoding="utf-8") as f:
            domain_map = json.load(f)
    titles = dict(DOMAIN_TITLES)
    project_titles = {}
    if args.titles_json:
        with open(args.titles_json, "r", encoding="utf-8") as f:
            project_titles = json.load(f)
        titles.update(project_titles)
    if args.java_root and not args.domain_map_json:
        order = [d for d in project_titles if d != "misc"] + list(DEFAULT_DOMAIN_MAP)
        tag_domain = dominios_java.dominio_das_tags(args.java_root, order)
        domains = dominios_java.ordem_dos_dominios(set(tag_domain.values()), order)
        domain_map = {d: sorted(t for t, dt in tag_domain.items() if dt == d) for d in domains}

    if args.no_subdomain:
        for tag in sorted(by_tag):
            _emit_tag(out, tag, by_tag[tag])
    else:
        printed: set[str] = set()
        for domain, tags in domain_map.items():
            title = titles.get(domain, domain.title())
            section_lines: list[str] = []
            for tag in tags:
                if tag in by_tag:
                    printed.add(tag)
                    _emit_tag(section_lines, tag, by_tag[tag])
            if section_lines:
                out.append(f"\n### {title}\n")
                out.extend(section_lines)
        # remaining tags not in any domain
        remaining = sorted(set(by_tag) - printed)
        if remaining:
            out.append(f"\n### {titles['misc']}\n")
            for tag in remaining:
                _emit_tag(out, tag, by_tag[tag])

    content = "\n".join(out) + "\n"
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(content)

    total_endpoints = sum(len(v) for v in by_tag.values())
    print(
        f"OK: {len(by_tag)} tags, {total_endpoints} endpoints → {args.output}",
        file=sys.stderr,
    )
    return 0


def _emit_tag(out: list[str], tag: str, endpoints: list[tuple[str, str, str]]) -> None:
    endpoints = sorted(endpoints, key=lambda x: (x[1], x[0]))
    out.append(f"\n#### `{tag}` ({len(endpoints)} endpoints)\n")
    out.append("| Método | Caminho | Descrição |")
    out.append("|---|---|---|")
    for method, path, summary in endpoints:
        summary = summary.replace("|", "\\|")
        out.append(f"| `{method}` | `{path}` | {summary} |")


if __name__ == "__main__":
    sys.exit(main())
