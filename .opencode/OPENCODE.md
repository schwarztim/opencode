# OpenCode Project Instructions

You are working on OpenCode, a CLI tool for AI-assisted development.

## Code Style
- Use TypeScript strict mode
- Prefer functional patterns with Remeda library
- Use Bun.$ for shell commands
- Follow existing namespace patterns (Config.*, Session.*, Agent.*)

## Architecture
- Instance.state() pattern for caching
- Bun.Glob for file discovery
- gray-matter for YAML frontmatter parsing
