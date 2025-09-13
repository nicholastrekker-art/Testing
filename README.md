# Trekker WhatsApp Bot Management System

## 🚨 CRITICAL SECURITY NOTICE

**⚠️ IMPORTANT**: This repository contains a confirmed security vulnerability. WhatsApp credentials and session data were previously exposed in the Git history. 

**BEFORE USING THIS APPLICATION:**
1. **READ** [SECURITY.md](./SECURITY.md) for critical security remediation steps
2. **READ** [GIT_HISTORY_AUDIT.md](./GIT_HISTORY_AUDIT.md) for repository security audit
3. **INVALIDATE** all existing WhatsApp sessions before creating new ones
4. **VERIFY** all environment variables are properly configured

## Quick Start (Security-First)

### 1. Environment Setup (REQUIRED)
Configure these environment variables in Replit Secrets:
```
JWT_SECRET=your-secure-jwt-secret-here          # REQUIRED
DATABASE_URL=your-database-connection-string    # REQUIRED  
OPENAI_API_KEY=your-openai-api-key             # OPTIONAL
ADMIN_USERNAME=your-admin-username              # OPTIONAL
ADMIN_PASSWORD=your-secure-admin-password       # OPTIONAL
```

### 2. Security Verification
```bash
# Verify no credential files exist
ls -la auth/ temp_auth/ 2>/dev/null || echo "Credential directories clean"

# Verify .gitignore protection
git status --ignored | grep -E "(auth|session|creds)" || echo "No credential files tracked"
```

### 3. Start Application
```bash
npm run dev
```

## Security Features

- **Automatic credential protection** - App fails securely if secrets missing
- **Comprehensive .gitignore** - All credential patterns protected  
- **Environment variable enforcement** - No hardcoded secrets
- **Session isolation** - Temporary validation sessions automatically cleaned
- **Guest access controls** - Limited access with OTP verification

## Project Structure

```
├── client/              # React frontend
├── server/              # Express backend
├── shared/              # Shared types and schemas
├── auth/                # WhatsApp session storage (gitignored)
├── temp_auth/           # Temporary validation sessions (gitignored)
└── data/                # Application data
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | ✅ Yes | Secure JWT signing secret |
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | ❌ No | OpenAI API key for AI features |
| `ADMIN_USERNAME` | ❌ No | Admin dashboard username |
| `ADMIN_PASSWORD` | ❌ No | Admin dashboard password |

## Security Compliance

- ✅ No hardcoded secrets
- ✅ Comprehensive credential protection
- ✅ Secure session management  
- ✅ Environment variable validation
- ✅ Git history audit completed
- ⚠️ **Credential rotation required** (see SECURITY.md)

## Getting Help

- **Security issues**: See [SECURITY.md](./SECURITY.md)
- **Repository audit**: See [GIT_HISTORY_AUDIT.md](./GIT_HISTORY_AUDIT.md)
- **General support**: Create an issue in this repository

---

**⚠️ Security Notice**: Always follow secure development practices. This application has been hardened against credential exposure, but requires proper environment setup and credential rotation as documented in SECURITY.md.
