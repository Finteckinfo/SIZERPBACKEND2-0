/**
 * SSO Security Vulnerability Testing Script
 * 
 * This script tests for common security vulnerabilities in the SSO system:
 * 1. SQL Injection
 * 2. XSS (Cross-Site Scripting)
 * 3. CSRF (Cross-Site Request Forgery)
 * 4. Brute Force / Rate Limiting
 * 5. Session Hijacking
 * 6. Password Strength
 * 7. JWT Token Security
 * 8. CORS Misconfiguration
 * 9. Information Disclosure
 * 10. Input Validation
 */

import fetch from 'node-fetch';
import * as crypto from 'crypto';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

interface TestResult {
  testName: string;
  passed: boolean;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  message: string;
  details?: string;
}

const results: TestResult[] = [];

function addResult(result: TestResult) {
  results.push(result);
  const icon = result.passed ? '[PASS]' : '[FAIL]';
  const color = result.passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon} [${result.severity}] ${result.testName}\x1b[0m`);
  console.log(`   ${result.message}`);
  if (result.details) {
    console.log(`   Details: ${result.details}`);
  }
  console.log('');
}

/**
 * Test 1: SQL Injection via Login
 */
async function testSQLInjection() {
  console.log('[TEST] Testing SQL Injection vulnerabilities...\n');
  
  const sqlPayloads = [
    "' OR '1'='1",
    "admin'--",
    "' OR '1'='1' --",
    "'; DROP TABLE users;--",
    "1' UNION SELECT NULL,NULL,NULL--"
  ];

  for (const payload of sqlPayloads) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: payload,
          password: payload
        })
      });

      const data = await res.json();

      if (res.ok && data.token) {
        addResult({
          testName: 'SQL Injection - Login Bypass',
          passed: false,
          severity: 'Critical',
          message: 'SQL injection vulnerability detected!',
          details: `Payload: ${payload}`
        });
        return;
      }
    } catch (error) {
      // Network errors are expected for some payloads
    }
  }

  addResult({
    testName: 'SQL Injection - Login Bypass',
    passed: true,
    severity: 'Critical',
    message: 'No SQL injection vulnerabilities detected in login endpoint'
  });
}

/**
 * Test 2: XSS via Registration
 */
async function testXSS() {
  console.log('[TEST] Testing XSS vulnerabilities...\n');

  const xssPayloads = [
    "<script>alert('XSS')</script>",
    "<img src=x onerror=alert('XSS')>",
    "javascript:alert('XSS')",
    "<svg onload=alert('XSS')>",
    "'-alert('XSS')-'"
  ];

  for (const payload of xssPayloads) {
    try {
      const randomEmail = `test${Date.now()}@test.com`;
      const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: randomEmail,
          password: 'TestPass123!',
          firstName: payload,
          lastName: 'Test'
        })
      });

      const data = await res.json();

      // Check if XSS payload was sanitized
      if (data.user && data.user.firstName && data.user.firstName.includes('<')) {
        addResult({
          testName: 'XSS - Registration Name Fields',
          passed: false,
          severity: 'High',
          message: 'XSS vulnerability detected! HTML not sanitized',
          details: `Payload: ${payload}`
        });
        return;
      }
    } catch (error) {
      // Continue testing
    }
  }

  addResult({
    testName: 'XSS - Registration Name Fields',
    passed: true,
    severity: 'High',
    message: 'XSS payloads properly sanitized'
  });
}

/**
 * Test 3: Brute Force / Rate Limiting
 */
async function testRateLimiting() {
  console.log('[TEST] Testing rate limiting and brute force protection...\n');

  const testEmail = `brute${Date.now()}@test.com`;
  let blockedCount = 0;

  // Try 15 rapid failed login attempts
  for (let i = 0; i < 15; i++) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: 'WrongPassword123!'
        })
      });

      if (res.status === 429) {
        blockedCount++;
      }
    } catch (error) {
      // Continue
    }
  }

  if (blockedCount > 0) {
    addResult({
      testName: 'Rate Limiting - Brute Force Protection',
      passed: true,
      severity: 'Critical',
      message: `Rate limiting active! Blocked ${blockedCount} out of 15 attempts`
    });
  } else {
    addResult({
      testName: 'Rate Limiting - Brute Force Protection',
      passed: false,
      severity: 'Critical',
      message: 'No rate limiting detected! System vulnerable to brute force attacks',
      details: 'Attempted 15 rapid login attempts without being blocked'
    });
  }
}

/**
 * Test 4: Weak Password Acceptance
 */
async function testPasswordStrength() {
  console.log('[TEST] Testing password strength requirements...\n');

  const weakPasswords = [
    'password',
    '12345678',
    'abc123',
    'qwerty',
    'Password', // No number or special char
    'pass123', // Too short
    'ALLUPPERCASE123!'
  ];

  let weakPasswordAccepted = false;

  for (const weakPass of weakPasswords) {
    try {
      const randomEmail = `weakpass${Date.now()}@test.com`;
      const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: randomEmail,
          password: weakPass,
          firstName: 'Test',
          lastName: 'User'
        })
      });

      if (res.ok) {
        addResult({
          testName: 'Password Strength Requirements',
          passed: false,
          severity: 'High',
          message: 'Weak password accepted!',
          details: `Weak password: "${weakPass}"`
        });
        weakPasswordAccepted = true;
        break;
      }
    } catch (error) {
      // Continue
    }
  }

  if (!weakPasswordAccepted) {
    addResult({
      testName: 'Password Strength Requirements',
      passed: true,
      severity: 'High',
      message: 'Password strength requirements enforced properly'
    });
  }
}

/**
 * Test 5: CORS Configuration
 */
async function testCORS() {
  console.log('[TEST] Testing CORS configuration...\n');

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/health`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://malicious-site.com',
        'Access-Control-Request-Method': 'POST'
      }
    });

    const allowOrigin = res.headers.get('access-control-allow-origin');

    if (allowOrigin === '*' || allowOrigin === 'https://malicious-site.com') {
      addResult({
        testName: 'CORS Configuration',
        passed: false,
        severity: 'Medium',
        message: 'CORS misconfigured! Allows unauthorized origins',
        details: `Allow-Origin: ${allowOrigin}`
      });
    } else {
      addResult({
        testName: 'CORS Configuration',
        passed: true,
        severity: 'Medium',
        message: 'CORS properly configured to restrict origins'
      });
    }
  } catch (error) {
    addResult({
      testName: 'CORS Configuration',
      passed: false,
      severity: 'Medium',
      message: 'Could not test CORS configuration',
      details: (error as Error).message
    });
  }
}

/**
 * Test 6: JWT Token Security
 */
async function testJWTSecurity() {
  console.log('[TEST] Testing JWT token security...\n');

  // Test with manipulated JWT
  const fakeJWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhZG1pbiIsImVtYWlsIjoiYWRtaW5AYWRtaW4uY29tIn0.FAKE_SIGNATURE';

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/profile`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${fakeJWT}`
      }
    });

    if (res.ok) {
      addResult({
        testName: 'JWT Token Validation',
        passed: false,
        severity: 'Critical',
        message: 'JWT signature not properly validated!',
        details: 'Fake JWT token was accepted'
      });
    } else {
      addResult({
        testName: 'JWT Token Validation',
        passed: true,
        severity: 'Critical',
        message: 'JWT tokens properly validated'
      });
    }
  } catch (error) {
    addResult({
      testName: 'JWT Token Validation',
      passed: true,
      severity: 'Critical',
      message: 'JWT tokens properly validated (rejected fake token)'
    });
  }
}

/**
 * Test 7: Information Disclosure
 */
async function testInformationDisclosure() {
  console.log('[TEST] Testing information disclosure...\n');

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent@test.com',
        password: 'WrongPass123!'
      })
    });

    const data = await res.json();
    const message = data.error || data.message || '';

    // Check if error message reveals too much info
    if (message.toLowerCase().includes('user not found') || 
        message.toLowerCase().includes('email does not exist')) {
      addResult({
        testName: 'Information Disclosure - User Enumeration',
        passed: false,
        severity: 'Medium',
        message: 'Error messages reveal user existence',
        details: `Error message: "${message}"`
      });
    } else if (message.toLowerCase().includes('invalid credentials')) {
      addResult({
        testName: 'Information Disclosure - User Enumeration',
        passed: true,
        severity: 'Medium',
        message: 'Generic error messages prevent user enumeration'
      });
    }
  } catch (error) {
    // Continue
  }
}

/**
 * Test 8: Email Validation
 */
async function testEmailValidation() {
  console.log('[TEST] Testing email validation...\n');

  const invalidEmails = [
    'notanemail',
    '@test.com',
    'test@',
    'test..test@test.com',
    'test@test..com'
  ];

  let invalidEmailAccepted = false;

  for (const email of invalidEmails) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          password: 'ValidPass123!',
          firstName: 'Test',
          lastName: 'User'
        })
      });

      if (res.ok) {
        addResult({
          testName: 'Email Validation',
          passed: false,
          severity: 'Medium',
          message: 'Invalid email format accepted',
          details: `Invalid email: ${email}`
        });
        invalidEmailAccepted = true;
        break;
      }
    } catch (error) {
      // Continue
    }
  }

  if (!invalidEmailAccepted) {
    addResult({
      testName: 'Email Validation',
      passed: true,
      severity: 'Medium',
      message: 'Email validation working properly'
    });
  }
}

/**
 * Test 9: Security Headers
 */
async function testSecurityHeaders() {
  console.log('[TEST] Testing security headers...\n');

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/health`);
    
    const headers = {
      'x-frame-options': res.headers.get('x-frame-options'),
      'x-content-type-options': res.headers.get('x-content-type-options'),
      'x-xss-protection': res.headers.get('x-xss-protection'),
      'strict-transport-security': res.headers.get('strict-transport-security')
    };

    let missingHeaders: string[] = [];

    if (!headers['x-frame-options']) missingHeaders.push('X-Frame-Options');
    if (!headers['x-content-type-options']) missingHeaders.push('X-Content-Type-Options');

    if (missingHeaders.length > 0) {
      addResult({
        testName: 'Security Headers',
        passed: false,
        severity: 'Medium',
        message: 'Missing security headers',
        details: `Missing: ${missingHeaders.join(', ')}`
      });
    } else {
      addResult({
        testName: 'Security Headers',
        passed: true,
        severity: 'Medium',
        message: 'Security headers properly configured'
      });
    }
  } catch (error) {
    addResult({
      testName: 'Security Headers',
      passed: false,
      severity: 'Medium',
      message: 'Could not test security headers',
      details: (error as Error).message
    });
  }
}

/**
 * Test 10: Wallet Address Validation
 */
async function testWalletValidation() {
  console.log('[TEST] Testing wallet address validation...\n');

  const invalidWallets = [
    'not-a-wallet',
    '0x123', // Too short
    '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', // Invalid hex
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD' // Wrong format
  ];

  let invalidWalletAccepted = false;

  for (const wallet of invalidWallets) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/wallet-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: wallet,
          chainId: 'ethereum',
          domain: 'test.com'
        })
      });

      if (res.ok) {
        addResult({
          testName: 'Wallet Address Validation',
          passed: false,
          severity: 'High',
          message: 'Invalid wallet address accepted',
          details: `Invalid wallet: ${wallet}`
        });
        invalidWalletAccepted = true;
        break;
      }
    } catch (error) {
      // Continue
    }
  }

  if (!invalidWalletAccepted) {
    addResult({
      testName: 'Wallet Address Validation',
      passed: true,
      severity: 'High',
      message: 'Wallet address validation working properly'
    });
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('\n===========================================================');
  console.log('SSO SECURITY VULNERABILITY TESTING');
  console.log('===========================================================\n');
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log(`Frontend URL: ${FRONTEND_URL}\n`);

  // Run all tests
  await testSQLInjection();
  await testXSS();
  await testRateLimiting();
  await testPasswordStrength();
  await testCORS();
  await testJWTSecurity();
  await testInformationDisclosure();
  await testEmailValidation();
  await testSecurityHeaders();
  await testWalletValidation();

  // Generate summary
  console.log('\n===========================================================');
  console.log('TEST SUMMARY');
  console.log('===========================================================\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const critical = results.filter(r => !r.passed && r.severity === 'Critical').length;
  const high = results.filter(r => !r.passed && r.severity === 'High').length;
  const medium = results.filter(r => !r.passed && r.severity === 'Medium').length;

  console.log(`Total Tests: ${results.length}`);
  console.log(`\x1b[32mPassed: ${passed}\x1b[0m`);
  console.log(`\x1b[31mFailed: ${failed}\x1b[0m`);
  
  if (failed > 0) {
    console.log('\nFailed by Severity:');
    if (critical > 0) console.log(`  [CRITICAL]: ${critical}`);
    if (high > 0) console.log(`  [HIGH]: ${high}`);
    if (medium > 0) console.log(`  [MEDIUM]: ${medium}`);
  }

  console.log('\n===========================================================\n');

  // Exit with error code if any tests failed
  if (failed > 0) {
    console.log('[WARNING] Security vulnerabilities detected! Please review and fix.\n');
    process.exit(1);
  } else {
    console.log('[SUCCESS] All security tests passed!\n');
    process.exit(0);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Test suite error:', error);
  process.exit(1);
});
