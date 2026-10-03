# Security Test Suite

**CRITICAL:** All tests in this directory MUST pass before inviting users.

## Test Categories

### 1. Compiler Security (`test_compiler_security.py`)
- Shell-escape attempts (`\write18`, `\immediate\write18`)
- Path traversal (`\input{/etc/passwd}`, `../../../`)
- Symlink attacks in ZIP files
- Resource exhaustion (infinite loops, memory bombs)

### 2. File Upload Security (`test_upload_security.py`)
- ZIP bomb detection
- ZIP-slip (path traversal in archives)
- Malicious file extensions
- File size limits
- Content-type validation

### 3. Authentication & Authorization (`test_auth.py`)
- JWT validation (signature, expiration, issuer)
- Cross-user access prevention
- Role-based access control
- WebSocket ticket validation
- Replay attack prevention

### 4. API Security (`test_api_security.py`)
- Rate limiting enforcement
- SQL injection prevention
- XSS prevention in error messages
- CORS policy enforcement
- CSRF protection (Bearer token only)

## Running Tests

```bash
# Run all security tests
cd apps/api
pytest tests/security/ -v

# Run specific test file
pytest tests/security/test_compiler_security.py -v

# Run with coverage
pytest tests/security/ --cov=app --cov-report=html
```

## CI Integration

These tests run automatically on every PR via GitHub Actions (`.github/workflows/ci.yml`).

**Pull requests cannot be merged if security tests fail.**

## Adding New Tests

When adding security-sensitive features:

1. Add test to appropriate file (or create new one)
2. Mark as `@pytest.mark.security`
3. Document attack scenario in docstring
4. Ensure test fails before fix, passes after

Example:

```python
@pytest.mark.security
def test_prevents_attack_vector():
    """
    Tests that the system blocks [specific attack].
    
    Attack scenario:
    1. Attacker does X
    2. System should respond with Y
    3. Attack is blocked because Z
    """
    # Test implementation
    pass
```

## Test Requirements

- **Isolated**: Tests don't depend on each other
- **Fast**: Each test completes in < 5 seconds
- **Clear**: Failure message explains what broke
- **Reproducible**: Same input always gives same result

## Before Launch Checklist

Run this checklist before inviting users:

```bash
# 1. All security tests pass
pytest tests/security/ -v
# Expected: 100% pass rate

# 2. No secrets in logs
grep -r "token\|password\|secret" apps/api/app/*.log
# Expected: no matches

# 3. Gitleaks scan clean
gitleaks detect --source . --verbose
# Expected: no leaks found

# 4. Manual penetration test
# - Try to compile malicious LaTeX
# - Try to access another user's project
# - Try to bypass rate limits
# - Try to exploit file uploads

# 5. Backup restoration tested
# See docs/DISASTER_RECOVERY.md
```

## Known Limitations

These are NOT vulnerabilities, but architectural constraints:

1. **Render free tier sleeps**: 15min idle = cold start
2. **No DOS protection**: Redis free tier limited
3. **Shared DB**: All data in one Neon database
4. **No audit trail encryption**: Logs in plaintext
5. **No 2FA**: Clerk handles auth, 2FA is paid tier

Document any new limitations here.

## Reporting Security Issues

If you find a vulnerability:

1. **Do NOT open a public issue**
2. Email security@likhitex.app (private inbox)
3. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Impact assessment
   - Suggested fix (if any)

We'll respond within 48 hours.

## Security Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [TeX Security](https://tex.stackexchange.com/questions/tagged/security)
- [Docker Security](https://docs.docker.com/engine/security/)
