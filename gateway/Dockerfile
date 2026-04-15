FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY *.ts ./
COPY public ./public

RUN npm run build
RUN cp -r public dist/public

EXPOSE 3000

CMD ["npm", "run", "dev"]
