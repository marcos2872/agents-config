import { Plugin } from "@opencode/plugin"

type Memory = {
  id: string
  text: string
  created: string
}

const MAX_MEMORIES = 50

export default Plugin.define({
  id: "agents.memory",
  async setup(ctx) {
    const fallbackProjectID = ctx.location.project.id
    const keyFor = (projectID?: string) => `memory/${projectID ?? fallbackProjectID}`

    const load = async (projectID?: string): Promise<Memory[]> => {
      const stored = await ctx.storage.get(keyFor(projectID))
      return Array.isArray(stored) ? (stored as Memory[]) : []
    }

    const save = async (projectID: string | undefined, memories: Memory[]) => {
      await ctx.storage.set(keyFor(projectID), memories)
    }

    const resolveProjectID = async (sessionID?: string): Promise<string | undefined> => {
      if (!sessionID) return undefined
      try {
        const session = await ctx.session.get({ sessionID })
        return session.projectID
      } catch {
        return undefined
      }
    }

    const newID = () => Math.random().toString(36).slice(2, 10)

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "memory",
        description: "Memória persistente deste projeto entre sessões",
      })

      editor.add({
        name: "write",
        description:
          "Salva uma memória durável sobre este projeto (preferências, decisões, convenções, armadilhas) para sessões futuras. Use uma frase objetiva por memória.",
        input: {
          type: "object",
          properties: {
            text: { type: "string", description: "A memória, em uma frase objetiva" },
          },
          required: ["text"],
          additionalProperties: false,
        },
        options: { namespace: "memory", codemode: true },
        execute: async (input, context) => {
          const text = String((input as { text?: string }).text ?? "").trim()
          if (!text) return { content: "Memória vazia; nada foi salvo." }
          const projectID = await resolveProjectID(context.sessionID)
          const memories = await load(projectID)
          if (memories.some((memory) => memory.text === text)) {
            return { content: "Essa memória já existe." }
          }
          memories.push({ id: newID(), text, created: new Date().toISOString() })
          const kept = memories.slice(-MAX_MEMORIES)
          await save(projectID, kept)
          return { content: `Memória salva (${kept.length} no projeto).` }
        },
      })

      editor.add({
        name: "list",
        description: "Lista as memórias duráveis salvas para este projeto, com os IDs.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "memory", codemode: true },
        execute: async (_input, context) => {
          const projectID = await resolveProjectID(context.sessionID)
          const memories = await load(projectID)
          if (!memories.length) return { content: "Nenhuma memória salva para este projeto." }
          return { content: memories.map((memory) => `[${memory.id}] ${memory.text}`).join("\n") }
        },
      })

      editor.add({
        name: "delete",
        description: "Remove uma memória do projeto pelo ID (liste antes com memory_list).",
        input: {
          type: "object",
          properties: { id: { type: "string", description: "ID da memória" } },
          required: ["id"],
          additionalProperties: false,
        },
        options: { namespace: "memory", codemode: true },
        execute: async (input, context) => {
          const id = String((input as { id?: string }).id ?? "").trim()
          const projectID = await resolveProjectID(context.sessionID)
          const memories = await load(projectID)
          const kept = memories.filter((memory) => memory.id !== id)
          if (kept.length === memories.length) return { content: `Nenhuma memória com id ${id}.` }
          await save(projectID, kept)
          return { content: "Memória removida." }
        },
      })
    })

    await ctx.session.hook("context", async (event) => {
      const projectID = await resolveProjectID(event.sessionID)
      const memories = await load(projectID)
      if (!memories.length) return
      event.system.push({
        type: "text",
        text: [
          "<project-memory>",
          "Memórias duráveis deste projeto, salvas em sessões anteriores:",
          ...memories.map((memory) => `- [${memory.id}] ${memory.text}`),
          "",
          "Siga estas memórias. Para salvar uma nova use a tool `memory_write`; para remover uma obsoleta use `memory_delete`.",
          "</project-memory>",
        ].join("\n"),
      })
    })
  },
})
