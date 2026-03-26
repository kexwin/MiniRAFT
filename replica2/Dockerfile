FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY . .

RUN npm run build

EXPOSE 4002

CMD ["npm", "run", "dev"]
