// Слой данных с двумя бэкендами:
//  - Postgres, если задан DATABASE_URL (продакшн на Render). Данные не теряются.
//  - JSON-файл, если DATABASE_URL нет (локальная разработка/демо).
// Публичный интерфейс одинаковый и асинхронный, поэтому остальной код от бэкенда не зависит.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USE_PG = !!process.env.DATABASE_URL;

const norm = (email) => String(email || '').trim().toLowerCase();
const uid = () => 'u_' + Math.random().toString(36).slice(2, 10);
const pid = () => 'p_' + Math.random().toString(36).slice(2, 10);
const rid = () => 'r_' + Math.random().toString(36).slice(2, 10);

// ---------- КАТАЛОГ ПРОДУКТОВ (статичен, живёт в коде) ----------
const products = [
  // landing — страница продаж (открывается, когда доступа НЕТ).
  { id: 'clean5', title: 'Энергетическая чистка', type: 'Гайд',
    desc: 'Убирает энергетические наслоения, возвращает ощущение себя, очищает пространство и внутренний баланс.',
    cover: 'g1', sym: 'V', slug: 'elements-cleaning', price: 888,
    coverVideo: 'https://nativastu.com/copy_6F88210E-62C5-4FAC-9FE0-8C1932C4BD65.mp4',
    landing: 'https://nativastu.com/elements-cleaning' },
  { id: 'venus', title: 'Протокол Венеры', type: 'Протокол',
    desc: 'Настраиваем юго-восток дома по вашей карте, дальше 21 день мягких ежедневных практик, чтобы вернуться к себе.',
    cover: 'g2', sym: '♀', slug: 'venus-landing', price: 5300,
    coverVideo: 'https://nativastu.com/hero-venus.mp4',
    landing: 'https://nativastu.com/venus',
    tiers: [
      { label: '30 дней', days: 30, price: 5300, url: 'https://nativastu.com/venus' },
      { label: '6 месяцев', days: 180, price: 7100, url: 'https://payform.ru/ricdu4J/' },
    ] },
  { id: 'consult-express', title: 'Экспресс-консультация', type: 'Консультация',
    desc: 'Полный разбор квартиры или дома по всем секторам: где живут деньги, сон, отношения, и что переставить.',
    cover: 'g4', sym: '◉', slug: 'consult-express', price: 9800,
    coverVideo: '/static/assets/consult-express.mp4',
    landing: 'https://nativastu.com/consult' },
  { id: 'consult-full', title: 'Полная консультация', type: 'Консультация',
    desc: 'Дом по всем секторам, приоритеты и пошаговый план на 3 месяца. Личный документ с поддержкой.',
    cover: 'g1', sym: '☰', slug: 'consult-full', price: 36800,
    coverVideo: '/static/assets/consult-full.mp4',
    landing: 'https://nativastu.com/consult' },
  { id: 'consult-business', title: 'Бизнес консультация', type: 'Консультация',
    desc: 'Офис, кабинет, точка продаж или рабочее место дома. Разбираю сектора влияния на доход, репутацию и команду.',
    cover: 'g3', sym: '⌘', slug: 'consult-business', price: 53000,
    coverVideo: 'https://nativastu.com/media/business.mp4',
    landing: 'https://nativastu.com/consult' },
  { id: 'sleep', title: 'Калькулятор сна', type: 'Инструмент',
    desc: 'Направление сна и качество жизни. Расчёт по сторонам света.',
    cover: 'g4', sym: '☾', slug: 'sleep-calculator', price: 0, free: true,
    coverVideo: 'https://nativastu.com/2770a102eafefdc79514561d69ed5114.mp4',
    landing: 'https://nativastu.com/sleep-calculator' },
  { id: 'bluebottle', title: 'Синяя бутылка', type: 'Практика',
    desc: 'Практика Сатурна. Убирает то, что тянет вниз: долги, тяжбы, застой. Возвращает опору и стабильность.',
    cover: 'g3', sym: '◐', slug: 'blue-bottle', price: 0, unlockByReview: true,
    coverVideo: '/static/assets/bluebottle.mp4',
    landing: 'https://nativastu.com/blue-bottle' },
];

const catalog = {
  products,
  productById: (id) => products.find((p) => p.id === id) || null,
  productBySlug: (slug) => products.find((p) => p.slug === slug) || null,
};

// =========================================================
//  БЭКЕНД A: POSTGRES
// =========================================================
function makePg() {
  const pgMod = require('pg');
  const pool = new pgMod.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const q = (text, params) => pool.query(text, params);

  return {
    ...catalog,
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY, email text UNIQUE NOT NULL, name text DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS purchases (
        id text PRIMARY KEY, user_id text NOT NULL, product_id text NOT NULL,
        source text DEFAULT 'manual', order_id text, progress int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, product_id))`);
      await q(`CREATE TABLE IF NOT EXISTS login_codes (
        email text PRIMARY KEY, code text NOT NULL, expires bigint NOT NULL, attempts int NOT NULL DEFAULT 0)`);
      await q(`CREATE TABLE IF NOT EXISTS reviews (
        id text PRIMARY KEY, user_id text NOT NULL, product_id text NOT NULL,
        text text NOT NULL, rating int, created_at timestamptz NOT NULL DEFAULT now())`);
      await q(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS duration_days int`);
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text DEFAULT ''`);
    },
    async updateProfile(userId, { name, phone }) {
      const r = await q(`UPDATE users SET name=$2, phone=$3 WHERE id=$1 RETURNING *`,
        [userId, name || '', phone || '']);
      return r.rows[0] ? mapUser(r.rows[0]) : null;
    },
    async addReview({ userId, productId, text, rating = null }) {
      const r = await q(
        'INSERT INTO reviews (id, user_id, product_id, text, rating) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [rid(), userId, productId, text, rating]
      );
      return mapReview(r.rows[0]);
    },
    async hasReview(userId) {
      const r = await q('SELECT 1 FROM reviews WHERE user_id=$1 LIMIT 1', [userId]);
      return r.rowCount > 0;
    },
    async allReviews() {
      const r = await q(`SELECT r.*, u.email, u.name FROM reviews r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC`);
      return r.rows.map((row) => ({ ...mapReview(row), email: row.email, name: row.name || '' }));
    },
    async findUserByEmail(email) {
      const r = await q('SELECT * FROM users WHERE email=$1', [norm(email)]);
      return r.rows[0] ? mapUser(r.rows[0]) : null;
    },
    async findUserById(id) {
      const r = await q('SELECT * FROM users WHERE id=$1', [id]);
      return r.rows[0] ? mapUser(r.rows[0]) : null;
    },
    async upsertUser({ email, name }) {
      const e = norm(email);
      const r = await q(
        `INSERT INTO users (id, email, name) VALUES ($1,$2,$3)
         ON CONFLICT (email) DO UPDATE SET name = COALESCE(NULLIF(users.name,''), EXCLUDED.name)
         RETURNING *`,
        [uid(), e, name || '']
      );
      return mapUser(r.rows[0]);
    },
    async purchasesForUser(userId) {
      const r = await q('SELECT * FROM purchases WHERE user_id=$1 ORDER BY created_at', [userId]);
      return r.rows.map(mapPurchase);
    },
    async hasPurchase(userId, productId) {
      const r = await q('SELECT 1 FROM purchases WHERE user_id=$1 AND product_id=$2', [userId, productId]);
      return r.rowCount > 0;
    },
    async addPurchase({ userId, productId, source = 'manual', orderId = null, progress = 0, durationDays = null }) {
      const r = await q(
        `INSERT INTO purchases (id, user_id, product_id, source, order_id, progress, duration_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, product_id) DO NOTHING RETURNING *`,
        [pid(), userId, productId, source, orderId, progress, durationDays]
      );
      return r.rows[0] ? mapPurchase(r.rows[0]) : null;
    },
    async renewPurchase(userId, productId, durationDays) {
      await q(`UPDATE purchases SET created_at=now(), duration_days=$3 WHERE user_id=$1 AND product_id=$2`,
        [userId, productId, durationDays]);
    },
    async removePurchase(userId, productId) {
      const r = await q('DELETE FROM purchases WHERE user_id=$1 AND product_id=$2', [userId, productId]);
      return r.rowCount;
    },
    async setProgress(userId, productId, progress) {
      await q('UPDATE purchases SET progress=$3 WHERE user_id=$1 AND product_id=$2',
        [userId, productId, Math.max(0, Math.min(100, progress))]);
    },
    async allUsers() {
      const r = await q('SELECT * FROM users ORDER BY created_at DESC');
      return r.rows.map(mapUser);
    },
    async putCode(email, code, ttlMs = 10 * 60 * 1000) {
      const e = norm(email);
      await q(
        `INSERT INTO login_codes (email, code, expires, attempts) VALUES ($1,$2,$3,0)
         ON CONFLICT (email) DO UPDATE SET code=EXCLUDED.code, expires=EXCLUDED.expires, attempts=0`,
        [e, String(code), Date.now() + ttlMs]
      );
    },
    async checkCode(email, code) {
      const e = norm(email);
      const r = await q('SELECT * FROM login_codes WHERE email=$1', [e]);
      const rec = r.rows[0];
      if (!rec) return { ok: false, reason: 'no_code' };
      if (Date.now() > Number(rec.expires)) { await this.clearCode(e); return { ok: false, reason: 'expired' }; }
      if (rec.attempts + 1 > 6) { await this.clearCode(e); return { ok: false, reason: 'too_many' }; }
      if (String(code).trim() !== rec.code) {
        await q('UPDATE login_codes SET attempts=attempts+1 WHERE email=$1', [e]);
        return { ok: false, reason: 'wrong' };
      }
      await this.clearCode(e);
      return { ok: true };
    },
    async clearCode(email) {
      await q('DELETE FROM login_codes WHERE email=$1', [norm(email)]);
    },
  };
}
const mapUser = (r) => ({ id: r.id, email: r.email, name: r.name || '', phone: r.phone || '', createdAt: r.created_at });
const mapPurchase = (r) => ({ id: r.id, userId: r.user_id, productId: r.product_id, source: r.source, orderId: r.order_id, progress: r.progress, durationDays: r.duration_days ?? null, createdAt: r.created_at });
const mapReview = (r) => ({ id: r.id, userId: r.user_id, productId: r.product_id, text: r.text, rating: r.rating, createdAt: r.created_at });

// require в ESM (для ленивой загрузки pg только когда нужен)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// =========================================================
//  БЭКЕНД B: JSON-ФАЙЛ (локально)
// =========================================================
function makeFile() {
  const DATA_DIR = join(__dirname, '..', 'data');
  const DB_FILE = join(DATA_DIR, 'db.json');
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const EMPTY = { users: [], purchases: [], codes: [], reviews: [] };

  const load = () => {
    if (!existsSync(DB_FILE)) return structuredClone(EMPTY);
    try { return { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(DB_FILE, 'utf8')) }; }
    catch { return structuredClone(EMPTY); }
  };
  let s = load();
  const save = () => writeFileSync(DB_FILE, JSON.stringify(s, null, 2));

  return {
    ...catalog,
    async init() {},
    async findUserByEmail(email) { const e = norm(email); return s.users.find((u) => u.email === e) || null; },
    async findUserById(id) { return s.users.find((u) => u.id === id) || null; },
    async upsertUser({ email, name }) {
      const e = norm(email);
      let u = s.users.find((x) => x.email === e);
      if (u) { if (name && !u.name) { u.name = name; save(); } return u; }
      u = { id: uid(), email: e, name: name || '', phone: '', createdAt: new Date().toISOString() };
      s.users.push(u); save(); return u;
    },
    async updateProfile(userId, { name, phone }) {
      const u = s.users.find((x) => x.id === userId);
      if (!u) return null;
      u.name = name || ''; u.phone = phone || ''; save();
      return u;
    },
    async purchasesForUser(userId) { return s.purchases.filter((p) => p.userId === userId); },
    async hasPurchase(userId, productId) { return s.purchases.some((p) => p.userId === userId && p.productId === productId); },
    async addReview({ userId, productId, text, rating = null }) {
      const rec = { id: rid(), userId, productId, text, rating, createdAt: new Date().toISOString() };
      s.reviews.push(rec); save(); return rec;
    },
    async hasReview(userId) { return s.reviews.some((r) => r.userId === userId); },
    async allReviews() {
      return s.reviews.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((r) => {
        const u = s.users.find((x) => x.id === r.userId);
        return { ...r, email: u ? u.email : '', name: u ? (u.name || '') : '' };
      });
    },
    async addPurchase({ userId, productId, source = 'manual', orderId = null, progress = 0, durationDays = null }) {
      if (await this.hasPurchase(userId, productId)) return null;
      const rec = { id: pid(), userId, productId, source, orderId, progress, durationDays, createdAt: new Date().toISOString() };
      s.purchases.push(rec); save(); return rec;
    },
    async renewPurchase(userId, productId, durationDays) {
      const rec = s.purchases.find((p) => p.userId === userId && p.productId === productId);
      if (rec) { rec.createdAt = new Date().toISOString(); rec.durationDays = durationDays; save(); }
    },
    async removePurchase(userId, productId) {
      const before = s.purchases.length;
      s.purchases = s.purchases.filter((p) => !(p.userId === userId && p.productId === productId));
      if (s.purchases.length !== before) save();
      return before - s.purchases.length;
    },
    async setProgress(userId, productId, progress) {
      const rec = s.purchases.find((p) => p.userId === userId && p.productId === productId);
      if (rec) { rec.progress = Math.max(0, Math.min(100, progress)); save(); }
    },
    async allUsers() { return s.users.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); },
    async putCode(email, code, ttlMs = 10 * 60 * 1000) {
      const e = norm(email);
      s.codes = s.codes.filter((c) => c.email !== e);
      s.codes.push({ email: e, code: String(code), expires: Date.now() + ttlMs, attempts: 0 });
      save();
    },
    async checkCode(email, code) {
      const e = norm(email);
      const rec = s.codes.find((c) => c.email === e);
      if (!rec) return { ok: false, reason: 'no_code' };
      if (Date.now() > rec.expires) { await this.clearCode(e); return { ok: false, reason: 'expired' }; }
      rec.attempts += 1;
      if (rec.attempts > 6) { await this.clearCode(e); return { ok: false, reason: 'too_many' }; }
      if (String(code).trim() !== rec.code) { save(); return { ok: false, reason: 'wrong' }; }
      await this.clearCode(e);
      return { ok: true };
    },
    async clearCode(email) { const e = norm(email); s.codes = s.codes.filter((c) => c.email !== e); save(); },
  };
}

export const db = USE_PG ? makePg() : makeFile();
export const backend = USE_PG ? 'postgres' : 'file';
