/**
 * Entrada server (no-op) do plugin go-usage.
 *
 * O widget vive 100% no TUI (`tui.tsx`); este entrypoint existe apenas para o
 * OpenCode resolver o diretório local como um pacote (mesmo layout dos pacotes
 * publicados: `index.ts` + `tui.tsx`).
 */
import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "go-usage",
  setup: () => {},
});
