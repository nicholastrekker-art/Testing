import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "../shared/schema.js";
const dbConfig = {
    url: process.env.DATABASE_URL,
};
const dbSslEnv = process.env.DB_SSL;
let sslConfig;
let sslMode = '';
if (dbSslEnv === 'disable' || dbSslEnv === 'false') {
    sslConfig = false;
    sslMode = '';
    console.log('🔓 Database SSL disabled by environment configuration');
}
else if (dbSslEnv === 'require') {
    sslConfig = true;
    sslMode = '?sslmode=require';
    console.log('🔒 Database SSL required (strict mode)');
}
else if (dbSslEnv === 'no-verify') {
    sslConfig = { rejectUnauthorized: false };
    sslMode = '?sslmode=require';
    console.log('🔒 Database SSL enabled with certificate verification disabled');
}
else {
    if (process.env.NODE_ENV === 'development') {
        sslConfig = { rejectUnauthorized: false };
        sslMode = '?sslmode=require';
        console.log('🔒 Database SSL enabled with certificate verification disabled (development mode)');
    }
    else {
        sslConfig = true;
        sslMode = '?sslmode=require';
        console.log('🔒 Database SSL required (production mode)');
    }
}
if (process.env.NODE_ENV !== 'development' && sslConfig === false) {
    console.error('❌ SECURITY ERROR: SSL is disabled in non-development environment!');
    console.error('   Set DB_SSL=require for production or DB_SSL=no-verify if necessary.');
    process.exit(1);
}
if (!dbConfig.url) {
    console.error('❌ DATABASE_URL is required but not found in secrets!');
    console.error('   Please set DATABASE_URL in Replit secrets before starting the application.');
    console.error('   This application only works with DATABASE_URL from secrets, no other database configuration is supported.');
    process.exit(1);
}
let connectionString = dbConfig.url;
if (sslConfig !== false && !connectionString.includes('sslmode=')) {
    connectionString += (connectionString.includes('?') ? '&' : '?') + 'sslmode=require';
}
try {
    const dbUrl = new URL(dbConfig.url);
    console.log(`🔗 Using DATABASE_URL from secrets with host: ${dbUrl.hostname}`);
}
catch (urlError) {
    console.log('🔗 Using DATABASE_URL from secrets (invalid URL format for logging)');
}
const client = postgres(connectionString, {
    ssl: sslConfig,
    max: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
    prepare: false,
    connect_timeout: 30,
    idle_timeout: 0,
    max_lifetime: 300,
    onnotice: () => { },
    transform: {
        undefined: null
    }
});
export const db = drizzle(client, { schema });
export function getServerName() {
    return process.env.RUNTIME_SERVER_NAME || process.env.SERVER_NAME || 'server1';
}
export async function getServerNameWithFallback() {
    if (process.env.RUNTIME_SERVER_NAME) {
        return process.env.RUNTIME_SERVER_NAME;
    }
    if (process.env.SERVER_NAME) {
        return process.env.SERVER_NAME;
    }
    try {
        const { storage } = await import('./storage.js');
        const servers = await storage.getAllServers();
        if (servers.length > 0) {
            return servers[0].serverName;
        }
    }
    catch (error) {
        console.warn('Failed to get server name from database:', error);
    }
    return 'server1';
}
export async function initializeDatabase() {
    try {
        console.log('🔄 Checking database connectivity...');
        const serverName = getServerName();
        console.log(`🏷️ Server instance: ${serverName}`);
        await client `SELECT 1`;
        console.log('✅ Database connection established');
        try {
            const tableExists = await client `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'bot_instances'
        )
      `;
            if (tableExists[0].exists) {
                console.log('✅ Bot instances table exists, checking schema...');
                const columnsExist = await client `
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'bot_instances' 
          AND column_name IN ('approval_status', 'is_guest', 'approval_date', 'expiration_months', 'server_name')
        `;
                if (columnsExist.length >= 5) {
                    console.log('✅ Database schema is up to date');
                    try {
                        await db.query.botInstances.findFirst();
                        console.log('✅ Database tables functional');
                        const { storage } = await import('./storage.js');
                        await storage.checkAndExpireBots();
                        await storage.initializeCurrentServer();
                        return;
                    }
                    catch (queryError) {
                        console.log('⚠️ Database query failed, will recreate schema:', queryError.message);
                    }
                }
                else {
                    console.log('⚠️ Database schema is outdated, missing columns');
                }
            }
            else {
                console.log('⚠️ Bot instances table does not exist');
            }
            console.log('⚠️ Database tables missing or schema outdated, creating/updating them...');
        }
        catch (error) {
            console.log('⚠️ Database schema check failed, will create/update tables:', error.message);
        }
        try {
            await client `
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            server_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
            await client `
          CREATE TABLE IF NOT EXISTS bot_instances (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            phone_number TEXT,
            status TEXT NOT NULL DEFAULT 'offline',
            credentials JSONB,
            settings JSONB DEFAULT '{}',
            auto_like BOOLEAN DEFAULT false,
            auto_view_status BOOLEAN DEFAULT false,
            auto_react BOOLEAN DEFAULT false,
            typing_mode TEXT DEFAULT 'none',
            chatgpt_enabled BOOLEAN DEFAULT false,
            last_activity TIMESTAMP,
            messages_count INTEGER DEFAULT 0,
            commands_count INTEGER DEFAULT 0,
            approval_status TEXT DEFAULT 'pending',
            is_guest BOOLEAN DEFAULT false,
            approval_date TEXT,
            expiration_months INTEGER,
            server_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
            await client `
          CREATE TABLE IF NOT EXISTS commands (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            response TEXT,
            is_active BOOLEAN DEFAULT true,
            use_chatgpt BOOLEAN DEFAULT false,
            bot_instance_id VARCHAR,
            server_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
            await client `
          CREATE TABLE IF NOT EXISTS activities (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            bot_instance_id VARCHAR,
            type TEXT NOT NULL,
            description TEXT NOT NULL,
            metadata JSONB DEFAULT '{}',
            server_name TEXT NOT NULL,
            remote_tenancy TEXT,
            remote_bot_id TEXT,
            phone_number TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
            await client `
          CREATE TABLE IF NOT EXISTS groups (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            whatsapp_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT,
            participant_count INTEGER DEFAULT 0,
            bot_instance_id VARCHAR NOT NULL,
            is_active BOOLEAN DEFAULT true,
            server_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
            await client `
          CREATE TABLE IF NOT EXISTS god_register (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            phone_number TEXT NOT NULL UNIQUE,
            tenancy_name TEXT NOT NULL,
            registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
            await client `
          CREATE TABLE IF NOT EXISTS server_registry (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            server_name TEXT NOT NULL UNIQUE,
            max_bot_count INTEGER NOT NULL,
            current_bot_count INTEGER DEFAULT 0,
            server_status TEXT DEFAULT 'active',
            server_url TEXT,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
            try {
                await client `ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending'`;
                await client `ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false`;
                await client `ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS approval_date TEXT`;
                await client `ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS expiration_months INTEGER`;
                await client `ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS server_name TEXT`;
                await client `UPDATE bot_instances SET server_name = ${serverName} WHERE server_name IS NULL`;
                await client `ALTER TABLE bot_instances ALTER COLUMN server_name SET NOT NULL`;
                await client `ALTER TABLE users ADD COLUMN IF NOT EXISTS server_name TEXT`;
                await client `UPDATE users SET server_name = ${serverName} WHERE server_name IS NULL`;
                await client `ALTER TABLE users ALTER COLUMN server_name SET NOT NULL`;
                await client `ALTER TABLE commands ADD COLUMN IF NOT EXISTS server_name TEXT`;
                await client `UPDATE commands SET server_name = ${serverName} WHERE server_name IS NULL`;
                await client `ALTER TABLE commands ALTER COLUMN server_name SET NOT NULL`;
                await client `ALTER TABLE activities ADD COLUMN IF NOT EXISTS server_name TEXT`;
                await client `UPDATE activities SET server_name = ${serverName} WHERE server_name IS NULL`;
                await client `ALTER TABLE activities ALTER COLUMN server_name SET NOT NULL`;
                await client `ALTER TABLE groups ADD COLUMN IF NOT EXISTS server_name TEXT`;
                await client `UPDATE groups SET server_name = ${serverName} WHERE server_name IS NULL`;
                await client `ALTER TABLE groups ALTER COLUMN server_name SET NOT NULL`;
                console.log('✅ Database schema updated with missing columns');
            }
            catch (alterError) {
                console.log('ℹ️ Some schema updates may have already been applied:', alterError.message);
            }
            console.log('✅ Database tables created/updated successfully');
            const { storage } = await import('./storage.js');
            await storage.checkAndExpireBots();
            await storage.initializeCurrentServer();
        }
        catch (createError) {
            console.error('❌ Failed to create/update database tables:', createError);
            throw createError;
        }
    }
    catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
}
