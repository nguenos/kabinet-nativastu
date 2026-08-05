// Разбор и проверка вебхука Prodamus.
// Prodamus после успешной оплаты шлёт POST (form-urlencoded) с параметрами заказа
// и подписью в поле `sign`. Подпись = HMAC-SHA256 по отсортированным параметрам с секретом.
import crypto from 'node:crypto';

const SECRET = process.env.PRODAMUS_SECRET || '';

// Рекурсивная сортировка ключей (как в официальной библиотеке Prodamus Hmac).
function ksort(obj) {
  if (Array.isArray(obj)) return obj.map(ksort);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = ksort(obj[k]);
    return out;
  }
  return obj;
}

// Строковое приведение как в PHP http_build_query (значения -> строки).
function stringifyDeep(obj) {
  if (obj && typeof obj === 'object') {
    const out = Array.isArray(obj) ? [] : {};
    for (const k of Object.keys(obj)) out[k] = stringifyDeep(obj[k]);
    return out;
  }
  return obj === null || obj === undefined ? '' : String(obj);
}

export function verifySignature(data) {
  if (!SECRET) return { ok: true, skipped: true }; // dev: без секрета не проверяем
  const provided = data.sign;
  if (!provided) return { ok: false, reason: 'no_sign' };
  const copy = { ...data };
  delete copy.sign;
  const sorted = ksort(stringifyDeep(copy));
  const json = JSON.stringify(sorted);
  const mac = crypto.createHmac('sha256', SECRET).update(json).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(String(provided));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, reason: ok ? null : 'bad_sign' };
}

// Сопоставление оплаченного товара с нашим product.id.
// 1) Если в заказе передан наш параметр nv_product — используем его.
// 2) Иначе сопоставляем по названию товара из PRODUCT_MAP.
const PRODUCT_MAP = {
  'Чистка по 5 элементам': 'clean5',
  'Протокол Венеры': 'venus',
  'Код сна': 'sleep',
  'Синяя бутылка': 'bluebottle',
};

export function extractOrder(data) {
  const email = data.customer_email || data._param_email || data.email || '';
  const phone = data.customer_phone || data.customer_phone_number || '';
  const orderId = data.order_id || data.order_num || null;
  const status = (data.payment_status || data.paymentStatus || '').toLowerCase();

  // Определяем productId.
  let productId = data.nv_product || data._param_nv_product || null;
  if (!productId && data.products) {
    // products может прийти как products[0][name] (Prodamus form) — express парсит в массив/объект.
    const first = Array.isArray(data.products) ? data.products[0] : data.products['0'] || data.products;
    const name = first && (first.name || first.title);
    if (name && PRODUCT_MAP[name]) productId = PRODUCT_MAP[name];
  }

  return { email, phone, orderId, status, productId, paid: status === 'success' || status === 'paid' };
}
