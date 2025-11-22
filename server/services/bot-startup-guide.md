# Bot Container Isolation & Startup System

## Overview
Each WhatsApp bot runs in its own isolated container with dedicated auth directories and message processing pipelines. This prevents duplicate command execution and ensures proper credential management.

## Container Structure

### Auth Directory Layout
```
auth/
├── SERVER0/                          # Server/Tenant isolation
│   ├── bot_662fefd0.../            # Bot 1 - Isolated container
│   │   ├── creds.json              # Baileys credentials (loaded from DB)
│   │   ├── pre-key-*.json          # Signal protocol keys
│   │   ├── session-*.json          # Session files
│   │   └── device-list-*.json      # Device info
│   │
│   └── bot_abc123.../              # Bot 2 - Isolated container
│       └── (same structure)
│
└── SERVER1/                          # Another server/tenant
    └── bot_xyz789.../              # Bot 3 - Isolated container
```

## Approved Bot Startup Flow

### 1. Initial Startup (server/index.ts)
```
Server Start
  ↓
Database Initialize
  ↓
Resume Bots for Server (non-blocking)
  ↓
Scheduled Monitoring Starts (10 seconds)
  ↓
Each Approved Bot Starts Individually
```

### 2. Bot Startup Process (bot-manager.ts:118-217)
```
startBot(botId)
  ↓
Load Bot from Database
  ↓
Check if Approved (approvalStatus === 'approved')
  ↓
Check if Already Online
  ↓
Stop Existing Bot if Running
  ↓
Reload Bot Instance (get latest settings)
  ↓
Preserve Session Files (keep existing auth)
  ↓
Create New WhatsAppBot Instance
  ↓
Start Bot (connects using existing session)
  ↓
Check Status & Log Result
  ↓
Reset Failure Counter on Success
```

### 3. Credential Handling

#### From Database to Container
```
Database (botInstance.credentials)
  ↓
WhatsAppBot Constructor (bot-manager.ts line 182)
  ↓
saveCredentialsToAuthDir() (whatsapp-bot.ts:86)
  ↓
Write creds.json to container auth dir
  ↓
Baileys loads from auth dir on connection
```

#### Session Persistence
- **Existing Session**: Preserves `creds.json` and session files between restarts
- **New Session**: Uses QR code pairing if no existing credentials
- **No Re-authentication**: Saved credentials prevent repeated login requests

### 4. Baileys Initialization (whatsapp-bot.ts:start)
```
Read auth directory: auth/{serverName}/bot_{botId}/
  ↓
Load existing credentials from creds.json
  ↓
Initialize Baileys with loaded state
  ↓
Connect to WhatsApp (with existing session)
  ↓
No QR code needed (session already authenticated)
```

## Container Isolation Features

### Message Deduplication (Per-Bot)
- **Service**: `bot-isolation.ts`
- **Scope**: Each bot has isolated message cache
- **TTL**: 5 seconds per message
- **Prevents**: Same message processed multiple times within container

### Command Execution Locks (Per-Bot)
- **Service**: `bot-isolation.ts`
- **Scope**: Each bot has individual command locks
- **TTL**: 30 seconds per command
- **Prevents**: Concurrent execution of same command in one bot
- **Lock Release**: Automatic via try-finally block in `handleCommand()`

### Isolation Statistics
```javascript
// Available in logs after each command
[Container Stats] Bot WhatsApp Bot: Messages cached=2, Locks held=0
```

## Approved Bot Auto-Start

### Scheduled Monitoring (index.ts:41-80)
```javascript
checkApprovedBots() runs every 5 minutes
  ↓
Get ALL approved bots from database
  ↓
For each approved bot:
  ├── Check if online
  ├── If NOT online → Auto-start via botManager.startBot()
  ├── If online → Skip (already running)
  └── If error state → Auto-restart
```

### Key Behaviors
1. **Only Approved Bots Start**: Non-approved bots are skipped
2. **Independent Startup**: Each bot starts in isolated container
3. **Failure Tracking**: Failed bots tracked and skipped after 2 failures
4. **No Double Starts**: Running bots not restarted
5. **Error Recovery**: Auto-restart bots in error state

## Database Credential Storage

### Where Credentials Come From
1. **QR Code Pairing**: User scans QR → credentials generated
2. **Saved in Database**: `botInstances.credentials` (JSONB)
3. **Loaded on Startup**: Credentials loaded from DB to auth dir
4. **Session Maintained**: No re-pairing needed after restart

### Credential Format
```javascript
{
  "noiseKey": {...},
  "signedIdentityKey": {...},
  "signedPreKey": {...},
  // ... additional v7 credentials
}
```

### Session Preservation
```
Bot Restart
  ↓
Load botInstance.credentials from database
  ↓
Write to auth/{serverName}/bot_{botId}/creds.json
  ↓
Baileys loads existing session
  ↓
No QR code needed (already authenticated)
```

## Monitoring Container Health

### Container Stats Available
```javascript
botIsolationService.getIsolationStats(botId)
  ├── messagesCached: number
  ├── locksHeld: number
  └── botId: string
```

### Log Patterns to Watch
```
✅ Processing message {id} (first time in container)
⏭️ Skipping duplicate message {id} (already processed in this container)
🔒 Acquired lock for command {name}
🔓 Released command lock for {name}
[Container Stats] Bot {name}: Messages cached={n}, Locks held={n}
```

## Configuration

### Environment Variables
```bash
BOT_PREFIX=.                 # Command prefix (default: .)
BOTCOUNT=20                  # Max bots per server (default: 20)
```

### Database Connection
- Uses DATABASE_URL from Replit secrets
- Automatic SSL configuration
- Connection pooling with configurable pool size

## Troubleshooting

### Bot Not Starting
1. Check if bot is approved: `approvalStatus === 'approved'`
2. Check credentials in database: `botInstance.credentials`
3. Check auth directory: `auth/{serverName}/bot_{botId}/`
4. Check logs for skip tracking (failed 2+ times)

### Duplicate Commands Executing
1. Check isolation stats: `[Container Stats]` in logs
2. Verify lock release in finally block
3. Check TTL settings (30 seconds for command locks)

### Credentials Not Loading
1. Verify bot has credentials in database
2. Check auth directory permissions
3. Verify `creds.json` exists and valid JSON
4. Check Baileys version compatibility

## Best Practices

1. **Always Use Approved Status**: Only approved bots auto-start
2. **Preserve Sessions**: Don't clear auth dirs unless destroying bot
3. **Monitor Isolation Stats**: Track messages cached and locks held
4. **Check Failure Tracking**: Monitor skip data for repeated failures
5. **Database as Source of Truth**: All credentials stored in DB, not local files
