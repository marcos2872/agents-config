/**
 * Entrada server (no-op) do plugin go-usage.
 *
 * O widget vive 100% no TUI (`tui.tsx`); este entrypoint existe apenas para o
 * OpenCode resolver o diretório local como um pacote (mesmo layout dos pacotes
 * publicados: `index.ts` + `tui.tsx`).
 */
// Não importe `@opencode/plugin` aqui: o plugin é carregado como arquivo local
// e versões antigas do serviço não resolvem o pacote.
export default {
  id: "go-usage",
  setup: () => {},
};
