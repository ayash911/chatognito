import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { AuthService } from './services/auth.service';
import { UsernameService } from './services/username.service';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretfallback';

// Middleware for JWT verification
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (req as any).user = decoded;
    next();
  } catch (_err) {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
};

// Routes
app.post('/api/v1/auth/signup', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'MISSING_FIELDS' });
  }
  const user = await AuthService.signup(email, password);
  res.status(201).json(user);
});

app.post('/api/v1/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'MISSING_FIELDS' });
  }
  const result = await AuthService.login(email, password);
  res.status(200).json(result);
});

app.put('/api/v1/users/me/username', requireAuth, async (req: Request, res: Response) => {
  const { username } = req.body;
  const userId = (req as any).user.userId;

  if (!username) {
    return res.status(400).json({ error: 'USERNAME_REQUIRED' });
  }

  const cooldownEndsAt = await UsernameService.setUsername(userId, username);
  res.status(200).json({ message: 'Username updated successfully.', cooldownEndsAt });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (
    err.message === 'USERNAME_TAKEN' ||
    err.message === 'USERNAME_TAKEN_OR_PENDING' ||
    err.message === 'EMAIL_IN_USE'
  ) {
    return res.status(409).json({ error: err.message });
  }
  if (err.message === 'COOLDOWN_ACTIVE') {
    return res.status(429).json({ error: err.message });
  }
  if (err.message.startsWith('INVALID_FORMAT') || err.message === 'INVALID_CREDENTIALS') {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Auth Service listening on port ${PORT}`);
});
