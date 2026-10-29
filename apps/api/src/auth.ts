// Signing in, for a Telios on a public address. One account, made on the first visit with the
// setup code (TELIOS_SETUP_CODE, from the server's .env), then a name and password. Without an
// account or a setup code (Telios on your own computer), nothing asks for one.
//
//   data/account.json   the name, and the password's scrypt hash and salt
//   data/secret.key     signs the session cookie (made on first use)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { DATA, SETUP_CODE } from './config.ts';
import { readJson, writeJson } from './store.ts';

const ACCOUNT = path.join(DATA, 'account.json');
const SECRET = path.join(DATA, 'secret.key');
const COOKIE = 'telios_session';
const SESSION_DAYS = 30;

interface Account { name: string; salt: string; hash: string; createdAt: string }

const account = () => readJson<Account>(ACCOUNT);
export const authRequired = () => !!SETUP_CODE || !!account();

let secret: Buffer | null = null;
function key() {
  if (secret) return secret;
  if (!fs.existsSync(SECRET)) fs.writeFileSync(SECRET, crypto.randomBytes(32), { mode: 0o600 });
  return (secret = fs.readFileSync(SECRET));
}

const hashOf = (password: string, salt: string) => crypto.scryptSync(password, salt, 64, { N: 1 << 15, maxmem: 64 * 1024 * 1024 }).toString('hex');
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A session: when it ends, signed. */
function session(now = Date.now()) {
  const exp = String(now + SESSION_DAYS * 86400_000);
  return `${exp}.${crypto.createHmac('sha256', key()).update(exp).digest('hex')}`;
}
function valid(value: string | undefined) {
  const [exp, sig] = (value ?? '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, crypto.createHmac('sha256', key()).update(exp).digest('hex'));
}
const cookieOf = (req: Request) => (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1];

function signIn(req: Request, res: Response) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${session()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

// Ten wrong tries from one address in fifteen minutes, then a wait.
const tries = new Map<string, number[]>();
function tooMany(req: Request) {
  const ip = req.ip ?? '';
  const recent = (tries.get(ip) ?? []).filter((t) => Date.now() - t < 15 * 60_000);
  tries.set(ip, recent);
  return recent.length >= 10;
}
const missed = (req: Request) => tries.set(req.ip ?? '', [...(tries.get(req.ip ?? '') ?? []), Date.now()]);

export function authRoutes() {
  const router = express.Router();
  router.get('/', (req, res) => {
    const a = account();
    res.json({ required: authRequired(), setup: !a && !!SETUP_CODE, signedIn: !authRequired() || valid(cookieOf(req)), name: a?.name ?? null });
  });
  router.post('/setup', (req, res) => {
    if (account()) return res.status(409).json({ error: 'The account is already made: sign in.' });
    if (!SETUP_CODE) return res.status(409).json({ error: 'This Telios has no setup code.' });
    if (tooMany(req)) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
    const { code, name, password } = req.body ?? {};
    if (typeof code !== 'string' || !same(code.trim(), SETUP_CODE)) { missed(req); return res.status(403).json({ error: 'That setup code is not right.' }); }
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Choose a name to sign in with.' });
    if (typeof password !== 'string' || password.length < 10) return res.status(400).json({ error: 'Choose a password of at least 10 characters.' });
    const salt = crypto.randomBytes(16).toString('hex');
    writeJson(ACCOUNT, { name: name.trim().slice(0, 80), salt, hash: hashOf(password, salt), createdAt: new Date().toISOString() });
    fs.chmodSync(ACCOUNT, 0o600);
    signIn(req, res);
    res.json({ ok: true });
  });
  router.post('/login', (req, res) => {
    const a = account();
    if (!a) return res.status(409).json({ error: 'No account yet: set it up first.' });
    if (tooMany(req)) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
    const { name, password } = req.body ?? {};
    const ok = typeof name === 'string' && typeof password === 'string' && name.trim() === a.name && same(hashOf(password, a.salt), a.hash);
    if (!ok) { missed(req); return res.status(403).json({ error: 'That name and password do not match.' }); }
    signIn(req, res);
    res.json({ ok: true });
  });
  router.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });
  return router;
}

/** Everything but signing in itself and the web app's own files waits for a session. */
export function requireSession(req: Request, res: Response, next: NextFunction) {
  if (!authRequired() || valid(cookieOf(req))) return next();
  res.status(401).json({ error: 'Sign in first.' });
}
