import { Global, Module } from '@nestjs/common';
import { UsageService } from './usage.service';
import { GenerationLimitGuard } from './generation-limit.guard';

@Global()
@Module({
  providers: [UsageService, GenerationLimitGuard],
  exports: [UsageService, GenerationLimitGuard],
})
export class UsageModule {}
