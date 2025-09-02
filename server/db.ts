import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// Database configuration from environment variables
const dbConfig = {
  url: process.env.DATABASE_URL,
  host: process.env.PGHOST || process.env.DB_HOST,
  port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432'),
  database: process.env.PGDATABASE || process.env.DB_NAME,
  username: process.env.PGUSER || process.env.DB_USER,
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
};

// Determine database URL from available environment variables
let connectionString: string;

if (dbConfig.url) {
  connectionString = dbConfig.url;
} else if (dbConfig.host && dbConfig.database && dbConfig.username && dbConfig.password) {
  connectionString = `postgresql://${dbConfig.username}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;
} else {
  throw new Error(
    "Database connection not configured. Please set either DATABASE_URL or individual database environment variables (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD)"
  );
}

// Configure SSL based on environment
const sslConfig = process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };

// Use the standard postgres driver with flexible SSL handling
const client = postgres(connectionString, {
  ssl: sslConfig,
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
  prepare: false
});

export const db = drizzle(client, { schema });

// Function to initialize database (create tables if they don't exist)
export async function initializeDatabase() {
  try {
    console.log('🔄 Checking database connectivity...');
    
    // Test database connection
    await client`SELECT 1`;
    console.log('✅ Database connection established');

    // Check if tables exist by trying to query one of them
    try {
      await db.query.botInstances.findFirst();
      console.log('✅ Database tables exist');
      
      // Check for expired bots on startup
      const { storage } = await import('./storage');
      await storage.checkAndExpireBots();
    } catch (error: any) {
      if (error.code === '42P01') { // Table does not exist
        console.log('⚠️ Database tables do not exist, creating them...');
        
        // Import and run the schema creation
        const { sql } = await import('drizzle-orm');
        const { 
          botInstances, 
          commands, 
          activities, 
          groups, 
          users 
        } = await import('@shared/schema');
        
        // Create tables manually using raw SQL
        await client`
          CREATE TABLE IF NOT EXISTS users (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        await client`
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        await client`
          CREATE TABLE IF NOT EXISTS commands (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            response TEXT,
            is_active BOOLEAN DEFAULT true,
            use_chatgpt BOOLEAN DEFAULT false,
            bot_instance_id VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        await client`
          CREATE TABLE IF NOT EXISTS activities (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            bot_instance_id VARCHAR NOT NULL,
            type TEXT NOT NULL,
            description TEXT NOT NULL,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        await client`
          CREATE TABLE IF NOT EXISTS groups (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
            whatsapp_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT,
            participant_count INTEGER DEFAULT 0,
            bot_instance_id VARCHAR NOT NULL,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        console.log('✅ Database tables created successfully');
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}