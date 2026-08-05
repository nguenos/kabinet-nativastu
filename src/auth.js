// Сессия в подписанной cookie (HMAC). Без внешних библиотек.
import crypto from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const COOKIE = 'nv_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 дней

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function setSession(res, userId) {
  const token = sign({ uid: userId, exp: Date.now() + MAX_AGE * 1000 });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function getUserId(req) {
  const data = verify(parseCookies(req)[COOKIE]);
  return data ? data.uid : null;
}

// Middleware: требует вход. Для API отдаёт 401, для страниц редиректит на /login.
export function requireAuth(kind = 'page') {
  return (req, res, next) => {
    const uid = getUserId(req);
    if (!uid) {
      if (kind === 'api') return res.status(401).json({ error: 'unauthorized' });
      return res.redirect('/login');
    }
    req.userId = uid;
    next();
  };
}

export function genCode() {
  return String(crypto.randomInt(100000, 1000000)); // 6 цифр
}

// Список админов из переменной окружения ADMIN_EMAILS (через запятую).
const ADMINS = (process.env.ADMIN_EMAILS || 'natiyaguenos@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function isAdminEmail(email) {
  return ADMINS.includes(String(email || '').trim().toLowerCase());
}
