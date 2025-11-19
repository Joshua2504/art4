# Database Migration Instructions

## Apply New Features

To add the new features (video upload, public by default, hide username), run this migration:

```bash
docker-compose exec mysql mysql -u root -proot ruo < migrate-add-features.sql
```

This migration adds:
1. `hide_username` column to `reports` table (BOOLEAN, default FALSE)
2. Changes `is_public` default to TRUE for new reports
3. Adds `media_type` column to `photos` table (ENUM: 'photo', 'video')

## Verify Migration

```bash
docker-compose exec mysql mysql -u root -proot ruo -e "DESCRIBE reports;"
docker-compose exec mysql mysql -u root -proot ruo -e "DESCRIBE photos;"
```

You should see:
- `reports.hide_username` column
- `reports.is_public` with DEFAULT TRUE
- `photos.media_type` column
