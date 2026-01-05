import { createStore } from "solid-js/store"
import { batch, createMemo } from "solid-js"
import { filter, firstBy, flat, groupBy, mapValues, pipe, uniqueBy, values } from "remeda"
import type { Model, Provider } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { base64Encode } from "@opencode-ai/util/encode"
import { useProviders } from "@/hooks/use-providers"
import { DateTime } from "luxon"
import { persisted } from "@/utils/persist"

export type LocalModel = Omit<Model, "provider"> & {
  provider: Provider
  latest?: boolean
}
export type ModelKey = { providerID: string; modelID: string }

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const providers = useProviders()

    function isModelValid(model: ModelKey) {
      const provider = providers.all().find((x) => x.id === model.providerID)
      return (
        !!provider?.models[model.modelID] &&
        providers
          .connected()
          .map((p) => p.id)
          .includes(model.providerID)
      )
    }

    function getFirstValidModel(...modelFns: (() => ModelKey | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    const agent = (() => {
      const list = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
      const [store, setStore] = createStore<{
        current?: string
      }>({
        current: list()[0]?.name,
      })
      return {
        list,
        current() {
          const available = list()
          if (available.length === 0) return undefined
          return available.find((x) => x.name === store.current) ?? available[0]
        },
        set(name: string | undefined) {
          const available = list()
          if (available.length === 0) {
            setStore("current", undefined)
            return
          }
          if (name && available.some((x) => x.name === name)) {
            setStore("current", name)
            return
          }
          setStore("current", available[0].name)
        },
        move(direction: 1 | -1) {
          const available = list()
          if (available.length === 0) {
            setStore("current", undefined)
            return
          }
          let next = available.findIndex((x) => x.name === store.current) + direction
          if (next < 0) next = available.length - 1
          if (next >= available.length) next = 0
          const value = available[next]
          if (!value) return
          setStore("current", value.name)
          if (value.model)
            model.set({
              providerID: value.model.providerID,
              modelID: value.model.modelID,
            })
        },
      }
    })()

    const model = (() => {
      const [store, setStore, _, modelReady] = persisted(
        "model.v1",
        createStore<{
          user: (ModelKey & { visibility: "show" | "hide"; favorite?: boolean })[]
          recent: ModelKey[]
          variant?: Record<string, string | undefined>
        }>({
          user: [],
          recent: [],
          variant: {},
        }),
      )

      const [ephemeral, setEphemeral] = createStore<{
        model: Record<string, ModelKey>
      }>({
        model: {},
      })

      const available = createMemo(() =>
        providers.connected().flatMap((p) =>
          Object.values(p.models).map((m) => ({
            ...m,
            provider: p,
          })),
        ),
      )

      const latest = createMemo(() =>
        pipe(
          available(),
          filter((x) => Math.abs(DateTime.fromISO(x.release_date).diffNow().as("months")) < 6),
          groupBy((x) => x.provider.id),
          mapValues((models) =>
            pipe(
              models,
              groupBy((x) => x.family),
              values(),
              (groups) =>
                groups.flatMap((g) => {
                  const first = firstBy(g, [(x) => x.release_date, "desc"])
                  return first ? [{ modelID: first.id, providerID: first.provider.id }] : []
                }),
            ),
          ),
          values(),
          flat(),
        ),
      )

      const latestSet = createMemo(() => new Set(latest().map((x) => `${x.providerID}:${x.modelID}`)))

      const userVisibilityMap = createMemo(() => {
        const map = new Map<string, "show" | "hide">()
        for (const item of store.user) {
          map.set(`${item.providerID}:${item.modelID}`, item.visibility)
        }
        return map
      })

      const list = createMemo(() =>
        available().map((m) => ({
          ...m,
          name: m.name.replace("(latest)", "").trim(),
          latest: m.name.includes("(latest)"),
        })),
      )

      const find = (key: ModelKey) => list().find((m) => m.id === key?.modelID && m.provider.id === key.providerID)

      const fallbackModel = createMemo(() => {
        if (sync.data.config.model) {
          const [providerID, modelID] = sync.data.config.model.split("/")
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        for (const item of store.recent) {
          if (isModelValid(item)) {
            return item
          }
        }

        for (const p of providers.connected()) {
          if (p.id in providers.default()) {
            return {
              providerID: p.id,
              modelID: providers.default()[p.id],
            }
          }
        }

        throw new Error("No default model found")
      })

      const current = createMemo(() => {
        const a = agent.current()
        if (!a) return undefined
        const key = getFirstValidModel(
          () => ephemeral.model[a.name],
          () => a.model,
          fallbackModel,
        )
        if (!key) return undefined
        return find(key)
      })

      const recent = createMemo(() => store.recent.map(find).filter(Boolean))

      const cycle = (direction: 1 | -1) => {
        const recentList = recent()
        const currentModel = current()
        if (!currentModel) return

        const index = recentList.findIndex(
          (x) => x?.provider.id === currentModel.provider.id && x?.id === currentModel.id,
        )
        if (index === -1) return

        let next = index + direction
        if (next < 0) next = recentList.length - 1
        if (next >= recentList.length) next = 0

        const val = recentList[next]
        if (!val) return

        model.set({
          providerID: val.provider.id,
          modelID: val.id,
        })
      }

      function updateVisibility(model: ModelKey, visibility: "show" | "hide") {
        const index = store.user.findIndex((x) => x.modelID === model.modelID && x.providerID === model.providerID)
        if (index >= 0) {
          setStore("user", index, { visibility })
        } else {
          setStore("user", store.user.length, { ...model, visibility })
        }
      }

      return {
        ready: modelReady,
        current,
        recent,
        list,
        cycle,
        set(model: ModelKey | undefined, options?: { recent?: boolean }) {
          batch(() => {
            const currentAgent = agent.current()
            if (currentAgent) setEphemeral("model", currentAgent.name, model ?? fallbackModel())
            if (model) updateVisibility(model, "show")
            if (options?.recent && model) {
              const uniq = uniqueBy([model, ...store.recent], (x) => x.providerID + x.modelID)
              if (uniq.length > 5) uniq.pop()
              setStore("recent", uniq)
            }
          })
        },
        visible(model: ModelKey) {
          const key = `${model.providerID}:${model.modelID}`
          const visibility = userVisibilityMap().get(key)
          return visibility !== "hide" && (latestSet().has(key) || visibility === "show")
        },
        setVisibility(model: ModelKey, visible: boolean) {
          updateVisibility(model, visible ? "show" : "hide")
        },
        variant: {
          current() {
            const m = current()
            if (!m) return undefined
            const key = `${m.provider.id}/${m.id}`
            return store.variant?.[key]
          },
          list() {
            const m = current()
            if (!m) return []
            if (!m.variants) return []
            return Object.keys(m.variants)
          },
          set(value: string | undefined) {
            const m = current()
            if (!m) return
            const key = `${m.provider.id}/${m.id}`
            if (!store.variant) {
              setStore("variant", { [key]: value })
            } else {
              setStore("variant", key, value)
            }
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            const currentVariant = this.current()
            if (!currentVariant) {
              this.set(variants[0])
              return
            }
            const index = variants.indexOf(currentVariant)
            if (index === -1 || index === variants.length - 1) {
              this.set(undefined)
              return
            }
            this.set(variants[index + 1])
          },
        },
      }
    })()

    const result = {
      slug: createMemo(() => base64Encode(sdk.directory)),
      model,
      agent,
    }
    return result
  },
})
