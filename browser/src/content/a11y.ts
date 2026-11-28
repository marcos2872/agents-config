interface ElementInfo {
  ref: string
  role: string
  name: string
  tag: string
  type?: string
  value?: string
  checked?: boolean
  disabled?: boolean
  rect: { x: number; y: number; width: number; height: number }
}

interface TreeOptions {
  filter?: "interactive" | "all"
  depth?: number
  refId?: string
  maxChars?: number
  includeHidden?: boolean
}

interface TreeResult {
  pageContent: string
  viewport: { width: number; height: number }
  count: number
  url: string
}

const ROLE_BY_TAG: Record<string, string> = {
  a: "link",
  button: "button",
  select: "combobox",
  textarea: "textbox",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  img: "image",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  section: "region",
  article: "article",
  aside: "complementary",
  form: "form",
  table: "table",
  ul: "list",
  ol: "list",
  li: "listitem",
  label: "label",
  dialog: "dialog",
}

const INTERACTIVE_ROLES = new Set([
  "link",
  "button",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "tab",
  "switch",
  "slider",
  "searchbox",
  "spinbutton",
])

const SKIP_TAGS = new Set(["script", "style", "noscript", "meta", "link", "head", "template"])

function roleOf(element: Element): string {
  const explicit = element.getAttribute("role")
  if (explicit) return explicit
  const tag = element.tagName.toLowerCase()
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase()
    if (type === "submit" || type === "button" || type === "reset" || type === "file") return "button"
    if (type === "checkbox") return "checkbox"
    if (type === "radio") return "radio"
    if (type === "search") return "searchbox"
    if (type === "range") return "slider"
    return "textbox"
  }
  return ROLE_BY_TAG[tag] ?? "generic"
}

function isSensitive(element: Element): boolean {
  const tag = element.tagName.toLowerCase()
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "").toLowerCase()
    if (type === "password" || type === "hidden") return true
  }
  const autocomplete = (element.getAttribute("autocomplete") ?? "").toLowerCase()
  return [
    "current-password",
    "new-password",
    "one-time-code",
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
  ].some((token) => autocomplete.includes(token))
}

function textOf(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160)
}

function labelFor(element: Element): string {
  const id = element.getAttribute("id")
  if (!id) return ""
  const label = document.querySelector(`label[for="${CSS.escape(id)}"]`)
  return label ? textOf(label) : ""
}

function accessibleName(element: Element): string {
  const aria = element.getAttribute("aria-label")
  if (aria?.trim()) return aria.trim().slice(0, 160)
  const labelledBy = element.getAttribute("aria-labelledby")
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text.slice(0, 160)
  }
  const tag = element.tagName.toLowerCase()
  if (tag === "img") return (element.getAttribute("alt") ?? "").slice(0, 160)
  if (tag === "input" || tag === "textarea" || tag === "select") {
    if (isSensitive(element)) {
      const hint =
        labelFor(element) ||
        element.getAttribute("placeholder") ||
        element.getAttribute("title") ||
        ""
      return hint ? `${hint} [value redacted]` : "[value redacted]"
    }
    const value = (element as HTMLInputElement).value
    const placeholder = element.getAttribute("placeholder")
    const label = labelFor(element)
    if (label) return label.slice(0, 160)
    if (placeholder) return placeholder.slice(0, 160)
    if (value && tag !== "select") return String(value).slice(0, 80)
    if (tag === "select") {
      const select = element as HTMLSelectElement
      return (select.selectedOptions[0]?.textContent ?? "").trim().slice(0, 160)
    }
  }
  const title = element.getAttribute("title")
  if (title?.trim()) return title.trim().slice(0, 160)
  const text = textOf(element)
  if (text) return text
  return ""
}

function isVisible(element: Element): boolean {
  let current: Element | null = element
  for (let depth = 0; current && depth < 10; depth += 1) {
    const style = window.getComputedStyle(current)
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false
    current = current.parentElement
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 || element.children.length > 0
}

function isInteractive(element: Element, role: string): boolean {
  if (INTERACTIVE_ROLES.has(role)) return true
  if (element.hasAttribute("onclick")) return true
  if (element.hasAttribute("contenteditable")) return true
  const tabindex = element.getAttribute("tabindex")
  return tabindex !== null && Number(tabindex) >= 0
}

function rectOf(element: Element) {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function install(): void {
  const existing = (window as unknown as { __piA11y?: unknown }).__piA11y
  if (existing) return

  const elementToRef = new WeakMap<Element, string>()
  const refToElement = new Map<string, Element>()
  let counter = 0

  function refOf(element: Element): string {
    let ref = elementToRef.get(element)
    if (!ref) {
      counter += 1
      ref = `ref_${counter}`
      elementToRef.set(element, ref)
      refToElement.set(ref, element)
    }
    return ref
  }

  function describe(element: Element): ElementInfo {
    const role = roleOf(element)
    const tag = element.tagName.toLowerCase()
    const info: ElementInfo = {
      ref: refOf(element),
      role,
      name: accessibleName(element),
      tag,
      rect: rectOf(element),
    }
    const type = element.getAttribute("type")
    if (type) info.type = type
    if (element instanceof HTMLInputElement) {
      if (type === "checkbox" || type === "radio") info.checked = element.checked
      if (!isSensitive(element) && element.value) info.value = element.value.slice(0, 120)
      info.disabled = element.disabled
    }
    if (element instanceof HTMLTextAreaElement) {
      if (element.value) info.value = element.value.slice(0, 120)
      info.disabled = element.disabled
    }
    if (element instanceof HTMLSelectElement) {
      info.value = element.selectedOptions[0]?.textContent?.trim().slice(0, 80)
      info.disabled = element.disabled
    }
    if (element instanceof HTMLButtonElement) {
      info.disabled = element.disabled
    }
    if ((element as HTMLElement).isContentEditable) info.role = "textbox"
    return info
  }

  function walk(
    node: Element,
    depth: number,
    maxDepth: number,
    filter: "interactive" | "all",
    includeHidden: boolean,
    lines: string[],
    collected: ElementInfo[],
  ): void {
    if (depth > maxDepth) return
    const tag = node.tagName.toLowerCase()
    if (SKIP_TAGS.has(tag)) return
    if (!includeHidden && !isVisible(node)) return
    const role = roleOf(node)
    const interactive = isInteractive(node, role)
    if (filter === "all" || interactive) {
      const info = describe(node)
      collected.push(info)
      if (filter === "all" || interactive) {
        const indent = "  ".repeat(Math.min(depth, 12))
        const bits = [`${indent}[${info.ref}] ${info.role}`]
        if (info.name) bits.push(`"${info.name.replace(/"/g, '\\"')}"`)
        if (info.value) bits.push(`= ${JSON.stringify(info.value)}`)
        if (info.checked !== undefined) bits.push(`(${info.checked ? "checked" : "unchecked"})`)
        if (info.disabled) bits.push("(disabled)")
        lines.push(bits.join(" "))
      }
    }
    for (const child of Array.from(node.children)) {
      walk(child, depth + 1, maxDepth, filter, includeHidden, lines, collected)
    }
  }

  function generate(options: TreeOptions = {}): TreeResult {
    const filter = options.filter === "interactive" ? "interactive" : "all"
    const maxDepth = Math.max(1, Math.min(options.depth ?? 12, 30))
    const includeHidden = options.includeHidden ?? filter === "all"
    const lines: string[] = []
    const collected: ElementInfo[] = []
    let root: Element | null = document.body ?? document.documentElement
    if (options.refId) {
      root = refToElement.get(options.refId) ?? null
      if (!root)
        return {
          pageContent: `Ref ${options.refId} not found.`,
          viewport: viewport(),
          count: 0,
          url: location.href,
        }
    }
    if (root) walk(root, 0, maxDepth, filter, includeHidden, lines, collected)
    const maxChars = Math.max(1000, options.maxChars ?? 50_000)
    let text = lines.join("\n")
    if (text.length > maxChars) {
      const cut = text.lastIndexOf("\n", maxChars)
      text = text.slice(0, cut > 0 ? cut : maxChars)
      text += `\n\n[truncado em ${maxChars} de ${lines.join("\n").length} caracteres]`
    }
    return { pageContent: text, viewport: viewport(), count: collected.length, url: location.href }
  }

  function viewport() {
    return { width: window.innerWidth, height: window.innerHeight }
  }

  function elements(): ElementInfo[] {
    const collected: ElementInfo[] = []
    const root = document.body ?? document.documentElement
    if (!root) return collected
    const visit = (node: Element, depth: number) => {
      if (depth > 30 || collected.length >= 4000) return
      const tag = node.tagName.toLowerCase()
      if (SKIP_TAGS.has(tag)) return
      if (isVisible(node)) collected.push(describe(node))
      for (const child of Array.from(node.children)) visit(child, depth + 1)
    }
    visit(root, 0)
    return collected
  }

  function resolve(ref: string): (ElementInfo & { x: number; y: number }) | null {
    const element = refToElement.get(ref)
    if (!element) return null
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior })
    const rect = element.getBoundingClientRect()
    return {
      ...describe(element),
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
    }
  }

  function setValue(ref: string, value: string): { ok: boolean; error?: string } {
    const element = refToElement.get(ref)
    if (!element) return { ok: false, error: `Ref ${ref} not found.` }
    const tag = element.tagName.toLowerCase()
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" || element.type === "radio") {
        const desired = value === "true" || value === "1" || value === "checked"
        if (element.checked !== desired) element.click()
        return { ok: true }
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      element.focus()
      setter?.call(element, value)
      element.dispatchEvent(new Event("input", { bubbles: true }))
      element.dispatchEvent(new Event("change", { bubbles: true }))
      return { ok: true }
    }
    if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      element.focus()
      setter?.call(element, value)
      element.dispatchEvent(new Event("input", { bubbles: true }))
      element.dispatchEvent(new Event("change", { bubbles: true }))
      return { ok: true }
    }
    if (element instanceof HTMLSelectElement) {
      const option = Array.from(element.options).find(
        (item) => item.value === value || item.textContent?.trim() === value,
      )
      if (!option) return { ok: false, error: "Option not found in the select." }
      element.value = option.value
      element.dispatchEvent(new Event("input", { bubbles: true }))
      element.dispatchEvent(new Event("change", { bubbles: true }))
      return { ok: true }
    }
    if ((element as HTMLElement).isContentEditable) {
      ;(element as HTMLElement).focus()
      ;(element as HTMLElement).textContent = value
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }))
      return { ok: true }
    }
    if (tag === "a" || tag === "button") {
      ;(element as HTMLElement).click()
      return { ok: true }
    }
    return { ok: false, error: `Element <${tag}> does not accept a value.` }
  }

  function pageText(maxChars = 50_000) {
    const candidates = [
      document.querySelector("article"),
      document.querySelector("main"),
      document.querySelector('[role="main"]'),
      document.body,
    ].filter((item): item is HTMLElement => item instanceof HTMLElement)
    const source = candidates.find((item) => (item.innerText ?? "").trim().length > 200) ?? candidates[0]
    if (!source) return { text: "", title: document.title, url: location.href, source: "body" }
    const text = (source.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim()
    const cut = text.lastIndexOf("\n", maxChars)
    const truncated =
      text.length > maxChars ? `${text.slice(0, cut > 0 ? cut : maxChars)}\n\n[truncado]` : text
    return { text: truncated, title: document.title, url: location.href, source: source.tagName.toLowerCase() }
  }

  function dispatchMouse(element: Element, type: string): void {
    const rect = element.getBoundingClientRect()
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      }),
    )
  }

  function clickRef(ref: string): { ok: boolean; error?: string } {
    const element = refToElement.get(ref)
    if (!element) return { ok: false, error: `Ref ${ref} not found.` }
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior })
    dispatchMouse(element, "mouseover")
    dispatchMouse(element, "mousemove")
    dispatchMouse(element, "mousedown")
    dispatchMouse(element, "mouseup")
    dispatchMouse(element, "click")
    return { ok: true }
  }

  function hoverRef(ref: string): { ok: boolean; error?: string } {
    const element = refToElement.get(ref)
    if (!element) return { ok: false, error: `Ref ${ref} not found.` }
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior })
    dispatchMouse(element, "mouseover")
    dispatchMouse(element, "mousemove")
    return { ok: true }
  }

  function scrollRef(ref: string): { ok: boolean; error?: string } {
    const element = refToElement.get(ref)
    if (!element) return { ok: false, error: `Ref ${ref} not found.` }
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior })
    return { ok: true }
  }

  function focusRef(ref: string): { ok: boolean; error?: string } {
    const element = refToElement.get(ref)
    if (!element) return { ok: false, error: `Ref ${ref} not found.` }
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior })
    if (element instanceof HTMLElement) element.focus()
    return { ok: true }
  }

  function uploadFiles(
    ref: string,
    files: Array<{ data: string; name: string; mimeType?: string }>,
  ): { ok: boolean; target?: string; error?: string } {
    const element = refToElement.get(ref)
    if (!element) return { ok: false, error: `Ref ${ref} not found.` }
    let transfer: DataTransfer
    try {
      transfer = new DataTransfer()
      for (const file of files) {
        const binary = atob(file.data)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        transfer.items.add(new File([bytes], file.name, { type: file.mimeType || "application/octet-stream" }))
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Falha ao montar o arquivo." }
    }

    const input =
      element instanceof HTMLInputElement && element.type === "file"
        ? element
        : element.querySelector<HTMLInputElement>('input[type="file"]')
    if (input) {
      input.files = transfer.files
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))
      return { ok: true, target: "input" }
    }

    const rect = element.getBoundingClientRect()
    const init: DragEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
      dataTransfer: transfer,
    }
    element.dispatchEvent(new DragEvent("dragenter", init))
    element.dispatchEvent(new DragEvent("dragover", init))
    element.dispatchEvent(new DragEvent("drop", init))
    return { ok: true, target: "drop" }
  }

  ;(window as unknown as { __piA11y: unknown }).__piA11y = {
    generate,
    elements,
    resolve,
    setValue,
    pageText,
    clickRef,
    hoverRef,
    scrollRef,
    focusRef,
    uploadFiles,
  }
}

install()
