# Clerk Backend Setup Guide

## 🔑 Required Environment Variables

Add these to your `.env` file:

```bash
# Clerk Configuration
CLERK_SECRET_KEY=sk_test_your_clerk_secret_key_here
CLERK_JWT_KEY=your_clerk_jwt_key_here
CLERK_ISSUER_URL=https://clerk.your-domain.com
```

## 📍 Where to Find These Values

### 1. CLERK_SECRET_KEY
- Go to your Clerk Dashboard
- Navigate to **API Keys**
- Copy the **Secret Key** (starts with `sk_test_` or `sk_live_`)

### 2. CLERK_JWT_KEY
- In Clerk Dashboard, go to **JWT Templates**
- Copy the **Signing Key** (starts with `-----BEGIN PUBLIC KEY-----`)

### 3. CLERK_ISSUER_URL
- In Clerk Dashboard, go to **Settings** → **General**
- Copy your **Instance URL** (e.g., `https://clerk.your-domain.com`)

## 🚀 What This Enables

✅ **Automatic user creation** when users first log in via Clerk  
✅ **Secure token verification** using Clerk's built-in security  
✅ **No custom JWT management** - Clerk handles everything  
✅ **Social login support** out of the box  
✅ **Multi-factor authentication** support  
✅ **Enterprise-grade security**  

## 🔄 How It Works Now

1. **Frontend**: User logs in via Clerk → gets session token
2. **Frontend**: Sends session token in Authorization header
3. **Backend**: Verifies token with Clerk's API
4. **Backend**: Creates user in database if first time
5. **Backend**: Allows access to protected routes

## 🧪 Testing

Once configured:
1. **Frontend login** should work with Clerk
2. **API calls** should include Clerk session tokens
3. **Backend** should automatically create users on first login
4. **All protected routes** should work seamlessly

## 🆘 Troubleshooting

- **"Authentication configuration error"**: Check if environment variables are set
- **"Invalid token payload"**: Verify Clerk JWT key is correct
- **"Clerk token verification failed"**: Check CLERK_ISSUER_URL format

This setup gives you the best of both worlds: Clerk's security + your custom backend logic! 🎉
