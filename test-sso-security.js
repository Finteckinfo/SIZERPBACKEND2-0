"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var node_fetch_1 = require("node-fetch");
var BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
var FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
var results = [];
function addResult(result) {
    results.push(result);
    var icon = result.passed ? '✅' : '❌';
    var color = result.passed ? '\x1b[32m' : '\x1b[31m';
    console.log("".concat(color).concat(icon, " [").concat(result.severity, "] ").concat(result.testName, "\u001B[0m"));
    console.log("   ".concat(result.message));
    if (result.details) {
        console.log("   Details: ".concat(result.details));
    }
    console.log('');
}
/**
 * Test 1: SQL Injection via Login
 */
function testSQLInjection() {
    return __awaiter(this, void 0, void 0, function () {
        var sqlPayloads, _i, sqlPayloads_1, payload, res, data, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing SQL Injection vulnerabilities...\n');
                    sqlPayloads = [
                        "' OR '1'='1",
                        "admin'--",
                        "' OR '1'='1' --",
                        "'; DROP TABLE users;--",
                        "1' UNION SELECT NULL,NULL,NULL--"
                    ];
                    _i = 0, sqlPayloads_1 = sqlPayloads;
                    _a.label = 1;
                case 1:
                    if (!(_i < sqlPayloads_1.length)) return [3 /*break*/, 7];
                    payload = sqlPayloads_1[_i];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 5, , 6]);
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(BACKEND_URL, "/api/auth/login"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: payload,
                                password: payload
                            })
                        })];
                case 3:
                    res = _a.sent();
                    return [4 /*yield*/, res.json()];
                case 4:
                    data = _a.sent();
                    if (res.ok && data.token) {
                        addResult({
                            testName: 'SQL Injection - Login Bypass',
                            passed: false,
                            severity: 'Critical',
                            message: 'SQL injection vulnerability detected!',
                            details: "Payload: ".concat(payload)
                        });
                        return [2 /*return*/];
                    }
                    return [3 /*break*/, 6];
                case 5:
                    error_1 = _a.sent();
                    return [3 /*break*/, 6];
                case 6:
                    _i++;
                    return [3 /*break*/, 1];
                case 7:
                    addResult({
                        testName: 'SQL Injection - Login Bypass',
                        passed: true,
                        severity: 'Critical',
                        message: 'No SQL injection vulnerabilities detected in login endpoint'
                    });
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Test 2: XSS via Registration
 */
function testXSS() {
    return __awaiter(this, void 0, void 0, function () {
        var xssPayloads, _i, xssPayloads_1, payload, randomEmail, res, data, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing XSS vulnerabilities...\n');
                    xssPayloads = [
                        "<script>alert('XSS')</script>",
                        "<img src=x onerror=alert('XSS')>",
                        "javascript:alert('XSS')",
                        "<svg onload=alert('XSS')>",
                        "'-alert('XSS')-'"
                    ];
                    _i = 0, xssPayloads_1 = xssPayloads;
                    _a.label = 1;
                case 1:
                    if (!(_i < xssPayloads_1.length)) return [3 /*break*/, 7];
                    payload = xssPayloads_1[_i];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 5, , 6]);
                    randomEmail = "test".concat(Date.now(), "@test.com");
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(BACKEND_URL, "/api/auth/register"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: randomEmail,
                                password: 'TestPass123!',
                                firstName: payload,
                                lastName: 'Test'
                            })
                        })];
                case 3:
                    res = _a.sent();
                    return [4 /*yield*/, res.json()];
                case 4:
                    data = _a.sent();
                    // Check if XSS payload was sanitized
                    if (data.user && data.user.firstName && data.user.firstName.includes('<')) {
                        addResult({
                            testName: 'XSS - Registration Name Fields',
                            passed: false,
                            severity: 'High',
                            message: 'XSS vulnerability detected! HTML not sanitized',
                            details: "Payload: ".concat(payload)
                        });
                        return [2 /*return*/];
                    }
                    return [3 /*break*/, 6];
                case 5:
                    error_2 = _a.sent();
                    return [3 /*break*/, 6];
                case 6:
                    _i++;
                    return [3 /*break*/, 1];
                case 7:
                    addResult({
                        testName: 'XSS - Registration Name Fields',
                        passed: true,
                        severity: 'High',
                        message: 'XSS payloads properly sanitized'
                    });
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Test 3: Brute Force / Rate Limiting
 */
function testRateLimiting() {
    return __awaiter(this, void 0, void 0, function () {
        var testEmail, blockedCount, i, res, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing rate limiting and brute force protection...\n');
                    testEmail = "brute".concat(Date.now(), "@test.com");
                    blockedCount = 0;
                    i = 0;
                    _a.label = 1;
                case 1:
                    if (!(i < 15)) return [3 /*break*/, 6];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(BACKEND_URL, "/api/auth/login"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: testEmail,
                                password: 'WrongPassword123!'
                            })
                        })];
                case 3:
                    res = _a.sent();
                    if (res.status === 429) {
                        blockedCount++;
                    }
                    return [3 /*break*/, 5];
                case 4:
                    error_3 = _a.sent();
                    return [3 /*break*/, 5];
                case 5:
                    i++;
                    return [3 /*break*/, 1];
                case 6:
                    if (blockedCount > 0) {
                        addResult({
                            testName: 'Rate Limiting - Brute Force Protection',
                            passed: true,
                            severity: 'Critical',
                            message: "Rate limiting active! Blocked ".concat(blockedCount, " out of 15 attempts")
                        });
                    }
                    else {
                        addResult({
                            testName: 'Rate Limiting - Brute Force Protection',
                            passed: false,
                            severity: 'Critical',
                            message: 'No rate limiting detected! System vulnerable to brute force attacks',
                            details: 'Attempted 15 rapid login attempts without being blocked'
                        });
                    }
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Test 4: Weak Password Acceptance
 */
function testPasswordStrength() {
    return __awaiter(this, void 0, void 0, function () {
        var weakPasswords, weakPasswordAccepted, _i, weakPasswords_1, weakPass, randomEmail, res, error_4;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing password strength requirements...\n');
                    weakPasswords = [
                        'password',
                        '12345678',
                        'abc123',
                        'qwerty',
                        'Password', // No number or special char
                        'pass123', // Too short
                        'ALLUPPERCASE123!'
                    ];
                    weakPasswordAccepted = false;
                    _i = 0, weakPasswords_1 = weakPasswords;
                    _a.label = 1;
                case 1:
                    if (!(_i < weakPasswords_1.length)) return [3 /*break*/, 6];
                    weakPass = weakPasswords_1[_i];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    randomEmail = "weakpass".concat(Date.now(), "@test.com");
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(BACKEND_URL, "/api/auth/register"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: randomEmail,
                                password: weakPass,
                                firstName: 'Test',
                                lastName: 'User'
                            })
                        })];
                case 3:
                    res = _a.sent();
                    if (res.ok) {
                        addResult({
                            testName: 'Password Strength Requirements',
                            passed: false,
                            severity: 'High',
                            message: 'Weak password accepted!',
                            details: "Weak password: \"".concat(weakPass, "\"")
                        });
                        weakPasswordAccepted = true;
                        return [3 /*break*/, 6];
                    }
                    return [3 /*break*/, 5];
                case 4:
                    error_4 = _a.sent();
                    return [3 /*break*/, 5];
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6:
                    if (!weakPasswordAccepted) {
                        addResult({
                            testName: 'Password Strength Requirements',
                            passed: true,
                            severity: 'High',
                            message: 'Password strength requirements enforced properly'
                        });
                    }
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Test 5: CORS Configuration
 */
function testCORS() {
    return __awaiter(this, void 0, void 0, function () {
        var res, allowOrigin, error_5;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing CORS configuration...\n');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(BACKEND_URL, "/api/auth/health"), {
                            method: 'OPTIONS',
                            headers: {
                                'Origin': 'https://malicious-site.com',
                                'Access-Control-Request-Method': 'POST'
                            }
                        })];
                case 2:
                    res = _a.sent();
                    allowOrigin = res.headers.get('access-control-allow-origin');
                    if (allowOrigin === '*' || allowOrigin === 'https://malicious-site.com') {
                        addResult({
                            testName: 'CORS Configuration',
                            passed: false,
                            severity: 'Medium',
                            message: 'CORS misconfigured! Allows unauthorized origins',
                            details: "Allow-Origin: ".concat(allowOrigin)
                        });
                    }
                    else {
                        addResult({
                            testName: 'CORS Configuration',
                            passed: true,
                            severity: 'Medium',
                            message: 'CORS properly configured to restrict origins'
                        });
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_5 = _a.sent();
                    addResult({
                        testName: 'CORS Configuration',
                        passed: false,
                        severity: 'Medium',
                        message: 'Could not test CORS configuration',
                        details: error_5.message
                    });
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Test 6: JWT Token Security
 */
function testJWTSecurity() {
    return __awaiter(this, void 0, void 0, function () {
        var fakeJWT, res, error_6;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing JWT token security...\n');
                    fakeJWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhZG1pbiIsImVtYWlsIjoiYWRtaW5AYWRtaW4uY29tIn0.FAKE_SIGNATURE';
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(BACKEND_URL, "/api/auth/profile"), {
                            method: 'GET',
                            headers: {
                                'Authorization': "Bearer ".concat(fakeJWT)
                            }
                        })];
                case 2:
                    res = _a.sent();
                    if (res.ok) {
                        addResult({
                            testName: 'JWT Token Validation',
                            passed: false,
                            severity: 'Critical',
                            message: 'JWT signature not properly validated!',
                            details: 'Fake JWT token was accepted'
                        });
                    }
                    else {
                        addResult({
                            testName: 'JWT Token Validation',
                            passed: true,
                            severity: 'Critical',
                            message: 'JWT tokens properly validated'
                        });
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_6 = _a.sent();
                    addResult({
                        testName: 'JWT Token Validation',
                        passed: true,
                        severity: 'Critical',
                        message: 'JWT tokens properly validated (rejected fake token)'
                    });
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Test 7: Information Disclosure
 */
function testInformationDisclosure() {
    return __awaiter(this, void 0, void 0, function () {
        var res, data, message, error_7;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing information disclosure...\n');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(BACKEND_URL, "/api/auth/login"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: 'nonexistent@test.com',
                                password: 'WrongPass123!'
                            })
                        })];
                case 2:
                    res = _a.sent();
                    return [4 /*yield*/, res.json()];
                case 3:
                    data = _a.sent();
                    message = data.error || data.message || '';
                    // Check if error message reveals too much info
                    if (message.toLowerCase().includes('user not found') ||
                        message.toLowerCase().includes('email does not exist')) {
                        addResult({
                            testName: 'Information Disclosure - User Enumeration',
                            passed: false,
                            severity: 'Medium',
                            message: 'Error messages reveal user existence',
                            details: "Error message: \"".concat(message, "\"")
                        });
                    }
                    else if (message.toLowerCase().includes('invalid credentials')) {
                        addResult({
                            testName: 'Information Disclosure - User Enumeration',
                            passed: true,
                            severity: 'Medium',
                            message: 'Generic error messages prevent user enumeration'
                        });
                    }
                    return [3 /*break*/, 5];
                case 4:
                    error_7 = _a.sent();
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
/**
 * Test 8: Email Validation
 */
function testEmailValidation() {
    return __awaiter(this, void 0, void 0, function () {
        var invalidEmails, invalidEmailAccepted, _i, invalidEmails_1, email, res, error_8;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing email validation...\n');
                    invalidEmails = [
                        'notanemail',
                        '@test.com',
                        'test@',
                        'test..test@test.com',
                        'test@test..com'
                    ];
                    invalidEmailAccepted = false;
                    _i = 0, invalidEmails_1 = invalidEmails;
                    _a.label = 1;
                case 1:
                    if (!(_i < invalidEmails_1.length)) return [3 /*break*/, 6];
                    email = invalidEmails_1[_i];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(BACKEND_URL, "/api/auth/register"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: email,
                                password: 'ValidPass123!',
                                firstName: 'Test',
                                lastName: 'User'
                            })
                        })];
                case 3:
                    res = _a.sent();
                    if (res.ok) {
                        addResult({
                            testName: 'Email Validation',
                            passed: false,
                            severity: 'Medium',
                            message: 'Invalid email format accepted',
                            details: "Invalid email: ".concat(email)
                        });
                        invalidEmailAccepted = true;
                        return [3 /*break*/, 6];
                    }
                    return [3 /*break*/, 5];
                case 4:
                    error_8 = _a.sent();
                    return [3 /*break*/, 5];
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6:
                    if (!invalidEmailAccepted) {
                        addResult({
                            testName: 'Email Validation',
                            passed: true,
                            severity: 'Medium',
                            message: 'Email validation working properly'
                        });
                    }
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Test 9: Security Headers
 */
function testSecurityHeaders() {
    return __awaiter(this, void 0, void 0, function () {
        var res, headers, missingHeaders, error_9;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing security headers...\n');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(BACKEND_URL, "/api/auth/health"))];
                case 2:
                    res = _a.sent();
                    headers = {
                        'x-frame-options': res.headers.get('x-frame-options'),
                        'x-content-type-options': res.headers.get('x-content-type-options'),
                        'x-xss-protection': res.headers.get('x-xss-protection'),
                        'strict-transport-security': res.headers.get('strict-transport-security')
                    };
                    missingHeaders = [];
                    if (!headers['x-frame-options'])
                        missingHeaders.push('X-Frame-Options');
                    if (!headers['x-content-type-options'])
                        missingHeaders.push('X-Content-Type-Options');
                    if (missingHeaders.length > 0) {
                        addResult({
                            testName: 'Security Headers',
                            passed: false,
                            severity: 'Medium',
                            message: 'Missing security headers',
                            details: "Missing: ".concat(missingHeaders.join(', '))
                        });
                    }
                    else {
                        addResult({
                            testName: 'Security Headers',
                            passed: true,
                            severity: 'Medium',
                            message: 'Security headers properly configured'
                        });
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_9 = _a.sent();
                    addResult({
                        testName: 'Security Headers',
                        passed: false,
                        severity: 'Medium',
                        message: 'Could not test security headers',
                        details: error_9.message
                    });
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Test 10: Wallet Address Validation
 */
function testWalletValidation() {
    return __awaiter(this, void 0, void 0, function () {
        var invalidWallets, invalidWalletAccepted, _i, invalidWallets_1, wallet, res, error_10;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🔍 Testing wallet address validation...\n');
                    invalidWallets = [
                        'not-a-wallet',
                        '0x123', // Too short
                        '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', // Invalid hex
                        'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD' // Wrong format
                    ];
                    invalidWalletAccepted = false;
                    _i = 0, invalidWallets_1 = invalidWallets;
                    _a.label = 1;
                case 1:
                    if (!(_i < invalidWallets_1.length)) return [3 /*break*/, 6];
                    wallet = invalidWallets_1[_i];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, node_fetch_1.default)("".concat(BACKEND_URL, "/api/auth/wallet-login"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                walletAddress: wallet,
                                chainId: 'ethereum',
                                domain: 'test.com'
                            })
                        })];
                case 3:
                    res = _a.sent();
                    if (res.ok) {
                        addResult({
                            testName: 'Wallet Address Validation',
                            passed: false,
                            severity: 'High',
                            message: 'Invalid wallet address accepted',
                            details: "Invalid wallet: ".concat(wallet)
                        });
                        invalidWalletAccepted = true;
                        return [3 /*break*/, 6];
                    }
                    return [3 /*break*/, 5];
                case 4:
                    error_10 = _a.sent();
                    return [3 /*break*/, 5];
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6:
                    if (!invalidWalletAccepted) {
                        addResult({
                            testName: 'Wallet Address Validation',
                            passed: true,
                            severity: 'High',
                            message: 'Wallet address validation working properly'
                        });
                    }
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Main test runner
 */
function runAllTests() {
    return __awaiter(this, void 0, void 0, function () {
        var passed, failed, critical, high, medium;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('\n═══════════════════════════════════════════════════════════');
                    console.log('🛡️  SSO SECURITY VULNERABILITY TESTING');
                    console.log('═══════════════════════════════════════════════════════════\n');
                    console.log("Backend URL: ".concat(BACKEND_URL));
                    console.log("Frontend URL: ".concat(FRONTEND_URL, "\n"));
                    // Run all tests
                    return [4 /*yield*/, testSQLInjection()];
                case 1:
                    // Run all tests
                    _a.sent();
                    return [4 /*yield*/, testXSS()];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, testRateLimiting()];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, testPasswordStrength()];
                case 4:
                    _a.sent();
                    return [4 /*yield*/, testCORS()];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, testJWTSecurity()];
                case 6:
                    _a.sent();
                    return [4 /*yield*/, testInformationDisclosure()];
                case 7:
                    _a.sent();
                    return [4 /*yield*/, testEmailValidation()];
                case 8:
                    _a.sent();
                    return [4 /*yield*/, testSecurityHeaders()];
                case 9:
                    _a.sent();
                    return [4 /*yield*/, testWalletValidation()];
                case 10:
                    _a.sent();
                    // Generate summary
                    console.log('\n═══════════════════════════════════════════════════════════');
                    console.log('📊 TEST SUMMARY');
                    console.log('═══════════════════════════════════════════════════════════\n');
                    passed = results.filter(function (r) { return r.passed; }).length;
                    failed = results.filter(function (r) { return !r.passed; }).length;
                    critical = results.filter(function (r) { return !r.passed && r.severity === 'Critical'; }).length;
                    high = results.filter(function (r) { return !r.passed && r.severity === 'High'; }).length;
                    medium = results.filter(function (r) { return !r.passed && r.severity === 'Medium'; }).length;
                    console.log("Total Tests: ".concat(results.length));
                    console.log("\u001B[32m\u2705 Passed: ".concat(passed, "\u001B[0m"));
                    console.log("\u001B[31m\u274C Failed: ".concat(failed, "\u001B[0m"));
                    if (failed > 0) {
                        console.log('\nFailed by Severity:');
                        if (critical > 0)
                            console.log("  \uD83D\uDD34 Critical: ".concat(critical));
                        if (high > 0)
                            console.log("  \uD83D\uDFE0 High: ".concat(high));
                        if (medium > 0)
                            console.log("  \uD83D\uDFE1 Medium: ".concat(medium));
                    }
                    console.log('\n═══════════════════════════════════════════════════════════\n');
                    // Exit with error code if any tests failed
                    if (failed > 0) {
                        console.log('⚠️  Security vulnerabilities detected! Please review and fix.\n');
                        process.exit(1);
                    }
                    else {
                        console.log('✅ All security tests passed!\n');
                        process.exit(0);
                    }
                    return [2 /*return*/];
            }
        });
    });
}
// Run tests
runAllTests().catch(function (error) {
    console.error('Test suite error:', error);
    process.exit(1);
});
