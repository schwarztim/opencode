#!/usr/bin/env node
/**
 * OpenCode Azure Setup
 * Cross-platform installer for Azure OpenAI configuration
 *
 * Usage:
 *   npx opencode-azure-setup
 *   node install-azure.js
 *   bun install-azure.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const http = require('http');

// Colors (works on most terminals)
const colors = {
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

const logo = `
   ___                   ____          _
  / _ \\ _ __   ___ _ __ / ___|___   __| | ___
 | | | | '_ \\ / _ \\ '_ \\ |   / _ \\ / _\` |/ _ \\
 | |_| | |_) |  __/ | | | |__| (_) | (_| |  __/
  \\___/| .__/ \\___|_| |_|\\____\\___/ \\__,_|\\___|
       |_|                 Azure Edition
`;

// Get config path based on OS
function getConfigPath() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (process.platform === 'win32') {
    return path.join(home, '.config', 'opencode', 'opencode.json');
  }
  return path.join(home, '.config', 'opencode', 'opencode.json');
}

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultValue = '') {
  return new Promise((resolve) => {
    const prompt = defaultValue
      ? `${question} [${defaultValue}]: `
      : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer || defaultValue);
    });
  });
}

function askPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(`${question}: `);

    // Try to hide input on Unix systems
    if (process.stdin.isTTY) {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      let password = '';
      const onData = (char) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          console.log();
          resolve(password);
        } else if (char === '\u0003') {
          // Ctrl+C
          process.exit();
        } else if (char === '\u007F' || char === '\b') {
          // Backspace
          password = password.slice(0, -1);
        } else {
          password += char;
        }
      };
      stdin.on('data', onData);
    } else {
      // Fallback for non-TTY
      rl.question('', resolve);
    }
  });
}

async function testConnection(endpoint, apiKey, deployment) {
  return new Promise((resolve) => {
    const url = new URL(`${endpoint}/deployments/${deployment}/chat/completions?api-version=2024-12-01-preview`);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
    };

    const body = JSON.stringify({
      messages: [{ role: 'user', content: 'hi' }],
      max_completion_tokens: 5,
    });

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode === 200,
          status: res.statusCode,
          body: data
        });
      });
    });

    req.on('error', (e) => {
      resolve({ ok: false, status: 0, body: e.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ ok: false, status: 0, body: 'Timeout' });
    });

    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(colors.blue + logo + colors.reset);
  console.log(colors.blue + 'Azure OpenAI Setup' + colors.reset);
  console.log('─'.repeat(40));
  console.log();

  // Get Azure endpoint
  console.log('Enter your Azure OpenAI endpoint');
  console.log(colors.dim + '(from Azure Portal → Azure OpenAI → Keys and Endpoint)' + colors.reset);
  let endpoint = await ask('Endpoint');

  if (!endpoint) {
    console.log(colors.red + 'Endpoint is required' + colors.reset);
    process.exit(1);
  }

  // Ensure endpoint format
  endpoint = endpoint.replace(/\/$/, '');
  if (!endpoint.endsWith('/openai')) {
    endpoint += '/openai';
  }

  console.log();

  // Get API key
  const apiKey = await askPassword('API Key');
  if (!apiKey) {
    console.log(colors.red + 'API Key is required' + colors.reset);
    process.exit(1);
  }

  console.log();

  // Get deployment name
  console.log('Enter your deployment name');
  console.log(colors.dim + '(default: model-router for Azure APIM setups)' + colors.reset);
  const deployment = await ask('Deployment', 'model-router');

  console.log();
  console.log(colors.blue + 'Testing connection...' + colors.reset);

  const result = await testConnection(endpoint, apiKey, deployment);

  if (result.ok) {
    console.log(colors.green + '✓ Connection successful!' + colors.reset);
  } else {
    console.log(colors.red + `✗ Connection failed (${result.status || 'error'})` + colors.reset);
    if (result.body) {
      try {
        const err = JSON.parse(result.body);
        console.log(colors.dim + (err.error?.message || result.body.slice(0, 200)) + colors.reset);
      } catch {
        console.log(colors.dim + result.body.slice(0, 200) + colors.reset);
      }
    }
    console.log();
    const cont = await ask('Continue anyway? (y/N)', 'N');
    if (cont.toLowerCase() !== 'y') {
      process.exit(1);
    }
  }

  // Create config
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  fs.mkdirSync(configDir, { recursive: true });

  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: `azure/${deployment}`,
    provider: {
      azure: {
        npm: '@ai-sdk/azure',
        name: 'Azure OpenAI',
        options: {
          baseURL: endpoint,
          apiKey: apiKey,
          useDeploymentBasedUrls: true,
          apiVersion: '2024-12-01-preview',
        },
        models: {
          [deployment]: {
            name: deployment,
            limit: {
              context: 200000,
              output: 16384,
            },
          },
        },
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log();
  console.log(colors.green + `✓ Configuration saved to ${configPath}` + colors.reset);
  console.log();
  console.log(colors.blue + "You're all set! Run:" + colors.reset);
  console.log();
  console.log('    opencode');
  console.log();
  console.log(colors.dim + 'Tips:' + colors.reset);
  console.log('  • View config:  opencode azure status');
  console.log('  • Reconfigure:  opencode azure');
  console.log();

  rl.close();
}

main().catch((err) => {
  console.error(colors.red + 'Error: ' + err.message + colors.reset);
  process.exit(1);
});
