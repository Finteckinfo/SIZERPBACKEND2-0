# SIZER Backend 2.0

A comprehensive backend API for enterprise project management with integrated blockchain payment processing. Built with Express, TypeScript, and Algorand blockchain for secure, transparent task-based compensation.

## Overview

SIZER Backend provides a complete project management solution with role-based access control, department organization, task tracking, real-time communication, and automated SIZCOIN payments via Algorand smart contracts. The system supports multiple payment models including per-task, salary-based, milestone, and oversight compensation.

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

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js 5
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis
- **Blockchain**: Algorand
- **Authentication**: NextAuth (SSO)
- **WebSocket**: ws library for real-time updates
- **Security**: Helmet, CORS, Rate Limiting, CSRF
- **Logging**: Winston, Morgan, Pino

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- Redis server
- Algorand wallet and node access (for payment features)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/Finteckinfo/SIZERPBACKEND2-0.git
cd SIZERPBACKEND2-0
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment Configuration

Copy the example environment file and configure your settings:

```bash
cp env.example .env
```

Configure the following required variables in `.env`:

```env
# Server
PORT=3000
NODE_ENV=development

# CORS - Add your frontend domains
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/sizer_db"

# Redis
REDIS_URL="redis://localhost:6379"

# NextAuth Secret (must match frontend)
NEXTAUTH_SECRET="your_secure_secret_key_here"

# Algorand Blockchain
ALGORAND_NODE_URL="https://testnet-api.algonode.cloud"
ALGORAND_INDEXER_URL="https://testnet-idx.algonode.cloud"
ALGORAND_NETWORK="testnet"

# Encryption for Escrow Private Keys
ENCRYPTION_SECRET="your_32_character_encryption_key"

# Payment Processing
PAYMENT_CONFIRMATION_THRESHOLD=3
```

### 4. Database Setup

Run Prisma migrations to set up the database schema:

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev --name init

# (Optional) Seed the database
npm run redis:seed
```

### 5. Start Development Server

```bash
npm run dev
```

The server will start on `http://localhost:3000` (or your configured PORT).

## Development

### Available Scripts

```bash
# Start development server with hot reload
npm run dev

# Start built server directly
npm run dev:direct

# Build TypeScript to JavaScript
npm run build

# Start production server
npm start

# Check Redis connection
npm run redis:ping

# Seed Redis with initial data
npm run redis:seed
```

### Database Operations

```bash
# Create a new migration after schema changes
npx prisma migrate dev --name description_of_changes

# Deploy migrations to production
npx prisma migrate deploy

# Reset database (WARNING: deletes all data)
npx prisma migrate reset

# Open Prisma Studio (database GUI)
npx prisma studio

# Regenerate Prisma client after schema changes
npx prisma generate
```

### TypeScript Configuration

For local development, ensure `tsconfig.json` uses:
```json
{
  "compilerOptions": {
    "module": "ESNext"
  }
}
```

For production builds, use:
```json
{
  "compilerOptions": {
    "module": "NodeNext"
  }
}
```

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

## Payment System Architecture

The payment system uses Algorand blockchain for transparent, verifiable transactions:

1. **Project Escrow**: Each project has a dedicated Algorand escrow account
2. **Task Payment Allocation**: When tasks are created, funds are allocated from the escrow
3. **Automatic Release**: Upon task completion and approval, payments are automatically released
4. **Recurring Payments**: Salary-based roles receive automated recurring payments
5. **Transaction Verification**: All payments require blockchain confirmation
6. **Audit Trail**: Complete transaction history stored in PostgreSQL

### Payment Flow

```
Project Owner Funds Escrow
         ↓
Task Created with Payment Amount
         ↓
Employee Completes Task
         ↓
Manager Approves Task
         ↓
Blockchain Transaction Initiated
         ↓
Payment Confirmed (3 confirmations)
         ↓
Employee Wallet Credited
```

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
