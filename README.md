# SIZLAND Backend API (SIZERPBACKEND2-0)

**Enterprise Project Management Backend with Blockchain Integration**

[![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.1.0-blue)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.14.0-2D3748)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-336791)](https://www.postgresql.org/)

SIZLAND Backend API is the core business logic layer that powers the SIZLAND ecosystem. Built with Node.js, Express, and TypeScript, it provides robust RESTful APIs for project management, task tracking, team collaboration, and blockchain-based payment processing through Algorand integration.

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Development](#development)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Payment System](#payment-system)
- [WebSocket Events](#websocket-events)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)
- [Related Documentation](#related-documentation)

---

## Overview

SIZLAND Backend API serves as the central business logic layer for the entire SIZLAND ecosystem. It provides secure, scalable RESTful APIs that power the ERP frontend application while integrating with Algorand blockchain for transparent, automated payment processing.

**Primary Responsibilities:**
- Business logic processing and validation
- Database operations (PostgreSQL + Prisma)
- Authentication and authorization (NextAuth SSO)
- Blockchain integration (Algorand payments)
- Real-time communication (WebSocket)
- Background job processing (BullMQ)
- Caching layer (Redis)
- API rate limiting and security

**Integration Points:**
- **ERP Frontend**: Vue 3 application consuming REST APIs
- **Database**: PostgreSQL for persistent data storage
- **Cache**: Redis for session management and caching
- **Blockchain**: Algorand network for payment processing
- **Authentication**: NextAuth for unified SSO

**Key Capabilities:**
- Multi-tenant project workspaces
- Role-based access control (RBAC)
- Department-based task organization
- Automated blockchain payment processing
- Real-time notifications and updates
- Comprehensive audit logging
- Advanced analytics and reporting

## Key Features

### Project Management
- Multi-project workspace with role-based access control
- Progressive and parallel project workflows
- Department-based task organization (major/minor departments)
- Role management (Project Owner, Project Manager, Employee)
- Project invitations with customizable payment terms
- Real-time collaboration via WebSocket

### Task Management
- Kanban-style task boards with drag-and-drop ordering
- Task prioritization (Low, Medium, High, Critical)
- Status tracking (Pending, In Progress, Completed, Approved)
- Calendar integration with scheduling capabilities
- Progress tracking with checklists
- Task assignment to user roles with department scoping
- Activity audit logs for all task changes

### Blockchain Payment System
- Algorand blockchain integration for transparent payments
- Project escrow accounts for fund management
- Automated task-based payment release
- Multiple payment types:
  - Per-task compensation
  - Recurring salary payments (weekly, biweekly, monthly)
  - Milestone-based payments
  - Oversight rate compensation (percentage-based)
  - Hybrid payment models
- Real-time payment status tracking
- Transaction history and audit trail
- Low balance alerts and automated notifications

### Security & Performance
- NextAuth SSO integration for unified authentication
- JWT-based session management
- CORS configuration for multi-domain support
- Rate limiting and request optimization
- Response compression and caching
- Redis-based session storage
- Helmet.js security headers
- CSRF protection
- Input validation and sanitization

### Analytics & Monitoring
- Project analytics and reporting
- Task completion metrics
- Payment history and summaries
- User activity tracking
- Real-time WebSocket notifications
- Redis health monitoring
- Structured logging with Winston

---

## Technology Stack

### Core Framework
**Node.js 18+ with TypeScript 5.9.2**
- ESNext module system
- Async/await for all operations
- Type-safe development
- Modern JavaScript features

### Web Framework
**Express.js 5.1.0**
- Fast, unopinionated framework
- Middleware-based architecture
- RESTful API design
- Extensive ecosystem

### Database & ORM
**PostgreSQL 14+ with Prisma 6.14.0**
- Relational database for structured data
- Type-safe database client
- Automatic migrations
- Query optimization
- Connection pooling

### Caching Layer
**Redis 5.8.2**
- Session storage
- API response caching
- Rate limiting counters
- Real-time data pub/sub
- Job queue backing (BullMQ)

### Blockchain Integration
**Algorand SDK 2.11.0**
- Smart contract interaction
- Transaction signing and submission
- Wallet management
- ARC-0059 atomic transfers
- Network state queries

### Authentication
**NextAuth Integration**
- Single Sign-On (SSO)
- JWT token management
- Session handling
- Multi-provider support

### Real-time Communication
**WebSocket (ws 8.18.0)**
- Bidirectional client-server communication
- Real-time notifications
- Task status updates
- Payment confirmations

### Background Jobs
**BullMQ 5.61.0**
- Async job processing
- Recurring payment schedules
- Payment confirmations
- Notification dispatching
- Job retry mechanisms

### Security
- **Helmet 8.1.0**: Security headers
- **CORS 2.8.5**: Cross-origin resource sharing
- **express-rate-limit 8.0.1**: API rate limiting
- **csurf 1.11.0**: CSRF protection
- **bcryptjs 3.0.3**: Password hashing
- **jsonwebtoken 9.0.2**: JWT token handling

### Logging & Monitoring
- **Winston 3.18.3**: Structured logging
- **Morgan 1.10.1**: HTTP request logging
- **Pino 9.9.0**: High-performance logging

### Additional Libraries
- **compression 1.8.1**: Response compression
- **cookie-parser 1.4.7**: Cookie handling
- **uuid 13.0.0**: UUID generation
- **raw-body 3.0.0**: Webhook payload parsing
- **svix 1.71.0**: Webhook verification

### Development Tools
- **nodemon 3.1.10**: Auto-restart on changes
- **ts-node 10.9.2**: TypeScript execution
- **TypeScript 5.9.2**: Type checking

---

## Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  ERP Frontend (Vue 3)                    │
│                  Port: 5173                              │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP/WebSocket
┌──────────────────────▼──────────────────────────────────┐
│                SIZLAND Backend API                       │
│                  Port: 4000                              │
│  ┌────────────────────────────────────────────────┐    │
│  │         Express.js Application                  │    │
│  │  ┌──────────────┬──────────────┬─────────────┐ │    │
│  │  │ Controllers  │ Middleware   │   Routes    │ │    │
│  │  └──────┬───────┴──────┬───────┴──────┬──────┘ │    │
│  │         │              │              │         │    │
│  │  ┌──────▼──────┐  ┌───▼────┐  ┌─────▼──────┐ │    │
│  │  │  Services   │  │ Guards │  │   Models   │ │    │
│  │  └──────┬──────┘  └────────┘  └─────┬──────┘ │    │
│  │         │                            │         │    │
│  └─────────┼────────────────────────────┼─────────┘    │
└────────────┼────────────────────────────┼──────────────┘
             │                            │
   ┌─────────▼─────────┐       ┌─────────▼──────────┐
   │  PostgreSQL DB    │       │   Redis Cache      │
   │  (Prisma ORM)     │       │  (Sessions/Jobs)   │
   └───────────────────┘       └────────────────────┘
             │
   ┌─────────▼─────────┐
   │ Algorand Blockchain│
   │  (SIZ Token)       │
   └────────────────────┘
```

### Request Flow

```
Client Request
      ↓
CORS Middleware → Security Headers → Rate Limiting
      ↓
Authentication → JWT Validation → Session Check
      ↓
Authorization → Role Check → Permission Validation
      ↓
Route Handler → Controller → Service Layer
      ↓
Business Logic → Data Validation → Database Query
      ↓
Response Format → Compression → Client
```

### Payment Processing Flow

```
Task Approval
      ↓
Payment Service Triggered
      ↓
Escrow Balance Check
      ↓
Algorand Transaction Builder
      ↓
Transaction Signing (Server-side)
      ↓
Blockchain Submission
      ↓
Confirmation Polling (4 blocks)
      ↓
Database Update
      ↓
WebSocket Notification
      ↓
Employee Receives Payment
```

### Directory Structure

```
SIZERPBACKEND2-0/
├── src/
│   ├── index.ts                 # Application entry point
│   │
│   ├── routes/                  # API route definitions
│   │   ├── auth.ts             # Authentication routes
│   │   ├── projects.ts         # Project management
│   │   ├── tasks.ts            # Task management
│   │   ├── payments.ts         # Payment processing
│   │   ├── escrow.ts           # Escrow management
│   │   ├── users.ts            # User management
│   │   ├── invites.ts          # Invitation system
│   │   └── analytics.ts        # Analytics endpoints
│   │
│   ├── controllers/             # Request handlers
│   │   ├── authController.ts
│   │   ├── projectController.ts
│   │   ├── taskController.ts
│   │   ├── paymentController.ts
│   │   └── userController.ts
│   │
│   ├── services/                # Business logic
│   │   ├── authService.ts
│   │   ├── projectService.ts
│   │   ├── taskService.ts
│   │   ├── paymentService.ts
│   │   ├── escrowService.ts
│   │   ├── blockchainService.ts
│   │   └── notificationService.ts
│   │
│   ├── models/                  # Data models
│   │   ├── User.ts
│   │   ├── Project.ts
│   │   ├── Task.ts
│   │   ├── Payment.ts
│   │   └── Escrow.ts
│   │
│   ├── middleware/              # Express middleware
│   │   ├── auth.ts             # Authentication
│   │   ├── rbac.ts             # Role-based access
│   │   ├── validation.ts       # Input validation
│   │   ├── errorHandler.ts     # Error handling
│   │   └── rateLimiter.ts      # Rate limiting
│   │
│   ├── utils/                   # Utility functions
│   │   ├── encryption.ts       # Encryption helpers
│   │   ├── validators.ts       # Validation functions
│   │   ├── formatters.ts       # Data formatting
│   │   └── constants.ts        # Application constants
│   │
│   ├── config/                  # Configuration
│   │   ├── database.ts         # Database config
│   │   ├── redis.ts            # Redis config
│   │   ├── algorand.ts         # Blockchain config
│   │   └── cors.ts             # CORS settings
│   │
│   └── types/                   # TypeScript types
│       ├── index.ts
│       ├── express.d.ts        # Express extensions
│       ├── api.ts              # API types
│       └── blockchain.ts       # Blockchain types
│
├── prisma/
│   ├── schema.prisma           # Database schema
│   ├── migrations/             # Database migrations
│   └── seed.ts                 # Database seeding
│
├── scripts/
│   ├── redis-seed.js           # Redis initialization
│   └── test-backend-endpoints.sh
│
├── logs/                        # Application logs
│   ├── app.log
│   ├── error.log
│   └── payments.log
│
├── .env                         # Environment variables
├── package.json                 # Dependencies
├── tsconfig.json               # TypeScript config
└── README.md                   # This file
```

---

## Prerequisites

**Required Software:**
- Node.js 18+ (LTS recommended)
- npm 9+ or yarn 1.22+
- PostgreSQL 14+ database server
- Redis 6+ server
- Git for version control

**Required Services:**
- PostgreSQL database (local or hosted)
- Redis instance (local or hosted)
- Algorand node access (for blockchain features)

**Optional:**
- Docker and Docker Compose (for containerized setup)
- AWS account (for production deployment)
- Sentry account (for error monitoring)

---

## Installation

### Option 1: Local Development Setup

**1. Clone the Repository**

```bash
git clone https://github.com/Finteckinfo/SIZERPBACKEND2-0.git
cd SIZERPBACKEND2-0
```

**2. Install Dependencies**

```bash
# Using npm
npm install

# Or using yarn
yarn install
```

**3. Set Up Environment Variables**

```bash
# Copy example environment file
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=4000
NODE_ENV=development

# CORS - Add your frontend domains (comma-separated)
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/sizland_db"

# Redis
REDIS_URL="redis://localhost:6379"
RAILWAY_REDIS_URL=""  # For Railway deployment

# NextAuth Secret (must match frontend)
NEXTAUTH_SECRET="your_secure_random_secret_minimum_32_characters"

# Algorand Blockchain
ALGORAND_NODE_URL="https://testnet-api.algonode.cloud"
ALGORAND_INDEXER_URL="https://testnet-idx.algonode.cloud"
ALGORAND_NETWORK="testnet"  # or "mainnet" for production

# Encryption for Escrow Private Keys
ENCRYPTION_SECRET="your_32_character_encryption_key_here"

# Payment Processing
PAYMENT_CONFIRMATION_THRESHOLD=4
MAX_RETRY_ATTEMPTS=3

# Logging
LOG_LEVEL="info"  # debug, info, warn, error
```

**4. Set Up PostgreSQL Database**

```bash
# Create database (if not already created)
psql -U postgres
CREATE DATABASE sizland_db;
\q

# Or use createdb command
createdb sizland_db
```

**5. Run Database Migrations**

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev --name init

# Verify database setup
npx prisma studio
```

**6. Seed Redis (Optional)**

```bash
# Test Redis connection
npm run redis:ping

# Seed initial data
npm run redis:seed
```

**7. Build the Project**

```bash
npm run build
```

**8. Start Development Server**

```bash
npm run dev
```

Server will be available at `http://localhost:4000`

### Option 2: Docker Setup

```bash
# Using Docker Compose
docker-compose up -d

# Server will be available at http://localhost:4000
```

---

## Configuration

### Environment Variables Reference

**Server Settings:**

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | 4000 | No |
| `NODE_ENV` | Environment mode | development | Yes |
| `CORS_ORIGINS` | Allowed CORS origins | localhost:3000 | Yes |

**Database:**

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | postgresql://user:pass@host:5432/db | Yes |

**Redis:**

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `REDIS_URL` | Redis connection string | redis://localhost:6379 | Yes |
| `RAILWAY_REDIS_URL` | Railway Redis URL | redis://railway.app | No |

**Authentication:**

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXTAUTH_SECRET` | Secret for JWT signing | Yes |

**Blockchain:**

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `ALGORAND_NODE_URL` | Algorand node endpoint | testnet-api.algonode.cloud | Yes |
| `ALGORAND_INDEXER_URL` | Algorand indexer endpoint | testnet-idx.algonode.cloud | Yes |
| `ALGORAND_NETWORK` | Network (mainnet/testnet) | testnet | Yes |
| `ENCRYPTION_SECRET` | Escrow key encryption secret | - | Yes |
| `PAYMENT_CONFIRMATION_THRESHOLD` | Block confirmations required | 4 | No |

### Production Configuration

**For production deployment:**

```env
# Production settings
NODE_ENV=production
PORT=4000

# Production URLs
CORS_ORIGINS=https://app.sizland.com,https://sizland.com

# Production database with SSL
DATABASE_URL="postgresql://user:password@prod-db.cloud:5432/sizland_db?sslmode=require"

# Production Redis
REDIS_URL="redis://prod-redis.cloud:6379"

# Strong secrets (generate with: openssl rand -base64 32)
NEXTAUTH_SECRET="strong_random_secret_minimum_32_characters"
ENCRYPTION_SECRET="another_strong_random_32_character_key"

# Algorand Mainnet
ALGORAND_NODE_URL="https://mainnet-api.algonode.cloud"
ALGORAND_INDEXER_URL="https://mainnet-idx.algonode.cloud"
ALGORAND_NETWORK="mainnet"

# Production logging
LOG_LEVEL="warn"
```

---

## Development

### Available Scripts

```bash
# Development
npm run dev              # Start dev server with auto-reload
npm run dev:direct       # Start built server directly
npm run build            # Build TypeScript to JavaScript
npm start                # Start production server

# Database
npx prisma generate      # Generate Prisma client
npx prisma migrate dev   # Create and apply migration
npx prisma migrate deploy # Deploy migrations (production)
npx prisma studio        # Open Prisma Studio (DB GUI)
npx prisma db push       # Push schema changes (dev only)

# Redis
npm run redis:ping       # Test Redis connection
npm run redis:seed       # Seed Redis with initial data

# Testing
bash scripts/test-backend-endpoints.sh  # Test API endpoints
```

### Development Workflow

**1. Start Required Services:**

```bash
# Terminal 1: PostgreSQL (if not running as service)
postgres -D /usr/local/var/postgres

# Terminal 2: Redis (if not running as service)
redis-server
```

**2. Start Backend Server:**

```bash
# Terminal 3: Backend API
cd ~/SizLand/SIZERPBACKEND2-0
npm run dev
```

**3. Start Frontend (for testing):**

```bash
# Terminal 4: ERP Application
cd ~/SizLand/SIZERP2-0
npm run dev
```

### Hot Reload

The development server uses `nodemon` to automatically restart when files change:
- TypeScript files in `src/`
- Configuration files
- Environment variables (requires manual restart)

---

## Database Schema

### Core Tables

**Users Table:**
```sql
- id: UUID (Primary Key)
- email: VARCHAR (Unique)
- name: VARCHAR
- clerkUserId: VARCHAR (Unique)
- role: ENUM (ADMIN, USER)
- algorandAddress: VARCHAR
- createdAt: TIMESTAMP
- updatedAt: TIMESTAMP
```

**Projects Table:**
```sql
- id: UUID (Primary Key)
- name: VARCHAR
- description: TEXT
- type: ENUM (PROGRESSIVE, PARALLEL)
- priority: ENUM (LOW, MEDIUM, HIGH, CRITICAL)
- budget: DECIMAL
- startDate: DATE
- endDate: DATE
- status: ENUM (PLANNING, ACTIVE, COMPLETED, ARCHIVED)
- ownerId: UUID (Foreign Key -> Users)
- escrowAddress: VARCHAR
- createdAt: TIMESTAMP
- updatedAt: TIMESTAMP
```

**Tasks Table:**
```sql
- id: UUID (Primary Key)
- title: VARCHAR
- description: TEXT
- projectId: UUID (Foreign Key -> Projects)
- departmentId: UUID (Foreign Key -> Departments)
- assignedToRoleId: UUID (Foreign Key -> UserRoles)
- status: ENUM (PENDING, IN_PROGRESS, COMPLETED, APPROVED)
- priority: ENUM (LOW, MEDIUM, HIGH, CRITICAL)
- estimatedHours: INTEGER
- actualHours: INTEGER
- paymentAmount: DECIMAL
- dueDate: TIMESTAMP
- completedAt: TIMESTAMP
- approvedAt: TIMESTAMP
- createdAt: TIMESTAMP
- updatedAt: TIMESTAMP
```

**Payments Table:**
```sql
- id: UUID (Primary Key)
- taskId: UUID (Foreign Key -> Tasks)
- recipientId: UUID (Foreign Key -> Users)
- amount: DECIMAL
- transactionHash: VARCHAR
- status: ENUM (PENDING, PROCESSING, CONFIRMED, FAILED)
- blockNumber: INTEGER
- confirmations: INTEGER
- errorMessage: TEXT
- createdAt: TIMESTAMP
- processedAt: TIMESTAMP
```

**Escrows Table:**
```sql
- id: UUID (Primary Key)
- projectId: UUID (Foreign Key -> Projects)
- address: VARCHAR (Unique)
- encryptedPrivateKey: TEXT
- balance: DECIMAL
- totalAllocated: DECIMAL
- totalPaid: DECIMAL
- createdAt: TIMESTAMP
- updatedAt: TIMESTAMP
```

### Database Migrations

```bash
# Create new migration
npx prisma migrate dev --name add_payment_tracking

# Apply migrations
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset

# View migration status
npx prisma migrate status
```

---

## API Documentation

### Authentication Endpoints
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout
- `GET /api/auth/session` - Get current session

### Project Endpoints
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project
- `GET /api/projects/:id` - Get project details
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Task Endpoints
- `GET /api/tasks` - List tasks (with filters)
- `POST /api/tasks` - Create new task
- `GET /api/tasks/:id` - Get task details
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task
- `PATCH /api/tasks/:id/status` - Update task status

### Payment Endpoints
- `GET /api/escrow/:projectId` - Get project escrow details
- `POST /api/escrow/:projectId/fund` - Fund project escrow
- `POST /api/tasks/:taskId/release-payment` - Release task payment
- `GET /api/transactions/:projectId` - Get transaction history
- `GET /api/recurring-payments` - List recurring payments
- `POST /api/recurring-payments` - Create recurring payment

### User & Role Endpoints
- `GET /api/users` - List users
- `GET /api/admin/users` - Admin user management
- `GET /api/user-roles` - List user roles
- `POST /api/invites` - Send project invitation
- `PUT /api/invites/:id/accept` - Accept invitation

### Analytics Endpoints
- `GET /api/analytics/project/:id` - Project analytics
- `GET /api/analytics/tasks` - Task completion metrics
- `GET /api/analytics/payments` - Payment summaries

### WebSocket Events
- `task:created` - New task created
- `task:updated` - Task status/details changed
- `payment:processed` - Payment completed
- `notification` - General notifications

## Deployment

### Production Build

```bash
# Build the application
npm run build

# Start production server
npm start
```

### Environment Variables for Production

Ensure these are properly configured:

- Update `CORS_ORIGINS` with your production domain(s)
- Set `NODE_ENV=production`
- Use production database and Redis URLs
- Switch to Algorand mainnet for live payments
- Use strong secrets for `NEXTAUTH_SECRET` and `ENCRYPTION_SECRET`
- Consider using AWS KMS for escrow key management

### Railway Deployment

This project is optimized for Railway deployment. See `RAILWAY_ENVIRONMENT_SETUP.md` for detailed instructions.

### Health Check Endpoints

- `GET /health/redis` - Redis connection status

## Payment System

### Payment Architecture

The payment system integrates Algorand blockchain for transparent, automated payment processing:

**Key Components:**
1. **Project Escrow**: Dedicated Algorand account per project
2. **Task Payment Allocation**: Funds reserved upon task creation
3. **Automatic Release**: Payments trigger on task approval
4. **Transaction Verification**: Multiple block confirmations required
5. **Audit Trail**: Complete history in PostgreSQL

### Payment Flow

```
1. Project Owner Funds Escrow
         ↓
2. Task Created with Payment Amount
         ↓
3. Employee Completes Task (status: COMPLETED)
         ↓
4. Manager Reviews & Approves
         ↓
5. Backend Initiates Blockchain Transaction
         ↓
6. Transaction Signed & Submitted to Algorand
         ↓
7. Wait for Confirmations (4 blocks ~16 seconds)
         ↓
8. Database Updated with Transaction Hash
         ↓
9. WebSocket Notification Sent
         ↓
10. Employee Wallet Credited
```

### Payment Models

**Per-Task Payment:**
```typescript
{
  type: 'TASK',
  amount: 500,  // SIZ tokens
  taskId: 'uuid',
  recipientId: 'uuid'
}
```

**Recurring Salary:**
```typescript
{
  type: 'RECURRING',
  amount: 5000,
  frequency: 'MONTHLY',  // WEEKLY, BIWEEKLY, MONTHLY
  roleId: 'uuid'
}
```

**Milestone Payment:**
```typescript
{
  type: 'MILESTONE',
  amount: 10000,
  milestoneId: 'uuid',
  recipients: ['uuid1', 'uuid2']
}
```

---

## WebSocket Events

### Real-time Communication

**Connection:**
```javascript
const ws = new WebSocket('ws://localhost:4000');
```

**Event Types:**

**Task Events:**
```json
{
  "event": "task:created",
  "data": {
    "taskId": "uuid",
    "projectId": "uuid",
    "title": "New Task",
    "assignedTo": "uuid"
  }
}
```

**Payment Events:**
```json
{
  "event": "payment:processed",
  "data": {
    "paymentId": "uuid",
    "taskId": "uuid",
    "amount": 500,
    "transactionHash": "TXNHASH123",
    "status": "CONFIRMED"
  }
}
```

**Notification Events:**
```json
{
  "event": "notification",
  "data": {
    "type": "info",
    "message": "Payment confirmed",
    "userId": "uuid"
  }
}
```

---

## Testing

### Manual API Testing

```bash
# Test with provided script
bash scripts/test-backend-endpoints.sh
```

### Unit Testing (Setup Required)

```bash
# Install testing dependencies
npm install --save-dev jest @types/jest ts-jest supertest

# Run tests
npm test

# Run with coverage
npm test -- --coverage
```

### Integration Testing

```bash
# Test database connection
npx prisma studio

# Test Redis connection
npm run redis:ping

# Test Algorand connection
curl https://testnet-api.algonode.cloud/v2/status
```

### API Endpoint Testing

**Using curl:**
```bash
# Health check
curl http://localhost:4000/health/redis

# Login (get JWT token)
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'

# Get projects (with JWT)
curl http://localhost:4000/api/projects \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Deployment

### Production Build

```bash
# Build the application
npm run build

# Start production server
npm start
```

### Railway Deployment

**1. Install Railway CLI:**
```bash
npm install -g @railway/cli
```

**2. Login and Link Project:**
```bash
railway login
railway link
```

**3. Set Environment Variables:**
```bash
railway variables set DATABASE_URL="postgresql://..."
railway variables set REDIS_URL="redis://..."
railway variables set NEXTAUTH_SECRET="..."
```

**4. Deploy:**
```bash
railway up
```

### Docker Deployment

**Dockerfile:**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY prisma ./prisma
RUN npx prisma generate
EXPOSE 4000
CMD ["npm", "start"]
```

**Build and Run:**
```bash
docker build -t sizland-backend .
docker run -p 4000:4000 --env-file .env sizland-backend
```

### Environment Variables (Production)

Update these for production:
- `NODE_ENV=production`
- `DATABASE_URL` with SSL enabled
- `REDIS_URL` pointing to production Redis
- Strong random secrets for `NEXTAUTH_SECRET` and `ENCRYPTION_SECRET`
- `ALGORAND_NETWORK=mainnet`
- `CORS_ORIGINS` with production domains

---

## Security

### Implemented Security Measures

**Authentication & Authorization:**
- NextAuth SSO integration
- JWT token validation
- Role-based access control (RBAC)
- Session management via Redis

**Data Protection:**
- Escrow private keys encrypted with AES-256-GCM
- Password hashing with bcrypt
- Input validation and sanitization
- SQL injection prevention (Prisma ORM)

**API Security:**
- Rate limiting per IP
- CORS configuration
- Helmet security headers
- CSRF protection
- Request size limits

**Blockchain Security:**
- Server-side transaction signing
- Transaction verification
- Multiple block confirmations
- Encrypted key storage

### Security Best Practices

```bash
# Regular security audits
npm audit

# Fix vulnerabilities
npm audit fix

# Keep dependencies updated
npm update
```

### Production Security Checklist

- [ ] Use environment variables for all secrets
- [ ] Enable database SSL in production
- [ ] Use strong random secrets (32+ characters)
- [ ] Implement rate limiting on all endpoints
- [ ] Enable HTTPS only
- [ ] Configure CORS for specific domains
- [ ] Set up error monitoring (Sentry)
- [ ] Enable logging and log rotation
- [ ] Regular database backups
- [ ] Implement API versioning

---

## Monitoring

### Logging

**Winston Logger:**
```typescript
import logger from './utils/logger';

logger.info('User logged in', { userId, email });
logger.error('Payment failed', { error, taskId });
```

**Log Levels:**
- `debug`: Detailed information for debugging
- `info`: General information
- `warn`: Warning messages
- `error`: Error messages

**Log Files:**
- `logs/app.log`: General application logs
- `logs/error.log`: Error logs only
- `logs/payments.log`: Payment-specific logs

### Health Checks

```bash
# Redis health
GET /health/redis

Response: {
  "status": "healthy",
  "redis": "connected",
  "timestamp": "2025-11-21T12:00:00Z"
}
```

### Performance Monitoring

**Recommended Tools:**
- **Sentry**: Error tracking and monitoring
- **DataDog**: Application performance monitoring
- **New Relic**: Full-stack observability
- **Grafana**: Metrics visualization

---

## Troubleshooting

### Common Issues

**Issue: Server won't start**
```bash
# Check if port is already in use
lsof -i :4000

# Kill process using the port
kill -9 <PID>
```

**Issue: Database connection fails**
```bash
# Test PostgreSQL connection
psql $DATABASE_URL

# Check database URL format
echo $DATABASE_URL
```

**Issue: Redis connection fails**
```bash
# Test Redis connection
redis-cli -u $REDIS_URL ping

# Start Redis server
redis-server
```

**Issue: Blockchain transactions fail**
- Verify Algorand node is accessible
- Check escrow account has sufficient balance
- Ensure recipient wallet is opted into SIZ token
- Review logs in `logs/payments.log`

**Issue: Build fails**
```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

### Debug Mode

```env
# Enable debug logging
LOG_LEVEL=debug
NODE_ENV=development
```

### Database Issues

```bash
# Reset database (development only)
npx prisma migrate reset

# Verify schema
npx prisma validate

# Check migrations
npx prisma migrate status
```

---

## Related Documentation

**In This Repository:**
- `API_IMPLEMENTATION_SUMMARY.md` - Detailed API docs
- `BACKEND_PAYMENT_REQUIREMENTS_FINAL.txt` - Payment specs
- `RAILWAY_ENVIRONMENT_SETUP.md` - Railway deployment
- `SIZCOIN_BACKEND_REQUIREMENTS.md` - Blockchain integration

**System-Wide Documentation:**
- [Complete System Guide](../COMPLETE_SIZLAND_SYSTEM_GUIDE.md)
- [Master README](../README.md)
- [ERP Application README](../SIZERP2-0/README.md)
- [Landing Page README](../web3-landing/README.md)

**Ecosystem Components:**
- **ERP Frontend**: `/SIZERP2-0` - Vue 3 application
- **Landing Page**: `/web3-landing` - Next.js marketing site
- **This Repository**: Backend API and business logic

---

## Contributing

### Development Workflow

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes and test locally
3. Run type check: `npm run build`
4. Commit with conventional commits
5. Push and create pull request

### Commit Convention

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `test:` Tests
- `chore:` Maintenance

---

## License

**Proprietary License**

This project is private and proprietary to Finteck Information Systems. All rights reserved.

---

## Support

**Technical Support:**
- Email: dev@sizland.com
- GitHub Issues: Create issue in repository

**Documentation:**
- This README (backend overview)
- System Guide (complete ecosystem)
- API Documentation (endpoint reference)

---

**Built with Node.js + Express + TypeScript + PostgreSQL + Algorand**

**Made by Finteck Information Systems**

**Last Updated:** November 2025

## Security Considerations

- All escrow private keys are encrypted at rest
- Use AWS KMS for production key management
- Enable rate limiting on all public endpoints
- Implement HTTPS in production
- Regular security audits recommended
- Keep dependencies updated
- Use environment-based secrets management

## Testing

```bash
# Test backend endpoints using provided script
bash test-backend-endpoints.sh
```

## Monitoring & Logging

- Structured logging with Winston
- Request logging with Morgan
- Memory usage monitoring
- Redis connection health checks
- Blockchain transaction status tracking
- Payment processing logs in `payments.log` and `payment-errors.log`

## Troubleshooting

### Redis Connection Issues
```bash
# Check Redis status
npm run redis:ping

# Verify Redis URL in .env
echo $REDIS_URL
```

### Database Migration Issues
```bash
# Reset and reapply migrations
npx prisma migrate reset
npx prisma migrate dev
```

### Blockchain Payment Issues
- Verify Algorand node connectivity
- Check wallet addresses are valid
- Ensure sufficient balance in escrow
- Review transaction logs in `payments.log`

## Contributing

1. Create a feature branch from `main`
2. Make your changes with clear commit messages
3. Ensure all tests pass
4. Submit a pull request with detailed description

## License

Private - Finteck Information Systems

## Support

For issues and questions, contact the development team or create an issue in the repository.

## Related Documentation

- `API_IMPLEMENTATION_SUMMARY.md` - Detailed API documentation
- `BACKEND_PAYMENT_REQUIREMENTS_FINAL.txt` - Payment system specifications
- `RAILWAY_ENVIRONMENT_SETUP.md` - Deployment guide
- `SIZCOIN_BACKEND_REQUIREMENTS.md` - Blockchain integration details
