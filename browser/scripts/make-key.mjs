// Gera um par de chaves RSA e imprime o `key` do manifest e o ID da extensão.
// O Chrome deriva o ID dos 16 primeiros bytes do SHA-256 da chave pública DER,
// mapeando cada nibble (0..15) para uma letra a..p.
//
// Uso único: o `key` gerado entra no manifest e o ID no plugin (`browser-relay.ts`).
// Rodar de novo gera um ID novo — não é uma operação reprodutível, é uma ferramenta.
import { generateKeyPairSync, createHash } from "node:crypto"

const { publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "der" },
})

const key = publicKey.toString("base64")
const digest = createHash("sha256").update(publicKey).digest()
const id = [...digest.subarray(0, 16)]
  .flatMap((byte) => [(byte >> 4) & 0xf, byte & 0xf])
  .map((nibble) => String.fromCharCode(97 + nibble))
  .join("")

console.log("MANIFEST_KEY=" + key)
console.log("EXTENSION_ID=" + id)
