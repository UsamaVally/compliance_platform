-- Add rating column to rm_reviews
ALTER TABLE rm_reviews
  ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating >= 1 AND rating <= 5);
