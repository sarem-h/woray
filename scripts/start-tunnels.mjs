import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

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
 * Safely kills all child processes and their process trees on exit (in parallel).
 */
function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  console.log('\n[Woray] Shutting down all processes...');

  const procs = [backendProc, agentProc, tunnel3001Proc, tunnel8081Proc, expoProc].filter(
    (p) => p && p.pid
  );

  // Kill all child processes concurrently.
  const kills = procs.map(
    (p) =>
      new Promise((resolve) => {
        try {
          if (process.platform === 'win32') {
            const k = spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
            k.on('close', resolve);
            k.on('error', resolve);
          } else {
            p.kill('SIGTERM');
            resolve();
          }
        } catch {
          resolve(); // Process might have already exited
        }
      })
  );

  Promise.all(kills).finally(() => {
    try {
      agentLogStream.end();
    } catch {
      // Stream may already be closed
    }
  });
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
 * Fast, deterministic Windows process sweep that kills any lingering cloudflared.exe,
 * orphaned node.exe belonging to this repo, plus any process holding TCP 3001 or 8081.
 */
function ensureCleanSlate() {
  if (process.platform === 'win32') {
    console.log('[Woray] Ensuring clean slate: sweeping port listeners and orphaned processes...');
    const psCmd = [
      // 1. Kill any process listening on 3001 or 8081 (IPv4 or IPv6)
      `Get-NetTCPConnection -LocalPort 3001,8081 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 4 -and $_ -ne ${process.pid} } | ForEach-Object { taskkill /F /T /PID $_ 2>$null }`,
      // 2. Kill any orphaned cloudflared, expo, metro, server.ts, or agent.ts processes
      `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and ($_.Name -eq 'cloudflared.exe' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'expo|metro|server\\.ts|agent\\.ts')) } | ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null }`
    ].join('; ');
    spawnSync('powershell.exe', ['-NoProfile', '-Command', psCmd], { stdio: 'ignore' });
    console.log('[Woray] Clean slate complete.');
  }
}

const TUNNEL_URL_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i;

/**
 * Spawns a Cloudflare tunnel and waits for the public trycloudflare URL.
 */
function startTunnel(name, localPort) {
  return new Promise((resolve, reject) => {
    console.log(`[Tunnel] Starting Cloudflare Tunnel for ${name} (port ${localPort})...`);

    const proc = spawn(`cloudflared tunnel --url http://localhost:${localPort}`, {
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

const AGENT_IMPORTANT_REGEX = /\[AgentJob\]|\[Dispatch\]|\[Healthcheck\]|ERROR|FATAL/i;

async function main() {
  const t0 = performance.now();

  console.log('========================================================');
  console.log('⚡ Starting Woray Full-Stack Development Environment');
  console.log('========================================================');

  // Step 0: Ensure a clean slate by sweeping stale listeners & orphaned dev processes
  ensureCleanSlate();

  // Step 1: Spawn Voice Backend (:3001) in background.
  console.log('[Backend] Spawning voice-backend server on :3001...');
  backendProc = spawn('npm --workspace=apps/voice-backend run dev', {
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

  // Step 1B: Spawn LiveKit Agent Worker in background (teeing raw output to agent.log).
  console.log('[Agent] Spawning LiveKit Agent Worker (npx tsx src/agent.ts dev)...');
  agentProc = spawn('npx tsx src/agent.ts dev', {
    cwd: path.resolve(rootDir, 'apps', 'voice-backend'),
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  agentProc.stdout.on('data', (chunk) => {
    // Always capture full raw agent output to agent.log (byte-for-byte) for diagnostics.
    try {
      agentLogStream.write(chunk);
    } catch {
      // Log stream may be closed during shutdown
    }

    const lines = chunk.toString().trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!expoStarted || AGENT_IMPORTANT_REGEX.test(trimmed)) {
        console.log(`[Agent] ${trimmed}`);
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

    const lines = chunk.toString().trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!expoStarted || AGENT_IMPORTANT_REGEX.test(trimmed) || trimmed.toLowerCase().includes('error')) {
        console.error(`[Agent Error] ${trimmed}`);
      }
    }
  });

  agentProc.on('error', (err) => {
    console.error('[Agent] Process spawn error:', err);
  });

  agentProc.on('exit', () => {
    try {
      agentLogStream.end();
    } catch {
      // Stream may already be closed
    }
  });

  try {
    // Step 2: Launch both Cloudflare Tunnels (:3001 and :8081) CONCURRENTLY via Promise.all.
    const startTunnel3001AndWriteConfig = async () => {
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
      return backendTunnel.url;
    };

    const startTunnel8081 = async () => {
      const metroTunnel = await startTunnel('metro-bundler', 8081);
      tunnel8081Proc = metroTunnel.proc;
      console.log(`✅ Metro Bundler Tunnel Live: ${metroTunnel.url}`);
      return metroTunnel.url;
    };

    const [backendTunnelUrl, metroTunnelUrl] = await Promise.all([
      startTunnel3001AndWriteConfig(),
      startTunnel8081(),
    ]);

    // Step 3: Print Clean Summary Banner with parallel boot timing telemetry.
    const bootMs = Math.round(performance.now() - t0);
    console.log('\n========================================================');
    console.log('⚡ WORAY STACK READY (ENTERPRISE WI-FI BYPASS ACTIVE)');
    console.log('========================================================');
    console.log(`⚡ Parallel stack initialized in ${bootMs}ms`);
    console.log(`📡 Backend Tunnel (3001): ${backendTunnelUrl}`);
    console.log(`📱 Metro Tunnel   (8081): ${metroTunnelUrl}`);
    console.log('========================================================');
    console.log('Launching Expo Dev Server with interactive QR code...\n');

    // Mute non-error backend logs so Expo interactive UI stays pristine
    expoStarted = true;

    // Step 4: Launch Interactive Expo Dev Server with inherited stdio on port 8081.
    expoProc = spawn('npx expo start --dev-client --port 8081', {
      cwd: path.resolve(rootDir, 'apps', 'ios-client'),
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        EXPO_PACKAGER_PROXY_URL: metroTunnelUrl,
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
