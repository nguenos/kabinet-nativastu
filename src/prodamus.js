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
// Приоритет: 1) параметр nv_product в заказе; 2) точное имя товара; 3) сумма заказа.
// Имена — как они заданы в Prodamus (реальные названия из платёжных ссылок).
const PRODUCT_MAP = {
  'Гайд - глубокая энергетическая чистка': 'clean5',
  'Чистка по 5 элементам': 'clean5',
  'Протокол Венеры': 'venus',
  'Экспресс-консультация': 'consult-express',
  'Полная консультация': 'consult-full',
  'Бизнес консультация': 'consult-business',
  'Васту консультация по дому': 'consult-express',
  'Код сна': 'sleep',
  'Синяя бутылка': 'bluebottle',
};

// Запасной вариант — по сумме заказа (у каждого продукта своя цена).
const PRICE_MAP = {
  888: 'clean5',
  5300: 'venus',
  9800: 'consult-express',
  36800: 'consult-full',
  53000: 'consult-business',
};

// Помощники для массовой загрузки учениц из истории Prodamus.
export function productIdByName(name) {
  return (name && PRODUCT_MAP[String(name).trim()]) || null;
}
export function productIdByAmount(sum) {
  const n = Math.round(parseFloat(String(sum).replace(/[^\d.]/g, '')) || 0);
  return PRICE_MAP[n] || null;
}
// Известные суммы продуктов (для поиска в строке выгрузки), от больших к меньшим.
export const KNOWN_AMOUNTS = Object.keys(PRICE_MAP).map(Number).sort((a, b) => b - a);

export function extractOrder(data) {
  const email = data.customer_email || data._param_email || data.email || '';
  const phone = data.customer_phone || data.customer_phone_number || '';
  const orderId = data.order_id || data.order_num || null;
  const status = (data.payment_status || data.paymentStatus || '').toLowerCase();
  const sum = Math.round(parseFloat(data.sum || data.amount || '0'));

  // 1) Явный параметр nv_product (если добавлен в платёжную ссылку).
  let productId = data.nv_product || data._param_nv_product || null;

  // 2) По названию товара.
  if (!productId && data.products) {
    const first = Array.isArray(data.products) ? data.products[0] : (data.products['0'] || data.products);
    const name = first && (first.name || first.title);
    if (name && PRODUCT_MAP[name]) productId = PRODUCT_MAP[name];
  }

  // 3) По сумме заказа.
  if (!productId && PRICE_MAP[sum]) productId = PRICE_MAP[sum];

  return { email, phone, orderId, status, sum, productId, paid: status === 'success' || status === 'paid' };
}
