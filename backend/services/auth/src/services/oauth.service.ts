import { prisma } from '@common/db/prisma';
import { AuthService } from './auth.service';
import { OAuthProvider } from '@chatognito/database';

export class OAuthService {
  /**
   * Handle OAuth Callback (Simplified for now)
   */
  static async handleOAuthLogin(
    provider: OAuthProvider,
    providerId: string,
    email: string,
    displayName?: string,
    avatarUrl?: string,
  ) {
    // 1. Check if this OAuth identity already exists
    const existingIdentity = await prisma.oAuthIdentity.findUnique({
      where: {
        provider_providerId: {
          provider,
          providerId,
        },
      },
      include: { user: true },
    });

    if (existingIdentity) {
      // User found, generate token
      return await AuthService.loginWithoutPassword(existingIdentity.user);
    }

    // 2. Check if a user with this email already exists
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Create new user (OAuth signup)
      user = await prisma.user.create({
        data: {
          email,
          displayName: displayName || email.split('@')[0],
          avatarUrl,
        },
      });
    }

    // 3. Link the OAuth identity to the user
    await prisma.oAuthIdentity.create({
      data: {
        userId: user.id,
        provider,
        providerId,
      },
    });

    return await AuthService.loginWithoutPassword(user);
  }
}
