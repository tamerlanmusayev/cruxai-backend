import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Create an anonymous user and return a long-lived token. */
  async anonymous() {
    const user = await this.prisma.user.create({
      data: { anonId: randomBytes(16).toString('hex') },
      select: { id: true },
    });
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, userId: user.id };
  }
}
