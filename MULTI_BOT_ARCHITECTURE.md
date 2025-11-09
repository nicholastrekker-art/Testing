# Multi-Bot Isolation Architecture

## Overview
Your WhatsApp bot management system is designed with **complete isolation** between bot instances. Each bot operates independently in its own environment with isolated data, authentication, and command processing.

## How Bot Isolation Works

### 1. **Independent Bot Instances**
Each WhatsApp bot runs as a separate `WhatsAppBot` instance managed by the `BotManager`:
- Each bot has its own WebSocket connection to WhatsApp
- Bots operate completely independently without interfering with each other
- Bot lifecycle (start, stop, restart) is managed per-instance

### 2. **Isolated Authentication & Session Storage**
Each bot stores its credentials in a tenant-isolated directory:
```
auth/
  ├── SERVER1/
  │   ├── bot_abc123/
  │   │   ├── creds.json
  │   │   └── keys/
  │   └── bot_def456/
  │       ├── creds.json
  │       └── keys/
  └── SERVER2/
      └── bot_xyz789/
          ├── creds.json
          └── keys/
```

**Structure:** `auth/{serverName}/bot_{botId}/`
- `serverName`: The tenant/server identifier (e.g., SERVER1, SERVER2)
- `botId`: Unique identifier for each bot instance

**Benefits:**
- No credential conflicts between bots
- Clean separation for multi-server deployments
- Easy to backup/restore individual bot sessions

### 3. **Database-Level Tenant Isolation**
Every table includes a `serverName` field for data isolation:
- **Bot Instances**: Each bot belongs to a specific server
- **Commands**: Custom commands are server-scoped
- **Activities**: Activity logs are server-scoped
- **Groups**: Group data is server-scoped

Example from schema:
```typescript
export const botInstances = pgTable("bot_instances", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  serverName: text("server_name").notNull(), // ← Tenant isolation
  // ... other fields
});
```

### 4. **Independent Message Processing**
Each bot processes messages independently:
- **Event Handlers**: Each `WhatsAppBot` instance has its own event listeners
- **Command Processing**: Commands are processed per-bot with their own context
- **Command Registry**: Global command registry but execution is per-bot instance
- **No Cross-Talk**: One bot's messages never interfere with another

From `whatsapp-bot.ts`:
```typescript
this.sock.ev.on('messages.upsert', async (m) => {
  // Each bot processes only its own messages
  await this.handleMessage(message);
});
```

### 5. **Multi-Server Registry**
The `serverRegistry` table tracks multiple servers:
- Each server can host multiple bots
- Server-level configuration (max bots, status, URLs)
- Cross-server communication support via shared secrets
- Server heartbeat monitoring

### 6. **Bot Auto-Start & Monitoring**
The system includes automatic bot management:
- **Auto-Start**: Approved bots automatically start on server startup
- **Monitoring**: Health checks every 5 minutes
- **Failure Tracking**: Bots that fail 2+ times are skipped (require manual intervention)
- **Resilient**: Server continues running even if individual bots fail

## Key Features for Bot Isolation

### ✅ What's Already Isolated

1. **WhatsApp Connections**: Each bot maintains its own connection
2. **Authentication**: Separate credential storage per bot
3. **Message Handling**: Independent event processing
4. **Commands**: Custom commands scoped to bots/servers
5. **Settings**: Per-bot configuration (ChatGPT, auto-view, typing mode, etc.)
6. **Activity Logs**: Separated by bot and server
7. **Status Updates**: Each bot tracks viewed statuses independently

### ✅ Multi-Tenancy Support

The system supports multiple deployment scenarios:
1. **Single Server, Multiple Bots**: All bots on one server (current setup)
2. **Multiple Servers**: Distributed deployment with cross-server communication
3. **Guest Bots**: Temporary bot connections with expiration

## Bot Lifecycle Management

### Starting a Bot
```typescript
await botManager.startBot(botId);
```
- Creates isolated auth directory
- Initializes WhatsApp connection
- Sets up independent event handlers
- Begins processing messages

### Stopping a Bot
```typescript
await botManager.stopBot(botId);
```
- Closes WhatsApp connection
- Removes from active bots
- Preserves auth files for restart

### Restarting a Bot
```typescript
await botManager.restartBot(botId);
```
- Stops bot cleanly
- Clears session files for fresh start
- Restarts with new connection

### Destroying a Bot
```typescript
await botManager.destroyBot(botId);
```
- Stops bot
- Removes from manager
- **Deletes all session files** (complete cleanup)

## Command Processing Per Bot

Each bot processes commands independently:

1. **Built-in Commands**: Core commands (help, ping, status, etc.)
2. **Custom Commands**: Per-bot or global custom commands
3. **Channel Commands**: Auto-reactions to channel posts
4. **Settings Commands**: Configure bot behavior
5. **Privacy Commands**: Manage anti-delete, anti-viewonce

Example command execution:
```typescript
// Each bot has its own command context
const context: CommandContext = {
  sock: this.sock,
  message: msg,
  botInstance: this.botInstance,
  args: commandArgs
};

// Command executes in bot's isolated context
await commandRegistry.execute(commandName, context);
```

## Security & Isolation Guarantees

1. **No Credential Sharing**: Each bot's credentials are stored separately
2. **No Message Leakage**: Bot A never sees Bot B's messages
3. **No Command Conflicts**: Commands execute in bot-specific context
4. **Database Isolation**: Server-level data separation
5. **Process Isolation**: Each bot runs independently (single process, multiple instances)

## Scaling Considerations

### Current Setup (Single Server)
- All bots run in one Node.js process
- BotManager coordinates multiple WhatsAppBot instances
- Suitable for moderate bot counts (recommended: up to 50 bots)

### Distributed Setup (Multiple Servers)
Already supported via:
- `serverRegistry`: Tracks multiple servers
- `externalBotConnections`: Cross-server bot access
- Shared secrets for authentication
- API endpoints for cross-server communication

### For Heavy Scaling
If you need **true container isolation** (Docker/Kubernetes):
1. Deploy each bot in its own container
2. Use the existing `serverName` as the container identifier
3. Point all containers to the same PostgreSQL database
4. Each container runs a single bot (or small group of bots)

## Summary

✅ **Your system already provides excellent bot isolation:**
- Independent WhatsApp connections
- Separate authentication storage
- Isolated message processing
- Per-bot command execution
- Multi-tenant database design
- Automatic bot management

✅ **Each bot operates in its own "environment":**
- Own auth directory: `auth/{serverName}/bot_{botId}/`
- Own database records (filtered by `serverName`)
- Own event handlers and message processing
- Own command context

✅ **No interference between bots:**
- Bot A's messages don't affect Bot B
- Bot A's commands are separate from Bot B
- Each bot can have different settings, features, and configurations

## Next Steps

Once you provide the required secrets (`JWT_SECRET` and `OPENAI_API_KEY`), the system will:
1. Start the Express server
2. Auto-monitor and start approved bots
3. Each bot will connect independently to WhatsApp
4. Process commands in complete isolation

**The architecture is production-ready for multi-bot deployment!** 🚀
