FROM node:18-alpine

WORKDIR /app

# Copiar package.json
COPY package.json ./

# Tentar copiar yarn.lock se existir, senão continuar
COPY yarn.loc[k] ./

# Instalar dependências
RUN yarn install

# Copiar o resto do código
COPY . .

EXPOSE 3000

CMD ["yarn", "start"]