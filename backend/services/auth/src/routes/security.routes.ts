import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '@common/db/prisma';
import { requireAuth, AuthRequest } from '../middlewares/auth.middleware';
import { CryptoPrimitives } from '@chatognito/crypto';

export const securityRouter = Router();

securityRouter.use(requireAuth);

/**
 * Upload key bundle for X3DH
 */
securityRouter.post('/keys', async (req: AuthRequest, res: Response) => {
  const schema = z
    .object({
      identityPublicKey: z.string().optional(),
      identityDhPublicKey: z.string().optional(),
      identitySigningPublicKey: z.string().optional(),
      signedPreKey: z.string(),
      signedPreKeySignature: z.string(),
      oneTimePreKeys: z.array(z.string()).min(1),
    })
    .refine((body) => body.identitySigningPublicKey || body.identityPublicKey, {
      message: 'IDENTITY_SIGNING_PUBLIC_KEY_REQUIRED',
      path: ['identitySigningPublicKey'],
    })
    .refine((body) => body.identityDhPublicKey || body.identityPublicKey, {
      message: 'IDENTITY_DH_PUBLIC_KEY_REQUIRED',
      path: ['identityDhPublicKey'],
    });

  const {
    identityPublicKey,
    identityDhPublicKey,
    identitySigningPublicKey,
    signedPreKey,
    signedPreKeySignature,
    oneTimePreKeys,
  } = schema.parse(req.body);

  const signingPublicKey = identitySigningPublicKey ?? identityPublicKey!;
  const dhPublicKey = identityDhPublicKey ?? identityPublicKey!;

  // VITAL: Use our crypto package to verify the signature
  const isSignatureValid = (() => {
    try {
      return CryptoPrimitives.verify(
        signingPublicKey,
        Buffer.from(signedPreKey),
        Buffer.from(signedPreKeySignature, 'hex'),
      );
    } catch (_err) {
      return false;
    }
  })();

  if (!isSignatureValid) {
    return res.status(400).json({ error: 'INVALID_SIGNED_PREKEY_SIGNATURE' });
  }

  const userId = req.user!.userId;

  await prisma.$transaction(async (tx) => {
    // Delete existing bundle
    await tx.oneTimePreKey.deleteMany({ where: { userId } });

    await tx.keyBundle.upsert({
      where: { userId },
      create: {
        userId,
        identityPublicKey: signingPublicKey,
        identityDhPublicKey: dhPublicKey,
        identitySigningPublicKey: signingPublicKey,
        signedPreKey,
        signedPreKeySignature,
        oneTimePreKeys: {
          create: oneTimePreKeys.map((publicKey) => ({ publicKey })),
        },
      },
      update: {
        identityPublicKey: signingPublicKey,
        identityDhPublicKey: dhPublicKey,
        identitySigningPublicKey: signingPublicKey,
        signedPreKey,
        signedPreKeySignature,
        oneTimePreKeys: {
          create: oneTimePreKeys.map((publicKey) => ({ publicKey })),
        },
      },
    });
  });

  res.json({ success: true });
});

/**
 * Get public key bundle for a target user
 */
securityRouter.get('/keys/:targetUserId', async (req: AuthRequest, res: Response) => {
  const { targetUserId } = req.params;

  const bundle = await prisma.keyBundle.findUnique({
    where: { userId: targetUserId },
    include: {
      oneTimePreKeys: {
        take: 1, // Fetch only one OPK for X3DH
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!bundle) throw new Error('USER_NOT_FOUND');

  // Pop the OPK so it's not reused
  const opk = bundle.oneTimePreKeys[0];
  if (opk) {
    await prisma.oneTimePreKey.delete({ where: { id: opk.id } });
  }

  res.json({
    identityPublicKey: bundle.identityPublicKey,
    identityDhPublicKey: bundle.identityDhPublicKey ?? bundle.identityPublicKey,
    identitySigningPublicKey: bundle.identitySigningPublicKey ?? bundle.identityPublicKey,
    signedPreKey: bundle.signedPreKey,
    signedPreKeySignature: bundle.signedPreKeySignature,
    oneTimePreKey: opk ? opk.publicKey : null,
  });
});
