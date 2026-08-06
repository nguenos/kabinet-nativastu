import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { db, backend } from './src/db.js';
import { setSession, clearSession, getUserId, requireAuth, genCode, isAdminEmail } from './src/auth.js';
import { sendCode, sendPurchaseEmail, mailerMode } from './src/mailer.js';
import { extractOrder, productIdByName, productIdByAmount, KNOWN_AMOUNTS } from './src/prodamus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(join(__dirname, 'public')));

// маленький помощник, чтобы ошибки в async-маршрутах не роняли сервер
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- СТРАНИЦЫ ----------
app.get('/', (req, res) => res.redirect(getUserId(req) ? '/app' : '/login'));

app.get('/login', (req, res) => {
  if (getUserId(req)) return res.redirect('/app');
  res.sendFile(join(__dirname, 'public', 'login.html'));
});

app.get('/app', requireAuth('page'), (req, res) => {
  res.sendFile(join(__dirname, 'public', 'app.html'));
});

// ---------- ВХОД ПО EMAIL-КОДУ ----------
app.post('/api/auth/request-code', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'bad_email' });
  const code = genCode();
  await db.putCode(email, code);
  const r = await sendCode(email, code);
  // Код показываем на экране только локально. На проде без SMTP он уходит в логи сервера.
  res.json({ ok: true, mode: mailerMode, ...(r.delivered === 'console' && isDev ? { devCode: code } : {}) });
}));

app.post('/api/auth/verify', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  const chk = await db.checkCode(email, code);
  if (!chk.ok) return res.status(401).json({ error: chk.reason });
  const user = await db.upsertUser({ email });
  setSession(res, user.id);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

// ---------- ДАННЫЕ КАБИНЕТА ----------
app.get('/api/me', requireAuth('api'), wrap(async (req, res) => {
  const user = await db.findUserById(req.userId);
  if (!user) { clearSession(res); return res.status(401).json({ error: 'unauthorized' }); }

  const owned = await db.purchasesForUser(user.id);
  const ownedMap = new Map(owned.map((p) => [p.productId, p]));
  const reviewed = await db.hasReview(user.id);

  const products = db.products.map((p) => {
    const rec = ownedMap.get(p.id);
    return {
      id: p.id, title: p.title, type: p.type, desc: p.desc,
      cover: p.cover, sym: p.sym, slug: p.slug, price: p.price, landing: p.landing || '',
      coverVideo: p.coverVideo || '',
      free: !!p.free, unlockByReview: !!p.unlockByReview,
      owned: !!rec, progress: rec ? rec.progress : 0,
    };
  });

  res.json({
    user: { email: user.email, name: user.name || '' },
    products,
    hasReview: reviewed,
    stats: {
      owned: owned.length,
      started: owned.filter((p) => p.progress > 0 && p.progress < 100).length,
    },
  });
}));

// ---------- ОТЗЫВ (открывает бонус) ----------
app.post('/api/review', requireAuth('api'), wrap(async (req, res) => {
  const productId = String(req.body.productId || '').trim();
  const text = String(req.body.text || '').trim();
  const rating = req.body.rating ? Math.max(1, Math.min(5, parseInt(req.body.rating, 10))) : null;
  if (text.length < 5) return res.status(400).json({ error: 'short' });
  if (!db.productById(productId)) return res.status(400).json({ error: 'bad_product' });
  if (!(await db.hasPurchase(req.userId, productId))) return res.status(403).json({ error: 'not_owned' });
  await db.addReview({ userId: req.userId, productId, text, rating });
  res.json({ ok: true });
}));

// ---------- ГАЙДЫ ЗА ВХОДОМ ----------
app.get('/guide/:slug', requireAuth('page'), wrap(async (req, res) => {
  const product = db.productBySlug(req.params.slug);
  if (!product) return res.status(404).send('Материал не найден');
  // Доступ: бесплатные — всем вошедшим; «по отзыву» — после отзыва; остальные — при покупке.
  let allowed = product.free
    || (product.unlockByReview && await db.hasReview(req.userId))
    || await db.hasPurchase(req.userId, product.id);
  if (!allowed) return res.redirect('/app?locked=' + encodeURIComponent(product.id));
  const file = join(__dirname, 'guides', product.slug + '.html');
  if (!existsSync(file)) {
    return res.status(200).send(
      `<div style="font-family:sans-serif;max-width:600px;margin:80px auto;padding:24px;text-align:center">
        <h2>${product.title}</h2>
        <p>Доступ открыт. Здесь будет ваш материал.</p>
        <p style="color:#888">Файл guides/${product.slug}.html пока не загружен.</p>
        <a href="/app">← в кабинет</a>
      </div>`);
  }
  res.sendFile(file);
}));

// ---------- АДМИНКА (для Нати) ----------
function requireAdmin(kind = 'page') {
  return wrap(async (req, res, next) => {
    const uid = getUserId(req);
    const user = uid ? await db.findUserById(uid) : null;
    if (!user || !isAdminEmail(user.email)) {
      if (kind === 'api') return res.status(403).json({ error: 'forbidden' });
      return res.redirect('/login');
    }
    req.userId = uid;
    next();
  });
}

app.get('/admin', requireAdmin('page'), (req, res) => {
  res.sendFile(join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/data', requireAdmin('api'), wrap(async (req, res) => {
  const list = await db.allUsers();
  const users = [];
  for (const u of list) {
    const purchases = await db.purchasesForUser(u.id);
    users.push({
      id: u.id, email: u.email, name: u.name || '', createdAt: u.createdAt,
      purchases: purchases.map((p) => ({
        productId: p.productId,
        title: (db.productById(p.productId) || {}).title || p.productId,
        source: p.source, createdAt: p.createdAt,
      })),
    });
  }
  const reviews = (await db.allReviews()).map((r) => ({
    email: r.email, name: r.name,
    product: (db.productById(r.productId) || {}).title || r.productId,
    text: r.text, rating: r.rating, createdAt: r.createdAt,
  }));

  res.json({
    products: db.products.map((p) => ({ id: p.id, title: p.title, type: p.type, price: p.price })),
    users,
    reviews,
    totals: { users: users.length, purchases: users.reduce((n, u) => n + u.purchases.length, 0), reviews: reviews.length },
  });
}));

app.post('/api/admin/grant', requireAdmin('api'), wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const productId = String(req.body.productId || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'bad_email' });
  if (!db.productById(productId)) return res.status(400).json({ error: 'bad_product' });
  const user = await db.upsertUser({ email });
  await db.addPurchase({ userId: user.id, productId, source: 'admin' });
  res.json({ ok: true });
}));

app.post('/api/admin/revoke', requireAdmin('api'), wrap(async (req, res) => {
  const removed = await db.removePurchase(String(req.body.userId || ''), String(req.body.productId || ''));
  res.json({ ok: true, removed });
}));

// Массовая загрузка учениц из истории Prodamus — БЕЗ отправки писем.
// Каждая строка: email + продукт (по id продукта или по сумме в строке).
app.post('/api/admin/bulk-grant', requireAdmin('api'), wrap(async (req, res) => {
  const text = String(req.body.text || '');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5000);
  const productIds = db.products.map((p) => p.id);
  const added = [], already = [], skipped = [];

  for (const line of lines) {
    const emailMatch = line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (!emailMatch) { continue; } // строки без email (номер заказа, дата) просто пропускаем
    const email = emailMatch[0].toLowerCase();

    let productId = null;
    // 1) явный id продукта в строке (например "clean5")
    for (const id of productIds) {
      if (new RegExp('(^|[^\\w-])' + id + '([^\\w-]|$)').test(line)) { productId = id; break; }
    }
    // 2) по сумме (числа со «пробелами» тоже: 36 800 -> 36800)
    if (!productId) {
      let norm = line;
      for (let k = 0; k < 3; k++) norm = norm.replace(/(\d)\s(\d)/g, '$1$2');
      for (const amt of KNOWN_AMOUNTS) {
        if (new RegExp('\\b' + amt + '\\b').test(norm)) { productId = productIdByAmount(amt); break; }
      }
    }
    if (!productId) { skipped.push({ line, email, reason: 'не понял продукт' }); continue; }

    const user = await db.upsertUser({ email });
    const created = await db.addPurchase({ userId: user.id, productId, source: 'import' });
    (created ? added : already).push({ email, productId });
  }

  res.json({
    ok: true,
    addedCount: added.length, alreadyCount: already.length, skippedCount: skipped.length,
    added, already, skipped,
  });
}));

// ---------- ВЕБХУК PRODAMUS ----------
app.post('/webhook/prodamus', wrap(async (req, res) => {
  const data = req.body || {};

  // Защита: секретный ключ в адресе вебхука (?key=...). Если задан WEBHOOK_KEY — проверяем.
  const WEBHOOK_KEY = process.env.WEBHOOK_KEY;
  if (WEBHOOK_KEY && req.query.key !== WEBHOOK_KEY) {
    console.warn('Prodamus: неверный ключ вебхука');
    return res.status(403).send('forbidden');
  }

  console.log('Prodamus webhook payload:', JSON.stringify(data));
  const order = extractOrder(data);
  if (!order.paid) return res.status(200).send('ignored: not paid');
  if (!order.email) return res.status(200).send('ignored: no email');
  if (!order.productId) { console.warn('Prodamus: неизвестный продукт', order.orderId); return res.status(200).send('ignored: unknown product'); }

  const user = await db.upsertUser({ email: order.email });
  const created = await db.addPurchase({ userId: user.id, productId: order.productId, source: 'prodamus', orderId: order.orderId });
  console.log(`Prodamus: доступ выдан ${order.email} → ${order.productId}${created ? '' : ' (уже был)'}`);

  // Письмо покупателю — только при НОВОЙ покупке (не на повторные вебхуки).
  if (created) {
    const product = db.productById(order.productId);
    try {
      await sendPurchaseEmail(order.email, product ? product.title : 'ваш продукт');
    } catch (e) {
      console.error('Не удалось отправить письмо о покупке:', e.message);
    }
  }
  res.status(200).send('success');
}));

app.get('/healthz', (req, res) => res.json({ ok: true, backend, mailer: mailerMode }));

// глобальный обработчик ошибок
app.use((err, req, res, next) => {
  console.error('Ошибка:', err);
  if (res.headersSent) return next(err);
  res.status(500).send('Внутренняя ошибка');
});

async function main() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`\n  Nati Vastu · кабинет запущен: http://localhost:${PORT}`);
    console.log(`  База: ${backend === 'postgres' ? 'Postgres' : 'файл (локально)'} · Почта: ${mailerMode === 'console' ? 'ДЕМО (код в консоли)' : 'SMTP'}${isDev ? ' · DEV' : ''}\n`);
  });
}
main().catch((e) => { console.error('Не удалось запустить:', e); process.exit(1); });
