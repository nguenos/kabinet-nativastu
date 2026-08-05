// Отправка письма с кодом входа.
// MVP: пишем код в консоль (и в data/outbox.log), чтобы протестировать весь поток.
// Продакшн: подставляется SMTP (переменные окружения SMTP_*), код внизу готов к включению.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTBOX = join(__dirname, '..', 'data', 'outbox.log');

const hasSMTP = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

export async function sendCode(email, code) {
  const subject = 'Код для входа в кабинет Nati Vastu';
  const text =
    `Ваш код для входа: ${code}\n\n` +
    `Введите его на странице входа. Код действует 10 минут.\n\n` +
    `Если вы не запрашивали вход, просто проигнорируйте это письмо.`;

  if (hasSMTP) {
    // Включается автоматически, когда заданы SMTP_* и установлен nodemailer.
    const nodemailer = (await import('nodemailer')).default;
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await t.sendMail({
      from: process.env.MAIL_FROM || `Nati Vastu <${process.env.SMTP_USER}>`,
      to: email, subject, text,
    });
    return { delivered: 'smtp' };
  }

  // DEV: логируем вместо реальной отправки.
  const line = `[${new Date().toISOString()}] TO ${email} | CODE ${code}\n`;
  try { appendFileSync(OUTBOX, line); } catch {}
  console.log('\n  ✉  ' + line.trim() + '\n');
  return { delivered: 'console', code }; // code возвращаем только в dev
}

export const mailerMode = hasSMTP ? 'smtp' : 'console';
