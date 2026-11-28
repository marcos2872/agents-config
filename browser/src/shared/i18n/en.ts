/**
 * Catálogo de mensagens em inglês (fonte única; o modelo lê inglês fixo).
 * Sem o par pt-BR nesta versão sem UI: só as chaves usadas pelos módulos do
 * núcleo importam, as demais ficam como peso morto inofensivo.
 */
export const en = {
  // ---------------------------------------------------------------- genéricos
  "app.loading": "Loading...",
  "app.loadingInline": "loading",
  "app.retry": "Try again",
  "app.reconnect": "Reconnect",
  "app.copyCommand": "Copy command",
  "app.openSettings": "Open settings",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.connected": "Connected.",
  "common.unavailable": (p: { value: string }) => `${p.value} (unavailable)`,

  // ------------------------------------------------------------- painel (App)
  "app.brand": "OpenCode",
  "app.settingsTitle": "Settings",
  "app.status.online": "online",
  "app.status.offline": "offline",
  "app.status.connecting": "connecting",
  "app.status.unknown": "...",
  "app.status.api": (p: { status: string }) => `API: ${p.status}`,
  "app.apiTitle": (p: { status: string; detail?: string }) =>
    p.detail ? `OpenCode API: ${p.status} — ${p.detail}` : `OpenCode API: ${p.status}`,
  "app.offline.startServer": "OpenCode offline — start the server to send",
  "app.offline.connecting": "Connecting to OpenCode…",
  "app.offline.unconfigured": "OpenCode not configured",
  "app.toast.paired": "Connected to OpenCode.",
  "app.toast.groupCreated": "New conversation created · tab group open",
  "app.confirm.deleteSession":
    "Delete this session? The history will be removed from OpenCode.",
  "app.waiting": "waiting for OpenCode",
  "app.working": "working",
  "app.thinking": "thinking",

  // --------------------------------------------------------------- onboarding
  "onboarding.title": "Connect your browser to the OpenCode on your machine",
  "onboarding.intro.1": "The extension uses the local API of",
  "onboarding.intro.product": "OpenCode Terminal (v2)",
  "onboarding.intro.2":
    ". Pairing creates a single-use token that expires in 5 minutes. Nothing leaves your computer.",
  "onboarding.step1": "In the terminal, run:",
  "onboarding.step2":
    "Copy the link shown (the same one that opens the OpenCode web interface) and paste it below.",
  "onboarding.step3": "Click connect.",
  "onboarding.pairLabel": "`opencode pair` link",
  "onboarding.pairBusy": "Connecting...",
  "onboarding.pairAction": "Connect to OpenCode",
  "onboarding.tip":
    "Tip: you can run `opencode pair` again at any time. The previous token stays valid until you disconnect.",
  "onboarding.plugin.title": "Install the browser tools plugin",
  "onboarding.plugin.body":
    "The chat works with the API alone. For the agent to control Chrome, install the plugin in OpenCode and restart the service.",
  "onboarding.plugin.connected": "Plugin connected",
  "onboarding.plugin.reconnect": "Reconnect",

  // --------------------------------------------------------------- session bar
  "session.listTitle": "OpenCode sessions",
  "session.empty": "No sessions",
  "session.busySuffix": " · running",
  "session.unreadSuffix": " · new reply",
  "session.agentTitle": "OpenCode agent",
  "session.tabNoAddress": "Tab without address",
  "session.tabNoTitle": "Tab without title",
  "session.attach.title": (p: { count: number; error: string | null }) => {
    if (p.count > 0) {
      return `${p.count} ${p.count === 1 ? "connected tab" : "connected tabs"}. Show tabs or connect a new one`
    }
    return p.error
      ? `${p.error}. Click to connect the current tab`
      : "Connect current tab"
  },
  "session.attach.aria": (p: { count: number }) =>
    p.count > 0
      ? `Show ${p.count} ${p.count === 1 ? "connected tab" : "connected tabs"}`
      : "Connect current tab",
  "session.attach.current": "Connect current tab",
  "session.attach.menu": "Connected tabs",
  "session.attach.remove": (p: { title: string }) =>
    `Remove ${p.title || "tab"} from the context`,
  "session.attach.add": "Connect a new tab",
  "session.new": "New conversation",
  "session.newBusy": "Creating conversation…",
  "session.delete": "Delete session",
  "session.fallbackLabel": (p: { id: string }) => `Session ${p.id}`,

  // ----------------------------------------------------------------- composer
  "composer.placeholder.busy": "The agent is working...",
  "composer.placeholder.idle": "Ask OpenCode something...",
  "composer.inputLabel": "Message to the agent",
  "composer.hint": "Enter sends · Shift+Enter breaks the line",
  "composer.send": "Send (Enter)",
  "composer.stop": "Stop",
  "composer.contextPercent": (p: { tokens: string; percent: number }) =>
    `Context ${p.tokens} (${p.percent}%)`,
  "composer.contextTokens": (p: { tokens: string }) => `Context ${p.tokens} tokens`,
  "composer.sessionCost": (p: { cost: string }) => `Session ${p.cost}`,
  "composer.usageHint":
    "Tokens of the last request / model window · cost reported by OpenCode",
  "composer.toolsOn": "tools connected",
  "composer.toolsOff": "tools offline",
  "composer.toolsOnHint": "Browser plugin connected; tools available",
  "composer.toolsOffHint": "Browser plugin disconnected; tools unavailable",

  // ------------------------------------------------------------------- banner
  "banner.connecting.title": "Connecting to OpenCode…",
  "banner.connecting.detail":
    "If the server is not running yet, start OpenCode in the terminal with `opencode serve`.",
  "banner.unauthorized.title": "OpenCode token invalid or expired",
  "banner.unauthorized.detail":
    "Run `opencode pair` in the terminal, paste the new link in the settings and try again.",
  "banner.timeout.title": "OpenCode took too long to respond",
  "banner.timeout.detail":
    "The server may be stuck. Restart OpenCode and try again.",
  "banner.serverError.title": "OpenCode responded with an error",
  "banner.serverError.detail": "Check the OpenCode server log and try again.",
  "banner.streamClosed.title": "The connection to OpenCode was closed",
  "banner.streamClosed.detail":
    "Try reconnecting. If the problem persists, restart OpenCode in the terminal.",
  "banner.unreachable.title": "OpenCode is not responding",
  "banner.unreachable.detail":
    "Start OpenCode in the terminal with `opencode serve` and click Try again.",
  "banner.toolsOffline.title": "Browser tools disconnected",
  "banner.reconnectPlugin": "Reconnect plugin",

  // ----------------------------------------------------------- relay (plugin)
  "relay.connected": "Plugin connected",
  "relay.disconnected": "Plugin disconnected",
  "relay.missing": "Plugin not found — install the plugin and restart OpenCode",
  "relay.rejected": "Plugin refused the connection — check the extension ID",
  "relay.silent": "Plugin stopped responding — restart OpenCode",
  "relay.closed": "Plugin disconnected — restart OpenCode to reconnect",

  // ------------------------------------------------------------- model picker
  "model.title": "OpenCode model",
  "model.empty": "No models",
  "model.noTools": " (no tools)",
  "model.variantTitle": "Model variant",

  // ------------------------------------------------------------- tools (chat)
  "tool.tabs_context": "Group tabs",
  "tool.tabs_create": "New tab",
  "tool.tabs_close": "Close tab",
  "tool.tabs_attach": "Attach tab",
  "tool.navigate": "Navigate",
  "tool.read_page": "Read page",
  "tool.find": "Find element",
  "tool.get_page_text": "Extract text",
  "tool.form_input": "Fill field",
  "tool.computer": "Interact",
  "tool.javascript_tool": "JavaScript",
  "tool.read_console_messages": "Console",
  "tool.read_network_requests": "Network",
  "tool.resize_window": "Resize",
  "tool.update_plan": "Plan",
  "tool.browser_batch": "Action batch",
  "tool.batch": "Action batch",
  "tool.upload_image": "Upload file",
  "tool.gif_creator": "Record GIF",
  "tool.question": "Question",
  "tool.tabRef": (p: { id: number }) => `tab ${p.id}`,
  "tool.actionsCount": (p: { count: number }) => `${p.count} action(s)`,
  "tool.status.ok": "ok",
  "tool.status.error": "error",
  "tool.status.running": "running",
  "tool.status.waiting": "waiting",
  "tool.params": "Parameters",
  "tool.result": "Result",
  "tool.multipleChoice": " · multiple choice",
  "tool.runCount": (p: { count: number }) =>
    `${p.count} tool${p.count > 1 ? "s" : ""}`,
  "tool.runErrors": (p: { count: number }) => `${p.count} error${p.count > 1 ? "s" : ""}`,
  "tool.runOpen": "view",
  "tool.modalTitle": "Tools in this run",
  "tool.modalOnlyErrors": "Errors only",

  // ------------------------------------------------------------ chat (vazio)
  "chat.empty.title": "Your browser, with OpenCode models",
  "chat.empty.body":
    "The agent runs on your machine and gets an isolated tab group to browse, read and interact. Every sensitive action asks for your permission.",
  "chat.suggestion.news": "Open Hacker News and summarize today's top 5 stories.",
  "chat.suggestion.form":
    "Read the current page, find the contact form and fill it with test data.",
  "chat.suggestion.console":
    "Investigate the console errors and network requests on this page.",
  "chat.suggestion.price":
    "Look up the price of a product in three stores and compare them in a table.",
  "chat.reasoning": "Reasoning",

  // -------------------------------------------------------- atividade (gerúndio)
  "activity.clicking": "clicking",
  "activity.typing": "typing",
  "activity.pressingKeys": "pressing keys",
  "activity.scrolling": "scrolling the page",
  "activity.hovering": "hovering",
  "activity.screenshot": "capturing the screen",
  "activity.zoom": "zooming the screen",
  "activity.waiting": "waiting",
  "activity.interacting": "interacting with the page",
  "activity.back": "going back a page",
  "activity.forward": "going forward a page",
  "activity.navigating": "navigating",
  "activity.readingPage": "reading the page",
  "activity.readingPageAllFrames": "reading the page (all frames)",
  "activity.clickingShort": "Clicking",
  "activity.capturingRegion": "Capturing region",
  "activity.scrollingShort": "Scrolling",
  "activity.hoveringShort": "Hovering",
  "activity.runningJs": "Running JavaScript",
  "activity.readingText": "reading the page text",
  "activity.finding": "searching the page",
  "activity.filling": "filling a field",
  "activity.tabsContext": "checking the tabs",
  "activity.tabOpening": "opening a tab",
  "activity.tabClosing": "closing a tab",
  "activity.tabAttaching": "connecting the tab",
  "activity.script": "running a script",
  "activity.console": "reading the console",
  "activity.network": "checking the network",
  "activity.resizing": "resizing the window",
  "activity.planning": "planning the next steps",
  "activity.batch": "running actions",
  "activity.uploading": "uploading a file",
  "activity.recording": "recording the screen",
  "activity.question": "waiting for your answer",
  "activity.working": "working",
  "activity.writing": "writing the reply",
  "activity.thinking": "thinking",
  "activity.prefix": (p: { detail: string }) => `working: ${p.detail}`,

  // --------------------------------------------------------------- permissões
  "permission.title": "Permission request",
  "permission.session": (p: { label: string }) => `Session: ${p.label}`,
  "permission.planIntro": "The agent wants to visit these domains before continuing.",
  "permission.domainIntro":
    "The agent wants to switch domains. This changes what it can access.",
  "permission.actionIntro": (p: { tool: string }) => `${p.tool} · permission request`,
  "permission.screenshotAlt": "Action preview",
  "permission.approvePlan": "Approve plan",
  "permission.allow": "Allow",
  "permission.deny": "Deny",
  "permission.allowAlwaysDomain": (p: { domain: string }) =>
    `Always allow for ${p.domain}`,
  "permission.allowOnce": "Allow once",
  "permission.scopeLabel": "Broader permissions",
  "permission.allowSession": "Allow in this session",
  "permission.allowAlways": (p: { host: string }) =>
    `Always allow for ${p.host || "this site"}`,
  "permission.denyAction": "Deny",
  "permission.footnote":
    "You can revoke permissions in Settings. The agent should never buy things, create accounts or bypass captchas without your confirmation.",
  "permission.tool.navigate": "Navigation",
  "permission.tool.computer": "Page interaction",
  "permission.tool.form_input": "Form filling",
  "permission.tool.javascript_tool": "JavaScript execution",
  "permission.tool.tabs_close": "Tab close",
  "permission.tool.upload_image": "File upload",
  "permission.tool.gif_creator": "GIF export",
  "permission.tool.update_plan": "Browsing plan",
  "permission.ask.closeTab": "Close tab",
  "permission.ask.attachTab": "Give the agent access to this tab",
  "permission.ask.screenshot": "Take a screenshot",
  "permission.ask.zoom": "Capture a zoomed region",
  "permission.ask.javascript": "Run JavaScript on the page",
  "permission.ask.upload": "Upload a file to the page",
  "permission.ask.exportGif": "Export the recording GIF",
  "permission.ask.fillField": (p: { ref: string }) => `Fill field ${p.ref}`,
  "permission.ask.approvePlan": "Approve browsing plan",
  "permission.ask.navigateTo": (p: { to: string }) => `Navigate to ${p.to}`,
  "permission.ask.navigateFromTo": (p: { from: string; to: string }) =>
    `Navigate from ${p.from} to ${p.to}`,
  "permission.ask.click": "Click on the page",
  "permission.ask.type": "Type on the page",
  "permission.ask.key": "Press a key",
  "permission.ask.scroll": "Scroll the page",
  "permission.ask.hover": "Move the mouse",
  "permission.ask.action": (p: { action: string }) => `Action: ${p.action}`,
  "permission.ask.tab": (p: { id: number }) => `Tab ${p.id}`,
  "permission.ask.coordinate": (p: { x: number; y: number }) => `Coordinate ${p.x}, ${p.y}`,

  // ------------------------------------------------------------------- forms
  "form.question": "Question",
  "form.yes": "Yes",
  "form.otherAnswer": "Other answer",
  "form.submit": "Answer",
  "form.cancel": "Cancel",

  // -------------------------------------------------- configurações (options)
  "options.title": "OpenCode Browser",
  "options.openPanel": "Open panel",
  "options.lead": "Settings for the extension that connects Chrome to local OpenCode models.",
  "options.navigation": "Settings sections",
  "options.sessions": "Sessions and model",
  "options.behavior": "Behavior",
  "options.chat": "Chat and tools",
  "options.unsaved": "You have unsaved changes",
  "options.savedStatus": "All changes saved",
  "options.discard": "Discard",
  "options.saveChanges": "Save changes",
  "options.saving": "Saving…",
  "options.saveListsFailed": (p: { detail: string }) =>
    `Settings were saved, but site lists were not. Try saving again. ${p.detail}`,
  "options.language.title": "Language",
  "options.language.label": "Interface language",
  "options.language.auto": "Automatic (browser language)",
  "options.language.hint":
    "Applies to the panel, the settings, the on-page indicator and notifications. Saves automatically; agent replies follow the language of your message.",
  "options.connection": "Connection",
  "options.api": (p: { state: string }) => `API: ${p.state}`,
  "options.apiUnconfigured": "not configured",
  "options.apiUnauthorized": "offline — invalid or expired token",
  "options.apiTimeout": "offline — the server did not respond in time",
  "options.apiServerError": "offline — the server responded with an error",
  "options.apiStreamClosed": "offline — connection closed",
  "options.apiUnreachable": "offline — server did not respond",
  "options.tools": (p: { state: string }) => `Tools: ${p.state}`,
  "options.reconnect": "Reconnect",
  "options.reconnectPlugin": "Reconnect plugin",
  "options.server": "Server",
  "options.token": "Token",
  "options.tokenHidden": (p: { head: string; tail: string }) =>
    `${p.head}…${p.tail} (hidden)`,
  "options.workspace.label": "Browser conversations folder",
  "options.workspace.hint":
    "Conversations created by the extension live in this folder, and the extension only lists the ones inside it. The plugin creates the folder and reports the path automatically (default:",
  "options.disconnect": "Disconnect",
  "options.confirmDisconnect": "Disconnect from this OpenCode? The token will be removed.",
  "options.disconnected": "Disconnected.",
  "options.pairLabel": "`opencode pair` link",
  "options.pairBusy": "Connecting...",
  "options.pairAction": "Connect",
  "options.defaultModel": "Default model",
  "options.defaultModelHint":
    "Used when creating new sessions. You can switch per conversation in the panel picker.",
  "options.followGroups":
    "Show the conversation of the focused tab group in the panel (each session is bound to its group)",
  "options.autoGroup":
    "Create a tab group when starting a new conversation (opens a blank tab in the background; when off, the group appears only when the agent uses the browser)",
  "options.modelsCount": (p: { count: number }) =>
    `${p.count} model(s) available. Models without tool support can still chat, but do not control the browser.`,
  "options.permissions": "Permissions",
  "options.permissionsHint":
    "Actions that change the page (click, type, navigate, run JS) follow the mode below. Reading the page, console and network is always allowed.",
  "options.mode.ask": "Ask on every site",
  "options.mode.askHint": "Asks on the first action on each domain.",
  "options.mode.allow": "Allow actions automatically",
  "options.mode.allowHint": "Does not ask; uses the block list below.",
  "options.mode.allowWarning":
    "Actions on the site will run without asking for confirmation. Avoid this mode on sensitive sites.",
  "options.mode.deny": "Block actions",
  "options.mode.denyHint": "Read-only; no interaction is executed.",
  "options.timeout": "Time to answer a request:",
  "options.timeout.30": "30 seconds",
  "options.timeout.60": "1 minute",
  "options.timeout.120": "2 minutes",
  "options.timeout.300": "5 minutes",
  "options.findMode": "Element search:",
  "options.findMode.heuristic": "Heuristic (free)",
  "options.findMode.model": "OpenCode model (uses tokens)",
  "options.sound":
    "Play a sound when the agent finishes or asks for permission while the panel is closed",
  "options.notify":
    "Show a system notification when the agent finishes while the panel is closed",
  "options.bringToFront":
    "Allow tabs opened or attached by the agent to come to the front (when off, the extension works in the background and does not steal focus from the window you are in)",
  "options.toolDisplay": "Tools in the chat",
  "options.toolDisplay.grouped": "Grouped (open in a modal)",
  "options.toolDisplay.rows": "Compact rows, one per call",
  "options.toolDisplay.full": "Full cards, with parameters and result",
  "options.toolDisplay.hidden": "Hide tools and reasoning (only “working”)",
  "options.toolDisplayHint":
    "In grouped mode, one row summarizes the run and opens the full tool list; only the running tool stays in the chat. In “Hide”, reasoning and tools disappear and only the working indicator shows; agent questions remain visible.",
  "options.allowList": "Always allowed sites (one per line)",
  "options.denyList": "Always blocked sites (one per line)",
  "options.saved": "Settings saved.",
  "options.browserTools": "Browser tools",
  "options.browserToolsHint":
    "Exposed to OpenCode by the `browser-relay` plugin (namespace `browser`). The agent only sees tabs in the group created for the session.",
  "options.security": "Security",
  "options.securityHint":
    "The pairing token lives in this browser's `chrome.storage.local` and is sent only to the local OpenCode server. The plugin listens on `ws://127.0.0.1:8799` and accepts only this extension's origin. Even so, treat browser automation as code: review permissions and never leave \"allow automatically\" on sensitive sites.",
  "options.tool.tabs_context": "lists the tabs in the group",
  "options.tool.tabs_create": "creates a tab in the group",
  "options.tool.tabs_close": "closes a tab in the group",
  "options.tool.tabs_attach": "moves the current tab into the group",
  "options.tool.navigate": "navigates, goes back and forward",
  "options.tool.read_page": "accessibility tree with refs",
  "options.tool.find": "finds elements by text/role",
  "options.tool.get_page_text": "extracts the main text",
  "options.tool.form_input": "fills fields by ref",
  "options.tool.computer": "click, typing, keys, scroll, screenshot",
  "options.tool.javascript_tool": "runs JS on the page",
  "options.tool.read_console_messages": "reads console and errors",
  "options.tool.read_network_requests": "reads network requests",
  "options.tool.resize_window": "resizes the window",
  "options.tool.update_plan": "asks for domain approval",
  "options.tool.upload_image": "uploads files to inputs/drop zones",
  "options.tool.gif_creator": "records and exports a GIF of the actions",
  "options.tool.browser_batch": "runs several actions in sequence",

  // ------------------------------------------------------ indicador na página
  "indicator.defaultStatus": "OpenCode is on this tab",
  "indicator.stop": "Stop",
  "indicator.stopAria": "Stop the agent on this tab",

  // -------------------------------------------------------------- background
  "notify.permissionTitle": "OpenCode Browser: pending approval",
  "notify.formTitle": "OpenCode Browser",
  "notify.formNeedsAnswer": (p: { title: string }) =>
    p.title
      ? `The agent needs an answer: ${p.title}`
      : "The agent needs an answer.",
  "notify.done": (p: { session: string }) => `Done: ${p.session}`,
  "badge.configurePairing": "OpenCode Browser: configure pairing",
  "badge.unread": (p: { count: number }) =>
    `OpenCode Browser: ${p.count} conversation${p.count > 1 ? "s" : ""} with news`,
  "background.notConfigured": "OpenCode not configured.",
  "background.browserAgentUnavailable":
    "The OpenCode Browser agent is unavailable. Reconnect the plugin and try again.",
  "background.configureFirst": "Configure pairing first.",
  "background.invalidConfig": "Invalid configuration.",
  "background.noActiveSession": "No active session.",
  "background.sessionNotFound": "Session not found.",
  "background.sessionCreateFailed": "Could not create the session.",
  "background.unknownCommand": "Unknown command.",
  "background.noActiveTab": "No active tab found.",
  "background.unexpected": "Unexpected error from OpenCode.",
  "background.streamDropped":
    "The connection to OpenCode dropped during the run. The reply may be incomplete.",
  "background.streamClosed": "OpenCode closed the event stream.",
  "background.executionFailed": "The run failed in OpenCode without further details.",
  "background.temporaryError": "temporary error",
  "background.retrying": (p: { attempt: string; reason: string }) =>
    `Retrying${p.attempt}: ${p.reason}`,
  "background.attachCurrentTab": "Give the agent access to this tab",
  "background.swSilent": "The service worker did not respond.",
  "opencode.guidance.payment":
    "Check the balance and spending limits of OpenCode Go/the provider, or select another provider or model.",
  "opencode.guidance.auth":
    "Check the credentials and permissions configured for this provider in OpenCode.",
  "opencode.guidance.rateLimit":
    "The provider rate-limited the requests. Wait a moment or check the account quota and limits.",
  "opencode.pairInvalid": "Invalid link. Paste the full link shown by `opencode pair`.",
  "opencode.pairProtocol": "The link must start with http:// or https://.",
  "opencode.pairPath": "The link does not contain /auth/connect/<code>.",
  "opencode.unreachable": (p: { baseUrl: string }) =>
    `Could not reach OpenCode at ${p.baseUrl}. Is it running?`,
  "opencode.pairExpired": "Link expired or already used. Run `opencode pair` again.",
  "opencode.pairFailed": (p: { status: number }) => `Pairing failed (HTTP ${p.status}).`,
  "opencode.noToken": "The server did not return a session token.",
  "opencode.timeout": (p: { seconds: number }) =>
    `OpenCode did not respond within ${p.seconds}s. Is it still running?`,
  "opencode.sessionNoID": "Session created without an id.",
  "opencode.streamUnavailable": (p: { status: number }) =>
    `Event stream unavailable (HTTP ${p.status}).`,

  // ------------------------------------------------------- relay (background)
  "relayError.noAgent": "The plugin did not write the agent.",
  "relayError.disconnectedBeforeAgent": "The plugin disconnected before installing the agent.",
  "relayError.noResponse": "The plugin stopped responding.",
  "relayError.closedCode": (p: { code: number }) => `Connection closed (${p.code}).`,
  "relayError.pluginMissing": "OpenCode plugin not found.",
  "relayError.pluginNotConnected": "OpenCode plugin not connected.",
  "relayError.agentInstallSilent": "The plugin did not respond while installing the agent.",
  "relayError.sendFailed": "Failed to send the request to the plugin.",
  "relayError.closedBeforeAgent": "Connection closed before installing the agent.",

  // ---------------------------------------------------- chrome (background)
  "cdp.devtoolsOpen": "DevTools is open on this tab. Close DevTools and try again.",
  "cdp.attachFailed": (p: { error: string }) => `Could not attach the debugger: ${p.error}`,
  "cdp.jsUnknownError": "Unknown error while running JavaScript.",
  "cdp.noImage": "Chrome did not return the image.",
  "cdp.noScreenshot": "Could not capture the tab image.",
  "group.noTab":
    "This session has no browser tab. Use browser_tabs_create to open a page or browser_tabs_attach to use an already open tab.",
  "group.createFailed": "Could not create the group tab.",
  "group.tabNotInSession": (p: { tabId: number }) =>
    `Tab ${p.tabId} does not belong to this session.`,
  "group.tabNotInGroup": (p: { tabId: number }) =>
    `Tab ${p.tabId} does not belong to this session's group.`,
  "group.empty": "This session's group has no tabs.",
  "group.otherWindow":
    "The tab is in another window. Open a new tab from the session or move the tab to the group window before attaching it.",
  "group.noAttachedTabs": "The session has no attached tabs.",
  "group.tabNotInConversation": "The tab does not belong to this conversation's context.",
  "group.createTabFailed": "Could not create the tab.",
  "group.tabNotInGroupShort": "The tab does not belong to this session's group.",
  "offscreen.canvasUnavailable": "Canvas unavailable.",
}
