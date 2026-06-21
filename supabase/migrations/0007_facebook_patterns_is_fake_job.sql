-- Add is_fake_job verification column to facebook_patterns
alter table facebook_patterns
  add column if not exists is_fake_job boolean;
