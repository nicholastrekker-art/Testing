# replit.md

## Overview

This is a WhatsApp Bot Management application built as a full-stack web application for creating, managing, and monitoring WhatsApp bot instances. The system provides a comprehensive dashboard for controlling multiple bot instances, managing commands, and tracking activities in real-time. Each bot can be configured with automation features like auto-like, auto-react, and ChatGPT integration for intelligent responses.

## Recent Changes (September 2, 2025)

- **Multi-Tenancy System**: Implemented server isolation with bot count limits per tenant
- **Bot Approval Workflow**: Complete workflow with pending bots requiring admin approval
- **Feature Management**: Bot registration includes feature selection (auto like, auto react, auto view status, typing indicator, ChatGPT integration)
- **Admin Controls**: Individual feature toggles for approved bots with real-time UI updates
- **Authentication**: Fixed admin authentication middleware for approval endpoints
- **Database Schema**: Updated to store bot feature preferences in JSONB settings field

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The client-side is built with React and TypeScript using Vite as the build tool. The UI leverages shadcn/ui components with Radix UI primitives for a modern, accessible interface. The application uses Wouter for client-side routing and TanStack React Query for server state management with optimistic updates. Real-time updates are handled through WebSocket connections for live bot status monitoring and activity feeds.

### Backend Architecture
The server runs on Express.js with TypeScript, following a modular architecture. The bot management system uses a service-oriented approach with dedicated services for WhatsApp bot operations, OpenAI integration, and database operations. The WhatsApp functionality is implemented using the whatsapp-web.js library, which provides a reliable interface to WhatsApp Web. Real-time communication between server and clients is achieved through WebSocket connections for instant status updates and notifications.

### Database Layer
The application uses PostgreSQL as the primary database with Drizzle ORM for type-safe database operations. The database configuration is flexible and supports multiple deployment scenarios:

**Database Configuration Options:**
- **Environment Variables**: Supports both DATABASE_URL or individual database variables (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD)
- **SSL Configuration**: Automatically configures SSL based on environment (can be disabled with DB_SSL=false)
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
- **whatsapp-web.js**: Primary library for WhatsApp Web automation
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