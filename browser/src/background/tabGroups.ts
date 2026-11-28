import { activateTab } from "./focus"
import { t } from "../shared/i18n/runtime"

interface GroupRecord {
  sessionID: string;
  groupId: number;
  mainTabId: number;
}

function isBlankUrl(url?: string): boolean {
  return !url || url === "about:blank" || url.startsWith("chrome://newtab");
}

function sameBaseUrl(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Sessão sem aba não abre grupo por acidente. Sessões-filhas (subagentes) têm
 * `sessionID` próprio e nunca recebem aba: qualquer tool que resolvesse a aba
 * criava um grupo com `about:blank` que ficava para sempre no navegador.
 */
/** Resolvido na hora (não no import): o idioma é carregado de forma assíncrona. */
function noTabMessage(): string {
  return t("group.noTab")
}

const STORAGE_KEY = "tabGroups";
const TITLE_BASE = "pi";
const TITLE_SEPARATOR = " · ";
const COLORS = [
  "blue",
  "cyan",
  "green",
  "orange",
  "purple",
  "red",
  "yellow",
  "pink",
] as const;

/** Título exibido no grupo; a sessão ativa aparece nele para diferenciar. */
function groupTitle(label?: string): string {
  const clean = (label ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return clean ? `${TITLE_BASE}${TITLE_SEPARATOR}${clean}` : TITLE_BASE;
}

/** Grupos da extensão: o título padrão ou o padrão seguido do nome da sessão. */
function isManagedTitle(title: string | undefined): boolean {
  return (
    title === TITLE_BASE ||
    (typeof title === "string" && title.startsWith(TITLE_BASE + TITLE_SEPARATOR))
  );
}

export interface GroupTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export class TabGroups {
  private records: GroupRecord[] | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    chrome.tabs.onRemoved.addListener((tabId) => {
      void this.serialize(async () => {
        const records = await this.load();
        let changed = false;
        for (const record of records) {
          if (record.mainTabId !== tabId) continue;
          const tabs = await chrome.tabs
            .query({ groupId: record.groupId })
            .catch(() => []);
          const next = tabs.find((tab) => tab.id !== undefined);
          if (next?.id !== undefined) {
            record.mainTabId = next.id;
          } else {
            this.records = records.filter((item) => item !== record);
          }
          changed = true;
        }
        if (changed) await this.save();
      });
    });
    chrome.tabGroups.onRemoved.addListener((group) => {
      void this.serialize(async () => {
        const records = await this.load();
        const next = records.filter((record) => record.groupId !== group.id);
        if (next.length !== records.length) {
          this.records = next;
          await this.save();
        }
      });
    });
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async load(force = false): Promise<GroupRecord[]> {
    if (this.records && !force) return this.records;
    const data = await chrome.storage.session.get(STORAGE_KEY);
    const value = data[STORAGE_KEY];
    this.records = Array.isArray(value)
      ? value.filter(
          (item): item is GroupRecord =>
            !!item &&
            typeof item.sessionID === "string" &&
            typeof item.groupId === "number" &&
            typeof item.mainTabId === "number",
        )
      : [];
    return this.records;
  }

  private async save(): Promise<void> {
    await chrome.storage.session.set({ [STORAGE_KEY]: this.records ?? [] });
  }

  /**
   * Cria a aba reserva e o grupo. Só deve ser chamado por pedido explícito
   * (`tabs_context` com `createIfEmpty`) — tools normais usam `resolveTab`, que
   * falha quando a sessão ainda não tem aba.
   */
  async ensure(
    sessionID: string,
    displayName?: string,
    windowId?: number,
  ): Promise<GroupRecord> {
    return this.serialize(async () => {
      const records = await this.load();
      const existing = records.find((record) => record.sessionID === sessionID);
      if (existing) {
        try {
          await chrome.tabGroups.get(existing.groupId);
          const tabs = await chrome.tabs.query({ groupId: existing.groupId });
          if (tabs.length > 0) {
            if (!tabs.some((tab) => tab.id === existing.mainTabId)) {
              const first = tabs.find((tab) => tab.id !== undefined);
              if (first?.id !== undefined) {
                existing.mainTabId = first.id;
                await this.save();
              }
            }
            return existing;
          }
          // Grupo vazio: descarta o registro antigo antes de recriar.
          this.records = records.filter((record) => record !== existing);
        } catch {
          // Group is gone; recreate below.
          this.records = records.filter((record) => record !== existing);
        }
      }

      const window =
        windowId === undefined
          ? await chrome.windows.getLastFocused().catch(() => undefined)
          : undefined;
      // A aba reserva nasce em segundo plano: criar o grupo não deve tirar o
      // foco da aba/janela em que o usuário está trabalhando.
      const tab = await chrome.tabs.create({
        windowId: windowId ?? window?.id,
        url: "about:blank",
        active: false,
      });
      if (tab.id === undefined) throw new Error(t("group.createFailed"));
      let groupId: number;
      try {
        groupId = await this.createGroupLocked(
          sessionID,
          tab.id,
          displayName,
        );
      } catch (error) {
        // Grupo não consolidou: não deixa uma aba em branco órfã.
        await chrome.tabs.remove(tab.id).catch(() => undefined);
        throw error;
      }
      return { sessionID, groupId, mainTabId: tab.id };
    });
  }

  /**
   * Cria o grupo usando a própria aba informada como principal, sem abrir uma
   * aba em branco. Deve ser chamado dentro de `serialize`.
   */
  private async createGroupLocked(
    sessionID: string,
    tabId: number,
    displayName?: string,
  ): Promise<number> {
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    const index = (this.records ?? []).length;
    await chrome.tabGroups.update(groupId, {
      title: groupTitle(displayName),
      color: COLORS[index % COLORS.length] as chrome.tabGroups.Color,
      collapsed: false,
    });
    // Um grupo pertence a uma única sessão: descarta vínculos duplicados
    // criados ao mover abas manualmente entre grupos.
    this.records = [
      ...(this.records ?? []).filter(
        (record) =>
          record.groupId !== groupId && record.sessionID !== sessionID,
      ),
      { sessionID, groupId, mainTabId: tabId },
    ];
    await this.save();
    return groupId;
  }

  /** Atualiza o título do grupo com o nome da sessão. */
  async setLabel(sessionID: string, label: string | undefined): Promise<void> {
    const record = await this.get(sessionID);
    if (!record) return;
    await chrome.tabGroups
      .update(record.groupId, { title: groupTitle(label) })
      .catch(() => undefined);
  }

  /** Sessão dona de um grupo, ou `null` se o grupo não é gerenciado. */
  async sessionOfGroup(groupId: number): Promise<string | null> {
    const records = await this.load(true);
    const record = records.find((item) => item.groupId === groupId);
    if (!record) return null;
    try {
      await chrome.tabGroups.get(record.groupId);
    } catch {
      return null;
    }
    return record.sessionID;
  }

  /** Sessão dona da aba, resolvida pelo grupo em que ela está. */
  async sessionOfTab(tabId: number): Promise<string | null> {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab || typeof tab.groupId !== "number" || tab.groupId < 0) return null;
    return this.sessionOfGroup(tab.groupId);
  }

  /**
   * Remove o vínculo da sessão e libera as abas do grupo: fecha as que estão em
   * branco e desagrupa as demais, para não destruir páginas do usuário.
   */
  async release(sessionID: string): Promise<void> {
    await this.serialize(async () => {
      const records = await this.load();
      const record = records.find((item) => item.sessionID === sessionID);
      if (!record) return;
      this.records = records.filter((item) => item !== record);
      await this.save();
      const groupTabs = await chrome.tabs
        .query({ groupId: record.groupId })
        .catch(() => []);
      for (const tab of groupTabs) {
        if (tab.id === undefined) continue;
        if (isBlankUrl(tab.url ?? tab.pendingUrl)) {
          // Nunca fecha a aba que o usuário está usando: só desagrupa.
          if (tab.active) await chrome.tabs.ungroup(tab.id).catch(() => undefined);
          else await chrome.tabs.remove(tab.id).catch(() => undefined);
        } else {
          await chrome.tabs.ungroup(tab.id).catch(() => undefined);
        }
      }
    });
  }

  async get(sessionID: string): Promise<GroupRecord | null> {
    const records = await this.load();
    return records.find((record) => record.sessionID === sessionID) ?? null;
  }

  async list(sessionID: string): Promise<GroupTab[]> {
    const record = await this.get(sessionID);
    if (!record) return [];
    try {
      await chrome.tabGroups.get(record.groupId);
    } catch {
      return [];
    }
    const tabs = await chrome.tabs.query({ groupId: record.groupId });
    return tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) => ({
        id: tab.id as number,
        title: tab.title ?? "",
        url: tab.url ?? tab.pendingUrl ?? "",
        active: tab.active,
      }));
  }

  async resolveTab(
    sessionID: string,
    requested?: number,
  ): Promise<{ tabId: number; groupId: number }> {
    const record = await this.get(sessionID);
    const groupId = record ? await this.groupOf(sessionID) : null;
    if (!record || groupId === null) {
      throw new Error(
        requested === undefined
          ? noTabMessage()
          : t("group.tabNotInSession", { tabId: requested }),
      );
    }
    await this.expandGroup(groupId);
    const tabs = await chrome.tabs.query({ groupId });
    if (requested !== undefined) {
      const match = tabs.find((tab) => tab.id === requested);
      if (!match) {
        throw new Error(t("group.tabNotInGroup", { tabId: requested }));
      }
      return { tabId: requested, groupId };
    }
    const main =
      tabs.find((tab) => tab.id === record.mainTabId) ??
      tabs.find((tab) => tab.id !== undefined);
    if (!main?.id) throw new Error(t("group.empty"));
    return { tabId: main.id, groupId };
  }

  async addTab(
    sessionID: string,
    tabId: number,
    options: { makeMain?: boolean; activate?: boolean } = {},
  ): Promise<number> {
    return this.serialize(async () => {
      const records = await this.load();
      const record = records.find((item) => item.sessionID === sessionID);
      if (record) {
        let alive = true;
        try {
          await chrome.tabGroups.get(record.groupId);
        } catch {
          alive = false;
        }
        if (alive) {
          await this.assertSameWindow(record.groupId, tabId);
          await chrome.tabs.group({ tabIds: [tabId], groupId: record.groupId });
          if (options.makeMain) {
            record.mainTabId = tabId;
            await this.save();
          }
          if (options.activate) await activateTab(tabId, "attach tab to session");
          return record.groupId;
        }
        this.records = records.filter((item) => item !== record);
      }
      // Sem grupo: a aba anexada vira a principal, sem criar about:blank.
      const groupId = await this.createGroupLocked(sessionID, tabId);
      if (options.activate) await activateTab(tabId, "attach tab to session");
      return groupId;
    });
  }

  /**
   * `chrome.tabs.group` move a aba para a janela do grupo. Anexar uma aba de
   * outra janela arrastaria justamente o que o usuário está usando, então
   * recusamos e explicamos como proceder.
   */  private async assertSameWindow(groupId: number, tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab?.windowId === undefined) return;
    const groupTabs = await chrome.tabs
      .query({ groupId })
      .catch(() => [] as chrome.tabs.Tab[]);
    const windowId = groupTabs.find(
      (item) => item.windowId !== undefined,
    )?.windowId;
    if (windowId === undefined || windowId === tab.windowId) return;
    throw new Error(
      t("group.otherWindow"),
    );
  }

  /** Valida a anexação antes de pedir permissão, para não aprovar algo que falha. */
  async assertAttachable(sessionID: string, tabId: number): Promise<void> {
    const record = await this.get(sessionID);
    if (!record) return;
    try {
      await chrome.tabGroups.get(record.groupId);
    } catch {
      return;
    }
    await this.assertSameWindow(record.groupId, tabId);
  }

  /**
   * Grupo colapsado não renderiza as abas (leitura volta vazia e input por
   * coordenada erra o alvo). Expandir não muda o foco nem a aba ativa.
   */
  private async expandGroup(groupId: number): Promise<void> {
    const group = await chrome.tabGroups.get(groupId).catch(() => undefined);
    if (!group?.collapsed) return;
    await chrome.tabGroups
      .update(groupId, { collapsed: false })
      .catch(() => undefined);
  }

  /** Aba que as ferramentas usam quando nenhum `tabId` é informado. */
  async currentTabId(sessionID: string): Promise<number | null> {
    const record = await this.get(sessionID);
    if (!record) return null;
    const tabs = await chrome.tabs
      .query({ groupId: record.groupId })
      .catch(() => []);
    if (tabs.some((tab) => tab.id === record.mainTabId)) {
      return record.mainTabId;
    }
    return tabs.find((tab) => tab.id !== undefined)?.id ?? null;
  }

  async detachTab(sessionID: string, tabId: number): Promise<void> {
    const record = await this.get(sessionID);
    if (!record) throw new Error(t("group.noAttachedTabs"));
    const groupTabs = await chrome.tabs.query({ groupId: record.groupId });
    if (!groupTabs.some((tab) => tab.id === tabId)) {
      throw new Error(t("group.tabNotInConversation"));
    }
    await chrome.tabs.ungroup(tabId);
  }

  async createTab(
    sessionID: string,
    url = "about:blank",
    active = false,
  ): Promise<number> {
    return this.serialize(async () => {
      const records = await this.load();
      const record = records.find((item) => item.sessionID === sessionID);
      if (record) {
        try {
          await chrome.tabGroups.get(record.groupId);
        } catch {
          this.records = records.filter((item) => item !== record);
        }
      }
      const current = this.records?.find(
        (item) => item.sessionID === sessionID,
      );
      if (current) await this.expandGroup(current.groupId);

      // Sem grupo: a aba já nasce dentro dele, sem about:blank intermediário.
      if (!current) {
        const window = await chrome.windows
          .getLastFocused()
          .catch(() => undefined);
        // Nasce em segundo plano; ativar é decisão explícita do usuário.
        const created = await chrome.tabs.create({
          windowId: window?.id,
          url,
          active: false,
        });
        if (created.id === undefined) throw new Error(t("group.createTabFailed"));
        await this.createGroupLocked(sessionID, created.id);
        if (active) await activateTab(created.id, "open session tab");
        return created.id;
      }

      const tabs = await chrome.tabs
        .query({ groupId: current.groupId })
        .catch(() => []);
      const main = tabs.find((tab) => tab.id === current.mainTabId);
      const mainUrl = main?.url ?? main?.pendingUrl;
      // Reaproveita a aba principal se estiver em branco ou na mesma base.
      if (
        main?.id !== undefined &&
        (isBlankUrl(mainUrl) || sameBaseUrl(mainUrl, url))
      ) {
        await chrome.tabs.update(main.id, { url });
        if (active) await activateTab(main.id, "open session tab");
        return main.id;
      }

      const source = await chrome.tabs
        .get(current.mainTabId)
        .catch(() => undefined);
      const tab = await chrome.tabs.create({
        windowId: source?.windowId,
        url,
        active: false,
      });
      if (tab.id === undefined) throw new Error(t("group.createTabFailed"));
      await chrome.tabs.group({ tabIds: [tab.id], groupId: current.groupId });
      if (!tabs.some((item) => item.id === current.mainTabId)) {
        current.mainTabId = tab.id;
        await this.save();
      }
      if (active) await activateTab(tab.id, "open session tab");
      return tab.id;
    });
  }

  async closeTab(sessionID: string, tabId: number): Promise<void> {
    const groupId = await this.groupOf(sessionID);
    if (groupId === null) throw new Error(noTabMessage());
    const tabs = await chrome.tabs.query({ groupId });
    if (!tabs.some((tab) => tab.id === tabId)) {
      throw new Error(t("group.tabNotInGroupShort"));
    }
    await chrome.tabs.remove(tabId);
  }

  async cleanup(): Promise<void> {
    await this.serialize(async () => {
      const records = await this.load(true);
      const known = new Set(records.map((record) => record.groupId));
      let groups: chrome.tabGroups.TabGroup[] = [];
      try {
        groups = (await chrome.tabGroups.query({})).filter((group) =>
          isManagedTitle(group.title),
        );
      } catch {
        return;
      }
      let changed = false;
      for (const group of groups) {
        if (known.has(group.id)) continue;
        const tabs = await chrome.tabs
          .query({ groupId: group.id })
          .catch(() => []);
        const blanks = tabs.filter(
          (tab) =>
            !tab.url ||
            tab.url === "about:blank" ||
            tab.url.startsWith("chrome://newtab"),
        );
        const keep = tabs.filter((tab) => !blanks.includes(tab));
        try {
          if (keep.length === 0) {
            for (const tab of blanks) {
              if (tab.id === undefined) continue;
              // Nunca fecha a aba que o usuário está usando: só desagrupa.
              if (tab.active) await chrome.tabs.ungroup(tab.id);
              else await chrome.tabs.remove(tab.id);
            }
          } else {
            const keepIds = keep
              .map((tab) => tab.id)
              .filter((id): id is number => id !== undefined);
            for (const id of keepIds) await chrome.tabs.ungroup(id);
          }
        } catch {
          // ignore individual failures
        }
        changed = true;
      }
      if (changed) await this.save();
    });
  }

  async groupOf(sessionID: string): Promise<number | null> {
    const records = await this.load(true);
    const record = records.find((item) => item.sessionID === sessionID);
    if (!record || !Number.isFinite(record.groupId)) return null;
    try {
      await chrome.tabGroups.get(record.groupId);
    } catch {
      return null;
    }
    return record.groupId;
  }
}
