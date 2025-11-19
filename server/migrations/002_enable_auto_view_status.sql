
-- Enable auto_view_status for all existing bots
UPDATE bot_instances 
SET auto_view_status = true 
WHERE auto_view_status IS NULL OR auto_view_status = false;

-- Set NOT NULL constraint
ALTER TABLE bot_instances 
ALTER COLUMN auto_view_status SET DEFAULT true;

ALTER TABLE bot_instances 
ALTER COLUMN auto_view_status SET NOT NULL;
