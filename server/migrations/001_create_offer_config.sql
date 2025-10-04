
-- Create offer_config table for promotional offer management
CREATE TABLE IF NOT EXISTS offer_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active BOOLEAN DEFAULT FALSE,
  duration_type VARCHAR(50) NOT NULL DEFAULT 'days',
  duration_value INTEGER NOT NULL DEFAULT 7,
  start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration
INSERT INTO offer_config (is_active, duration_type, duration_value)
VALUES (false, 'days', 7)
ON CONFLICT DO NOTHING;
