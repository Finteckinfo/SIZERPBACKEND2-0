# Frontend JWT Authentication Implementation Guide

## 🚀 What We've Built

Your backend now has a **complete JWT-based authentication system** that replaces the old user ID token approach. This means:

✅ **Secure authentication** with JWT tokens that expire  
✅ **Password hashing** for security  
✅ **User registration and login** endpoints  
✅ **Token verification** for protected routes  
✅ **Automatic token validation** on all API calls  

## 🔐 New Authentication Endpoints

### 1. User Registration
```
POST /api/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:**
```json
{
  "user": {
    "id": "user_31V3XTC4jQ6C9jsIqLeSh7mXT6Z",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### 2. User Login
```
POST /api/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response:** Same as registration

### 3. Token Verification
```
GET /api/verify
Authorization: Bearer YOUR_JWT_TOKEN
```

**Response:**
```json
{
  "user": {
    "id": "user_31V3XTC4jQ6C9jsIqLeSh7mXT6Z",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

## 🛠️ Frontend Implementation Steps

### Step 1: Create Authentication Service

```javascript
// services/authService.js
class AuthService {
  constructor() {
    this.baseURL = 'https://sizerpbackend2-0-production.up.railway.app/api';
    this.tokenKey = 'auth_token';
  }

  // Store token in localStorage
  setToken(token) {
    localStorage.setItem(this.tokenKey, token);
  }

  // Get token from localStorage
  getToken() {
    return localStorage.getItem(this.tokenKey);
  }

  // Remove token (logout)
  removeToken() {
    localStorage.removeItem(this.tokenKey);
  }

  // Check if user is authenticated
  isAuthenticated() {
    return !!this.getToken();
  }

  // Get auth headers for API calls
  getAuthHeaders() {
    const token = this.getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  }

  // User registration
  async register(userData) {
    try {
      const response = await fetch(`${this.baseURL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Registration failed');
      }

      const data = await response.json();
      this.setToken(data.token);
      return data;
    } catch (error) {
      throw error;
    }
  }

  // User login
  async login(credentials) {
    try {
      const response = await fetch(`${this.baseURL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(credentials)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Login failed');
      }

      const data = await response.json();
      this.setToken(data.token);
      return data;
    } catch (error) {
      throw error;
    }
  }

  // Verify token
  async verifyToken() {
    try {
      const token = this.getToken();
      if (!token) {
        throw new Error('No token found');
      }

      const response = await fetch(`${this.baseURL}/verify`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        this.removeToken(); // Clear invalid token
        throw new Error('Token verification failed');
      }

      const data = await response.json();
      return data.user;
    } catch (error) {
      this.removeToken();
      throw error;
    }
  }

  // Logout
  logout() {
    this.removeToken();
    // Redirect to login page or clear user state
  }
}

export default new AuthService();
```

### Step 2: Update Your API Service

```javascript
// services/apiService.js
import authService from './authService.js';

class ApiService {
  constructor() {
    this.baseURL = 'https://sizerpbackend2-0-production.up.railway.app/api';
  }

  // Generic API call with authentication
  async apiCall(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    // Add auth headers to all requests
    const headers = {
      ...options.headers,
      ...authService.getAuthHeaders()
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      // Handle 401 Unauthorized (invalid/expired token)
      if (response.status === 401) {
        authService.logout();
        // Redirect to login or show auth error
        throw new Error('Authentication required');
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'API request failed');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  // Project API calls
  async createProject(projectData) {
    return this.apiCall('/projects', {
      method: 'POST',
      body: JSON.stringify(projectData)
    });
  }

  async getUserRoleInProject(projectId, userId) {
    return this.apiCall(`/user-roles/project/${projectId}/user/${userId}`);
  }

  // Add other API methods as needed...
}

export default new ApiService();
```

### Step 3: Update Your Components

```javascript
// components/LoginForm.js
import { useState } from 'react';
import authService from '../services/authService.js';

function LoginForm() {
  const [credentials, setCredentials] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await authService.login(credentials);
      console.log('Login successful:', result.user);
      
      // Redirect to dashboard or update app state
      // window.location.href = '/dashboard';
      
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        placeholder="Email"
        value={credentials.email}
        onChange={(e) => setCredentials({
          ...credentials,
          email: e.target.value
        })}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={credentials.password}
        onChange={(e) => setCredentials({
          ...credentials,
          password: e.target.value
        })}
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Logging in...' : 'Login'}
      </button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
```

### Step 4: Protected Route Component

```javascript
// components/ProtectedRoute.js
import { useState, useEffect } from 'react';
import authService from '../services/authService.js';

function ProtectedRoute({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        if (authService.isAuthenticated()) {
          await authService.verifyToken();
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    // Redirect to login
    window.location.href = '/login';
    return null;
  }

  return children;
}
```

## 🔄 Migration from Old System

### Before (Old User ID Token):
```javascript
// OLD WAY - Don't use this anymore
headers: {
  'Authorization': `Bearer ${userId}` // This was the user ID directly
}
```

### After (New JWT Token):
```javascript
// NEW WAY - Use this
headers: {
  'Authorization': `Bearer ${jwtToken}` // This is the JWT token from login/register
}
```

## 🚨 Important Notes

1. **Token Storage**: Store JWT tokens in localStorage (or secure storage)
2. **Automatic Headers**: All API calls now automatically include the Authorization header
3. **Token Expiry**: Tokens expire after 7 days (configurable in backend)
4. **Error Handling**: 401 errors automatically trigger logout and redirect
5. **Security**: Never expose the JWT secret in frontend code

## 🧪 Testing

1. **Register a new user** using `/api/register`
2. **Login** using `/api/login` 
3. **Try accessing protected routes** - they should now work with the JWT token
4. **Check browser dev tools** - you should see the Authorization header in all requests

## 🆘 Troubleshooting

- **401 Unauthorized**: Check if token is being sent in Authorization header
- **Token expired**: User will be automatically logged out
- **CORS issues**: Make sure your backend CORS is configured for your frontend domain

## 📱 Example Usage in Your App

```javascript
// In your main app component
import { useEffect } from 'react';
import authService from './services/authService.js';
import apiService from './services/apiService.js';

function App() {
  useEffect(() => {
    // Check authentication on app load
    const checkAuth = async () => {
      try {
        if (authService.isAuthenticated()) {
          const user = await authService.verifyToken();
          console.log('User authenticated:', user);
        }
      } catch (error) {
        console.log('User not authenticated');
      }
    };

    checkAuth();
  }, []);

  // Your app content...
}
```

This implementation will solve your "Invalid token" error and provide a secure, professional authentication system! 🎉
