import http from 'node:http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk';
import { pipelineConfig } from './config/pipeline.config.js';

const PORT = pipelineConfig.server.port;
const LIVEKIT_URL = pipelineConfig.livekit.url;
const LIVEKIT_API_KEY = pipelineConfig.livekit.apiKey;
const LIVEKIT_API_SECRET = pipelineConfig.livekit.apiSecret;

const dispatchClient = new AgentDispatchClient(
  pipelineConfig.livekit.url.replace(/^ws(s?):/, 'http$1:'),
  pipelineConfig.livekit.apiKey,
  pipelineConfig.livekit.apiSecret
);

const app = express();
app.use(cors());
app.use(express.json());

// Health Check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    livekitConfigured: Boolean(LIVEKIT_API_KEY && LIVEKIT_API_SECRET),
    livekitUrl: LIVEKIT_URL,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/session/token
 * Generates an authorized LiveKit AccessToken for real-time voice streaming.
 * Supports dynamic room and identity isolation when omitted or set to 'auto'.
 */
app.post('/api/session/token', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawRoom = (req.body?.room as string)?.trim();
    const rawIdentity = (req.body?.identity as string)?.trim();
    const triggerSource = (req.body?.trigger as string) || 'unknown';

    // Dynamic isolation: if omitted, empty, or 'auto', generate unique IDs
    const roomName =
      !rawRoom || rawRoom === 'auto'
        ? `woray-session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        : rawRoom;

    const participantIdentity =
      !rawIdentity || rawIdentity === 'auto'
        ? `iphone-17-${Math.random().toString(36).slice(2, 6)}`
        : rawIdentity;

    console.log(
      `[Woray Backend] Token requested for room="${roomName}", identity="${participantIdentity}", trigger="${triggerSource}"`
    );

    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      res.status(500).json({
        error:
          'LIVEKIT_API_KEY or LIVEKIT_API_SECRET is missing. Please configure apps/voice-backend/.env',
      });
      return;
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: participantIdentity,
      name: participantIdentity,
      ttl: '1h',
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    const agentName = pipelineConfig.livekit.agentName;
    try {
      const dispatch = await dispatchClient.createDispatch(roomName, agentName);
      console.log(`[Dispatch] Created ${dispatch.id} → ${agentName} @ ${roomName}`);
    } catch (err: any) {
      console.error(`[Dispatch] FAILED for ${roomName}:`, err);
      res.status(500).json({ error: 'Agent dispatch failed', detail: String(err) });
      return;
    }

    res.json({
      token,
      wsUrl: LIVEKIT_URL,
      room: roomName,
      identity: participantIdentity,
      trigger: triggerSource,
      issuedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[Woray Backend] Token generation error:', err);
    res.status(500).json({
      error: 'Failed to generate LiveKit room token',
      details: err?.message,
    });
  }
});

/**
 * GET /api/debug/dispatch/:roomName
 * Lists all active agent dispatches for a given room.
 */
app.get('/api/debug/dispatch/:roomName', async (req: Request, res: Response): Promise<void> => {
  try {
    const roomName = String(req.params.roomName);
    const dispatches = await dispatchClient.listDispatch(roomName);
    res.json(dispatches);
  } catch (err: any) {
    console.error(`[Dispatch Debug] Failed to list dispatches for ${req.params.roomName}:`, err);
    res.status(500).json({ error: 'Failed to list dispatches', detail: String(err) });
  }
});

// Create HTTP server instance
const server = http.createServer(app);

// WebSocket Control Channel Server on path /ws/control
const wss = new WebSocketServer({
  server,
  path: '/ws/control',
});

interface ControlMessage {
  type: string;
  payload?: any;
}

wss.on('connection', (ws: WebSocket, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[Woray Control WS] Client connected from ${clientIp}`);

  // Send initial handshake
  ws.send(
    JSON.stringify({
      type: 'handshake',
      status: 'ready',
      serverTime: Date.now(),
      targetRoom: 'action-button-room',
    })
  );

  ws.on('message', (data: Buffer | string) => {
    try {
      const msg: ControlMessage = JSON.parse(data.toString());
      console.log(`[Woray Control WS] Received message:`, msg);

      switch (msg.type) {
        case 'action_button_press':
          // Pre-warm signal received directly from iOS client
          console.log('[Woray Control WS] Action Button trigger notification received!', msg.payload);
          ws.send(
            JSON.stringify({
              type: 'action_button_ack',
              timestamp: Date.now(),
              room: msg.payload?.room || 'dynamic',
            })
          );
          break;

        case 'ping':
          ws.send(
            JSON.stringify({
              type: 'pong',
              clientTimestamp: msg.payload?.timestamp,
              serverTimestamp: Date.now(),
            })
          );
          break;

        default:
          ws.send(
            JSON.stringify({
              type: 'ack',
              receivedType: msg.type,
              status: 'processed',
            })
          );
          break;
      }
    } catch (e) {
      console.error('[Woray Control WS] Invalid JSON message received:', e);
    }
  });

  ws.on('close', () => {
    console.log(`[Woray Control WS] Client disconnected (${clientIp})`);
  });

  ws.on('error', (err) => {
    console.error(`[Woray Control WS] Socket error:`, err);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(`🚀 Woray Server running on http://0.0.0.0:${PORT}`);
  console.log(`📡 WebSocket Control Channel active on ws://0.0.0.0:${PORT}/ws/control`);
  console.log(`🔑 LiveKit URL target: ${LIVEKIT_URL}`);
  console.log('====================================================');
});
