import crypto from 'node:crypto';
import { config } from './config.js';

const TTL_MS = 7 * 24 * 3600 * 1000;

const sign = (payload) =>
  crypto.createHmac('sha256', config.tokenSecret).update(payload).digest('hex');

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

export function checkPassword(pw) {
  return safeEqual(pw ?? '', config.password);
}

export function issueToken() {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${sign(exp)}`;
}

export function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const [exp, sig] = token.split('.');
  if (exp && sig && Number(exp) > Date.now() && safeEqual(sig, sign(exp))) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}
