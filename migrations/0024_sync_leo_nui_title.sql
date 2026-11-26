-- Sync event & album title/slug for 26/11 Nui Luot event to match data/workshops.json
UPDATE events
SET title = 'HolaConnect · Chiều Leo Núi & Trò Chuyện Dưới Tán Thông',
    title_en = 'HolaConnect · Afternoon Pine-Hill Trek & Open Circle',
    updated_at = '2026-11-26T15:35:00.000Z'
WHERE id = 'holaconnect-leo-nui-lam-nghiep-2026-11-26';

UPDATE media_albums
SET title = 'HolaConnect · Chiều Leo Núi & Trò Chuyện Dưới Tán Thông',
    slug = 'leo-nui-luot',
    updated_at = '2026-11-26T15:35:00.000Z'
WHERE id = 'alb-ev-holaconnect-leo-nui-lam-nghiep-2026-11-26'
   OR event_id = 'holaconnect-leo-nui-lam-nghiep-2026-11-26';
