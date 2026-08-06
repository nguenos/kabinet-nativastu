# Универсальный образ для деплоя кабинета на любой хостинг (Timeweb, Yandex, VPS).
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
# Порт задаётся хостингом через переменную PORT; по умолчанию 3000.
EXPOSE 3000

CMD ["node", "server.js"]
