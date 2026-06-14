import { Global, Module } from '@nestjs/common';
import { MasteryService } from './mastery.service';
import { ProgressController } from './progress.controller';

@Global()
@Module({
  controllers: [ProgressController],
  providers: [MasteryService],
  exports: [MasteryService],
})
export class ProgressModule {}
