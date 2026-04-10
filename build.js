const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const os = require('os');

const pluginDir = 'iina-remote.iinaplugin';
const iinaPluginsDir = path.join(os.homedir(), 'Library/Application Support/com.colliderli.iina/plugins');

// Ensure output directories exist
if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir);
if (!fs.existsSync(path.join(pluginDir, 'dist'))) fs.mkdirSync(path.join(pluginDir, 'dist'));
if (!fs.existsSync(path.join(pluginDir, 'client'))) fs.mkdirSync(path.join(pluginDir, 'client'));

// Also ensure root-level directories exist for GitHub distribution
if (!fs.existsSync('dist')) fs.mkdirSync('dist');
if (!fs.existsSync('client')) fs.mkdirSync('client');

// Copy static client files
console.log('Copying static client files...');
fs.cpSync('src/client', 'client', { recursive: true });
fs.cpSync('src/client', path.join(pluginDir, 'client'), { recursive: true });

// Copy Info.json
console.log('Copying Info.json...');
fs.copyFileSync('Info.json', path.join(pluginDir, 'Info.json'));

console.log('Running esbuild...');
esbuild.build({
  entryPoints: ['src/index.ts', 'src/global.ts'],
  bundle: true,
  outdir: 'dist',
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  external: ['@iina/plugin-definition']
}).then(() => {
  // Also copy to plugin folder for local testing
  fs.cpSync('dist', path.join(pluginDir, 'dist'), { recursive: true });
  console.log('Build complete! Plugin prepared in root and iina-remote.iinaplugin');
  
  // Copy to IINA plugins folder
  const destination = path.join(iinaPluginsDir, pluginDir);
  console.log(`Copying plugin to IINA: ${destination}`);
  
  if (!fs.existsSync(iinaPluginsDir)) {
    fs.mkdirSync(iinaPluginsDir, { recursive: true });
  }

  // Remove existing plugin in IINA folder if it exists
  if (fs.existsSync(destination)) {
    fs.rmSync(destination, { recursive: true, force: true });
  }
  
  fs.cpSync(pluginDir, destination, { recursive: true });
  console.log('Successfully deployed to IINA!');
  
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

