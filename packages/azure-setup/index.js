#!/usr/bin/env node
/**
 * OpenCode Azure Setup
 * Cross-platform installer for Azure OpenAI configuration
 *
 * Usage:
 *   npx opencode-azure-setup
 *   node install-azure.js
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import https from 'https';
import os from 'os';

// Colors
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

function getConfigPath() {
  return path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultValue = '') {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => resolve(answer || defaultValue));
  });
}

function askPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(`${question}: `);
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
          process.exit();
        } else if (char === '\u007F' || char === '\b') {
          password = password.slice(0, -1);
        } else {
          password += char;
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question('', resolve);
    }
  });
}

// Fetch latest defaults from GitHub (falls back to hardcoded if offline)
async function fetchDefaults() {
  const defaults = {
    deployment: 'model-router',
    apiVersion: '2025-01-01-preview',
  };

  try {
    const res = await fetch('https://raw.githubusercontent.com/schwarztim/opencode/dev/azure-defaults.json', {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.apiVersion) defaults.apiVersion = data.apiVersion;
      if (data.deployment) defaults.deployment = data.deployment;
    }
  } catch {
    // Offline or fetch failed - use hardcoded defaults
  }

  return defaults;
}

// Parse Azure endpoint - handles both full URL and base URL
function parseAzureEndpoint(input, defaults) {
  const result = {
    baseUrl: '',
    deployment: defaults.deployment,
    apiVersion: defaults.apiVersion,
  };

  try {
    const url = new URL(input);

    // Extract deployment from path: /openai/deployments/{deployment}/...
    const deploymentMatch = url.pathname.match(/\/deployments\/([^/]+)/);
    if (deploymentMatch) {
      result.deployment = deploymentMatch[1];
    }

    // Extract api-version from query params
    const apiVersion = url.searchParams.get('api-version');
    if (apiVersion) {
      result.apiVersion = apiVersion;
    }

    // Build base URL: https://host/openai
    const pathParts = url.pathname.split('/');
    const openaiIndex = pathParts.indexOf('openai');
    if (openaiIndex !== -1) {
      url.pathname = pathParts.slice(0, openaiIndex + 1).join('/');
    } else {
      url.pathname = '/openai';
    }
    url.search = '';
    result.baseUrl = url.toString().replace(/\/$/, '');

  } catch {
    // Not a valid URL, assume it's just the host
    let cleaned = input.replace(/\/$/, '');
    if (!cleaned.startsWith('https://')) {
      cleaned = 'https://' + cleaned;
    }
    if (!cleaned.endsWith('/openai')) {
      cleaned += '/openai';
    }
    result.baseUrl = cleaned;
  }

  return result;
}

async function testConnection(endpoint, apiKey, deployment, apiVersion) {
  return new Promise((resolve) => {
    const url = new URL(`${endpoint}/deployments/${deployment}/chat/completions?api-version=${apiVersion}`);
    const options = {
      hostname: url.hostname,
      port: 443,
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
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: data }));
    });

    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
    req.setTimeout(15000, () => {
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

  // Fetch latest defaults (non-blocking, falls back to hardcoded)
  const defaults = await fetchDefaults();

  // Endpoint - accepts full URL or just the base
  console.log('Paste your Azure OpenAI endpoint');
  console.log(colors.dim + 'Tip: You can paste the full URL from Azure Portal - we\'ll extract what we need' + colors.reset);
  console.log();
  const rawEndpoint = await ask('Endpoint');

  if (!rawEndpoint) {
    console.log(colors.red + 'Endpoint is required' + colors.reset);
    process.exit(1);
  }

  // Parse the endpoint - extracts base URL, deployment, and api-version automatically
  const parsed = parseAzureEndpoint(rawEndpoint, defaults);

  // API Key
  console.log();
  const apiKey = await askPassword('API Key');
  if (!apiKey) {
    console.log(colors.red + 'API Key is required' + colors.reset);
    process.exit(1);
  }

  // Use auto-detected values
  let deployment = parsed.deployment;
  let apiVersion = parsed.apiVersion;

  console.log();
  console.log(colors.blue + 'Testing connection...' + colors.reset);
  console.log(colors.dim + `  ${parsed.baseUrl}/deployments/${deployment}` + colors.reset);

  let result = await testConnection(parsed.baseUrl, apiKey, deployment, apiVersion);

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

    // Offer to edit settings if connection failed
    console.log();
    console.log(colors.yellow + 'Let\'s try different settings:' + colors.reset);
    deployment = await ask('Deployment name', deployment);
    apiVersion = await ask('API Version', apiVersion);

    console.log();
    console.log(colors.blue + 'Retrying...' + colors.reset);
    result = await testConnection(parsed.baseUrl, apiKey, deployment, apiVersion);

    if (result.ok) {
      console.log(colors.green + '✓ Connection successful!' + colors.reset);
    } else {
      console.log(colors.red + `✗ Still failing (${result.status || 'error'})` + colors.reset);
      const cont = await ask('Save config anyway? (y/N)', 'N');
      if (cont.toLowerCase() !== 'y') process.exit(1);
    }
  }

  // Create config
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: `azure/${deployment}`,
    provider: {
      azure: {
        npm: '@ai-sdk/azure',
        name: 'Azure OpenAI',
        options: {
          baseURL: parsed.baseUrl,
          apiKey: apiKey,
          useDeploymentBasedUrls: true,
          apiVersion: apiVersion,
        },
        models: {
          [deployment]: {
            name: deployment,
            limit: { context: 200000, output: 16384 },
          },
        },
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log();
  console.log(colors.green + '✓ Configuration saved!' + colors.reset);
  console.log(colors.dim + `  ${configPath}` + colors.reset);
  console.log();
  console.log('─'.repeat(40));
  console.log(colors.green + 'You\'re all set! Run:' + colors.reset);
  console.log();
  console.log('    ' + colors.blue + 'opencode' + colors.reset);
  console.log();

  rl.close();
}

main().catch((err) => {
  console.error(colors.red + 'Error: ' + err.message + colors.reset);
  process.exit(1);
});
