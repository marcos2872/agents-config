// Avalia uma expressão JS na página de um app Electron via CDP e imprime o
// resultado em JSON. Uso: node cdp-eval.mjs <porta> '<expressão>'
//
// Requer o app rodando com --remote-debugging-port=<porta>.
const port = process.argv[2];
const expr = process.argv[3];

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("nenhuma página encontrada");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
};

const reply = await send("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
});
ws.close();

if (reply.error) {
  console.error(JSON.stringify(reply.error));
  process.exit(1);
}
const result = reply.result?.result;
if (result?.subtype === "error" || reply.result?.exceptionDetails) {
  console.error(JSON.stringify(reply.result.exceptionDetails, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result?.value ?? result, null, 2));
