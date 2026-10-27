import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const runtimeConfigPath = path.resolve(rootDir, 'apps', 'ios-client', 'runtime-config.json');
const agentLogPath = path.resolve(rootDir, 'apps', 'voice-backend', 'agent.log');

// Truncate agent.log on startup ({ flags: 'w' }) so each run captures a fresh, complete
// diagnostic trace of the LiveKit agent worker. Raw chunks are piped byte-for-byte below.
const agentLogStream = fs.createWriteStream(agentLogPath, { flags: 'w' });
agentLogStream.on('error', (err) => {
  console.error('[Woray] agent.log stream error:', err.message);
});

let backendProc = null;
let agentProc = null;
let tunnel3001Proc = null;
let tunnel8081Proc = null;
let expoProc = null;
let isCleaningUp = false;
let expoStarted = false;

/**
 * Safely kills all child processes and their process trees on exit.
 */
function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  console.log('\n[Woray] Shutting down all processes...');

  const procs = [backendProc, agentProc, tunnel3001Proc, tunnel8081Proc, expoProc];
  for (const p of procs) {
    if (p && p.pid) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' });
        } else {
          p.kill('SIGTERM');
        }
      } catch {
        // Process might have already exited
      }
    }
  }

  // Close the agent diagnostic log stream cleanly on shutdown.
  try {
    agentLogStream.end();
  } catch {
    // Stream may already be closed
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

/**
 * Free up any stale process holding onto a required port on Windows.
 */
function freeStalePort(port) {
  if (process.platform !== 'win32') return;
  try {
    const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = output.trim().split(/\r?\n/);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(Number(pid)) && Number(pid) !== process.pid) {
        console.log(`[Woray] Freeing stale process (${pid}) on port ${port}...`);
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      }
    }
  } catch {
    // Port is already free
  }
}

const TUNNEL_URL_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i;

/**
 * Spawns a Cloudflare tunnel and waits for the public trycloudflare URL.
 */
function startTunnel(name, localPort) {
  return new Promise((resolve, reject) => {
    console.log(`[Tunnel] Starting Cloudflare Tunnel for ${name} (port ${localPort})...`);

    const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${localPort}`], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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
        reject(new Error(`cloudflared for ${name} exited with code ${code}`));
      }
    });

    // Timeout after 40 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Timed out waiting for ${name} tunnel URL on port ${localPort}`));
      }
    }, 40000);
  });
}

async function main() {
  console.log('========================================================');
  console.log('⚡ Starting Woray Full-Stack Development Environment');
  console.log('========================================================');

  // Step 0: Free up stale ports if previously occupied
  freeStalePort(3001);
  freeStalePort(8081);

  // Step 1: Spawn Voice Backend (:3001) in background
  console.log('[Backend] Spawning voice-backend server on :3001...');
  backendProc = spawn('npm', ['--workspace=apps/voice-backend', 'run', 'dev'], {
    cwd: rootDir,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProc.stdout.on('data', (chunk) => {
    if (!expoStarted) {
      const lines = chunk.toString().trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`[Backend] ${line.trim()}`);
        }
      }
    }
  });

  backendProc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (!expoStarted || text.toLowerCase().includes('error')) {
      console.error(`[Backend Error] ${text.trim()}`);
    }
  });

  backendProc.on('error', (err) => {
    console.error('[Backend] Process spawn error:', err);
  });

  // Step 1B: Spawn LiveKit Agent Worker in background
  console.log('[Agent] Spawning LiveKit Agent Worker (npx tsx src/agent.ts dev)...');
  agentProc = spawn('npx', ['tsx', 'src/agent.ts', 'dev'], {
    cwd: path.resolve(rootDir, 'apps', 'voice-backend'),
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  agentProc.stdout.on('data', (chunk) => {
    // Always capture full raw agent output to agent.log (byte-for-byte) for diagnostics,
    // regardless of the terminal console-mute logic below.
    try {
      agentLogStream.write(chunk);
    } catch {
      // Log stream may be closed during shutdown
    }

    if (!expoStarted) {
      const lines = chunk.toString().trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`[Agent] ${line.trim()}`);
        }
      }
    }
  });

  agentProc.stderr.on('data', (chunk) => {
    // Always capture full raw agent stderr to agent.log (byte-for-byte) for diagnostics.
    try {
      agentLogStream.write(chunk);
    } catch {
      // Log stream may be closed during shutdown
    }

    const text = chunk.toString();
    if (!expoStarted || text.toLowerCase().includes('error')) {
      console.error(`[Agent Error] ${text.trim()}`);
    }
  });

  agentProc.on('error', (err) => {
    console.error('[Agent] Process spawn error:', err);
  });

  agentProc.on('exit', () => {
    // Close the agent diagnostic log stream when the worker terminates.
    try {
      agentLogStream.end();
    } catch {
      // Stream may already be closed
    }
  });

  try {
    // Step 2: Spawn Both Cloudflare Tunnels (:3001 and :8081)
    const backendTunnel = await startTunnel('voice-backend', 3001);
    tunnel3001Proc = backendTunnel.proc;
    console.log(`✅ Backend Tunnel Live: ${backendTunnel.url}`);

    // Immediately write backend tunnel URL to apps/ios-client/runtime-config.json
    const configData = {
      backendHost: backendTunnel.url,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(runtimeConfigPath, JSON.stringify(configData, null, 2), 'utf-8');
    console.log(`📁 Injected into apps/ios-client/runtime-config.json`);

    const metroTunnel = await startTunnel('metro-bundler', 8081);
    tunnel8081Proc = metroTunnel.proc;
    console.log(`✅ Metro Bundler Tunnel Live: ${metroTunnel.url}`);

    // Step 3: Print Clean Summary Banner
    console.log('\n========================================================');
    console.log('⚡ WORAY STACK READY (ENTERPRISE WI-FI BYPASS ACTIVE)');
    console.log('========================================================');
    console.log(`📡 Backend Tunnel (3001): ${backendTunnel.url}`);
    console.log(`📱 Metro Tunnel   (8081): ${metroTunnel.url}`);
    console.log('========================================================');
    console.log('Launching Expo Dev Server with interactive QR code...\n');

    // Mute non-error backend logs so Expo interactive UI stays pristine
    expoStarted = true;

    // Step 4: Launch Interactive Expo Dev Server with inherited stdio
    expoProc = spawn('npx', ['expo', 'start', '--dev-client'], {
      cwd: path.resolve(rootDir, 'apps', 'ios-client'),
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        EXPO_PACKAGER_PROXY_URL: metroTunnel.url,
      },
    });

    expoProc.on('close', (code) => {
      cleanup();
      process.exit(code ?? 0);
    });

    expoProc.on('error', (err) => {
      console.error('[Woray] Failed to start Expo:', err);
      cleanup();
      process.exit(1);
    });
  } catch (err) {
    console.error('\n❌ Initialization failed:', err.message);
    cleanup();
    process.exit(1);
  }
}

main();
