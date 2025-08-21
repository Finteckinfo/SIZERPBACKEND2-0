#!/bin/bash
# Test script to verify backend endpoints are working
# Run this with: bash test-backend-endpoints.sh

echo "🚀 Testing Backend Authentication Endpoints..."
echo "============================================="

BASE_URL="https://sizerpbackend2-0-production.up.railway.app"

# Test 1: Health check (should work)
echo ""
echo "🔍 Test 1: Health Check Endpoint"
echo "URL: $BASE_URL/api/auth/health"
curl -s -w "HTTP Status: %{http_code}\n" "$BASE_URL/api/auth/health" | head -5

# Test 2: Sync endpoint without token (should return 401)
echo ""
echo "🔍 Test 2: Sync Endpoint Without Token (should return 401)"
echo "URL: $BASE_URL/api/auth/sync-user"
curl -s -w "HTTP Status: %{http_code}\n" -X POST \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/auth/sync-user" | head -5

# Test 3: Protected endpoint without token (should return 401)
echo ""
echo "🔍 Test 3: Protected Endpoint Without Token (should return 401)"
echo "URL: $BASE_URL/api/projects/my-projects/simple"
curl -s -w "HTTP Status: %{http_code}\n" "$BASE_URL/api/projects/my-projects/simple" | head -5

# Test 4: CORS preflight for sync endpoint
echo ""
echo "🔍 Test 4: CORS Preflight for Sync Endpoint"
echo "URL: $BASE_URL/api/auth/sync-user (OPTIONS)"
curl -s -w "HTTP Status: %{http_code}\n" -X OPTIONS \
  -H "Origin: https://sizerp-2-0.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Authorization, Content-Type" \
  "$BASE_URL/api/auth/sync-user"

echo ""
echo "✅ Backend endpoint tests completed!"
echo ""
echo "📋 Expected Results:"
echo "- Health check: HTTP 200 with success message"
echo "- Sync without token: HTTP 401 (Unauthorized)"
echo "- Protected without token: HTTP 401 (Unauthorized)"
echo "- CORS preflight: HTTP 200 or 204"
echo ""
echo "If all tests show expected results, the backend is working correctly!"
echo "The issue is likely in the frontend JWT configuration or API calls."
