// Отправка писем: код входа и приветствие после покупки.
// DEV (нет SMTP): пишем в консоль и data/outbox.log.
// PROD: SMTP через переменные окружения SMTP_* (Gmail и т.п.).
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTBOX = join(__dirname, '..', 'data', 'outbox.log');
const hasSMTP = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
export const mailerMode = hasSMTP ? 'smtp' : 'console';

const SITE = process.env.PUBLIC_URL || 'https://kabinet-nativastu.onrender.com';

let _transport = null;
async function transport() {
  if (_transport) return _transport;
  const nodemailer = (await import('nodemailer')).default;
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transport;
}

// Базовая отправка. В dev — в консоль/лог, в prod — по SMTP.
async function send({ to, subject, text, html }) {
  if (hasSMTP) {
    const t = await transport();
    await t.sendMail({
      from: process.env.MAIL_FROM || `Nati Vastu <${process.env.SMTP_USER}>`,
      to, subject, text, html,
    });
    return { delivered: 'smtp' };
  }
  const line = `[${new Date().toISOString()}] TO ${to} | ${subject}\n${text}\n`;
  try { appendFileSync(OUTBOX, line); } catch {}
  console.log('\n  ✉  ' + line.trim() + '\n');
  return { delivered: 'console' };
}

// ---------- КОД ВХОДА ----------
export async function sendCode(email, code) {
  const subject = 'Код для входа в кабинет Nati Vastu';
  const text =
    `Ваш код для входа: ${code}\n\n` +
    `Введите его на странице входа. Код действует 10 минут.\n\n` +
    `Если вы не запрашивали вход, просто проигнорируйте это письмо.`;
  const html = wrap(`
    <p style="margin:0 0 18px">Ваш код для входа в личный кабинет:</p>
    <div style="font-size:32px;letter-spacing:8px;font-weight:600;color:#1E2D1F;margin:0 0 18px">${code}</div>
    <p style="margin:0 0 8px;color:#8B7355">Введите его на странице входа. Код действует 10 минут.</p>
    <p style="margin:0;color:#b3a894;font-size:13px">Если вы не запрашивали вход, просто проигнорируйте это письмо.</p>
  `);
  const r = await send({ to: email, subject, text, html });
  return { ...r, ...(r.delivered === 'console' ? { code } : {}) };
}

// ---------- ПРИВЕТСТВИЕ ПОСЛЕ ПОКУПКИ ----------
export async function sendPurchaseEmail(email, productTitle) {
  const loginUrl = `${SITE}/login`;
  const subject = `Доступ открыт · ${productTitle} · Nati Vastu`;
  const text =
    `Спасибо за покупку!\n\n` +
    `Ваш продукт «${productTitle}» уже ждёт вас в личном кабинете.\n\n` +
    `Как открыть:\n` +
    `1. Перейдите по ссылке: ${loginUrl}\n` +
    `2. Введите этот email (${email}) и получите код.\n` +
    `3. Введите код — и материал откроется.\n\n` +
    `Доступ сохраняется навсегда, возвращайтесь к практикам, когда нужно.\n\n` +
    `С теплом, Нати`;
  const html = wrap(`
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C4A882">Доступ открыт</p>
    <h1 style="margin:0 0 18px;font-size:24px;color:#1E2D1F;font-weight:600">${productTitle}</h1>
    <p style="margin:0 0 18px;color:#333">Спасибо за покупку. Ваш продукт уже ждёт вас в личном кабинете.</p>
    <a href="${loginUrl}" style="display:inline-block;background:#C4A882;color:#1E2D1F;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:60px;margin:0 0 20px">Войти в кабинет →</a>
    <p style="margin:0 0 6px;color:#8B7355">Как открыть:</p>
    <p style="margin:0 0 18px;color:#333;line-height:1.7">
      1. Перейдите по кнопке выше.<br>
      2. Введите этот email (<b>${email}</b>) и получите код.<br>
      3. Введите код — и материал откроется.
    </p>
    <p style="margin:0;color:#b3a894;font-size:13px">Доступ сохраняется навсегда. С теплом, Нати</p>
  `);
  return send({ to: email, subject, text, html });
}

// Простая брендовая обёртка письма.
function wrap(inner) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 28px;background:#F7F3ED;border:1px solid #d4c9b5;border-radius:8px;color:#252525">
    <div style="text-align:center;margin:0 0 24px;font-size:18px;letter-spacing:3px;text-transform:uppercase;color:#1E2D1F">NATI <span style="color:#C4A882">VASTU</span></div>
    ${inner}
  </div>`;
}
