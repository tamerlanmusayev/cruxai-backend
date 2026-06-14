import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { PresenceGateway } from './presence.gateway';

@Module({
  controllers: [StatsController],
  providers: [PresenceGateway],
})
export class StatsModule {}
