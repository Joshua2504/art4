-- Migration script to add districts table and district_id column
-- Run this if you already have an existing database with data
-- Date: 2025-11-19

USE ruo;

-- Create districts table
CREATE TABLE IF NOT EXISTS districts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  zip VARCHAR(10) UNIQUE NOT NULL,
  email VARCHAR(255),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  personal_email BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_zip (zip)
) ENGINE=InnoDB;

-- Add district_id column to reports table if it doesn't exist
ALTER TABLE reports
ADD COLUMN IF NOT EXISTS district_id INT AFTER user_id;

-- Add foreign key constraint if it doesn't exist
-- Note: This will only work if there are no existing non-null district_id values
-- that don't reference valid districts
SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = 'ruo'
    AND TABLE_NAME = 'reports'
    AND CONSTRAINT_NAME = 'reports_ibfk_2'
);

SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE reports ADD CONSTRAINT reports_ibfk_2 FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE SET NULL',
  'SELECT "Foreign key already exists" AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for district_id if it doesn't exist
ALTER TABLE reports
ADD INDEX IF NOT EXISTS idx_district_id (district_id);

SELECT 'Migration completed successfully!' AS status;
