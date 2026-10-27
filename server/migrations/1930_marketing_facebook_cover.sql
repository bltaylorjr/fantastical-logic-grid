-- The Facebook Page cover picture joins the marketing media library.
INSERT INTO marketing_media (title, kind, url, preview, size, notes, created_by, created_at)
  SELECT 'Facebook Page cover', 'image', 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/facebook-cover-1640x624.png', '/admin/marketing-fbcover.png', '1640x624', 'The Page''s cover photo. Phones crop the sides, so the words stay in the middle.', 'starter plan', 1793102400000
  WHERE NOT EXISTS (SELECT 1 FROM marketing_media WHERE url = 'https://github.com/bltaylorjr/fantastical-logic-grid/raw/main/media/marketing/facebook-cover-1640x624.png');
