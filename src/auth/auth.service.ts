import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  private readonly googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
  private readonly google = new OAuth2Client(this.googleClientId);

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

  /**
   * Sign in with a Google ID token (from Google Identity Services on the web).
   * Find-or-create the user by verified email, optionally adopting the work
   * done in an anonymous session, and return our own session token.
   */
  async googleLogin(credential: string, anonToken?: string) {
    if (!this.googleClientId) {
      throw new UnauthorizedException('Google sign-in is not configured');
    }

    let payload;
    try {
      const ticket = await this.google.verifyIdToken({
        idToken: credential,
        audience: this.googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google credential');
    }
    if (!payload?.email || !payload.email_verified) {
      throw new UnauthorizedException('Unverified Google account');
    }

    const email = payload.email.toLowerCase();
    const name = payload.name ?? null;
    const picture = payload.picture ?? null;

    let user = await this.prisma.user.findUnique({ where: { email } });

    if (user) {
      // Returning user — refresh profile, keep their existing data.
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { name, picture },
      });
    } else {
      // New account — create it, then migrate any anonymous work into it.
      user = await this.prisma.user.create({
        data: { email, name, picture },
      });
      await this.adoptAnonymous(anonToken, user.id);
    }

    const token = await this.jwt.signAsync({ sub: user.id });
    return {
      token,
      userId: user.id,
      user: { email: user.email, name: user.name, picture: user.picture },
    };
  }

  /**
   * Move documents/progress from a still-anonymous session into a freshly
   * created account, then drop the throwaway anon user. Safe only for a new
   * target user (no rows yet → no unique-constraint clashes).
   */
  private async adoptAnonymous(anonToken: string | undefined, targetId: string) {
    if (!anonToken) return;
    let anonId: string;
    try {
      const { sub } = await this.jwt.verifyAsync<{ sub: string }>(anonToken);
      anonId = sub;
    } catch {
      return; // bad/expired token — nothing to adopt
    }
    if (anonId === targetId) return;

    const anon = await this.prisma.user.findUnique({
      where: { id: anonId },
      select: { id: true, email: true },
    });
    if (!anon || anon.email) return; // only adopt genuinely anonymous sessions

    const where = { userId: anonId };
    const data = { userId: targetId };
    try {
      await this.prisma.$transaction([
        this.prisma.document.updateMany({ where, data }),
        this.prisma.attempt.updateMany({ where, data }),
        this.prisma.exam.updateMany({ where, data }),
        this.prisma.userConcept.updateMany({ where, data }),
        this.prisma.flashcardReview.updateMany({ where, data }),
        this.prisma.user.delete({ where: { id: anonId } }),
      ]);
      this.log.log(`Adopted anonymous session ${anonId} into ${targetId}`);
    } catch (e) {
      // Non-fatal: the user still gets their account, just without the
      // anonymous scratch data.
      this.log.warn(`Could not adopt anonymous session: ${(e as Error).message}`);
    }
  }
}
