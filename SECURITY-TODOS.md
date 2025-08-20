# Security TODOs for WebPods

This document tracks security improvements and considerations for the WebPods project.

## Current State (as of commit 467dd20)

The system uses simple JWT-based authentication with the following characteristics:
- JWT tokens are signed with a configurable secret
- Tokens include user_id, auth_id, email, name, provider, and optional pod claim
- Pod-specific tokens restrict access to specific pods
- Rate limiting is implemented per user/IP

## High Priority Security Items

### 1. Authentication & Authorization
- [ ] Add token refresh mechanism (currently tokens are long-lived)
- [ ] Implement token revocation/blacklist capability
- [ ] Add API key authentication option for programmatic access
- [ ] Consider implementing OAuth 2.0 for third-party integrations (future)

### 2. Input Validation & Sanitization
- [ ] Strengthen pod_id validation (DNS-compliant, reserved names)
- [ ] Add content size limits per stream/pod
- [ ] Validate and sanitize HTML content before serving
- [ ] Implement stricter name validation for records

### 3. Rate Limiting & DoS Protection
- [ ] Add per-pod rate limits
- [ ] Implement progressive rate limiting (stricter for anonymous users)
- [ ] Add request size limits
- [ ] Implement connection limits per IP

### 4. Data Protection
- [ ] Add encryption at rest for sensitive data
- [ ] Implement data retention policies
- [ ] Add audit logging for sensitive operations
- [ ] Consider implementing end-to-end encryption for private streams

### 5. Infrastructure Security
- [ ] Add HTTPS enforcement (currently handled by proxy)
- [ ] Implement CORS properly (currently permissive)
- [ ] Add security headers (CSP, X-Frame-Options, etc.)
- [ ] Implement database connection pooling limits

### 6. Session Management
- [ ] Add session timeout configuration
- [ ] Implement secure session storage
- [ ] Add CSRF protection for web operations
- [ ] Implement session invalidation on password change

## Medium Priority Items

### 1. Monitoring & Alerting
- [ ] Add security event logging
- [ ] Implement anomaly detection
- [ ] Add failed authentication tracking
- [ ] Monitor for suspicious patterns

### 2. Compliance & Privacy
- [ ] Add GDPR compliance features (data export, deletion)
- [ ] Implement privacy controls
- [ ] Add terms of service acceptance tracking
- [ ] Document data handling practices

### 3. Testing & Validation
- [ ] Add security-focused test suite
- [ ] Implement penetration testing
- [ ] Add dependency vulnerability scanning
- [ ] Regular security audits

## Low Priority Items

### 1. Advanced Features
- [ ] Add two-factor authentication
- [ ] Implement IP allowlisting for pods
- [ ] Add webhook security for integrations
- [ ] Consider implementing zero-knowledge architecture

### 2. Documentation
- [ ] Create security best practices guide
- [ ] Document threat model
- [ ] Add security configuration guide
- [ ] Create incident response plan

## Configuration Recommendations

### Production Deployment
1. Always use strong JWT_SECRET (min 32 characters)
2. Configure proper CORS origins
3. Use HTTPS exclusively
4. Enable rate limiting
5. Regular security updates
6. Monitor logs for suspicious activity

### Environment Variables
- `JWT_SECRET`: Must be cryptographically random
- `SESSION_SECRET`: Must be cryptographically random
- `CORS_ORIGIN`: Restrict to specific domains
- `RATE_LIMIT_*`: Configure based on expected usage

## Known Limitations

1. No built-in HTTPS (requires reverse proxy)
2. JWT tokens cannot be revoked before expiry
3. No built-in backup/recovery mechanism
4. Limited audit trail capabilities

## Future Considerations

1. **OAuth 2.0 Integration**: Consider adding OAuth 2.0 support for enterprise SSO
2. **Multi-tenancy**: Improve isolation between pods
3. **Encryption**: Add support for encrypted streams
4. **Compliance**: Build in compliance features from the start

## Security Contact

For security issues, please email: [security contact to be added]

---

*Last updated: Current commit (pre-OAuth improvements)*
*Reference commit: 467dd20*