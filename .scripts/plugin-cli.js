#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMMANDS = {
  create: 'Create a new plugin from template',
  build: 'Build a plugin into a .zip file',
  install: 'Install a plugin to ncSender',
  list: 'List installed plugins',
  help: 'Show this help message'
};

function showHelp() {
  console.log('\n🧩 ncSender Plugin CLI\n');
  console.log('Usage: node plugin-cli.js <command> [options]\n');
  console.log('Commands:');
  Object.entries(COMMANDS).forEach(([cmd, desc]) => {
    console.log(`  ${cmd.padEnd(12)} ${desc}`);
  });
  console.log('\nExamples:');
  console.log('  node plugin-cli.js create my-plugin');
  console.log('  node plugin-cli.js build my-plugin');
  console.log('  node plugin-cli.js install my-plugin');
  console.log('  node plugin-cli.js list\n');
}

function getUserDataDir() {
  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE;

  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'ncSender');
    case 'win32':
      return path.join(home, 'AppData', 'Roaming', 'ncSender');
    case 'linux':
      return path.join(home, '.config', 'ncSender');
    default:
      return path.join(home, '.ncSender');
  }
}

async function createPlugin(pluginName) {
  if (!pluginName) {
    console.error('❌ Error: Plugin name is required');
    console.log('Usage: node plugin-cli.js create <plugin-name>');
    process.exit(1);
  }

  const pluginId = pluginName.includes('.') ? pluginName : `com.ncsender.${pluginName}`;
  const pluginDir = path.join(process.cwd(), 'plugins', pluginId);

  if (fs.existsSync(pluginDir)) {
    console.error(`❌ Error: Plugin directory already exists: ${pluginDir}`);
    process.exit(1);
  }

  console.log(`📦 Creating plugin: ${pluginId}`);
  fs.mkdirSync(pluginDir, { recursive: true });

  // Create manifest.json
  const manifest = {
    id: pluginId,
    name: pluginName.split('.').pop().replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    version: '1.0.0',
    author: 'Your Name',
    description: 'A new ncSender plugin',
    entry: 'index.js',
    events: ['onBeforeJobStart'],
    permissions: []
  };

  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Create index.js
  const indexContent = `/**
 * ${manifest.name} Plugin
 * ${manifest.description}
 */

export async function onLoad(ctx) {
  ctx.log('Plugin loaded successfully');

  // Example: Register a tool menu item
  // ctx.registerToolMenu('My Tool', async () => {
  //   ctx.log('Tool menu item clicked!');
  //   ctx.showDialog('Hello', 'This is a plugin dialog');
  // });

  // Example: Subscribe to WebSocket events
  // ctx.onWebSocketEvent('cnc-data', (data) => {
  //   ctx.log('Received CNC data:', data);
  // });
}

export async function onUnload() {
  console.log('${manifest.name} plugin unloaded');
}

export async function onBeforeJobStart(gcode, context) {
  context.log('Job starting with', context.totalLines, 'lines');
  // You can modify the gcode here if needed
  return gcode;
}

export async function onBeforeGcodeLine(line, context) {
  // Modify individual G-code lines before sending
  return line;
}

export async function onAfterGcodeLine(line, response, context) {
  // React to line execution results
}

export async function onAfterJobEnd(context) {
  context.log('Job ended:', context.reason);
}
`;

  fs.writeFileSync(path.join(pluginDir, 'index.js'), indexContent);

  // Create README.md
  const readmeContent = `# ${manifest.name}

${manifest.description}

## Installation

1. Build the plugin:
   \`\`\`bash
   node .scripts/plugin-cli.js build ${pluginId}
   \`\`\`

2. Install the plugin:
   \`\`\`bash
   node .scripts/plugin-cli.js install ${pluginId}
   \`\`\`

## Development

Edit \`index.js\` to add your plugin logic. The plugin supports the following hooks:

- \`onLoad(ctx)\` - Called when plugin loads
- \`onUnload()\` - Called when plugin unloads
- \`onBeforeJobStart(gcode, context)\` - Modify G-code before job starts
- \`onBeforeGcodeLine(line, context)\` - Modify individual lines
- \`onAfterGcodeLine(line, response, context)\` - React to line results
- \`onAfterJobEnd(context)\` - Handle job completion

## Context API

The \`ctx\` object provides:

- \`ctx.log(...args)\` - Log messages with plugin prefix
- \`ctx.sendGcode(gcode, options)\` - Send G-code commands
- \`ctx.broadcast(event, data)\` - Broadcast to clients
- \`ctx.getSettings()\` - Get plugin settings
- \`ctx.setSettings(settings)\` - Save plugin settings
- \`ctx.showDialog(title, content)\` - Show dialog to user
- \`ctx.registerToolMenu(label, callback)\` - Add Tools menu item
- \`ctx.onWebSocketEvent(event, handler)\` - Subscribe to WebSocket events
- \`ctx.emitToClient(event, data)\` - Emit custom events to clients

## License

MIT
`;

  fs.writeFileSync(path.join(pluginDir, 'README.md'), readmeContent);

  console.log(`✅ Plugin created successfully at: ${pluginDir}`);
  console.log('\nNext steps:');
  console.log(`  1. Edit ${pluginDir}/index.js to add your plugin logic`);
  console.log(`  2. Build the plugin: node .scripts/plugin-cli.js build ${pluginId}`);
  console.log(`  3. Install the plugin: node .scripts/plugin-cli.js install ${pluginId}`);
}

async function buildPlugin(pluginName) {
  if (!pluginName) {
    console.error('❌ Error: Plugin name is required');
    console.log('Usage: node plugin-cli.js build <plugin-name>');
    process.exit(1);
  }

  const pluginId = pluginName.includes('.') ? pluginName : `com.ncsender.${pluginName}`;
  const pluginDir = path.join(process.cwd(), 'plugins', pluginId);

  if (!fs.existsSync(pluginDir)) {
    console.error(`❌ Error: Plugin directory not found: ${pluginDir}`);
    process.exit(1);
  }

  const manifestPath = path.join(pluginDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Error: manifest.json not found in ${pluginDir}`);
    process.exit(1);
  }

  const outputFile = path.join(process.cwd(), 'plugins', `${pluginId}.zip`);

  console.log(`📦 Building plugin: ${pluginId}`);

  try {
    // Remove old zip if exists
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }

    // Create zip file
    const { stdout, stderr } = await execAsync(
      `cd "${path.dirname(pluginDir)}" && zip -r "${path.basename(outputFile)}" "${path.basename(pluginDir)}" -x "*.DS_Store"`
    );

    if (stderr && !stderr.includes('zip warning')) {
      console.error('❌ Build error:', stderr);
      process.exit(1);
    }

    console.log(`✅ Plugin built successfully: ${outputFile}`);
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

async function installPlugin(pluginName) {
  if (!pluginName) {
    console.error('❌ Error: Plugin name is required');
    console.log('Usage: node plugin-cli.js install <plugin-name>');
    process.exit(1);
  }

  const pluginId = pluginName.includes('.') ? pluginName : `com.ncsender.${pluginName}`;
  const zipFile = path.join(process.cwd(), 'plugins', `${pluginId}.zip`);

  if (!fs.existsSync(zipFile)) {
    console.error(`❌ Error: Plugin zip file not found: ${zipFile}`);
    console.log('Build the plugin first: node .scripts/plugin-cli.js build ' + pluginName);
    process.exit(1);
  }

  const userDataDir = getUserDataDir();
  const pluginsDir = path.join(userDataDir, 'plugins');
  const targetDir = path.join(pluginsDir, pluginId);

  console.log(`📦 Installing plugin: ${pluginId}`);
  console.log(`   Source: ${zipFile}`);
  console.log(`   Target: ${targetDir}`);

  try {
    // Create plugins directory if it doesn't exist
    fs.mkdirSync(pluginsDir, { recursive: true });

    // Remove old installation if exists
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // Extract zip
    await execAsync(`unzip -q "${zipFile}" -d "${pluginsDir}"`);

    // Update plugins registry
    const registryPath = path.join(userDataDir, 'plugins.json');
    let registry = [];

    if (fs.existsSync(registryPath)) {
      registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    }

    const manifestPath = path.join(targetDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const existingIndex = registry.findIndex(p => p.id === pluginId);
    const pluginEntry = {
      id: pluginId,
      name: manifest.name,
      version: manifest.version,
      enabled: true,
      installedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      registry[existingIndex] = pluginEntry;
    } else {
      registry.push(pluginEntry);
    }

    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));

    console.log(`✅ Plugin installed successfully!`);
    console.log('\nTo reload the plugin:');
    console.log(`  curl -X POST http://localhost:8090/api/plugins/${pluginId}/reload`);
  } catch (error) {
    console.error('❌ Installation failed:', error.message);
    process.exit(1);
  }
}

async function listPlugins() {
  const userDataDir = getUserDataDir();
  const registryPath = path.join(userDataDir, 'plugins.json');

  if (!fs.existsSync(registryPath)) {
    console.log('No plugins installed');
    return;
  }

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

  if (registry.length === 0) {
    console.log('No plugins installed');
    return;
  }

  console.log('\n🧩 Installed Plugins:\n');
  registry.forEach(plugin => {
    const status = plugin.enabled ? '✅ Enabled' : '❌ Disabled';
    console.log(`  ${plugin.name} (${plugin.id})`);
    console.log(`    Version: ${plugin.version}`);
    console.log(`    Status: ${status}`);
    console.log(`    Installed: ${new Date(plugin.installedAt).toLocaleString()}`);
    console.log('');
  });
}

// Main CLI
const [,, command, ...args] = process.argv;

switch (command) {
  case 'create':
    createPlugin(args[0]);
    break;
  case 'build':
    buildPlugin(args[0]);
    break;
  case 'install':
    installPlugin(args[0]);
    break;
  case 'list':
    listPlugins();
    break;
  case 'help':
  default:
    showHelp();
}
