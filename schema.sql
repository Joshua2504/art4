CREATE DATABASE IF NOT EXISTS ruo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ruo;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB;

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
  id INT PRIMARY KEY AUTO_INCREMENT,
  case_number VARCHAR(50) UNIQUE NOT NULL,
  user_id INT NOT NULL,
  status ENUM('draft', 'submitted', 'in_progress', 'completed', 'rejected') DEFAULT 'draft',
  violation_type VARCHAR(255),
  notes TEXT,
  location_address TEXT,
  location_zip VARCHAR(10),
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  is_public BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_case_number (case_number),
  INDEX idx_status (status),
  INDEX idx_location (location_lat, location_lng)
) ENGINE=InnoDB;

-- Photos table
CREATE TABLE IF NOT EXISTS photos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  report_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  filepath VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100),
  file_size INT,
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  taken_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  INDEX idx_report_id (report_id)
) ENGINE=InnoDB;

-- Documents table (for uploaded PDFs, emails, etc.)
CREATE TABLE IF NOT EXISTS documents (
  id INT PRIMARY KEY AUTO_INCREMENT,
  report_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  filepath VARCHAR(500) NOT NULL,
  file_type VARCHAR(50),
  uploaded_by_user BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  INDEX idx_report_id (report_id)
) ENGINE=InnoDB;

-- Email logs table
CREATE TABLE IF NOT EXISTS email_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  report_id INT NOT NULL,
  direction ENUM('outbound', 'inbound') NOT NULL,
  from_email VARCHAR(255),
  to_email VARCHAR(255),
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  INDEX idx_report_id (report_id)
) ENGINE=InnoDB;

-- Status history table
CREATE TABLE IF NOT EXISTS status_history (
  id INT PRIMARY KEY AUTO_INCREMENT,
  report_id INT NOT NULL,
  old_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,
  changed_by_user_id INT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_report_id (report_id)
) ENGINE=InnoDB;
