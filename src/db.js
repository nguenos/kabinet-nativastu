// Простое файловое хранилище (JSON). Для MVP этого достаточно на сотни учениц.
// Позже слой заменяется на Postgres/Supabase без изменения остального кода.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_FILE = join(DATA_DIR, 'db.json');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const EMPTY = { users: [], purchases: [], codes: [] };

function load() {
  if (!existsSync(DB_FILE)) return structuredClone(EMPTY);
  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(DB_FILE, 'utf8')) };
  } catch {
    return structuredClone(EMPTY);
  }
}

let state = load();

function save() {
  writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
}

const norm = (email) => String(email || '').trim().toLowerCase();
const uid = () => 'u_' + Math.random().toString(36).slice(2, 10);

export const db = {
  // ---------- КАТАЛОГ ПРОДУКТОВ ----------
  // Здесь описан весь ассортимент. Покупка ссылается на product.id.
  // cover: класс градиента (g1..g4) + символ, пока без фото.
  products: [
    {
      id: 'clean5',
      title: 'Чистка по 5 элементам',
      type: 'Гайд',
      desc: 'Метод обнуления и наполнения дома. 13 блоков, читается онлайн.',
      cover: 'g1', sym: 'V',
      slug: 'elements-cleaning',
      price: 888,
    },
    {
      id: 'venus',
      title: 'Протокол Венеры',
      type: 'Протокол',
      desc: 'Персональная практика по знаку вашей Венеры и встроенный калькулятор.',
      cover: 'g2', sym: '♀',
      slug: 'venus-landing',
      price: 252,
    },
    {
      id: 'consult-express',
      title: 'Экспресс-консультация',
      type: 'Консультация',
      desc: 'Запись вашего разбора и конспект с рекомендациями по зонам.',
      cover: 'g4', sym: '◉',
      slug: 'consult-express',
      price: 9800,
    },
    {
      id: 'consult-full',
      title: 'Полная консультация',
      type: 'Консультация',
      desc: 'Карта зон дома, приоритеты и пошаговый план на 3 месяца, запись созвона.',
      cover: 'g1', sym: '☰',
      slug: 'consult-full',
      price: 36800,
    },
    {
      id: 'sleep',
      title: 'Код сна',
      type: 'Гайд',
      desc: 'Направление сна и качество жизни. Разбор по сторонам света.',
      cover: 'g4', sym: '☾',
      slug: 'sleep-article',
      price: 0,
    },
    {
      id: 'bluebottle',
      title: 'Синяя бутылка',
      type: 'Практика',
      desc: 'Практика солнечной воды для энергии пространства.',
      cover: 'g3', sym: '◐',
      slug: 'blue-bottle',
      price: 0,
    },
  ],

  productById(id) {
    return this.products.find((p) => p.id === id) || null;
  },
  productBySlug(slug) {
    return this.products.find((p) => p.slug === slug) || null;
  },

  // ---------- УЧЕНИЦЫ ----------
  findUserByEmail(email) {
    const e = norm(email);
    return state.users.find((u) => u.email === e) || null;
  },
  findUserById(id) {
    return state.users.find((u) => u.id === id) || null;
  },
  upsertUser({ email, name }) {
    const e = norm(email);
    let u = this.findUserByEmail(e);
    if (u) {
      if (name && !u.name) { u.name = name; save(); }
      return u;
    }
    u = { id: uid(), email: e, name: name || '', createdAt: new Date().toISOString() };
    state.users.push(u);
    save();
    return u;
  },

  // ---------- ПОКУПКИ ----------
  purchasesForUser(userId) {
    return state.purchases.filter((p) => p.userId === userId);
  },
  hasPurchase(userId, productId) {
    return state.purchases.some((p) => p.userId === userId && p.productId === productId);
  },
  addPurchase({ userId, productId, source = 'manual', orderId = null, progress = 0 }) {
    if (this.hasPurchase(userId, productId)) return this.purchasesForUser(userId).find((p) => p.productId === productId);
    const rec = {
      id: 'p_' + Math.random().toString(36).slice(2, 10),
      userId, productId, source, orderId, progress,
      createdAt: new Date().toISOString(),
    };
    state.purchases.push(rec);
    save();
    return rec;
  },
  removePurchase(userId, productId) {
    const before = state.purchases.length;
    state.purchases = state.purchases.filter((p) => !(p.userId === userId && p.productId === productId));
    if (state.purchases.length !== before) save();
    return before - state.purchases.length;
  },
  allUsers() {
    return state.users.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  setProgress(userId, productId, progress) {
    const rec = state.purchases.find((p) => p.userId === userId && p.productId === productId);
    if (rec) { rec.progress = Math.max(0, Math.min(100, progress)); save(); }
    return rec;
  },

  // ---------- КОДЫ ВХОДА ----------
  putCode(email, code, ttlMs = 10 * 60 * 1000) {
    const e = norm(email);
    state.codes = state.codes.filter((c) => c.email !== e);
    state.codes.push({ email: e, code: String(code), expires: Date.now() + ttlMs, attempts: 0 });
    save();
  },
  checkCode(email, code) {
    const e = norm(email);
    const rec = state.codes.find((c) => c.email === e);
    if (!rec) return { ok: false, reason: 'no_code' };
    if (Date.now() > rec.expires) { this.clearCode(e); return { ok: false, reason: 'expired' }; }
    rec.attempts += 1;
    if (rec.attempts > 6) { this.clearCode(e); return { ok: false, reason: 'too_many' }; }
    if (String(code).trim() !== rec.code) { save(); return { ok: false, reason: 'wrong' }; }
    this.clearCode(e);
    return { ok: true };
  },
  clearCode(email) {
    const e = norm(email);
    state.codes = state.codes.filter((c) => c.email !== e);
    save();
  },

  _raw: () => state,
  _reload: () => { state = load(); },
};
