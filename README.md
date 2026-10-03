<div align="center">

# Likhitex

![Likhitex Logo](frontend/public/logo.png)

A private, invite-only collaborative LaTeX editor for trusted research groups and academic teams.

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/downloads/)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Required-blue.svg)](https://www.docker.com/)

</div>

## Overview

Likhitex is a real-time collaborative LaTeX editor built for small, trusted groups (up to 200 users). It provides an alternative to commercial LaTeX editors with enhanced control over infrastructure, security, and privacy.

**Key Characteristics:**

- No compile timeouts or artificial limits
- Unlimited collaborators per project  
- Self-hosted on your own infrastructure
- Enhanced security with sandboxed compilation
- Designed for free-tier hosting (zero operational cost)
- Invite-only access control

**Target Users:** Research groups, academic teams, students, and small organizations requiring private LaTeX collaboration without vendor dependencies.

## Features

### Core Functionality

- **Real-Time Collaboration**: Simultaneous multi-user editing with live cursor tracking and presence awareness (Yjs-powered CRDT synchronization)
- **Instant PDF Preview**: One-click compilation with fast feedback and inline error highlighting  
- **Project Management**: Complete file tree management, multi-file projects, ZIP import/export
- **Version Control**: Full document history with diff viewing and point-in-time restoration
- **Role-Based Access**: Granular project sharing with Owner, Editor, and Viewer permissions
- **Smart Compilation**: Automatic TeX engine detection (pdfLaTeX, XeLaTeX, LuaLaTeX) from document preamble

### Security Features

- **Sandboxed Compilation**: LaTeX execution in isolated Docker containers with gVisor runtime and zero network access
- **Invite-Only Access**: Backend-enforced email allowlist with Clerk authentication
- **Input Validation**: Comprehensive validation for path traversal, zip bombs, symlinks, and shell-escape attempts  
- **Rate Limiting**: Per-user and global rate limits on all API endpoints and compilation requests
- **Audit Logging**: Complete activity tracking for security compliance and debugging
- **Secrets Management**: Environment-based configuration with no hardcoded credentials

### Developer Experience

- **Modern Technology Stack**: Next.js 15, FastAPI, TypeScript, Python 3.12
- **Type Safety**: End-to-end type checking with TypeScript strict mode and Python type hints
- **Automated Testing**: Comprehensive unit tests, integration tests, and adversarial security test suite
- **CI/CD Pipeline**: GitHub Actions with linting, type checking, security scanning, and automated deployments
- **Complete Documentation**: Detailed guides for setup, deployment, security, and contribution workflows

## Architecture

Likhitex is built as a modern monorepo with clear separation of concerns:

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Next.js 15    │─────▶│   FastAPI API    │─────▶│ Neon Postgres   │
│   (Frontend)    │      │    (Backend)     │      │   (Database)    │
│   Vercel        │      │    Render        │      │   Free Tier     │
└─────────────────┘      └──────────────────┘      └─────────────────┘
         │                        │
         │                        │
         ▼                        ▼
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│     Clerk       │      │   Hocuspocus     │      │  Cloudflare R2  │
│     (Auth)      │      │  (WebSocket)     │      │   (Storage)     │
└─────────────────┘      └──────────────────┘      └─────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐      ┌─────────────────┐
                        │  TeX Live +      │      │  Upstash Redis  │
                        │  latexmk         │      │   (Cache)       │
                        │  (Compiler)      │      └─────────────────┘
                        └──────────────────┘
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | Next.js 15 + TypeScript | Server-side rendering, routing, UI |
| **Backend API** | FastAPI + Python 3.12 | REST API, authentication, business logic |
| **Database** | Neon Postgres | User data, projects, permissions |
| **File Storage** | Cloudflare R2 (S3-compatible) | Document storage, PDFs |
| **Cache/Queue** | Upstash Redis | Rate limiting, compile queue |
| **Authentication** | Clerk | User management, JWT tokens |
| **Collaboration** | Hocuspocus + Yjs | Real-time document sync |
| **LaTeX Compiler** | TeX Live + Docker + gVisor | Secure, sandboxed compilation |
| **Editor** | CodeMirror 6 | Code editing with LaTeX support |
| **PDF Viewer** | PDF.js | Client-side PDF rendering |

### Design Principles

1. **Security First**: LaTeX compilation is treated as code execution with full sandboxing
2. **Free-Tier Friendly**: Optimized for Render's 512MB RAM and ephemeral filesystem
3. **Interface Boundaries**: Clean abstractions (Storage, Mailer, CompileBackend) for easy provider changes
4. **No Vendor Lock-In**: S3-compatible storage, pluggable backends

## Quick Start

### Prerequisites

- **Node.js** 18 or later
- **Python** 3.12 or later
- **Docker Desktop** (for local LaTeX compilation)
- **Git**

### Local Development Setup

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/likhitex.git
cd likhitex
```

2. **Set up environment variables**

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your local configuration
# Minimum required for local dev:
# - DATABASE_URL (local Postgres or Neon free tier)
# - CLERK_SECRET_KEY (get from clerk.com)
# - CLERK_PUBLISHABLE_KEY
```

3. **Start backend services with Docker Compose**

```bash
# Start Postgres, Redis, and Mailpit
docker-compose up -d

# Verify services are running
docker-compose ps
```

4. **Set up Python backend**

```bash
cd apps/api

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -e ".[dev]"

# Run database migrations
alembic upgrade head

# Start API server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend will be available at `http://localhost:8000`  
API documentation at `http://localhost:8000/docs`

5. **Set up Next.js frontend** (in a new terminal)

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Frontend will be available at `http://localhost:3000`

6. **Verify the setup**

- Open `http://localhost:3000` in your browser
- Check API health: `http://localhost:8000/health`
- View API docs: `http://localhost:8000/docs`
- Check Mailpit: `http://localhost:8025` (email testing)

### Running Tests

**Backend tests:**

```bash
cd apps/api
pytest                           # All tests
pytest tests/security/           # Security tests only
pytest -v --cov=app             # With coverage
```

**Frontend tests:**

```bash
cd frontend
npm test                         # All tests
npm run test:watch              # Watch mode
npm run test:coverage           # With coverage
```

**Linting:**

```bash
# Backend
cd apps/api
ruff check .                    # Lint
mypy app                        # Type check

# Frontend
cd frontend
npm run lint                    # ESLint
npm run type-check              # TypeScript
```

## Project Structure

```
likhitex/
├── apps/
│   ├── api/                    # FastAPI backend
│   │   ├── app/
│   │   │   ├── auth/          # Clerk integration, JWT verification
│   │   │   ├── projects/      # Project CRUD, permissions
│   │   │   ├── files/         # File operations, ZIP handling
│   │   │   ├── compile/       # LaTeX compilation service
│   │   │   ├── collab/        # WebSocket collaboration
│   │   │   ├── storage/       # R2/S3 storage interface
│   │   │   ├── cache/         # Redis integration
│   │   │   ├── mail/          # Email service interface
│   │   │   └── db/            # SQLAlchemy models, migrations
│   │   ├── tests/
│   │   │   ├── security/      # Security test suite
│   │   │   └── ...
│   │   ├── alembic/           # Database migrations
│   │   └── pyproject.toml     # Python dependencies
│   │
│   ├── compiler/              # LaTeX compiler service
│   │   ├── runner.py          # Compilation logic
│   │   ├── texmf.cnf          # TeX configuration
│   │   └── Dockerfile         # Compiler container
│   │
│   └── frontend/              # Next.js frontend
│       ├── app/               # App router pages
│       │   ├── (auth)/       # Authentication pages
│       │   ├── (dashboard)/  # Projects dashboard
│       │   ├── editor/       # LaTeX editor
│       │   ├── history/      # Version history
│       │   └── settings/     # User settings
│       ├── components/        # React components
│       │   ├── ui/           # Base UI components
│       │   ├── modals/       # Dialog components
│       │   └── editor/       # Editor-specific components
│       ├── lib/              # Utilities and API client
│       │   ├── api/          # Typed API client
│       │   └── utils.ts      # Helper functions
│       └── public/           # Static assets
│
├── infra/
│   ├── render.yaml           # Render deployment config
│   └── docker-compose.yml    # Local development services
│
├── docs/                      # Documentation
│   ├── SETUP_GUIDE.md        # Detailed setup instructions
│   ├── CLERK_SETUP.md        # Authentication setup
│   ├── DISASTER_RECOVERY.md  # Backup and restore
│   └── ...
│
├── .github/
│   └── workflows/
│       ├── ci.yml            # Main CI pipeline
│       └── backup.yml        # Automated backups
│
└── .kiro/steering/           # AI agent guidance documents
```

## Documentation

- [Complete Setup Guide](docs/SETUP_GUIDE.md) - Detailed installation and configuration
- [Clerk Authentication Setup](docs/CLERK_SETUP.md) - Configure user authentication
- [Deployment Guide](docs/plan.md) - Deploy to Vercel and Render
- [Architecture Details](docs/tech.md) - Technical decisions and constraints
- [Development Roadmap](docs/plan.md) - Feature phases and milestones
- [Disaster Recovery](docs/DISASTER_RECOVERY.md) - Backup and restore procedures
- [Security Model](docs/tech.md#compile-security-highest-risk-component) - How we secure LaTeX compilation

## Development Workflow

### Creating a Feature

1. **Create a feature branch**

```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes**

- Follow TypeScript/Python type safety practices
- Add tests for new functionality
- Update documentation if needed

3. **Run quality checks**

```bash
# Backend
cd apps/api
pytest
ruff check .
mypy app

# Frontend
cd frontend
npm test
npm run lint
npm run type-check
```

4. **Commit and push**

```bash
git add .
git commit -m "feat: add your feature description"
git push origin feature/your-feature-name
```

5. **Create a Pull Request**

- CI must pass (tests, linting, type checking, security scans)
- Request review from a team member
- Merge to `main` after approval

### Code Conventions

**Python (Backend):**
- Use `ruff` for linting and formatting
- Type hints on all functions
- Docstrings for public APIs
- SQLAlchemy async patterns
- Environment-driven configuration

**TypeScript (Frontend):**
- Strict mode enabled
- Functional components with hooks
- Tailwind CSS for styling
- Server components where possible
- Client components marked with `"use client"`

**General:**
- Keep functions small and focused
- Write tests for new features
- Document non-obvious code
- Never commit secrets or tokens

## Deployment

### Production Deployment

**Frontend (Vercel):**

```bash
# Connect your GitHub repo to Vercel
# Vercel will auto-deploy on push to main

# Environment variables to set in Vercel dashboard:
# - NEXT_PUBLIC_API_URL
# - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
```

**Backend (Render):**

```bash
# Create a new Web Service on Render
# Connect your GitHub repo
# Use Docker environment

# Environment variables to set in Render dashboard:
# - DATABASE_URL (Neon connection string)
# - CLERK_SECRET_KEY
# - R2_ACCESS_KEY_ID
# - R2_SECRET_ACCESS_KEY
# - REDIS_URL (Upstash connection string)
```

**Database (Neon):**

1. Create free Postgres database at [neon.tech](https://neon.tech)
2. Copy connection string to `DATABASE_URL`
3. Run migrations: `alembic upgrade head`

See [Deployment Guide](docs/plan.md#phase-110-deploy-to-vercel--render) for complete instructions.

## Security

Likhitex treats LaTeX compilation as **code execution** and implements defense in depth:

### Compilation Security

- **Docker Isolation**: All LaTeX compilation runs in isolated Docker containers with gVisor runtime
- **Shell-Escape Disabled**: `shell_escape = f` enforced in texmf.cnf configuration  
- **Network Isolation**: `--network none` Docker flag prevents all external network access
- **Resource Limits**: Strict CPU, memory, file size, and process count limits via prlimit
- **Read-Only TeX Tree**: Immutable TeX Live installation prevents package tampering
- **Clean Environment**: Compiler runs with `env -i` and no access to secrets or credentials
- **Timeout Enforcement**: 60-second hard timeout per compilation with process group termination

### Input Validation

- **ZIP Bomb Detection**: Size limits on uploaded archives with decompression ratio checks
- **Path Traversal Prevention**: Reject `../`, absolute paths, and directory escape attempts
- **Symlink Rejection**: Block all symbolic links in uploaded ZIP archives
- **Extension Allowlist**: Strict file type validation (`.tex`, `.bib`, `.sty`, `.png`, `.jpg`, `.pdf`, etc.)
- **Package Blocklist**: Reject packages requiring shell-escape (`minted`, `pythontex`)

### Access Control

- **Invite-Only Enforcement**: Backend validates user email against `allowed_emails` database table
- **JWT Verification**: Clerk tokens validated on every request with RS256 signature verification
- **Role-Based Permissions**: Owner/Editor/Viewer roles enforced at API and WebSocket levels
- **WebSocket Authentication**: Time-limited one-time tickets (30s TTL) stored in Redis

### Operational Security

- **Rate Limiting**: Per-user and global limits on compilation, uploads, and API endpoints (Upstash Redis)
- **Audit Logging**: Structured JSON logs for all authentication events, project operations, and security events
- **Automated Backups**: Daily encrypted database and storage backups with `age` encryption
- **Secret Scanning**: gitleaks runs in CI pipeline to prevent credential leaks
- **Dependency Scanning**: `pip-audit` and `npm audit` run automatically in CI/CD

See comprehensive security documentation in [SECURITY.md](SECURITY.md) and [docs/tech.md](docs/tech.md#compile-security-highest-risk-component).

## Contributing

This is a private project for invited collaborators. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development workflow and branch strategy
- Code style guidelines and conventions  
- Testing requirements and coverage expectations
- Pull request process and review criteria
- Security considerations for contributions

All contributors must follow the project's code of conduct and security policies.

## Roadmap

### Phase 1: Compile Core + Security ✅ (In Progress)

- [x] Hardened LaTeX compiler with Docker + gVisor
- [x] Security test suite (path traversal, shell-escape, zip attacks)
- [x] Minimal editor + PDF preview
- [ ] Deploy to Vercel + Render

### Phase 2: Accounts & Persistence

- [ ] Clerk authentication integration
- [ ] User and project database models
- [ ] File upload and ZIP import/export
- [ ] Storage quotas and limits
- [ ] Basic project dashboard

### Phase 3: Real-Time Collaboration

- [ ] Yjs document synchronization
- [ ] Cursor and presence tracking
- [ ] WebSocket authentication (tickets)
- [ ] Share by email with roles
- [ ] Multi-user editor testing

### Phase 4: Production Readiness

- [ ] Compile queue with position display
- [ ] Rate limiting on all endpoints
- [ ] Error log parsing and highlighting
- [ ] Version history with diffs
- [ ] Automated backup verification

### Phase 5: Quality of Life

- [ ] SyncTeX jump-to-source
- [ ] LaTeX autocomplete
- [ ] Template presets
- [ ] Monthly backup restore tests
- [ ] Comprehensive audit logging

See [plan.md](docs/plan.md) for detailed phase breakdown.

## Monitoring & Maintenance

### Health Checks

- API: `https://your-api.onrender.com/health`
- Frontend: `https://your-app.vercel.app/` (should load)
- Database: Check Neon dashboard for activity
- Storage: Check Cloudflare R2 dashboard for usage

### Backup & Recovery

- **Automated backups**: Daily via GitHub Actions
- **Storage**: Encrypted with `age` and uploaded to R2
- **Retention**: 30 days of daily backups
- **Testing**: Monthly restore verification (see [DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md))

### Logs

- **Frontend**: Vercel dashboard → Logs
- **Backend**: Render dashboard → Logs
- **Search**: Structured JSON logs with user_id, project_id, request_id

## Troubleshooting

### Common Issues

**Q: Backend returns 500 errors**  
A: Check Render logs. Often database connection or Redis issues. Verify environment variables.

**Q: Compile times out**  
A: Check if container has enough memory. Render free tier is limited to 512MB. Consider upgrading or optimizing the TeX document.

**Q: WebSocket connection fails**  
A: Verify Redis is running and `REDIS_URL` is set. Check Hocuspocus logs.

**Q: "Not invited" error after login**  
A: Add user's email to `allowed_emails` table in database.

**Q: PDF preview shows nothing**  
A: Check if compilation succeeded. Look for errors in compiler logs. Verify R2 storage is working.

### Getting Support

1. Check the [docs/](docs/) directory
2. Search existing issues
3. Ask in the team chat
4. Create a detailed issue with logs and steps to reproduce

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

While the code is open-source, the hosted instance is private and invite-only.

## Acknowledgments

Likhitex is inspired by:
- [Overleaf](https://www.overleaf.com/) - The original collaborative LaTeX editor
- [ShareLaTeX](https://github.com/sharelatex/sharelatex) - Open-source LaTeX collaboration
- [CodeMirror](https://codemirror.net/) - Extensible code editor
- [Yjs](https://yjs.dev/) - CRDT framework for real-time collaboration

Built with ❤️ for the research and academic community.

---

For questions, issues, or feature requests, please contact the maintainers through the project's private communication channels.
