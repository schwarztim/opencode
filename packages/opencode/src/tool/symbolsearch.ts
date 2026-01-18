import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { CodeIndex } from "@/index/codeindex"
import { Instance } from "@/project/instance"
import DESCRIPTION from "./symbolsearch.txt"

export const SymbolSearchTool = Tool.define("symbolsearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Symbol name or pattern to search for"),
    kind: z
      .array(z.enum(["function", "class", "method", "variable", "const", "interface", "type"]))
      .optional()
      .describe("Filter by symbol kind"),
    limit: z.number().default(20).describe("Maximum results (1-100)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "symbolsearch",
      patterns: [params.query],
      always: ["*"],
      metadata: { query: params.query },
    })

    // Ensure index is initialized
    await CodeIndex.init()

    const results = await CodeIndex.searchSymbols(params.query, {
      kind: params.kind,
      limit: Math.min(Math.max(params.limit, 1), 100),
    })

    if (results.length === 0) {
      return {
        title: `No symbols found for "${params.query}"`,
        metadata: { count: 0, truncated: false },
        output: `No symbols matching "${params.query}" were found in the codebase.

Try:
- Using a shorter or more general query
- Checking the spelling
- Searching without kind filters`,
      }
    }

    const output = results
      .map((sym) => {
        const relPath = path.relative(Instance.directory, sym.file)
        let line = `${sym.kind} ${sym.name}`
        if (sym.signature) line += ` ${sym.signature}`
        line += `\n  ${relPath}:${sym.line + 1}`
        if (sym.docstring) line += `\n  ${sym.docstring.split("\n")[0]}`
        return line
      })
      .join("\n\n")

    return {
      title: `Found ${results.length} symbols`,
      metadata: { count: results.length, truncated: false },
      output: `Found ${results.length} symbols matching "${params.query}":\n\n${output}`,
    }
  },
})
