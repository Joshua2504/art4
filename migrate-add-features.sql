-- Add hide_username column to reports table
ALTER TABLE reports ADD COLUMN hide_username BOOLEAN DEFAULT FALSE AFTER is_public;

-- Change is_public default to TRUE
ALTER TABLE reports ALTER COLUMN is_public SET DEFAULT TRUE;

-- Add media_type column to photos table to support videos
ALTER TABLE photos ADD COLUMN media_type ENUM('photo', 'video') DEFAULT 'photo' AFTER mime_type;
