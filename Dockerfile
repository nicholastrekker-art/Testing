# Builder stage
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY package.json yarn.lock ./

# Install only production deps
RUN yarn install --frozen-lockfile --production=true

CMD ["yarn", "start"]
