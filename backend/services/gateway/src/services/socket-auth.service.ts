import jwt from 'jsonwebtoken';
import type { GatewaySocket, GatewayUser } from '../types';

export interface SocketAuthPrismaClient {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; role: true; deletedAt: true };
    }): Promise<{
      id: string;
      role: 'user' | 'moderator' | 'admin';
      deletedAt: Date | null;
    } | null>;
  };
}

interface JwtPayload {
  userId: string;
  email: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretfallback';

export class SocketAuthService {
  constructor(private readonly prisma: SocketAuthPrismaClient) {}

  async authenticate(socket: GatewaySocket): Promise<GatewayUser> {
    const token = this.getBearerToken(socket);
    if (!token) throw new Error('UNAUTHORIZED');

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (err) {
      throw new Error('INVALID_TOKEN', { cause: err });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, deletedAt: true },
    });

    if (!user || user.deletedAt) throw new Error('USER_REMOVED');

    return {
      userId: decoded.userId,
      email: decoded.email,
      role: user.role,
    };
  }

  private getBearerToken(socket: GatewaySocket) {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }

    const authorization = socket.handshake.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length);
    }

    return null;
  }
}
