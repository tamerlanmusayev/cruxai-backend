import { Global, Module } from '@nestjs/common';
import { UsageService } from './usage.service';
import { GenerationLimitGuard } from './generation-limit.guard';
import { UsageController } from './usage.controller';

@Global()
@Module({
  controllers: [UsageController],
  providers: [UsageService, GenerationLimitGuard],
  exports: [UsageService, GenerationLimitGuard],
})
export class UsageModule {}
