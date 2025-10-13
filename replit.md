# replit.md

## Overview

This is a WhatsApp Bot Management application built as a full-stack web application for creating, managing, and monitoring WhatsApp bot instances. The system provides a comprehensive dashboard for controlling multiple bot instances, managing commands, and tracking activities in real-time. Each bot can be configured with automation features like auto-like, auto-react, and ChatGPT integration for intelligent responses.

## Recent Changes (October 13, 2025)

- **Production Frontend Fix**: Fixed BASE_PATH in vite.config.ts to default to '/' instead of '/default/server1/rest-service/v1.0/' for proper production builds
- **Pairing API Integration**: Integrated WhatsApp pairing service from /pair directory into main application at /api/pairing endpoint
- **Rate Limiting**: Added IP-based rate limiting (5 requests per 15 minutes) to pairing endpoint to prevent abuse
- **Non-Blocking Server Startup**: Made bot resume process non-blocking to ensure server starts listening on port 5000 immediately
- **Production Workflow**: Configured workflow to run 'yarn start' in production mode, serving built static files from /dist/public
- **Security Note**: Pairing endpoint is publicly accessible by design (users need to generate session IDs before registration) but protected with rate limiting

## Previous Changes (October 8, 2025)

- **Server Health Tracking**: Added `lastActive` timestamp to serverRegistry that updates every 30 minutes via heartbeat system
- **Invalid Bot Handling**: Bots with invalid credentials are automatically marked with `invalidReason` and skipped during auto-start
- **Smart Bot Counting**: Bot capacity limits now only count active/valid bots, excluding those with invalid credentials
- **Credential Validation Flow**: When credentials fail, bots are marked invalid with reason; updating credentials clears invalidReason and re-enables autoStart
- **Cross-Server Registration**: Guest credential updates automatically select alternative servers when current server reaches capacity
- **Admin Approval Intelligence**: Admin approval suggests alternative servers when current server is full, with automatic server selection

## Previous Changes (September 15, 2025)

- **PRODUCTION MODE ONLY**: GitHub imports to Replit now EXCLUSIVELY use production mode - no development mode option
- **AUTOMATIC FRONTEND BUILD**: Build process automatically creates optimized static files for production deployment
- **STATIC FILE SERVING**: Production mode serves built frontend from /dist/public with optimized performance
- **PRODUCTION WORKFLOW**: Default workflow uses `yarn start` (production) instead of `yarn dev` (development)
- **REPLIT DEPLOYMENT READY**: Configured for autoscale deployment with proper production settings

## Previous Changes (September 12, 2025)

- **DATABASE_URL ONLY RULE**: Implemented strict database configuration that ONLY works with DATABASE_URL from Replit secrets
- **Removed Replit Built-in Database Support**: Application no longer supports PG* environment variables or local Replit database
- **Enhanced SSL Security**: Automatic SSL requirement for all database connections with proper certificate verification
- **Import Configuration**: Updated for consistent behavior across GitHub imports to Replit
- **Simplified Build**: Removed TypeScript compilation, import fixing scripts, and Docker configurations - uses tsx directly

## Previous Changes (September 10, 2025)

- **Tenant Switching System**: Implemented true tenant switching where changing server names completely switches server context
- **Environment Variable Change**: Changed from NAME to SERVER_NAME environment variable with UI fallback
- **Dynamic Server Context**: Server configuration now restarts entire server context when switching tenants
- **Isolated Tenant Data**: Each server/tenant maintains completely separate bot instances, commands, activities, and groups
- **Runtime Server Management**: Added RUNTIME_SERVER_NAME environment variable for dynamic context switching
- **Bot Manager Tenant Support**: Enhanced bot manager to support stopping/starting all bots and resuming specific server tenants

## Previous Changes (September 2, 2025)

- **Multi-Tenancy System**: Implemented server isolation with bot count limits per tenant
- **Bot Approval Workflow**: Complete workflow with pending bots requiring admin approval
- **Feature Management**: Bot registration includes feature selection (auto like, auto react, auto view status, typing indicator, ChatGPT integration)
- **Admin Controls**: Individual feature toggles for approved bots with real-time UI updates
- **Authentication**: Fixed admin authentication middleware for approval endpoints
- **Database Schema**: Updated to store bot feature preferences in JSONB settings field

## User Preferences

**CRITICAL DATABASE RULE FOR REPLIT AGENTS**: 
- This application ONLY works with DATABASE_URL set in Replit secrets
- NEVER use Replit's built-in database or PG* environment variables
- The application will refuse to start without DATABASE_URL from secrets
- Wait for DATABASE_URL to be set in secrets before attempting to start the application
- This rule applies to ALL GitHub imports to Replit for this project

**CRITICAL PACKAGE MANAGER RULE FOR REPLIT AGENTS**:
- This project EXCLUSIVELY uses YARN for all operations
- NEVER change from yarn to npm when importing from GitHub
- ALL scripts, builds, installs, and deployments MUST use yarn commands only
- When setting up GitHub imports, always keep existing yarn configuration
- Package.json scripts should always use yarn (e.g., "yarn vite build", "yarn tsx", etc.)
- Deployment configuration must use yarn commands ("yarn build", "yarn start")
- This yarn-only rule applies to ALL future GitHub imports and project setups

**CRITICAL PRODUCTION MODE RULE FOR REPLIT AGENTS**:
- This application EXCLUSIVELY runs in PRODUCTION MODE when imported from GitHub to Replit
- NEVER use development mode (yarn dev) for GitHub imports - ONLY use production mode (yarn start)
- ALWAYS build the frontend first with "yarn build" before starting the application
- The workflow MUST use "yarn start" which serves static files from /dist/public
- GitHub imports to Replit should NEVER use development mode or Vite dev server
- This production-only rule applies to ALL future GitHub imports and project setups

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The client-side is built with React and TypeScript using Vite as the build tool. The UI leverages shadcn/ui components with Radix UI primitives for a modern, accessible interface. The application uses Wouter for client-side routing and TanStack React Query for server state management with optimistic updates. Real-time updates are handled through WebSocket connections for live bot status monitoring and activity feeds.

### Backend Architecture
The server runs on Express.js with TypeScript, following a modular architecture. The bot management system uses a service-oriented approach with dedicated services for WhatsApp bot operations, OpenAI integration, and database operations. The WhatsApp functionality is implemented using the whatsapp-web.js library, which provides a reliable interface to WhatsApp Web. Real-time communication between server and clients is achieved through WebSocket connections for instant status updates and notifications.

### Database Layer
The application uses PostgreSQL as the primary database with Drizzle ORM for type-safe database operations. **CRITICAL**: This application exclusively uses DATABASE_URL from Replit secrets.

**Database Configuration Requirements:**
- **DATABASE_URL ONLY**: The application ONLY works with DATABASE_URL set in Replit secrets
- **NO Local Database Support**: Replit built-in database and PG* variables are NOT supported
- **SSL Required**: Automatic SSL configuration with certificate verification for security
- **External Database Required**: Must use external PostgreSQL providers (Neon, Supabase, AWS RDS, Render, etc.)
- **Connection Pooling**: Configurable connection pool size via DB_MAX_CONNECTIONS
- **Auto-Initialization**: Automatically creates database tables on startup if they don't exist

The schema includes tables for users, bot instances, commands, activities, and groups. The database design supports multiple bot instances per user, command management with ChatGPT integration options, and comprehensive activity logging for monitoring and analytics.

### Authentication & Session Management
Session management is handled through PostgreSQL session storage using connect-pg-simple, providing secure and scalable session persistence. The authentication system is designed to support user-specific bot instances and command management.

### Bot Management System
The core bot management is handled by a centralized BotManager service that maintains active bot instances in memory. Each WhatsApp bot runs as a separate instance using the whatsapp-web.js library with LocalAuth for session persistence. The system supports QR code authentication, automatic reconnection, and status monitoring.

### Real-time Features
WebSocket implementation provides real-time updates for bot status changes, activity feeds, and system notifications. The client automatically reconnects on connection loss and updates the UI optimistically while maintaining data consistency.

### Automation Features
Bots support various automation modes including auto-like for status updates, auto-react to messages, auto-view status, and intelligent typing indicators. The system integrates with OpenAI's GPT-5 model for conversational AI capabilities, allowing bots to provide intelligent responses based on context.

## External Dependencies

### Primary Database
- **PostgreSQL**: Flexible database connection supporting multiple providers (Neon, Supabase, AWS RDS, etc.)
- **Drizzle ORM**: Type-safe database operations and automatic schema initialization
- **connect-pg-simple**: PostgreSQL session store for Express sessions
- **Auto-Migration**: Automatic table creation and schema management on startup

### WhatsApp Integration
- **@whiskeysockets/baileys**: Primary library for WhatsApp Web automation
- **puppeteer**: Headless browser automation for WhatsApp Web interface

### AI Integration
- **OpenAI API**: GPT-5 integration for intelligent bot responses and message analysis
- **OpenAI Node.js SDK**: Official SDK for OpenAI API interactions

### Frontend Libraries
- **Radix UI**: Accessible component primitives for the UI system
- **shadcn/ui**: Component library built on Radix UI
- **TanStack React Query**: Server state management and caching
- **React Hook Form**: Form validation and management
- **Zod**: Schema validation for forms and API requests

### Development Tools
- **Vite**: Frontend build tool and development server
- **TypeScript**: Type safety across the entire application
- **Tailwind CSS**: Utility-first CSS framework for styling
- **ESBuild**: Fast JavaScript bundler for production builds

### File Handling
- **Multer**: Middleware for handling multipart/form-data for bot credentials upload

### Real-time Communication
- **WebSocket (ws)**: Real-time bidirectional communication between server and clients