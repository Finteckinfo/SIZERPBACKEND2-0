# Railway Environment Configuration Guide

## Required Environment Variables

Set these environment variables in your Railway project dashboard:

### Server Configuration
```
PORT=3000
NODE_ENV=development
```

### Database
```
DATABASE_URL="${{Postgres-yzIH.DATABASE_PUBLIC_URL}}"
```

### Clerk Authentication Configuration
```
CLERK_WEBHOOK_SECRET="whsec_VM1g9vmpZo3pBcwtaQ4TP77X77NUkAQi"
CLERK_ISSUER_URL="https://pumped-sheep-45.clerk.accounts.dev"
CLERK_JWKS_URL="https://pumped-sheep-45.clerk.accounts.dev/.well-known/jwks.json"
CLERK_PUBLISHABLE_KEY="pk_test_cHVtcGVkLXNoZWVwLTQ1LmNsZXJrLmFjY291bnRzLmRldiQ"
CLERK_SECRET_KEY="sk_test_LTagW3LCrISpQxzO1zZuCDcqLf8Yew2hfusYPbzbZy"
```

### JWT Configuration (NEW - Replaces CLERK_JWT_KEY)
```
CLERK_JWKS_PUBLIC_KEY="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1xbJ4qo8K9XPbX9ibJmJ
inR1mDrhzGLu7ZTr8HPT0gY22rNx7cPd7G4y1pTKjjLmNC35DtRURJ/+FlQdTliT
vJhuV63G1dqfc8GS9gEHrUp1AVoJ9LAOWoeApuUBMNpcRcc/oR+P+cE380JGI22w
82crdZWCj6BPap8zWFLYpGCu1VjK9O2iAmC2lr8gWJSJ+AKOzVZo9Fvpvkx694Su
wAMVnJD/OSPBRZyAZBGYtjx0AGs6bSh0IJyiWta2uDJ8BxVT6SeshieHTWd/yMu0
MaHriJ3hucZcbLYCYocEgM2fS4ez9ohXtDADYjfa5U19HfH6fSpVAzaP+VaVdJLX
LwIDAQAB"
```

### Optional: Custom Audience
```
CLERK_AUDIENCE="https://sizerpbackend2-0-production.up.railway.app"
```

## JWT Template Configuration

In your Clerk Dashboard, ensure your JWT template matches this structure:

```json
{
  "user_id": "{{user.id}}",
  "email": "{{user.primary_email_address.email}}",
  "first_name": "{{user.first_name}}",
  "last_name": "{{user.last_name}}",
  "aud": "https://sizerpbackend2-0-production.up.railway.app"
}
```

## What This Configuration Enables

✅ **JWT Token Verification**: Using JWKS for automatic key rotation
✅ **Issuer Validation**: Ensures tokens come from your Clerk domain
✅ **Audience Validation**: Ensures tokens are intended for your backend
✅ **Expiration Validation**: Automatically checks token expiration
✅ **Signature Verification**: Uses RSA256 algorithm with public key
✅ **Fallback Methods**: Multiple verification strategies for reliability

## Backend URL Configuration

Your backend is accessible at:
- **Production**: `https://sizerpbackend2-0-production.up.railway.app`
- **Development**: `http://localhost:3000`

## Frontend Requirements Met

✅ **JWKS URL**: Configured for automatic key rotation
✅ **Issuer**: Matches Clerk domain exactly
✅ **Backend Verification**: 
  - Token signature using JWKS ✅
  - Issuer matches Clerk domain ✅
  - Audience matches backend URL ✅
  - Expiration validation ✅

## Testing the Setup

1. Deploy these environment variables to Railway
2. Restart your application
3. Test JWT authentication with your frontend
4. Check logs for successful JWT verification messages

## Troubleshooting

If you encounter issues:
1. Verify all environment variables are set correctly
2. Check that the JWT template matches exactly
3. Ensure the audience URL matches your backend domain
4. Check application logs for detailed error messages
