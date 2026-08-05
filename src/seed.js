// Демо-данные: ученица с покупками, чтобы увидеть полный кабинет.
// Запуск: npm run seed
import { db } from './db.js';

const email = process.argv[2] || 'demo@nativastu.com';
const user = db.upsertUser({ email, name: 'Марина' });

db.addPurchase({ userId: user.id, productId: 'clean5', source: 'seed' });
db.setProgress(user.id, 'clean5', 60);

db.addPurchase({ userId: user.id, productId: 'venus', source: 'seed' });
db.setProgress(user.id, 'venus', 20);

db.addPurchase({ userId: user.id, productId: 'sleep', source: 'seed' });
db.setProgress(user.id, 'sleep', 100);

console.log(`Демо-ученица готова: ${email}`);
console.log('Куплено: Чистка по 5 элементам (60%), Протокол Венеры (20%), Код сна (100%)');
console.log('Войдите этим email на /login, код появится в демо-подсказке.');
