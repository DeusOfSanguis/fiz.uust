# Приложение для группы: один адрес, телефоны участников
# Сборка: npm run build && node server.mjs

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173
ENV PACER_DATA_DIR=/data

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist

# журнал и бэкапы живут здесь — подключите том, чтобы они пережили перезапуск
VOLUME ["/data"]
EXPOSE 4173

CMD ["node", "server.mjs"]
