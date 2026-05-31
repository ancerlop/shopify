FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

# Install all dependencies (including devDependencies needed for build)
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Build the application
RUN npm run build

# Remove devDependencies to keep the image small
RUN npm prune --omit=dev

CMD ["npm", "run", "docker-start"]
