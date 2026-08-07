// Отправка писем: код входа и приветствие после покупки.
// PROD: Unisender HTTP API (порт 443 — работает на Timeweb, где SMTP заблокирован).
// DEV (нет ключа Unisender): пишем в консоль и data/outbox.log.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTBOX = join(__dirname, '..', 'data', 'outbox.log');

const SITE = process.env.PUBLIC_URL || 'https://lk.nativastu.com';

// --- Unisender Go (UniOne) — транзакционный HTTP API ---
const UNIGO_KEY = process.env.UNISENDER_GO_KEY || '';
const SENDER_EMAIL = process.env.MAIL_FROM_EMAIL || 'noreply@nativastu.com';
const SENDER_NAME = process.env.MAIL_FROM_NAME || 'Нати Гуенос';
const hasUnigo = !!UNIGO_KEY;
export const mailerMode = hasUnigo ? 'unisender-go' : 'console';

const UNIGO_SEND = 'https://goapi.unisender.ru/ru/transactional/api/v1/email/send.json';

// Базовая отправка. Есть ключ Unisender Go — шлём по HTTP API, иначе пишем в консоль (dev).
async function send({ to, subject, text, html }) {
  if (hasUnigo) {
    const res = await fetch(UNIGO_SEND, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': UNIGO_KEY },
      body: JSON.stringify({
        message: {
          recipients: [{ email: to }],
          from_email: SENDER_EMAIL,
          from_name: SENDER_NAME,
          subject,
          body: { html, plaintext: text },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === 'error' || data.failed_emails) {
      throw new Error(`Unisender Go: ${JSON.stringify(data)}`);
    }
    return { delivered: 'unisender-go' };
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
  const subject = `Оплата получена · ${productTitle} · Nati Vastu`;
  const text =
    `Оплата получена. Спасибо за доверие.\n\n` +
    `Доступ к продукту «${productTitle}» уже открыт в вашем личном кабинете.\n\n` +
    `Как войти:\n` +
    `1. Перейдите по ссылке: ${loginUrl}\n` +
    `2. Введите этот email (${email}) и получите код.\n` +
    `3. Введите код, и продукт откроется.\n\n` +
    `Если возникнут вопросы, просто ответьте на это письмо.\n\n` +
    `С теплом, Нати`;
  const html = wrap(`
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C4A882">Оплата получена</p>
    <h1 style="margin:0 0 16px;font-size:24px;color:#1E2D1F;font-weight:600">${productTitle}</h1>
    <p style="margin:0 0 10px;color:#333">Спасибо за доверие. Ваша оплата получена.</p>
    <p style="margin:0 0 20px;color:#333">Доступ к продукту уже открыт в вашем личном кабинете, он ждёт вас.</p>
    <a href="${loginUrl}" style="display:inline-block;background:#C4A882;color:#1E2D1F;text-decoration:none;font-weight:600;padding:14px 30px;border-radius:60px;margin:0 0 22px">Открыть личный кабинет</a>
    <p style="margin:0 0 6px;color:#8B7355">Как войти:</p>
    <p style="margin:0 0 20px;color:#333;line-height:1.8">
      1. Нажмите кнопку выше.<br>
      2. Введите этот email (<b>${email}</b>) и получите код.<br>
      3. Введите код, и продукт откроется.
    </p>
    <p style="margin:0;color:#b3a894;font-size:13px">Если появятся вопросы, просто ответьте на это письмо. С теплом, Нати</p>
  `);
  return send({ to: email, subject, text, html });
}

// ---------- ПИСЬМО ПОСЛЕ ОПЛАТЫ КОНСУЛЬТАЦИИ ----------
export async function sendConsultEmail(email, productTitle) {
  const loginUrl = `${SITE}/login`;
  const anketaUrl = `${SITE}/anketa`;
  const subject = `Оплата получена · ${productTitle} · Nati Vastu`;
  const text =
    `Оплата получена. Спасибо за доверие.\n\n` +
    `Вы записаны на «${productTitle}».\n\n` +
    `Чтобы я подготовилась к нашей консультации, заполните, пожалуйста, короткую анкету:\n${anketaUrl}\n\n` +
    `Личный кабинет с вашими продуктами: ${loginUrl}\n` +
    `Вход по этому email (${email}) и коду из письма.\n\n` +
    `Если возникнут вопросы, просто ответьте на это письмо.\n\n` +
    `С теплом, Нати`;
  const html = wrap(`
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C4A882">Оплата получена</p>
    <h1 style="margin:0 0 16px;font-size:24px;color:#1E2D1F;font-weight:600">${productTitle}</h1>
    <p style="margin:0 0 10px;color:#333">Спасибо за доверие. Ваша оплата получена, вы записаны на консультацию.</p>
    <p style="margin:0 0 18px;color:#333">Чтобы я подготовилась к нашей встрече, заполните, пожалуйста, короткую анкету.</p>
    <a href="${anketaUrl}" style="display:inline-block;background:#C4A882;color:#1E2D1F;text-decoration:none;font-weight:600;padding:14px 30px;border-radius:60px;margin:0 0 22px">Заполнить анкету</a>
    <p style="margin:0 0 6px;color:#8B7355">Личный кабинет:</p>
    <p style="margin:0 0 18px;color:#333;line-height:1.8">
      Все ваши продукты здесь: <a href="${loginUrl}" style="color:#8B7355">${SITE.replace('https://','')}/login</a><br>
      Вход по этому email (<b>${email}</b>) и коду из письма.
    </p>
    <p style="margin:0;color:#b3a894;font-size:13px">Если появятся вопросы, просто ответьте на это письмо. С теплом, Нати</p>
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
