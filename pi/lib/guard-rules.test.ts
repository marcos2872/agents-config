import assert from "node:assert/strict"
import { test } from "node:test"
import { bloqueioDeCaminho, bloqueioDeComando } from "./guard-rules.ts"

test("sudo é bloqueado em qualquer posição do comando", () => {
  assert.ok(bloqueioDeComando("sudo dnf install htop"))
  assert.ok(bloqueioDeComando("cd /tmp && sudo rm x"))
  assert.ok(bloqueioDeComando("FOO=1 env sudo systemctl restart x"))
  assert.equal(bloqueioDeComando("echo 'não use sudo'"), undefined)
  assert.equal(bloqueioDeComando("pkexec /usr/local/libexec/msbos-priv x"), undefined)
})

test("apagar a raiz é bloqueado, o resto do rm passa", () => {
  assert.ok(bloqueioDeComando("rm -rf /"))
  assert.ok(bloqueioDeComando("rm -fr /*"))
  assert.ok(bloqueioDeComando("rm -rf --no-preserve-root /"))
  assert.equal(bloqueioDeComando("rm -rf ./build"), undefined)
  assert.equal(bloqueioDeComando("rm -r /tmp/x"), undefined)
  assert.equal(bloqueioDeComando("rm /"), undefined)
})

test("push forçado é bloqueado", () => {
  assert.ok(bloqueioDeComando("git push --force"))
  assert.ok(bloqueioDeComando("git push -f origin main"))
  assert.ok(bloqueioDeComando("git push -uf origin main"))
  assert.equal(bloqueioDeComando("git push --force-with-lease"), undefined)
  assert.equal(bloqueioDeComando("git push origin main"), undefined)
})

test("caminhos com credenciais são bloqueados", () => {
  assert.ok(bloqueioDeCaminho(".env"))
  assert.ok(bloqueioDeCaminho("/home/marcos/.env.local"))
  assert.ok(bloqueioDeCaminho("~/.ssh/id_rsa"))
  assert.ok(bloqueioDeCaminho(".ssh/config"))
  assert.equal(bloqueioDeCaminho("src/env.ts"), undefined)
  assert.ok(bloqueioDeCaminho("docs/.env.md"))
  assert.equal(bloqueioDeCaminho(".env.example"), undefined)
  assert.equal(bloqueioDeCaminho("app/.env.sample"), undefined)
  assert.equal(bloqueioDeCaminho(".env.dist"), undefined)
})
