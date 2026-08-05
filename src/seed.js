// Демо-данные: ученица с покупками, чтобы увидеть полный кабинет.
// Запуск: npm run seed
import { db } from './db.js';

const email = process.argv[2] || 'demo@nativastu.com';

await db.init();
const user = await db.upsertUser({ email, name: 'Марина' });

await db.addPurchase({ userId: user.id, productId: 'clean5', source: 'seed' });
await db.setProgress(user.id, 'clean5', 60);
await db.addPurchase({ userId: user.id, productId: 'venus', source: 'seed' });
await db.setProgress(user.id, 'venus', 20);
await db.addPurchase({ userId: user.id, productId: 'sleep', source: 'seed' });
await db.setProgress(user.id, 'sleep', 100);

console.log(`Демо-ученица готова: ${email}`);
console.log('Куплено: Чистка по 5 элементам (60%), Протокол Венеры (20%), Код сна (100%)');
process.exit(0);
