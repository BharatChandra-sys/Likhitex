# Likhitex

A private, invite-only collaborative LaTeX editor built for ~200 trusted users.

## What is this?

Likhitex replaces Overleaf for small groups who need:
- No compile timeouts
- Unlimited collaborators per project
- Real-time collaborative editing
- Your own infrastructure

**Not a public product.** Invite-only access for friends and classmates.

## Stack

- **Frontend:** Next.js 15 + TypeScript (Vercel)
- **Backend:** FastAPI + Python 3.12 (Render)
- **Database:** Neon Postgres (free tier)
- **Storage:** Cloudflare R2
- **Cache:** Upstash Redis
- **Auth:** Clerk
- **Collaboration:** Hocuspocus (Yjs)
- **Compiler:** Docker + TeX Live + gVisor

## Project Status

🚧 **Phase 1: Compile Core + Security** (In Progress)

- [ ] Hardened LaTeX compiler with Docker isolation
- [ ] Security test suite (path traversal, shell-escape, zip attacks)
- [ ] Minimal editor + PDF preview
- [ ] Deploy to Vercel + Render

See `docs/plan.md` for full roadmap.

## Quick Start (Local Development)

### Prerequisites

- Node.js 18+
- Python 3.12+
- Docker Desktop
- Git

### Setup

```bash
# Clone the repo
git clone <your-repo-url>
cd likhitex

# Copy environment template
cp .env.example .env
# Edit .env with your local values

# Start services (Postgres + Mailpit + API)
docker-compose up -d

# Install frontend dependencies
cd apps/web
npm install

# Install backend dependencies
cd ../api
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -e ".[dev]"

# Run database migrations
alembic upgrade head

# Start frontend (separate terminal)
cd apps/web
npm run dev
# Frontend: http://localhost:3000

# Start backend (separate terminal)
cd apps/api
uvicorn app.main:app --reload
# API: http://localhost:8000
```

Visit http://localhost:3000

## Documentation

- [Product Spec](docs/product.md) - What we're building and why
- [Tech Stack](docs/tech.md) - Architecture and constraints
- [Development Plan](docs/plan.md) - Phase-by-phase roadmap
- [Structure](docs/structure.md) - Repo layout and conventions
- [Improvements](docs/improvements.md) - Recent tech stack upgrades

## Repository Structure

```
likhitex/
├── apps/
│   ├── web/          # Next.js frontend
│   ├── api/          # FastAPI backend
│   └── compiler/     # LaTeX compiler service
├── infra/            # Deployment configs
├── docs/             # Documentation
├── .kiro/steering/   # AI agent guidance
└── .github/          # CI/CD workflows
```

## Security

This app compiles LaTeX, which is **code execution by design**. Security is the top priority:

- Hardened sandbox (Docker + gVisor)
- No shell-escape allowed
- Zip upload validation (path traversal, symlinks, bombs)
- Rate limiting on all endpoints
- Invite-only access enforced in backend

See `docs/tech.md` for full security model.

## Deployment

- **Frontend:** Vercel (automatic from `main` branch)
- **Backend:** Render (Docker, automatic from `main` branch)
- **Database:** Neon (manual setup)
- **Storage:** Cloudflare R2 (manual setup)
- **Redis:** Upstash (manual setup)

See `docs/plan.md` Phase 1.10 for deployment steps.

## Contributing

This is a private project for invited users only. If you're a collaborator:

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Run tests: `pytest` (backend) and `npm test` (frontend)
4. Run linters: `ruff check .` and `npm run lint`
5. Push and create a PR
6. CI must pass before merge

## License

Private project. Not licensed for public use.

## Support

Questions? Ask in our private Discord/Slack/WhatsApp group.

---

**Current Phase:** Compile Core + Security  
**Next Milestone:** Deploy basic editor with PDF compilation  
**Target Users:** 200 trusted friends and classmates
