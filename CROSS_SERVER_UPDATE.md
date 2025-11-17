# Cross-Server Bot Credential Update Feature

## Overview

This document describes the cross-server bot credential update functionality that allows bots registered on one server to have their credentials updated from any server in the TREKKER-MD multi-server architecture.

## What Was Implemented

### 1. Enhanced Credential Validation
**File**: `server/services/creds-validator.ts`

The `validateCredentialsByPhoneNumber` function now:
- ✅ Detects when a bot is registered on a different server
- ✅ Returns metadata for cross-server updates instead of blocking
- ✅ Properly queries the shared database to find remote bots
- ✅ Handles data inconsistencies gracefully

**New Return Fields**:
```typescript
{
  isValid: boolean;
  message?: string;
  phoneNumber?: string;
  alreadyRegistered?: boolean;
  crossServerUpdate?: boolean;  // NEW: Indicates cross-server update needed
  targetServer?: string;         // NEW: The server hosting the bot
  botId?: string;               // NEW: The bot's ID for updates
}
```

### 2. Cross-Server Update Flow
**File**: `server/routes.ts` (lines 3255-3332)

When a bot is found on a different server:
1. Current server validates the credentials
2. Queries shared database for the remote bot using `phoneNumber` and `serverName`
3. Uses `CrossTenancyClient.updateBotCredentials()` to send update to remote server
4. Remote server updates credentials and restarts the bot
5. User receives WhatsApp confirmation message

### 3. Server Capacity Management
**File**: `server/routes.ts` (lines 3582-3677)

When current server is at capacity:
1. System automatically finds available servers
2. Selects server with most available slots
3. Performs cross-server registration
4. User is informed of auto-assignment

## How It Works

### Architecture
```
┌─────────────────┐
│  User Pairing   │
│ (Landing Page   │
│  or .pair cmd)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   /api/pair     │
│ (Any Server)    │
│ • Generates     │
│   credentials   │
│ • Sends to user │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  User Registration                      │
│  /api/guest/register-bot                │
│                                         │
│  Step 1: Validate credentials           │
│  Step 2: Check god_register             │
│                                         │
│  IF bot on different server:            │
│  ┌─────────────────────────────────┐   │
│  │ Cross-Server Credential Update  │   │
│  │ 1. Query shared DB for bot      │   │
│  │ 2. Get remote botId             │   │
│  │ 3. Call CrossTenancyClient      │   │
│  │ 4. Update on remote server      │   │
│  └─────────────────────────────────┘   │
│                                         │
│  IF current server full:                │
│  ┌─────────────────────────────────┐   │
│  │ Auto-Assignment                 │   │
│  │ 1. Find available servers       │   │
│  │ 2. Select best server           │   │
│  │ 3. Cross-server registration    │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Database Structure

**Shared Neon PostgreSQL Database**:
- `god_register`: Global phone number → server mapping
- `bot_instances`: All bot instances from all servers
- `server_registry`: Server metadata and capacity info

All servers connect to the same database, enabling cross-server queries.

## User Experience

### Scenario 1: Bot Already Registered on Different Server
```
User: *Pairs phone number on Server A*
System: ✅ Session ID generated and sent

User: *Registers with session ID on Server A*
System: 🌐 Bot found on Server B. Credentials will be updated on that server.
        
        ✅ *CREDENTIALS UPDATED!*
        
        Your bot credentials have been successfully updated on Server B!
        
        📊 *Bot Details:*
        • Phone: 254712345678
        • Hosting Server: Server B
        • Updated From: Server A
        • Updated: 11/17/2025, 2:30:00 PM
        
        🔄 Your bot will restart automatically with new credentials.
```

### Scenario 2: Server Full - Auto-Assignment
```
User: *Tries to register on Server A (at capacity)*
System: 🌍 Server A is at capacity
        
        ✅ Bot successfully auto-assigned to Server C
        
        📊 *Bot Details:*
        • Bot Name: My Bot
        • Phone: 254712345678
        • Server: Server C (Auto-assigned)
        • Available Slots: 7/10
```

### Scenario 3: New Registration on Current Server
```
User: *Registers new bot*
System: ✅ *BOT REGISTRATION SUCCESSFUL!*
        
        📱 Phone: 254712345678
        📅 Registered: 11/17/2025, 2:30:00 PM
        🏢 Server: Server A
        ⏳ Status: Awaiting admin approval
```

## Testing Recommendations

### Manual Testing

#### Test 1: Cross-Server Credential Update
1. Register a bot on Server A
2. Pair the same phone number on Server B (using landing page or `.pair` command)
3. Register using the session ID on Server B
4. **Expected**: Credentials updated on Server A, bot restarts, confirmation message sent

#### Test 2: Server Capacity Auto-Assignment
1. Fill Server A to capacity (register maximum bots)
2. Try to register a new bot on Server A
3. **Expected**: Bot automatically assigned to Server B (or other available server)

#### Test 3: Same-Server Credential Update
1. Register a bot on Server A
2. Pair the same phone number again
3. Register with new session ID on Server A
4. **Expected**: Credentials updated locally, bot restarts

#### Test 4: New Bot Registration
1. Pair a new phone number (never registered before)
2. Register the bot
3. **Expected**: New bot created on current server (if capacity available)

### Verification Points

For each test, verify:
- ✅ Appropriate log messages in server console
- ✅ WhatsApp confirmation message received
- ✅ Bot status updated in database
- ✅ Bot restarts (if approved)
- ✅ User receives correct server assignment information

### Edge Cases to Monitor

1. **Data Inconsistency**: Bot in `god_register` but not in `bot_instances`
   - **Expected**: Clear error message: "Bot found in registry but not in database. Please contact support."

2. **Remote Server Offline**: Target server for update is not active
   - **Expected**: Cross-server update fails with timeout/error message

3. **All Servers Full**: No available servers for auto-assignment
   - **Expected**: Error message: "All servers are at capacity. Please try again later or contact support."

## API Endpoints

### Pairing
```
GET /api/pair?number=254712345678
```
Generates pairing code and credentials. Used by both landing page and WhatsApp `.pair` command.

### Registration
```
POST /api/guest/register-bot
Body: {
  botName: string,
  phoneNumber: string,
  credentialType: 'session' | 'file',
  sessionId?: string,
  selectedServer?: string
}
```
Handles registration and cross-server updates.

## Security Considerations

1. **Server-to-Server Authentication**: `CrossTenancyClient` uses JWT tokens with shared secrets
2. **Phone Number Verification**: Credentials must match the phone number
3. **Idempotency**: Duplicate requests are handled safely
4. **Replay Protection**: Nonce-based replay prevention in cross-server calls

## Configuration

### Environment Variables
```bash
# Database (shared across all servers)
DATABASE_URL=postgresql://...

# Server Identity
SERVER_NAME=SERVER0  # or SERVER1, SERVER2, etc.

# Server Capacity
MAX_BOT_COUNT=10  # Maximum bots per server
```

### Server Registry Setup

Ensure all servers are registered in `server_registry`:
```sql
INSERT INTO server_registry (
  server_name, 
  max_bot_count, 
  server_status, 
  base_url, 
  shared_secret
) VALUES (
  'SERVER0', 
  10, 
  'active', 
  'https://server0.example.com',
  'your-shared-secret-here'
);
```

## Monitoring

### Key Metrics to Track

1. **Cross-Server Updates**: Count of successful/failed cross-server credential updates
2. **Auto-Assignments**: Count of bots auto-assigned to different servers
3. **Server Capacity**: Current bot count vs. maximum for each server
4. **Data Inconsistencies**: Bots in god_register but missing from bot_instances

### Log Patterns

**Successful Cross-Server Update**:
```
🌐 Cross-server credential update: SERVER0 → SERVER1
✅ Credentials updated on SERVER1 for bot abc-123
```

**Auto-Assignment**:
```
🚫 Current server SERVER0 is at capacity
🌍 Auto-selecting target server: SERVER1
✅ Bot successfully auto-assigned to SERVER1
```

**Data Inconsistency**:
```
⚠️ Bot 254712345678 found in god_register on SERVER1 but not in bot_instances
```

## Troubleshooting

### Issue: Cross-server update fails
**Symptoms**: Error message "Failed to update credentials on SERVER1"

**Checks**:
1. Verify target server is active: `SELECT * FROM server_registry WHERE server_name = 'SERVER1'`
2. Check network connectivity between servers
3. Verify shared secret is correct
4. Check target server logs for errors

### Issue: Bot not found in database
**Symptoms**: Error "Bot found in registry but not in database"

**Resolution**:
```sql
-- Find inconsistent records
SELECT gr.phone_number, gr.tenancy_name
FROM god_register gr
LEFT JOIN bot_instances bi ON gr.phone_number = bi.phone_number
WHERE bi.id IS NULL;

-- Option 1: Remove from god_register if bot doesn't exist
DELETE FROM god_register WHERE phone_number = '254712345678';

-- Option 2: Contact user to re-register
```

### Issue: All servers full
**Symptoms**: Error "All servers are at capacity"

**Resolution**:
1. Increase capacity on existing servers
2. Add new servers to `server_registry`
3. Archive/remove inactive bots

## Future Enhancements

Potential improvements:
- 🔄 Automatic load balancing based on server performance
- 📊 Real-time capacity dashboard
- 🔐 Enhanced server-to-server encryption
- 🧹 Automatic cleanup of inconsistent data
- 📈 Analytics for cross-server operations
- 🔔 Admin notifications for capacity warnings

## Support

For issues or questions:
- Contact: +254704897825
- Check logs: `server/routes.ts` and `server/services/crossTenancyClient.ts`
- Database queries: Use `execute_sql_tool` in development

---

**Last Updated**: November 17, 2025  
**Version**: 1.0  
**Status**: Production Ready ✅
