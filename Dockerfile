## ---- Build Stage ----
FROM node:22-alpine AS builder
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

# Install all dependencies (including devDependencies needed for build)
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Build the application (HOST must NOT be set here or Vite crashes)
RUN npm run build

# Remove devDependencies to keep the image small
RUN npm prune --omit=dev

## ---- Runtime Stage ----
FROM node:22-alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /app .

# Set runtime environment variables
# HOST=0.0.0.0 makes react-router-serve bind to all interfaces (required by Railway)
# PORT=3000 is the default, Railway may override this with its own PORT
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
