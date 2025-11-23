# Use official Node.js 18 image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the application (TypeScript -> JavaScript)
RUN npm run build

# Expose the port the app runs on
EXPOSE 4000

# Start the application with migrations
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
