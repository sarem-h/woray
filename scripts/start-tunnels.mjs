import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const runtimeConfigPath = path.resolve(rootDir, 'apps', 'ios-client', 'runtime-config.json');
const agentLogPath = path.resolve(rootDir, 'apps', 'voice-backend', 'agent.log');
const pidsFilePath = path.resolve(rootDir, '.woray-dev.pids');

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
    // Remove the PID tracking file, then close the agent diagnostic log stream cleanly.
    removePidsFile();
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
 * Writes the set of currently-tracked child PIDs to .woray-dev.pids (repo root).
 */
function writePidsFile() {
  const pids = [backendProc, agentProc, tunnel3001Proc, tunnel8081Proc, expoProc]
    .filter((p) => p && p.pid)
    .map((p) => p.pid);
  try {
    fs.writeFileSync(pidsFilePath, JSON.stringify({ pids, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
  } catch {
    // Non-fatal: PID file is a best-effort recovery mechanism
  }
}

/**
 * Removes the .woray-dev.pids tracking file (called on clean shutdown).
 */
function removePidsFile() {
  try {
    if (fs.existsSync(pidsFilePath)) fs.unlinkSync(pidsFilePath);
  } catch {
    // Ignore
  }
}

/**
 * Kills a single PID tree (Windows taskkill /T /F), ignoring errors if already dead.
 */
function killPidTree(pid) {
  if (!pid || isNaN(Number(pid)) || Number(pid) === process.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // Already dead
  }
}

/**
 * Kills every PID recorded in a previous run's .woray-dev.pids file.
 */
function killPidsFromFile() {
  try {
    if (!fs.existsSync(pidsFilePath)) return;
    const data = JSON.parse(fs.readFileSync(pidsFilePath, 'utf-8'));
    const pids = Array.isArray(data?.pids) ? data.pids : [];
    if (pids.length > 0) {
      console.log(`[Woray] Killing ${pids.length} stale PID(s) from previous .woray-dev.pids run...`);
      for (const pid of pids) killPidTree(pid);
    }
  } catch {
    // Corrupt/unreadable PID file — proceed anyway
  }
}

/**
 * Uses PowerShell's Get-NetTCPConnection to find and force-kill any process listening
 * on ports 3001 or 8081, plus any orphaned `src/agent.ts` node worker processes.
 */
function killProcessesOnPortsAndOrphans() {
  if (process.platform !== 'win32') return;

  const killListeners =
    'Get-NetTCPConnection -LocalPort 3001,8081 -State Listen -ErrorAction SilentlyContinue | ' +
    'Select-Object -ExpandProperty OwningProcess -Unique | ' +
    'ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }';

  const killOrphanAgents =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.CommandLine -match 'src/agent\\.ts' } | " +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';

  for (const cmd of [killListeners, killOrphanAgents]) {
    try {
      execSync(`powershell -NoProfile -Command "${cmd}"`, { stdio: 'ignore' });
    } catch {
      // No matching processes — ports already free / no orphans
    }
  }
}

/**
 * Verifies a TCP port is fully released by the OS kernel by attempting to bind to it.
 * Retries every 150ms (up to `timeoutMs`) until binding succeeds. Resolves once the
 * test server binds + closes cleanly (proving the port is genuinely free).
 */
function waitForPortFree(port, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;

  const tryBind = () =>
    new Promise((resolve, reject) => {
      const tester = net.createServer();
      tester.unref();
      tester.once('error', (err) => {
        try { tester.close(); } catch { /* ignore */ }
        reject(err);
      });
      tester.once('listening', () => {
        tester.close(() => resolve(true));
      });
      tester.listen({ host: '0.0.0.0', port });
    });

  return (async () => {
    for (;;) {
      try {
        await tryBind();
        return true;
      } catch (err) {
        if (Date.now() >= deadline) {
          throw new Error(`Port ${port} did not become free within ${timeoutMs}ms (${err?.code ?? err})`);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  })();
}

/**
 * Ensures a completely clean slate before spawning any dev processes:
 * 1. Kills PIDs recorded in a previous .woray-dev.pids run.
 * 2. Kills any process listening on 3001/8081 and orphaned agent.ts workers.
 * 3. Blocks until the OS kernel has fully released both ports (verified by binding).
 */
async function ensureCleanSlate() {
  if (process.platform !== 'win32') return;

  console.log('[Woray] Ensuring clean slate: killing stale PIDs, port listeners, and orphaned agents...');
  killPidsFromFile();
  killProcessesOnPortsAndOrphans();

  // Mandatory verification: do not proceed until both ports are genuinely free.
  await Promise.all([waitForPortFree(3001), waitForPortFree(8081)]);
  console.log('[Woray] Ports 3001 and 8081 verified free.');
}

const TUNNEL_URL_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i;

/**
 * Spawns a Cloudflare tunnel and waits for the public trycloudflare URL.
 */
function startTunnel(name, localPort) {
  return new Promise((resolve, reject) => {
    console.log(`[Tunnel] Starting Cloudflare Tunnel for ${name} (port ${localPort})...`);

    // DEP0190 fix: single combined command string with shell:true (no args array).
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

async function main() {
  const t0 = performance.now();

  console.log('========================================================');
  console.log('⚡ Starting Woray Full-Stack Development Environment');
  console.log('========================================================');

  // Step 0 (t=0ms): Ensure a completely clean slate — kill stale PIDs from any prior run,
  // kill anything still listening on 3001/8081 plus orphaned agent.ts workers, then BLOCK
  // until the OS kernel has verifiably released both ports before spawning anything.
  await ensureCleanSlate();

  // Step 1: Spawn Voice Backend (:3001) in background.
  // DEP0190 fix: single combined command string with shell:true (no args array).
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
  // DEP0190 fix: single combined command string with shell:true (no args array).
  console.log('[Agent] Spawning LiveKit Agent Worker (npx tsx src/agent.ts dev)...');
  agentProc = spawn('npx tsx src/agent.ts dev', {
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
    // Step 2: Launch both Cloudflare Tunnels (:3001 and :8081) CONCURRENTLY via Promise.all.
    // The voice-backend server (Process A) and LiveKit agent worker (Process B) are already
    // booting in the background (spawned above, fire-and-forget). Tunnel C (:3001) writes
    // runtime-config.json as soon as its URL resolves; Tunnel D (:8081) runs in parallel.
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
    // DEP0190 fix: single combined command string with shell:true (no args array).
    expoProc = spawn('npx expo start --dev-client --port 8081', {
      cwd: path.resolve(rootDir, 'apps', 'ios-client'),
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        EXPO_PACKAGER_PROXY_URL: metroTunnelUrl,
      },
    });

    // Persist all spawned PIDs for next-run clean-slate recovery.
    writePidsFile();

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
