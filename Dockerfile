# Stage 1: Build
FROM node:20 AS builder
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install all dependencies (including dev for build)
RUN yarn install --frozen-lockfile

# Copy the rest of the source code
COPY . .

# Build the app (outputs to /app/dist)
RUN yarn build

# Stage 2: Production image
FROM node:20
WORKDIR /app

# Copy only package files again
COPY package.json yarn.lock ./

# Install only production dependencies
RUN yarn install --frozen-lockfile --production=true

# Copy build output from builder stage
COPY --from=builder /app/dist ./dist

# Expose port (Jamsocket will map traffic here)
EXPOSE 8080

# Start the app
CMD ["yarn", "start"]
