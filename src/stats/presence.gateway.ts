import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { DEMO_MODE, demoOnline } from './demo.util';

const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

/**
 * Tracks how many clients are connected right now (real presence).
 * In DEMO_MODE the count is simulated for presentations.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: origins } })
export class PresenceGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() private server!: Server;
  private online = 0;

  onModuleInit() {
    if (DEMO_MODE) {
      // Refresh the simulated count periodically so it feels live.
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

  handleConnection(client: Socket) {
    if (!DEMO_MODE) this.online += 1;
    client.emit('online', this.getOnline());
    this.broadcast();
  }

  handleDisconnect() {
    if (!DEMO_MODE) this.online = Math.max(0, this.online - 1);
    this.broadcast();
  }

  private broadcast() {
    this.server?.emit('online', this.getOnline());
  }
}
