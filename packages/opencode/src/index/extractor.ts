import { ulid } from "ulid"
import path from "path"
import { Log } from "@/util/log"
import type { CodeIndex } from "./codeindex"

export namespace SymbolExtractor {
  const log = Log.create({ service: "symbol.extractor" })

  const LANGUAGE_MAP: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
  }

  export function detectLanguage(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase()
    return LANGUAGE_MAP[ext] ?? null
  }

  // Simple regex-based extraction as fallback (tree-sitter can be added later)
  export async function extract(filePath: string, content: string): Promise<CodeIndex.Symbol[]> {
    const language = detectLanguage(filePath)
    if (!language) return []

    const symbols: CodeIndex.Symbol[] = []
    const lines = content.split("\n")

    // TypeScript/JavaScript patterns
    if (language === "typescript" || language === "javascript") {
      extractTypeScriptSymbols(filePath, content, lines, language, symbols)
    }

    // Python patterns
    if (language === "python") {
      extractPythonSymbols(filePath, content, lines, language, symbols)
    }

    // Go patterns
    if (language === "go") {
      extractGoSymbols(filePath, content, lines, language, symbols)
    }

    // Rust patterns
    if (language === "rust") {
      extractRustSymbols(filePath, content, lines, language, symbols)
    }

    // Java patterns
    if (language === "java") {
      extractJavaSymbols(filePath, content, lines, language, symbols)
    }

    log.debug("Extracted symbols", { file: filePath, count: symbols.length })
    return symbols
  }

  function extractTypeScriptSymbols(
    filePath: string,
    content: string,
    lines: string[],
    language: string,
    symbols: CodeIndex.Symbol[],
  ) {
    const patterns = [
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, kind: "function" as const },
      { regex: /^(?:export\s+)?class\s+(\w+)/gm, kind: "class" as const },
      { regex: /^(?:export\s+)?interface\s+(\w+)/gm, kind: "interface" as const },
      { regex: /^(?:export\s+)?type\s+(\w+)/gm, kind: "type" as const },
      { regex: /^(?:export\s+)?const\s+(\w+)\s*=/gm, kind: "const" as const },
      { regex: /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/gm, kind: "method" as const },
      { regex: /^(?:export\s+)?(?:let|var)\s+(\w+)\s*=/gm, kind: "variable" as const },
    ]

    for (const { regex, kind } of patterns) {
      let match
      while ((match = regex.exec(content)) !== null) {
        const name = match[1]
        const line = content.slice(0, match.index).split("\n").length - 1

        // Find end line (simple heuristic: next blank line or next declaration)
        let endLine = line
        let braceCount = 0
        let foundOpen = false

        for (let i = line; i < lines.length; i++) {
          const currentLine = lines[i]
          for (const char of currentLine) {
            if (char === "{" || char === "(") {
              braceCount++
              foundOpen = true
            } else if (char === "}" || char === ")") {
              braceCount--
            }
          }

          if (foundOpen && braceCount === 0) {
            endLine = i
            break
          }

          // Fallback: if we hit another declaration, stop
          if (
            i > line &&
            (currentLine.match(/^(?:export\s+)?(?:function|class|interface|type|const|let|var)\s/) ||
              currentLine.trim() === "")
          ) {
            endLine = i - 1
            break
          }

          endLine = i
        }

        // Extract docstring from preceding comment
        let docstring: string | undefined
        if (line > 0) {
          const prevLines: string[] = []
          for (let i = line - 1; i >= 0 && i >= line - 10; i--) {
            const prevLine = lines[i].trim()
            if (prevLine.startsWith("*") || prevLine.startsWith("//") || prevLine.startsWith("/**")) {
              prevLines.unshift(prevLine.replace(/^\/?\*+\/?|^\/\/\s*/, "").trim())
            } else if (prevLine === "") {
              continue
            } else {
              break
            }
          }
          if (prevLines.length > 0) {
            docstring = prevLines.join(" ").slice(0, 200)
          }
        }

        // Extract signature for functions and methods
        let signature: string | undefined
        if (kind === "function" || kind === "method") {
          const sigMatch = lines[line].match(/\([^)]*\)(?:\s*:\s*[^{]+)?/)
          if (sigMatch) {
            signature = sigMatch[0].trim()
          }
        }

        symbols.push({
          id: ulid(),
          file: filePath,
          name,
          kind,
          line,
          endLine,
          signature,
          docstring,
          language,
        })
      }
    }
  }

  function extractPythonSymbols(
    filePath: string,
    content: string,
    lines: string[],
    language: string,
    symbols: CodeIndex.Symbol[],
  ) {
    const patterns = [
      { regex: /^(?:async\s+)?def\s+(\w+)/gm, kind: "function" as const },
      { regex: /^class\s+(\w+)/gm, kind: "class" as const },
      { regex: /^\s{4}(?:async\s+)?def\s+(\w+)/gm, kind: "method" as const },
    ]

    for (const { regex, kind } of patterns) {
      let match
      while ((match = regex.exec(content)) !== null) {
        const name = match[1]
        const line = content.slice(0, match.index).split("\n").length - 1

        // Calculate end line based on indentation
        const currentIndent = lines[line].search(/\S/)
        let endLine = line

        for (let i = line + 1; i < lines.length; i++) {
          const lineContent = lines[i]
          if (lineContent.trim() === "") continue

          const indent = lineContent.search(/\S/)
          if (indent <= currentIndent && lineContent.trim() !== "") {
            endLine = i - 1
            break
          }
          endLine = i
        }

        // Extract docstring
        let docstring: string | undefined
        if (line + 1 < lines.length) {
          const nextLine = lines[line + 1].trim()
          if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
            const quote = nextLine.startsWith('"""') ? '"""' : "'''"
            let doc = nextLine.slice(3)
            if (doc.endsWith(quote)) {
              docstring = doc.slice(0, -3).trim()
            } else {
              for (let i = line + 2; i < lines.length && i < line + 10; i++) {
                doc += " " + lines[i].trim()
                if (lines[i].includes(quote)) {
                  docstring = doc.split(quote)[0].trim().slice(0, 200)
                  break
                }
              }
            }
          }
        }

        // Extract signature
        let signature: string | undefined
        const sigMatch = lines[line].match(/\([^)]*\)/)
        if (sigMatch) {
          signature = sigMatch[0]
        }

        symbols.push({
          id: ulid(),
          file: filePath,
          name,
          kind,
          line,
          endLine,
          signature,
          docstring,
          language,
        })
      }
    }
  }

  function extractGoSymbols(
    filePath: string,
    content: string,
    lines: string[],
    language: string,
    symbols: CodeIndex.Symbol[],
  ) {
    const patterns = [
      { regex: /^func\s+(\w+)/gm, kind: "function" as const },
      { regex: /^func\s+\([^)]+\)\s+(\w+)/gm, kind: "method" as const },
      { regex: /^type\s+(\w+)\s+struct/gm, kind: "class" as const },
      { regex: /^type\s+(\w+)\s+interface/gm, kind: "interface" as const },
      { regex: /^type\s+(\w+)\s+/gm, kind: "type" as const },
      { regex: /^(?:var|const)\s+(\w+)\s*=/gm, kind: "const" as const },
    ]

    for (const { regex, kind } of patterns) {
      let match
      while ((match = regex.exec(content)) !== null) {
        const name = match[1]
        const line = content.slice(0, match.index).split("\n").length - 1

        // Find end line by tracking braces
        let endLine = line
        let braceCount = 0
        let foundOpen = false

        for (let i = line; i < lines.length; i++) {
          for (const char of lines[i]) {
            if (char === "{") {
              braceCount++
              foundOpen = true
            } else if (char === "}") {
              braceCount--
            }
          }

          if (foundOpen && braceCount === 0) {
            endLine = i
            break
          }
          endLine = i
        }

        // Extract signature for functions
        let signature: string | undefined
        if (kind === "function" || kind === "method") {
          const sigMatch = lines[line].match(/\([^)]*\)(?:\s*\([^)]*\))?(?:\s*[^{]+)?/)
          if (sigMatch) {
            signature = sigMatch[0].replace(/\s*\{.*/, "").trim()
          }
        }

        symbols.push({
          id: ulid(),
          file: filePath,
          name,
          kind,
          line,
          endLine,
          signature,
          language,
        })
      }
    }
  }

  function extractRustSymbols(
    filePath: string,
    content: string,
    lines: string[],
    language: string,
    symbols: CodeIndex.Symbol[],
  ) {
    const patterns = [
      { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, kind: "function" as const },
      { regex: /^(?:pub\s+)?struct\s+(\w+)/gm, kind: "class" as const },
      { regex: /^(?:pub\s+)?trait\s+(\w+)/gm, kind: "interface" as const },
      { regex: /^(?:pub\s+)?type\s+(\w+)/gm, kind: "type" as const },
      { regex: /^(?:pub\s+)?(?:static|const)\s+(\w+)/gm, kind: "const" as const },
      { regex: /^\s+(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, kind: "method" as const },
    ]

    for (const { regex, kind } of patterns) {
      let match
      while ((match = regex.exec(content)) !== null) {
        const name = match[1]
        const line = content.slice(0, match.index).split("\n").length - 1

        // Find end line by tracking braces
        let endLine = line
        let braceCount = 0
        let foundOpen = false

        for (let i = line; i < lines.length; i++) {
          for (const char of lines[i]) {
            if (char === "{") {
              braceCount++
              foundOpen = true
            } else if (char === "}") {
              braceCount--
            }
          }

          if (foundOpen && braceCount === 0) {
            endLine = i
            break
          }
          endLine = i
        }

        // Extract signature
        let signature: string | undefined
        if (kind === "function" || kind === "method") {
          const sigMatch = lines[line].match(/\([^)]*\)(?:\s*->\s*[^{]+)?/)
          if (sigMatch) {
            signature = sigMatch[0].trim()
          }
        }

        // Extract doc comment
        let docstring: string | undefined
        if (line > 0) {
          const prevLines: string[] = []
          for (let i = line - 1; i >= 0 && i >= line - 10; i--) {
            const prevLine = lines[i].trim()
            if (prevLine.startsWith("///") || prevLine.startsWith("//!")) {
              prevLines.unshift(prevLine.replace(/^\/\/[\/!]\s*/, "").trim())
            } else if (prevLine === "") {
              continue
            } else {
              break
            }
          }
          if (prevLines.length > 0) {
            docstring = prevLines.join(" ").slice(0, 200)
          }
        }

        symbols.push({
          id: ulid(),
          file: filePath,
          name,
          kind,
          line,
          endLine,
          signature,
          docstring,
          language,
        })
      }
    }
  }

  function extractJavaSymbols(
    filePath: string,
    content: string,
    lines: string[],
    language: string,
    symbols: CodeIndex.Symbol[],
  ) {
    const patterns = [
      {
        regex: /^(?:public|private|protected)?\s*(?:static)?\s*class\s+(\w+)/gm,
        kind: "class" as const,
      },
      {
        regex: /^(?:public|private|protected)?\s*interface\s+(\w+)/gm,
        kind: "interface" as const,
      },
      {
        regex: /^\s+(?:public|private|protected)?\s*(?:static)?\s*(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/gm,
        kind: "method" as const,
      },
    ]

    for (const { regex, kind } of patterns) {
      let match
      while ((match = regex.exec(content)) !== null) {
        const name = match[1]
        const line = content.slice(0, match.index).split("\n").length - 1

        // Find end line by tracking braces
        let endLine = line
        let braceCount = 0
        let foundOpen = false

        for (let i = line; i < lines.length; i++) {
          for (const char of lines[i]) {
            if (char === "{") {
              braceCount++
              foundOpen = true
            } else if (char === "}") {
              braceCount--
            }
          }

          if (foundOpen && braceCount === 0) {
            endLine = i
            break
          }
          endLine = i
        }

        // Extract Javadoc
        let docstring: string | undefined
        if (line > 0) {
          const prevLines: string[] = []
          for (let i = line - 1; i >= 0 && i >= line - 15; i--) {
            const prevLine = lines[i].trim()
            if (prevLine.startsWith("*") || prevLine === "/**") {
              const cleaned = prevLine.replace(/^\/?\*+\s*/, "").trim()
              if (cleaned && !cleaned.startsWith("@")) {
                prevLines.unshift(cleaned)
              }
            } else if (prevLine === "*/") {
              continue
            } else if (prevLine === "") {
              continue
            } else {
              break
            }
          }
          if (prevLines.length > 0) {
            docstring = prevLines.join(" ").slice(0, 200)
          }
        }

        // Extract signature for methods
        let signature: string | undefined
        if (kind === "method") {
          const sigMatch = lines[line].match(/\([^)]*\)/)
          if (sigMatch) {
            signature = sigMatch[0]
          }
        }

        symbols.push({
          id: ulid(),
          file: filePath,
          name,
          kind,
          line,
          endLine,
          signature,
          docstring,
          language,
        })
      }
    }
  }
}
