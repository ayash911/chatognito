import { Router, Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { OAuthService } from '../services/oauth.service';

export const authRouter = Router();

authRouter.post('/signup', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'MISSING_FIELDS' });
  }
  const user = await AuthService.signup(email, password);
  res.status(201).json(user);
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'MISSING_FIELDS' });
  }
  const result = await AuthService.login(email, password);
  res.status(200).json(result);
});

authRouter.post('/oauth/callback', async (req: Request, res: Response) => {
  const { provider, providerId, email, displayName, avatarUrl } = req.body;

  if (!provider || !providerId || !email) {
    return res.status(400).json({ error: 'MISSING_FIELDS' });
  }

  const result = await OAuthService.handleOAuthLogin(
    provider,
    providerId,
    email,
    displayName,
    avatarUrl,
  );

  res.json(result);
});
