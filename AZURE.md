# OpenCode Azure Edition

Use OpenCode with Azure OpenAI in 60 seconds.

## Quick Start

```bash
# 1. Install OpenCode (if not already installed)
curl -fsSL https://opencode.ai/install | bash

# 2. Run Azure setup
npx opencode-azure-setup
```

That's it! The setup will ask for:
- **Endpoint** - From Azure Portal → Azure OpenAI → Keys and Endpoint
- **API Key** - Your Azure OpenAI API key
- **Deployment** - Your deployment name (default: `model-router`)

## What You Need

From your Azure Portal:

1. **Endpoint URL** - Looks like: `https://your-resource.openai.azure.com`
2. **API Key** - A 32-character key
3. **Deployment Name** - The name you gave your model deployment

## Commands

```bash
opencode              # Start OpenCode
opencode azure        # Reconfigure Azure settings
opencode azure status # View current config
```

## Skip Permission Prompts

For a fully autonomous experience (no permission popups):

```bash
# Via CLI flag
opencode --dangerously-skip-permissions

# Via environment variable
export OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS=true
opencode

# For run command
opencode run --dangerously-skip-permissions "your message"
```

**Warning:** This skips ALL permission checks. Use with caution.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Connection failed" | Check your endpoint ends with `/openai` |
| "401 Unauthorized" | Double-check your API key |
| "Model not found" | Verify deployment name matches Azure Portal |
| "128 tool limit" | Reduce MCP servers (see below) |

### Tool Limit Error

If you see:
```
Invalid 'tools': array too long. Expected maximum 128
```

You have too many MCP servers. Run:
```bash
opencode azure mcp-trim
```

## Manual Configuration

Config lives at `~/.config/opencode/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "azure/model-router",
  "provider": {
    "azure": {
      "npm": "@ai-sdk/azure",
      "name": "Azure OpenAI",
      "options": {
        "baseURL": "https://YOUR-RESOURCE.openai.azure.com/openai",
        "apiKey": "YOUR_API_KEY",
        "useDeploymentBasedUrls": true,
        "apiVersion": "2025-01-01-preview"
      },
      "models": {
        "model-router": {
          "name": "model-router",
          "limit": {
            "context": 200000,
            "output": 16384
          }
        }
      }
    }
  }
}
```

## Need Help?

- [OpenCode Discord](https://opencode.ai/discord)
- [GitHub Issues](https://github.com/schwarztim/opencode/issues)
