import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { parse } from 'url';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

// WebSocket connection manager
class WebSocketManager {
  private wss: WebSocketServer;
  private connections: Map<string, Set<WebSocket>> = new Map();
  private userConnections: Map<string, WebSocket> = new Map();

  constructor(server: any) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/api/tasks/live',
      verifyClient: this.verifyClient.bind(this)
    });

    this.wss.on('connection', this.handleConnection.bind(this));
  }

  private async verifyClient(info: { req: IncomingMessage }): Promise<boolean> {
    try {
      const url = parse(info.req.url!, true);
      const token = url.query.token as string;
      
      if (!token) {
        return false;
      }

      // Verify JWT token (same logic as auth middleware)
      const client = jwksClient({
        jwksUri: process.env.CLERK_JWKS_URL || 'https://pumped-sheep-45.clerk.accounts.dev/.well-known/jwks.json'
      });

      const getKey = (header: any, callback: any) => {
        client.getSigningKey(header.kid, (err, key) => {
          if (err) {
            callback(err);
            return;
          }
          const signingKey = key?.getPublicKey();
          callback(null, signingKey);
        });
      };

      const decoded = await new Promise((resolve, reject) => {
        jwt.verify(token, getKey, {
          issuer: process.env.CLERK_ISSUER_URL,
          audience: process.env.CLERK_AUDIENCE,
          algorithms: ['RS256']
        }, (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        });
      });

      // Store user info in request for later use
      (info.req as any).user = decoded;
      return true;

    } catch (error) {
      console.error('WebSocket auth failed:', error);
      return false;
    }
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage) {
    const url = parse(req.url!, true);
    const projectId = url.pathname?.split('/').pop();
    const user = (req as any).user;

    if (!projectId || !user) {
      ws.close(1008, 'Invalid connection parameters');
      return;
    }

    console.log(`WebSocket connected: User ${user.sub} to project ${projectId}`);

    // Add connection to project room
    if (!this.connections.has(projectId)) {
      this.connections.set(projectId, new Set());
    }
    this.connections.get(projectId)!.add(ws);

    // Store user connection
    this.userConnections.set(user.sub, ws);

    // Handle messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(ws, message, projectId, user);
      } catch (error) {
        console.error('Invalid WebSocket message:', error);
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      console.log(`WebSocket disconnected: User ${user.sub} from project ${projectId}`);
      this.connections.get(projectId)?.delete(ws);
      this.userConnections.delete(user.sub);
      
      // Clean up empty project rooms
      if (this.connections.get(projectId)?.size === 0) {
        this.connections.delete(projectId);
      }
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'CONNECTED',
      projectId,
      userId: user.sub,
      timestamp: new Date().toISOString()
    }));
  }

  private handleMessage(ws: WebSocket, message: any, projectId: string, user: any) {
    // Handle ping/pong for connection health
    if (message.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
      return;
    }

    // Log other message types for debugging
    console.log('WebSocket message received:', message.type, 'from user:', user.sub);
  }

  // Broadcast task updates to project members
  public broadcastTaskUpdate(projectId: string, message: any) {
    const projectConnections = this.connections.get(projectId);
    if (!projectConnections) return;

    const messageStr = JSON.stringify({
      ...message,
      timestamp: new Date().toISOString()
    });

    projectConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  // Send message to specific user
  public sendToUser(userId: string, message: any) {
    const userWs = this.userConnections.get(userId);
    if (userWs && userWs.readyState === WebSocket.OPEN) {
      userWs.send(JSON.stringify({
        ...message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  // Get connection stats
  public getStats() {
    return {
      totalConnections: this.userConnections.size,
      activeProjects: this.connections.size,
      projectConnections: Object.fromEntries(
        Array.from(this.connections.entries()).map(([projectId, connections]) => [
          projectId,
          connections.size
        ])
      )
    };
  }
}

let wsManager: WebSocketManager | null = null;

export const initializeWebSocket = (server: any) => {
  wsManager = new WebSocketManager(server);
  return wsManager;
};

export const getWebSocketManager = () => wsManager;

// Helper functions for broadcasting task events
export const broadcastTaskMoved = (projectId: string, taskId: string, fromStatus: string, toStatus: string, movedBy: string) => {
  if (wsManager) {
    wsManager.broadcastTaskUpdate(projectId, {
      type: 'TASK_MOVED',
      taskId,
      fromStatus,
      toStatus,
      movedBy
    });
  }
};

export const broadcastTaskAssigned = (projectId: string, taskId: string, assignedTo: string, assignedBy: string) => {
  if (wsManager) {
    wsManager.broadcastTaskUpdate(projectId, {
      type: 'TASK_ASSIGNED',
      taskId,
      assignedTo,
      assignedBy
    });
  }
};

export const broadcastTaskCreated = (projectId: string, task: any, createdBy: string) => {
  if (wsManager) {
    wsManager.broadcastTaskUpdate(projectId, {
      type: 'TASK_CREATED',
      task,
      createdBy
    });
  }
};

export const broadcastTaskUpdated = (projectId: string, taskId: string, updates: any, updatedBy: string) => {
  if (wsManager) {
    wsManager.broadcastTaskUpdate(projectId, {
      type: 'TASK_UPDATED',
      taskId,
      updates,
      updatedBy
    });
  }
};
