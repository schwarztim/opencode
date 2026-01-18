# OpenCode Azure Fork

This is a fork of [OpenCode](https://github.com/anomalyco/opencode) with enhanced Azure OpenAI support.

## Quick Start

```bash
# Install opencode (if not already installed)
curl -fsSL https://opencode.ai/install | bash

# Run Azure setup wizard
opencode azure
```

The wizard will guide you through:
1. Azure OpenAI endpoint configuration
2. API key setup
3. Deployment mode selection (Model Router vs Single Deployment)
4. Connection testing

## Azure Commands

```bash
# Setup Azure OpenAI (interactive wizard)
opencode azure

# Check current Azure configuration
opencode azure status

# Trim MCPs to avoid 128 tool limit
opencode azure mcp-trim
```

## Configuration

Config is stored in `~/.config/opencode/opencode.json`

### Example: Model Router Mode (Recommended for Azure APIM)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "azure/model-router",
  "provider": {
    "azure": {
      "npm": "@ai-sdk/azure",
      "name": "Azure Model Router",
      "options": {
        "baseURL": "https://your-resource.openai.azure.com/openai",
        "apiKey": "your-api-key",
        "useDeploymentBasedUrls": true,
        "apiVersion": "2024-12-01-preview"
      },
      "models": {
        "model-router": {
          "name": "Model Router (Auto)",
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

### Example: Single Deployment Mode

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "azure/gpt-4o",
  "provider": {
    "azure": {
      "npm": "@ai-sdk/azure",
      "name": "Azure OpenAI",
      "options": {
        "baseURL": "https://your-resource.openai.azure.com/openai",
        "apiKey": "your-api-key",
        "useDeploymentBasedUrls": true,
        "apiVersion": "2024-12-01-preview"
      },
      "models": {
        "gpt-4o": {
          "name": "GPT-4o",
          "limit": {
            "context": 128000,
            "output": 16384
          }
        }
      }
    }
  }
}
```

## MCP Tool Limit (128 Tools Max)

Azure OpenAI and Anthropic APIs have a **128 tool limit**. If you have many MCP servers configured, you may hit this limit.

### Symptoms
```
Invalid 'tools': array too long. Expected an array with maximum length 128, but got an array with length 999 instead.
```

### Solution

1. **Check your current config:**
   ```bash
   opencode azure status
   ```

2. **Trim MCPs interactively:**
   ```bash
   opencode azure mcp-trim
   ```

3. **Manual trim:** Edit `~/.config/opencode/opencode.json` and remove unused MCPs from the `mcp` section.

### Recommended MCP Setup

Keep only the MCPs you actively use. A good starting set:
- 3-5 MCPs maximum
- Each MCP typically has 5-20 tools
- Total tools = built-in tools (~30) + MCP tools

Example minimal MCP config:
```json
{
  "mcp": {
    "essential-mcp-1": { ... },
    "essential-mcp-2": { ... },
    "essential-mcp-3": { ... }
  }
}
```

## Deployment Modes Explained

### Model Router Mode
- Single Azure deployment endpoint that routes requests
- Best for Azure API Management (APIM) setups
- Deployment handles model selection dynamically
- Use when you have APIM routing logic

### Single Deployment Mode
- Direct connection to one Azure OpenAI deployment
- Best for simple setups with one model
- Deployment name = model name in requests

## Environment Variables (Alternative to Config)

```bash
export AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com/openai"
export AZURE_OPENAI_API_KEY="your-api-key"
export AZURE_OPENAI_DEPLOYMENT="gpt-4o"
export AZURE_API_VERSION="2024-12-01-preview"
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 128 tool limit error | Run `opencode azure mcp-trim` |
| Connection failed | Check endpoint URL ends with `/openai` |
| 401 Unauthorized | Verify API key is correct |
| Model not found | Check deployment name matches Azure portal |
| Timeout errors | Try increasing context window or reducing MCP count |

## Building from Source

```bash
git clone https://github.com/schwarztim/opencode
cd opencode
bun install
bun run build
```

## Credits

- Original [OpenCode](https://github.com/anomalyco/opencode) by Anomaly
- Azure enhancements by the community
