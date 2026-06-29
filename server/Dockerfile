FROM node:20-alpine

WORKDIR /app

# 先装依赖（利用缓存）
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# 复制应用代码（private.pem / licenses.json 通过卷挂载，不打进镜像，见 .dockerignore）
COPY . .

EXPOSE 8090

CMD ["node", "server.js"]
