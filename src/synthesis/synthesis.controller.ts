import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { SynthesisService } from './synthesis.service';
import { SynthesisDto } from './dto/synthesis.dto';
import { AuthedRequest, JwtAuthGuard } from '../auth/jwt.guard';

@Controller('synthesis')
@UseGuards(JwtAuthGuard)
export class SynthesisController {
  constructor(private readonly synthesis: SynthesisService) {}

  @Post()
  run(@Req() req: AuthedRequest, @Body() dto: SynthesisDto) {
    return this.synthesis.run(req.userId!, dto.documentIds, dto.query);
  }
}
