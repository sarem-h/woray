import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const runtimeConfigPath = path.resolve(rootDir, 'apps', 'ios-client', 'runtime-config.json');

const children = [];

function cleanup() {
  console.log('\n[Woray Tunnels] Shutting down active tunnels...');
  for (const child of children) {
    try {
      if (!child.killed) {
        child.kill();
      }
    } catch {
      // ignore
    }
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

process.on('exit', () => {
  cleanup();
});

const TUNNEL_URL_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

function startTunnel(name, localPort) {
  return new Promise((resolve, reject) => {
    console.log(`[Woray Tunnels] Starting Cloudflare Tunnel for ${name} (port ${localPort})...`);

    const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${localPort}`], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    children.push(proc);

    let resolved = false;

    const handleOutput = (data) => {
      const output = data.toString();
      const match = output.match(TUNNEL_URL_REGEX);
      if (match && !resolved) {
        resolved = true;
        resolve({ url: match[0], proc });
      }
    };

    proc.stdout.on('data', handleOutput);
    proc.stderr.on('data', handleOutput);

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    proc.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`cloudflared exited prematurely with code ${code}`));
      }
    });

    // Timeout after 35 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Timed out waiting for ${name} tunnel URL`));
      }
    }, 35000);
  });
}

async function main() {
  console.log('========================================================');
  console.log('⚡ Woray Cloudflare Tunnel & Runtime Host Manager');
  console.log('   Overcomes Enterprise Wi-Fi Isolation (e.g. snhu.edu)');
  console.log('========================================================');

  try {
    // 1. Start Voice Backend Tunnel (Port 3001)
    const backendTunnel = await startTunnel('voice-backend', 3001);
    console.log(`\n✅ Backend Tunnel Live: ${backendTunnel.url}`);

    // Update runtime-config.json
    const configData = {
      backendHost: backendTunnel.url,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(runtimeConfigPath, JSON.stringify(configData, null, 2), 'utf-8');
    console.log(`📁 Injected into apps/ios-client/runtime-config.json successfully.`);

    // 2. Start Metro Bundler Tunnel (Port 8081)
    const metroTunnel = await startTunnel('metro-bundler', 8081);
    console.log(`\n✅ Metro Bundler Tunnel Live: ${metroTunnel.url}`);

    console.log('\n========================================================');
    console.log('🚀 READY TO TEST ON PHYSICAL IPHONE:');
    console.log('1. Start your voice-backend (if not already running):');
    console.log('   npm run dev:backend');
    console.log('   npm run agent:backend');
    console.log('');
    console.log('2. Start Expo with the Metro Tunnel proxy:');
    console.log(`   $env:EXPO_PACKAGER_PROXY_URL="${metroTunnel.url}"; npm run start:client`);
    console.log('========================================================\n');
    console.log('Tunnels are running. Press Ctrl+C to stop.');

    // Keep process open
    await new Promise(() => {});
  } catch (err) {
    console.error('\n❌ Tunnel initiation failed:', err.message);
    cleanup();
    process.exit(1);
  }
}

main();
