// Clica num botão pelo texto (locator semântico) usando evento de mouse real
// no centro do getBoundingClientRect, e captura só a página do app.
//
// Uso: node cdp-click.mjs <porta> "<texto do botão>" <saida.png>
const [port, label, outPath] = process.argv.slice(2);

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === "page");
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
const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return reply.result?.result?.value;
};

const found = await evaluate(`(() => {
  const alvo = ${JSON.stringify(label)};
  const b = [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === alvo);
  if (!b) return { found: false };
  const r = b.getBoundingClientRect();
  return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, disabled: b.disabled };
})()`);

if (!found?.found) {
  console.log(JSON.stringify({ error: "botão não encontrado", label }));
  process.exit(1);
}

await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: found.x, y: found.y });
await send("Input.dispatchMouseEvent", {
  type: "mousePressed",
  x: found.x,
  y: found.y,
  button: "left",
  clickCount: 1,
});
await send("Input.dispatchMouseEvent", {
  type: "mouseReleased",
  x: found.x,
  y: found.y,
  button: "left",
  clickCount: 1,
});
await new Promise((r) => setTimeout(r, 800));

const state = await evaluate(`(() => ({
  texto: document.body.innerText.slice(0, 700)
}))()`);

const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
const { writeFile } = await import("node:fs/promises");
await writeFile(outPath, Buffer.from(shot.result.data, "base64"));
ws.close();

console.log(JSON.stringify({ click: found, state, screenshot: outPath }, null, 2));
