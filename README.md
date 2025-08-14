# SIZBackend 2.0

Backend for the **SIZ** project — built with **Express + TypeScript**.  
Features:
- PostgreSQL with Prisma ORM
- Secure middleware setup
- Clerk webhook handling via Svix
- Fully typed API with TypeScript

---

## 🚀 Getting Started (Local Development)

### Install dependencies
npm install

### Run project locally
npm run dev
# In tsconfig.json, set:
# "module": "ESNext"
# for local development

---

## 🛠 Database Migrations

# Run initial migration
npx prisma migrate dev --name init

# After making schema changes
npx prisma migrate dev --name change_description

# Deploy migrations to production
npx prisma migrate deploy

# Regenerate Prisma client
npx prisma generate

---

## 📦 Build for Production
npm run build
# In tsconfig.json, set:
# "module": "NodeNext"
# before building for production

---

## 🚀 Start Production Server
npm start
