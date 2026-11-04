#!/usr/bin/env python3
"""
Generate detailed Markdown reference of all DTOs/Schemas from an OpenAPI 3 JSON spec.

Each schema becomes a section with:
- Anchor for cross-linking
- Description (if present)
- Table of fields: Field | Type | Required | Notes
- Internal links for $ref types
- Detection of enums, formats, validations, readOnly/nullable/deprecated flags

Usage:
    python3 generate-schemas-md.py --openapi /tmp/openapi.json --output docs/SCHEMAS.md
    python3 generate-schemas-md.py --openapi /tmp/openapi.json --output docs/SCHEMAS.md \
        --java-root meu-servico/src/main/java/com/empresa/servico
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dominios_java  # noqa: E402

# Exemplo ilustrativo de palavras-chave por domínio. Os domínios do projeto ficam no projeto
# (.agents/technical-documentation-generator/domain-keywords.json), passados em --keywords-json.
DEFAULT_DOMAIN_KEYWORDS = {
    "auth": ["auth", "account", "token", "password", "reset", "user",
             "permission", "login", "register"],
    "catalog": ["product", "category", "item", "catalog"],
    "orders": ["order", "invoice", "payment", "cart", "checkout"],
    "messaging": ["event", "message", "notification", "email", "job"],
}

# Títulos de exemplo. Os do projeto ficam em .agents/technical-documentation-generator/titles.json
# ({"<domínio>": "<título>", "misc": "<título do que sobra>"}), passado em --titles-json.
DOMAIN_TITLES = [
    ("auth", "Autenticação & Usuários"),
    ("catalog", "Catálogo"),
    ("orders", "Pedidos & Pagamentos"),
    ("messaging", "Mensageria & Eventos"),
    ("misc", "Outros"),
]


def ref_name(ref: str | None) -> str | None:
    return ref.split("/")[-1] if ref else None


def fmt_type(s) -> str:
    if not isinstance(s, dict):
        return "`?`"
    if "$ref" in s:
        n = ref_name(s["$ref"])
        return f"[`{n}`](#{n.lower()})"
    t = s.get("type")
    fmt = s.get("format")
    if t == "array":
        return f"`array<`{fmt_type(s.get('items', {}))}`>`"
    if t == "object":
        ap = s.get("additionalProperties")
        if isinstance(ap, dict):
            return f"`map<string,`{fmt_type(ap)}`>`"
        return "`object`"
    if s.get("enum"):
        vals = ", ".join(f"`{v}`" for v in s["enum"])
        return f"`{t or 'string'}` (enum: {vals})"
    if t and fmt:
        return f"`{t}<{fmt}>`"
    if t:
        return f"`{t}`"
    for key in ("oneOf", "anyOf", "allOf"):
        if key in s:
            parts = [fmt_type(x) for x in s[key]]
            return " / ".join(parts)
    return "`?`"


def heuristic_domain(name: str, keywords: dict) -> str:
    lname = name.lower()
    for domain, kws in keywords.items():
        if any(k in lname for k in kws):
            return domain
    return "misc"


def render_schema(name: str, sch: dict) -> str:
    lines: list[str] = []
    lines.append(f"### {name}")
    lines.append(f'<a id="{name.lower()}"></a>')
    desc = sch.get("description")
    if desc:
        lines.append(f"\n> {desc}\n")
    t = sch.get("type", "object")
    enum = sch.get("enum")
    if enum:
        lines.append(f"\n**Tipo:** `{t}` (enum)\n")
        lines.append("| Valor |")
        lines.append("|---|")
        for v in enum:
            lines.append(f"| `{v}` |")
        lines.append("")
        return "\n".join(lines)
    if t == "object" or "properties" in sch:
        props = sch.get("properties", {})
        required = set(sch.get("required", []))
        if not props:
            ap = sch.get("additionalProperties")
            if isinstance(ap, dict):
                lines.append(f"\n**Tipo:** `map<string, {fmt_type(ap)}>`\n")
            else:
                lines.append("\n*(objeto sem propriedades declaradas)*\n")
            return "\n".join(lines)
        lines.append("")
        lines.append("| Campo | Tipo | Obrigatório | Observações |")
        lines.append("|---|---|---|---|")
        for pname in sorted(props):
            p = props[pname]
            ttype = fmt_type(p)
            req = "✓" if pname in required else ""
            notes: list[str] = []
            if isinstance(p, dict):
                if "description" in p:
                    notes.append(p["description"])
                for k in ("minimum", "maximum", "minLength", "maxLength"):
                    if k in p:
                        notes.append(f"{k}: {p[k]}")
                if "pattern" in p:
                    notes.append(f"pattern: `{p['pattern']}`")
                if "default" in p:
                    notes.append(f"default: `{p['default']}`")
                if "example" in p:
                    ex = str(p["example"])
                    if len(ex) > 60:
                        ex = ex[:60] + "…"
                    notes.append(f"ex: `{ex}`")
                if p.get("readOnly"):
                    notes.append("readOnly")
                if p.get("nullable"):
                    notes.append("nullable")
                if p.get("deprecated"):
                    notes.append("**deprecated**")
                if "enum" in p:
                    vals = ", ".join(f"`{v}`" for v in p["enum"])
                    notes.append(f"enum: {vals}")
            note_str = "; ".join(notes).replace("|", "\\|")
            lines.append(f"| `{pname}` | {ttype} | {req} | {note_str} |")
        lines.append("")
        return "\n".join(lines)
    lines.append(f"\n**Tipo:** {fmt_type(sch)}\n")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--openapi", required=True, help="Path to OpenAPI 3 JSON file")
    parser.add_argument("--output", required=True, help="Path to output Markdown file")
    parser.add_argument(
        "--keywords-json",
        help="Optional JSON file overriding DEFAULT_DOMAIN_KEYWORDS",
    )
    parser.add_argument(
        "--no-subdomain",
        action="store_true",
        help="Emit a single flat list (alphabetical) instead of grouping by subdomain",
    )
    parser.add_argument(
        "--title",
        default="Anexo: DTOs / Schemas",
        help="Document title (default: 'Anexo: DTOs / Schemas')",
    )
    parser.add_argument(
        "--source-url",
        default="(spec OpenAPI)",
        help="URL/origin of the OpenAPI spec (for the header note)",
    )
    parser.add_argument(
        "--java-root",
        help="Raiz dos pacotes Java: o domínio de cada schema sai do subpacote da classe de mesmo nome "
             "(dto/<domínio>/, model/<domínio>/...); as palavras-chave ficam só para o que não for achado",
    )
    parser.add_argument(
        "--titles-json",
        help="JSON {domínio: título} com os títulos das seções do projeto; 'misc' é o título do que sobra",
    )
    args = parser.parse_args()

    with open(args.openapi, "r", encoding="utf-8") as f:
        spec = json.load(f)

    schemas = spec.get("components", {}).get("schemas", {})
    if not schemas:
        print("ERROR: no schemas found in components.schemas", file=sys.stderr)
        return 1

    keywords = DEFAULT_DOMAIN_KEYWORDS
    if args.keywords_json:
        with open(args.keywords_json, "r", encoding="utf-8") as f:
            keywords = json.load(f)

    out: list[str] = []
    out.append(f"# {args.title}\n")
    out.append(f"> Gerado a partir de `components.schemas` do contrato OpenAPI em `{args.source_url}`.")
    out.append(f"> Total: **{len(schemas)} schemas**.")
    out.append("")

    if args.no_subdomain:
        out.append("## Sumário\n")
        for n in sorted(schemas, key=str.lower):
            out.append(f"- [`{n}`](#{n.lower()})")
        out.append("\n---\n")
        for n in sorted(schemas, key=str.lower):
            out.append(render_schema(n, schemas[n]))
            out.append("")
    else:
        titles = dict(DOMAIN_TITLES)
        project_titles = {}
        if args.titles_json:
            with open(args.titles_json, "r", encoding="utf-8") as f:
                project_titles = json.load(f)
            titles.update(project_titles)
        tipos = {}
        if args.java_root:
            tipos = dominios_java.dominio_dos_tipos(args.java_root, dominios_java.dominios(args.java_root))
        groups: dict[str, list[str]] = {}
        for name in sorted(schemas, key=str.lower):
            domain = dominios_java.dominio_do_schema(name, tipos) or heuristic_domain(name, keywords)
            groups.setdefault(domain, []).append(name)
        order = dominios_java.ordem_dos_dominios(
            set(groups) - {"misc"}, [d for d in project_titles if d != "misc"], [k for k, _ in DOMAIN_TITLES])
        if "misc" in groups:
            order.append("misc")
        out.append("## Sumário\n")
        for key in order:
            out.append(f"- [{titles.get(key, key.title())}](#dominio-{key}) ({len(groups[key])} schemas)")
        out.append("\n---\n")
        for key in order:
            names = groups[key]
            out.append(f"## {titles.get(key, key.title())}")
            out.append(f'<a id="dominio-{key}"></a>\n')
            for n in names:
                out.append(render_schema(n, schemas[n]))
                out.append("")
            out.append("---\n")

    content = "\n".join(out)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(content)

    print(
        f"OK: {len(schemas)} schemas → {args.output} ({len(content)} chars)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
