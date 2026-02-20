FROM node:18-alpine

WORKDIR /app

# Copiar apenas arquivos de dependências primeiro
COPY package.json ./
COPY yarn.lock* ./

# Instalar dependências
RUN yarn install --frozen-lockfile || yarn install

# Copiar o resto do código
COPY . .

EXPOSE 3000

CMD ["yarn", "start"]