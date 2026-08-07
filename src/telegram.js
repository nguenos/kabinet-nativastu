// Отправка сообщений в Telegram-бот заявок (HTTP API, порт 443 - работает на Timeweb).
// Токен бота - в переменной окружения TELEGRAM_BOT_TOKEN (в код не коммитим).
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '866801756'; // Telegram-аккаунт Нати

export const tgEnabled = !!TG_TOKEN;

export async function sendTelegram(text) {
  if (!TG_TOKEN) { console.warn('[TG отключён: нет TELEGRAM_BOT_TOKEN]'); return { ok: false, disabled: true }; }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error('Telegram: ' + JSON.stringify(data));
  return data;
}
