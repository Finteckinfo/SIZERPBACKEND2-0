# 🎯 New Filtered Projects API Endpoints

## Overview
Instead of getting ALL projects, these new endpoints filter projects based on the authenticated user's access rights.

## 🔐 Authentication Required
Both endpoints require a valid JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## 📋 Available Endpoints

### 1. **GET /api/projects/my-projects**
**Full-featured endpoint with pagination, filtering, and search**

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `search` - Search in name/description
- `type` - Filter by project type (PROGRESSIVE/PARALLEL)
- `priority` - Filter by priority (LOW/MEDIUM/HIGH/CRITICAL)
- `startDate` - Filter projects starting after this date
- `endDate` - Filter projects ending before this date
- `tags` - Array of tag names to filter by
- `sortBy` - Field to sort by (default: createdAt)
- `sortOrder` - asc or desc (default: desc)

**Example Request:**
```
GET /api/projects/my-projects?page=1&limit=10&search=website&priority=HIGH
```

**Response Format:**
```json
{
  "projects": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### 2. **GET /api/projects/my-projects/simple**
**Simplified endpoint without pagination - returns all user's projects**

**No Query Parameters** - just returns all accessible projects

**Example Request:**
```
GET /api/projects/my-projects/simple
```

**Response Format:**
```json
{
  "projects": [...],
  "total": 5
}
```

## 🔍 How Filtering Works

The API automatically filters projects based on **TWO conditions**:

### **Condition 1: User Owns the Project**
```typescript
// Check if user's email matches project owner's email
owner: {
  email: authenticatedUserEmail
}
```

### **Condition 2: User Has a Role in the Project**
```typescript
// Check if user has a UserRole in the project
userRoles: {
  some: {
    user: {
      email: authenticatedUserEmail
    }
  }
}
```

## 🎯 Use Cases

### **Frontend Dashboard:**
```typescript
// Get user's projects for dashboard
const userProjects = await api.get('/api/projects/my-projects/simple');
// Shows: "You have access to 3 projects"
```

### **Project List with Search:**
```typescript
// Get projects with search and pagination
const searchResults = await api.get('/api/projects/my-projects?search=website&page=1');
// Shows: "Found 5 projects matching 'website'"
```

### **Project Management:**
```typescript
// Get all user's projects for project switcher
const allProjects = await api.get('/api/projects/my-projects/simple');
// Shows: "Switch between your 3 projects"
```

## 🚀 Benefits

1. **Security**: Users only see projects they have access to
2. **Performance**: No need to fetch all projects and filter client-side
3. **User Experience**: Clean, filtered results based on permissions
4. **Flexibility**: Both simple and advanced filtering options
5. **Consistency**: Same data structure as the original `/api/projects` endpoint

## 🔧 Migration Guide

### **Replace this:**
```typescript
// Old way - gets ALL projects
const allProjects = await api.get('/api/projects');
```

### **With this:**
```typescript
// New way - gets only user's projects
const userProjects = await api.get('/api/projects/my-projects/simple');
```

## 📱 Frontend Implementation

```typescript
// Example: Dashboard component
const Dashboard = () => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUserProjects = async () => {
      try {
        const response = await api.get('/api/projects/my-projects/simple');
        setProjects(response.data.projects);
      } catch (error) {
        console.error('Failed to fetch projects:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserProjects();
  }, []);

  if (loading) return <div>Loading your projects...</div>;

  return (
    <div>
      <h1>Your Projects ({projects.length})</h1>
      {projects.map(project => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
};
```

## 🎉 Result

Now when a user logs in, they'll only see:
- ✅ **Projects they own** (by email match)
- ✅ **Projects they're team members of** (by UserRole email match)
- ❌ **No other projects** (filtered out automatically)

This gives you a clean, secure, and user-specific project list! 🚀
