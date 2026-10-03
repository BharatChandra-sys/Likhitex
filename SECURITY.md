# Security Policy

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in Likhitex, please report it privately to the maintainers through one of these channels:

1. **Email**: Send details to [security@likhitex.org] (preferred)
2. **Private Issue**: Contact a maintainer directly for a private disclosure

### What to Include

When reporting a security vulnerability, please include:

- **Description**: Clear description of the vulnerability
- **Impact**: Potential impact and severity assessment
- **Reproduction**: Step-by-step instructions to reproduce the issue
- **Environment**: Relevant version information (commit hash, deployment environment)
- **Proof of Concept**: Code or configuration demonstrating the vulnerability (if applicable)
- **Suggested Fix**: Proposed remediation (optional but appreciated)

### Response Timeline

- **Initial Response**: Within 48 hours of report submission
- **Assessment**: Severity and impact evaluation within 5 business days
- **Fix Timeline**: Critical vulnerabilities patched within 7 days, others within 30 days
- **Disclosure**: Coordinated disclosure after patch deployment

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| < main  | :x:                |

We only support the latest commit on the `main` branch. Ensure you're running the current version before reporting vulnerabilities.

## Security Measures

### Compilation Security

Likhitex treats LaTeX compilation as code execution and implements defense-in-depth:

#### Container Isolation
- Docker containers with gVisor runtime for additional kernel protection
- `--network none` flag prevents all network access
- `--read-only` filesystem with tmpfs mounts for scratch space
- `--cap-drop ALL` removes all Linux capabilities
- `--security-opt no-new-privileges` prevents privilege escalation
- Process, memory, and file descriptor limits via prlimit

#### TeX Configuration
- `shell_escape = f` in texmf.cnf (shell escape completely disabled)
- `openin_any = p` (paranoid mode for file reads)
- `openout_any = p` (paranoid mode for file writes)
- Read-only TeX Live installation
- Unprivileged user with clean environment (`env -i`)
- 60-second hard timeout with process group termination

#### Package Restrictions
- Explicit blocklist for packages requiring shell-escape:
  - `minted` (requires `--shell-escape`)
  - `pythontex` (executes Python code)
  - Any package with `\write18` usage
- Package installation disabled during compilation

### Input Validation

#### File Upload Security
- **Extension Allowlist**: `.tex`, `.bib`, `.sty`, `.cls`, `.bst`, `.png`, `.jpg`, `.jpeg`, `.pdf`, `.svg`, `.eps`, `.txt` only
- **File Size Limits**:
  - Per-file maximum: 10 MB
  - Per-project maximum: 50 MB
  - Per-user storage quota: 50 MB
- **Content Validation**: MIME type verification for binary files

#### ZIP Archive Security
- **Path Traversal Prevention**: Reject paths containing `../`, absolute paths, or directory escape attempts
- **Symlink Detection**: All symbolic links in archives are rejected
- **Zip Bomb Protection**:
  - Maximum uncompressed size: 100 MB
  - Maximum file count: 1000 files
  - Compression ratio limits
- **Filename Validation**: Alphanumeric characters, hyphens, underscores, dots, and forward slashes only

### Authentication & Authorization

#### User Authentication
- **Clerk Integration**: OAuth-based authentication with email verification
- **JWT Validation**: RS256 signature verification on every API request
- **Token Claims**: Verify `iss`, `azp`, `exp`, `nbf` claims
- **JWKS Rotation**: Automatic key rotation support
- **Invite-Only Enforcement**: Backend validates user email against `allowed_emails` table

#### Project Authorization
- **Role-Based Access Control**:
  - **Owner**: Full control including deletion and member management
  - **Editor**: Read/write access to project files
  - **Viewer**: Read-only access to project files
- **Permission Checks**: Authorization verified on every endpoint and WebSocket connection
- **Membership Validation**: User-project relationships enforced at database level

#### WebSocket Security
- **Ticket-Based Authentication**: One-time use tickets with 30-second TTL
- **Ticket Generation**: `POST /api/collab/projects/{id}/ws-ticket` (requires Bearer token)
- **Ticket Storage**: Redis with automatic expiration (`EX 30`)
- **Origin Validation**: Check `Origin` header on WebSocket upgrade
- **Connection Limits**: Maximum 5 concurrent connections per user
- **Message Size Limit**: 1 MB maximum message size

### Rate Limiting

All rate limits are enforced using Upstash Redis with sliding window counters:

| Endpoint | Per-User Limit | Global Limit |
|----------|----------------|--------------|
| `/api/compile/*` | 10/min | 50/min |
| `/api/auth/*` | 20/min | 100/min |
| `/api/projects/*/files` (POST) | 50/min | 200/min |
| WebSocket connections | 5 concurrent | 100 concurrent |
| All other endpoints | 100/min | 500/min |

### Data Protection

#### Secrets Management
- **Environment Variables**: All secrets stored in platform environment variables (Vercel, Render)
- **Secret Isolation**: Clerk secret key only available to API service, never to frontend or compiler
- **No Hardcoded Secrets**: Automatic detection via `gitleaks` in CI pipeline
- **Database Credentials**: Connection strings with least-privilege roles

#### Database Security
- **Parameterized Queries**: SQLAlchemy ORM with automatic parameterization
- **TLS Connections**: Enforce SSL mode `require` for Neon Postgres
- **Connection Pooling**: Limited pool size (5 connections, 2 overflow) for free-tier memory constraints
- **Least Privilege**: Database role with minimal required permissions

#### Storage Security
- **Encrypted Transit**: TLS for all S3/R2 API calls
- **Access Control**: IAM-based bucket policies
- **Presigned URLs**: Time-limited access to stored files (5-minute expiration)
- **Content-Type Validation**: Serve files with correct MIME types and `X-Content-Type-Options: nosniff`

### Network Security

#### CORS Configuration
```python
allow_origins=["https://yourdomain.vercel.app"]  # Never "*"
allow_credentials=True
allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
allow_headers=["Authorization", "Content-Type", "X-Request-ID"]
expose_headers=["X-Total-Count", "X-Page"]
max_age=3600
```

#### CSP Headers (Vercel)
```
Content-Security-Policy: 
  default-src 'self'; 
  script-src 'self' 'unsafe-inline' https://clerk.*.com; 
  style-src 'self' 'unsafe-inline'; 
  img-src 'self' data: https:; 
  font-src 'self' data:; 
  connect-src 'self' https://clerk.*.com https://*.onrender.com https://*.r2.cloudflarestorage.com wss://*.onrender.com; 
  frame-ancestors 'none';
```

#### Additional Headers
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Logging & Monitoring

#### Audit Logging
All security-relevant events are logged with structured JSON:

- User authentication (login, logout, token refresh)
- Project operations (create, delete, share, unshare)
- File operations (upload, delete, rename)
- Compilation requests (initiated, completed, failed)
- Permission changes (role updates, member additions/removals)
- Failed authorization attempts

#### Log Format
```json
{
  "timestamp": "2026-10-03T14:32:01.234Z",
  "level": "INFO",
  "event": "project.shared",
  "user_id": "user_abc123",
  "project_id": "proj_xyz789",
  "target_user_id": "user_def456",
  "role": "editor",
  "request_id": "req_unique_id",
  "ip_address": "203.0.113.42"
}
```

#### What is NOT Logged
- JWT tokens or Bearer token values
- Document content or file contents
- Passwords or API keys
- Personally identifiable information beyond user IDs

### Backup & Recovery

#### Automated Backups
- **Frequency**: Daily at 02:00 UTC
- **Scope**: Full database dump (`pg_dump`) + R2 storage sync
- **Encryption**: `age` encryption with secure key storage
- **Retention**: 30 days of daily backups
- **Storage**: Separate R2 bucket with lifecycle policies

#### Backup Testing
- **Monthly Verification**: Automated restore to test environment
- **Restoration Time Objective (RTO)**: 4 hours
- **Recovery Point Objective (RPO)**: 24 hours
- **Documentation**: Full disaster recovery procedures in `docs/DISASTER_RECOVERY.md`

### Dependency Management

#### Automated Scanning
- **Python**: `pip-audit` runs in CI for every pull request
- **JavaScript**: `npm audit` runs in CI for every pull request
- **Dependabot**: Automated pull requests for dependency updates
- **Lock Files**: Committed to repository for reproducible builds

#### Update Policy
- **Critical Vulnerabilities**: Patched within 24 hours
- **High Severity**: Patched within 7 days
- **Medium/Low Severity**: Evaluated and patched during regular maintenance windows

## Security Test Suite

Likhitex includes an adversarial security test suite that must pass before any deployment:

### Compilation Attacks
- `\input{/etc/passwd}` (absolute path rejection)
- `\openin` with absolute paths
- `\immediate\write18{id}` (shell-escape attempts)
- `\usepackage{minted}` (blocked package detection)
- Infinite macro loops
- Runaway output generation
- Memory-exhausting documents

### File Upload Attacks
- Symlink injection in ZIP archives
- Zip-slip path traversal (`../../etc/passwd`)
- Zip bombs (highly compressed archives)
- Filename injection (newlines, null bytes)
- MIME type mismatches

### Authorization Bypasses
- User A requesting User B's project (should return 403)
- Missing JWT tokens (should return 401)
- Expired JWT tokens (should return 401)
- Wrong `iss` or `azp` claims in JWT
- WebSocket access without ticket
- Expired or replayed WebSocket tickets

### Run Tests Locally
```bash
cd apps/api
pytest tests/security/ -v
```

All tests must pass before deployment. Failures indicate critical security issues.

## Incident Response

### In Case of Security Incident

1. **Immediate Actions**:
   - Notify all maintainers immediately
   - Assess scope and impact
   - Contain the incident (disable affected users/features if necessary)

2. **Investigation**:
   - Review audit logs for the relevant time period
   - Identify compromised accounts or data
   - Determine root cause

3. **Remediation**:
   - Deploy fixes to production
   - Rotate any compromised credentials
   - Notify affected users (if applicable)

4. **Post-Incident**:
   - Document the incident and response
   - Update security measures to prevent recurrence
   - Conduct retrospective with team

### Emergency Contacts

- **Security Team**: [security@likhitex.org]
- **On-Call Maintainer**: Available through private team channels

## Security Disclosure Policy

### Responsible Disclosure

We request that security researchers:

- Allow reasonable time for vulnerabilities to be fixed before public disclosure
- Do not access or modify user data beyond what is necessary to demonstrate the vulnerability
- Do not perform testing on the production environment without prior authorization
- Provide detailed vulnerability information to assist with remediation

### Recognition

We appreciate security researchers who responsibly disclose vulnerabilities. With your permission, we will:

- Credit you in the release notes for the security fix
- Maintain a security acknowledgments file (`SECURITY_ACKNOWLEDGMENTS.md`)

## Compliance & Standards

### Standards Followed
- OWASP Top 10 (Web Application Security Risks)
- CWE Top 25 (Common Weakness Enumeration)
- NIST Cybersecurity Framework principles

### Regular Security Activities
- **Code Review**: All pull requests require review
- **Static Analysis**: Ruff, mypy, ESLint run on every commit
- **Dependency Audits**: Automated scanning on every pull request
- **Penetration Testing**: Annual external security assessment (planned)

## Additional Resources

- [Product Security Requirements](docs/tech.md#compile-security-highest-risk-component)
- [Disaster Recovery Procedures](docs/DISASTER_RECOVERY.md)
- [Development Guidelines](CONTRIBUTING.md#security-considerations)
- [Architecture Documentation](docs/tech.md)

---

**Last Updated**: October 2026  
**Version**: 1.0

For questions about this security policy, contact the maintainers through private channels.
