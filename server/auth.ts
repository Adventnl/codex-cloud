import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Store } from './store.js';
import { config } from './config.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function passwordRecord(password: string) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
export async function registerAuth(app: FastifyInstance, store: Store) {
  if (!store.get('password', null)) {
    const password = process.env.DASHBOARD_PASSWORD;
    if (!password || password.length < 16)
      throw new Error(
        'Run npm run setup first, or set DASHBOARD_PASSWORD to at least 16 characters',
      );
    store.set('password', passwordRecord(password));
  }
  const attempts = new Map<string, { count: number; since: number }>();
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    if (process.env.NODE_ENV === 'production')
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
      );
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (
        origin &&
        origin !== config.origin &&
        !(process.env.NODE_ENV !== 'production' && origin === 'http://127.0.0.1:5173')
      )
        return reply.code(403).send({ error: 'Request origin is not allowed' });
      if (request.headers['sec-fetch-site'] === 'cross-site')
        return reply.code(403).send({ error: 'Cross-site requests are not allowed' });
    }
    if (request.url === '/api/auth/login' || request.url === '/api/auth/status') return;
    const token = request.cookies.session;
    const session =
      token &&
      (store.db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(hash(token)) as
        { expires_at: number } | undefined);
    if (!session || session.expires_at < Date.now())
      return reply.code(401).send({ error: 'Sign in to your dashboard' });
  });
  app.get('/api/auth/status', async (request) => {
    const token = request.cookies.session;
    const row =
      token &&
      (store.db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(hash(token)) as
        { expires_at: number } | undefined);
    return { authenticated: Boolean(row && row.expires_at > Date.now()) };
  });
  app.post<{ Body: { password?: string } }>('/api/auth/login', async (request, reply) => {
    const ip = request.ip,
      now = Date.now();
    let attempt = attempts.get(ip);
    if (!attempt || now - attempt.since > 15 * 60_000) {
      attempt = { count: 0, since: now };
      attempts.set(ip, attempt);
    }
    if (attempt.count >= 10)
      return reply.code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' });
    attempt.count++;
    if (attempts.size > 1000)
      for (const [key, value] of attempts)
        if (now - value.since > 15 * 60_000) attempts.delete(key);
    const password = request.body?.password;
    if (typeof password !== 'string' || password.length > 1000)
      return reply.code(400).send({ error: 'Invalid password' });
    const record = store.get<{ salt: string; hash: string }>('password', { salt: '', hash: '' });
    if (!timingSafeEqual(scryptSync(password, record.salt, 64), Buffer.from(record.hash, 'hex')))
      return reply.code(401).send({ error: 'Incorrect dashboard password' });
    attempts.delete(ip);
    const token = randomBytes(32).toString('hex');
    store.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    store.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token), now + 7 * 86_400_000);
    reply.setCookie('session', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies,
      maxAge: 7 * 86400,
    });
    return { authenticated: true };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    if (request.cookies.session)
      store.db
        .prepare('DELETE FROM sessions WHERE token_hash=?')
        .run(hash(request.cookies.session));
    reply.clearCookie('session', { path: '/' });
    return { authenticated: false };
  });
}
