import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { DEMO_MODE, demoOnline } from '../stats/demo.util';

const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

export interface DocReadyEvent {
  id: string;
  title: string;
}

/**
 * Real-time hub:
 *  - live presence count (real, or simulated in DEMO_MODE)
 *  - per-user rooms so the worker can push "your notes are ready" while the
 *    user browses elsewhere.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: origins } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() private server!: Server;
  private online = 0;

  constructor(private readonly jwt: JwtService) {}

  onModuleInit() {
    if (DEMO_MODE) {
      setInterval(() => {
        this.online = demoOnline(Date.now());
        this.broadcast();
      }, 25_000);
      this.online = demoOnline(Date.now());
    }
  }

  getOnline(): number {
    return DEMO_MODE ? demoOnline(Date.now()) : this.online;
  }

  async handleConnection(client: Socket) {
    if (!DEMO_MODE) this.online += 1;
    client.emit('online', this.getOnline());
    this.broadcast();

    // Join the user's room (token passed in the socket handshake auth).
    const token = client.handshake.auth?.token as string | undefined;
    if (token) {
      try {
        const { sub } = await this.jwt.verifyAsync<{ sub: string }>(token);
        if (sub) await client.join(`user:${sub}`);
      } catch {
        /* anonymous / invalid token — presence still counts */
      }
    }
  }

  handleDisconnect() {
    if (!DEMO_MODE) this.online = Math.max(0, this.online - 1);
    this.broadcast();
  }

  /** Push a "document ready" event to a specific user's room. */
  notifyDocReady(userId: string, payload: DocReadyEvent) {
    this.server?.to(`user:${userId}`).emit('doc:ready', payload);
  }

  private broadcast() {
    this.server?.emit('online', this.getOnline());
  }
}
