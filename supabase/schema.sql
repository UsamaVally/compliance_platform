-- ============================================================
-- Compliance Platform - Full PostgreSQL Schema
-- ============================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SCHEMA GRANTS (restore Supabase defaults after schema reset)
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- After all tables are created, these default grants apply:
-- (Supabase sets these automatically on new projects, but they
--  must be re-applied after DROP SCHEMA public CASCADE)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role, postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role, postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO authenticated;

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
  'higher_supervision',
  'general_manager',
  'regional_manager',
  'branch_manager',
  'admin'
);

CREATE TYPE form_type AS ENUM (
  'branch_check',
  'regional_escalation',
  'gm_summary'
);

CREATE TYPE schedule_frequency AS ENUM (
  'daily',
  'weekly',
  'monthly',
  'custom'
);

CREATE TYPE question_type AS ENUM (
  'text',
  'textarea',
  'yes_no',
  'multiple_choice',
  'photo',
  'number',
  'date',
  'signature'
);

CREATE TYPE submission_status AS ENUM (
  'not_due',
  'due',
  'submitted_on_time',
  'submitted_late',
  'missed',
  'under_review',
  'approved',
  'rejected',
  'escalated',
  'closed'
);

CREATE TYPE escalation_type AS ENUM (
  'regional_report',
  'gm_report'
);

CREATE TYPE escalation_status AS ENUM (
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'closed'
);

CREATE TYPE missed_reason AS ENUM (
  'manager_absent',
  'technical_issue',
  'store_closed',
  'power_outage',
  'internet_outage',
  'operational_emergency',
  'other'
);

CREATE TYPE action_status AS ENUM (
  'open',
  'in_progress',
  'awaiting_evidence',
  'escalated',
  'resolved',
  'verified',
  'closed'
);

CREATE TYPE action_priority AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

CREATE TYPE review_type AS ENUM (
  'spot_check',
  'full_review'
);

-- ============================================================
-- TRIGGER FUNCTION: update_updated_at_column
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLES (all tables first, policies later)
-- ============================================================

-- TABLE: organisations
CREATE TABLE organisations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organisations_slug ON organisations(slug);
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;

-- TABLE: roles (seed/reference table)
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        user_role NOT NULL UNIQUE,
  description TEXT
);

-- TABLE: profiles
CREATE TABLE profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  role            user_role NOT NULL DEFAULT 'branch_manager',
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  avatar_url      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_organisation_id ON profiles(organisation_id);
CREATE INDEX idx_profiles_role            ON profiles(role);
CREATE INDEX idx_profiles_email           ON profiles(email);
CREATE INDEX idx_profiles_is_active       ON profiles(is_active);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- TABLE: regions
CREATE TABLE regions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  code               TEXT NOT NULL,
  general_manager_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organisation_id, code)
);

CREATE INDEX idx_regions_organisation_id    ON regions(organisation_id);
CREATE INDEX idx_regions_general_manager_id ON regions(general_manager_id);
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;

-- TABLE: stores
CREATE TABLE stores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL,
  address         TEXT,
  region_id       UUID REFERENCES regions(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organisation_id, code)
);

CREATE INDEX idx_stores_organisation_id ON stores(organisation_id);
CREATE INDEX idx_stores_region_id       ON stores(region_id);
CREATE INDEX idx_stores_is_active       ON stores(is_active);
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

-- TABLE: user_store_assignments
CREATE TABLE user_store_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE(user_id, store_id)
);

CREATE INDEX idx_user_store_assignments_user_id  ON user_store_assignments(user_id);
CREATE INDEX idx_user_store_assignments_store_id ON user_store_assignments(store_id);
ALTER TABLE user_store_assignments ENABLE ROW LEVEL SECURITY;

-- TABLE: user_region_assignments
CREATE TABLE user_region_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  region_id   UUID NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE(user_id, region_id)
);

CREATE INDEX idx_user_region_assignments_user_id   ON user_region_assignments(user_id);
CREATE INDEX idx_user_region_assignments_region_id ON user_region_assignments(region_id);
ALTER TABLE user_region_assignments ENABLE ROW LEVEL SECURITY;

-- TABLE: schedules
CREATE TABLE schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  form_type        form_type NOT NULL,
  frequency        schedule_frequency NOT NULL,
  days_of_week     INT[],
  time_due         TIME,
  cutoff_time      TIME,
  applicable_role  user_role,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedules_organisation_id ON schedules(organisation_id);
CREATE INDEX idx_schedules_form_type       ON schedules(form_type);
CREATE INDEX idx_schedules_frequency       ON schedules(frequency);
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

-- TABLE: form_templates
CREATE TABLE form_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  schedule_id     UUID REFERENCES schedules(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  version         INT NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_form_templates_organisation_id ON form_templates(organisation_id);
CREATE INDEX idx_form_templates_schedule_id     ON form_templates(schedule_id);
CREATE INDEX idx_form_templates_is_active       ON form_templates(is_active);
ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;

-- TABLE: form_sections
CREATE TABLE form_sections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_form_sections_template_id ON form_sections(template_id);
ALTER TABLE form_sections ENABLE ROW LEVEL SECURITY;

-- TABLE: form_questions
CREATE TABLE form_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id    UUID NOT NULL REFERENCES form_sections(id) ON DELETE CASCADE,
  template_id   UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type question_type NOT NULL DEFAULT 'text',
  is_required   BOOLEAN NOT NULL DEFAULT FALSE,
  options       JSONB,
  order_index   INT NOT NULL DEFAULT 0,
  help_text     TEXT
);

CREATE INDEX idx_form_questions_section_id  ON form_questions(section_id);
CREATE INDEX idx_form_questions_template_id ON form_questions(template_id);
ALTER TABLE form_questions ENABLE ROW LEVEL SECURITY;

-- TABLE: expected_submissions
CREATE TABLE expected_submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  schedule_id      UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  assigned_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  due_date         DATE NOT NULL,
  due_time         TIME,
  cutoff_time      TIME,
  status           submission_status NOT NULL DEFAULT 'not_due',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expected_submissions_organisation_id  ON expected_submissions(organisation_id);
CREATE INDEX idx_expected_submissions_schedule_id      ON expected_submissions(schedule_id);
CREATE INDEX idx_expected_submissions_store_id         ON expected_submissions(store_id);
CREATE INDEX idx_expected_submissions_assigned_user_id ON expected_submissions(assigned_user_id);
CREATE INDEX idx_expected_submissions_due_date         ON expected_submissions(due_date);
CREATE INDEX idx_expected_submissions_status           ON expected_submissions(status);
ALTER TABLE expected_submissions ENABLE ROW LEVEL SECURITY;

-- TABLE: submissions
CREATE TABLE submissions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expected_submission_id UUID REFERENCES expected_submissions(id) ON DELETE SET NULL,
  organisation_id        UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  store_id               UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  submitted_by           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  form_template_id       UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  status                 submission_status NOT NULL DEFAULT 'submitted_on_time',
  submitted_at           TIMESTAMPTZ,
  reviewed_at            TIMESTAMPTZ,
  reviewed_by            UUID REFERENCES profiles(id) ON DELETE SET NULL,
  review_notes           TEXT,
  is_late                BOOLEAN NOT NULL DEFAULT FALSE,
  draft_data             JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_submissions_expected_submission_id ON submissions(expected_submission_id);
CREATE INDEX idx_submissions_organisation_id        ON submissions(organisation_id);
CREATE INDEX idx_submissions_store_id               ON submissions(store_id);
CREATE INDEX idx_submissions_submitted_by           ON submissions(submitted_by);
CREATE INDEX idx_submissions_form_template_id       ON submissions(form_template_id);
CREATE INDEX idx_submissions_status                 ON submissions(status);
CREATE INDEX idx_submissions_submitted_at           ON submissions(submitted_at);
CREATE INDEX idx_submissions_is_late                ON submissions(is_late);
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER submissions_updated_at
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- TABLE: submission_answers
CREATE TABLE submission_answers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_id   UUID NOT NULL REFERENCES form_questions(id) ON DELETE CASCADE,
  answer_text   TEXT,
  answer_value  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(submission_id, question_id)
);

CREATE INDEX idx_submission_answers_submission_id ON submission_answers(submission_id);
CREATE INDEX idx_submission_answers_question_id   ON submission_answers(question_id);
ALTER TABLE submission_answers ENABLE ROW LEVEL SECURITY;

-- TABLE: attachments
CREATE TABLE attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entity_type     VARCHAR(100) NOT NULL,
  entity_id       UUID NOT NULL,
  file_name       TEXT NOT NULL,
  file_url        TEXT NOT NULL,
  file_size       BIGINT,
  mime_type       VARCHAR(255),
  uploaded_by     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_organisation_id ON attachments(organisation_id);
CREATE INDEX idx_attachments_entity          ON attachments(entity_type, entity_id);
CREATE INDEX idx_attachments_uploaded_by     ON attachments(uploaded_by);
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- TABLE: reviews
CREATE TABLE reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  submission_id     UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reviewer_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  review_type       review_type NOT NULL,
  score             NUMERIC(5, 2),
  pass_fail         BOOLEAN,
  findings          TEXT,
  corrective_action TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_organisation_id ON reviews(organisation_id);
CREATE INDEX idx_reviews_submission_id   ON reviews(submission_id);
CREATE INDEX idx_reviews_reviewer_id     ON reviews(reviewer_id);
CREATE INDEX idx_reviews_review_type     ON reviews(review_type);
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- TABLE: review_spot_checks
CREATE TABLE review_spot_checks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id     UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  answer        TEXT,
  is_compliant  BOOLEAN,
  notes         TEXT
);

CREATE INDEX idx_review_spot_checks_review_id ON review_spot_checks(review_id);
ALTER TABLE review_spot_checks ENABLE ROW LEVEL SECURITY;

-- TABLE: escalations
CREATE TABLE escalations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  escalation_type escalation_type NOT NULL,
  submitted_by    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          escalation_status NOT NULL DEFAULT 'draft',
  content         JSONB NOT NULL DEFAULT '{}',
  submitted_at    TIMESTAMPTZ,
  reviewed_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  review_notes    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_escalations_organisation_id ON escalations(organisation_id);
CREATE INDEX idx_escalations_submitted_by    ON escalations(submitted_by);
CREATE INDEX idx_escalations_status          ON escalations(status);
CREATE INDEX idx_escalations_type            ON escalations(escalation_type);
CREATE INDEX idx_escalations_period          ON escalations(period_start, period_end);
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER escalations_updated_at
  BEFORE UPDATE ON escalations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- TABLE: missed_submission_entries
CREATE TABLE missed_submission_entries (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escalation_id          UUID NOT NULL REFERENCES escalations(id) ON DELETE CASCADE,
  expected_submission_id UUID REFERENCES expected_submissions(id) ON DELETE SET NULL,
  store_id               UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  manager_id             UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reason                 missed_reason NOT NULL,
  reason_notes           TEXT,
  action_taken           TEXT
);

CREATE INDEX idx_missed_submission_entries_escalation_id ON missed_submission_entries(escalation_id);
CREATE INDEX idx_missed_submission_entries_store_id      ON missed_submission_entries(store_id);
CREATE INDEX idx_missed_submission_entries_manager_id    ON missed_submission_entries(manager_id);
ALTER TABLE missed_submission_entries ENABLE ROW LEVEL SECURITY;

-- TABLE: actions
CREATE TABLE actions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  issue_type           VARCHAR(100),
  related_entity_type  VARCHAR(100),
  related_entity_id    UUID,
  store_id             UUID REFERENCES stores(id) ON DELETE SET NULL,
  assigned_to          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  raised_by            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT,
  action_required      TEXT,
  action_taken         TEXT,
  status               action_status NOT NULL DEFAULT 'open',
  priority             action_priority NOT NULL DEFAULT 'medium',
  due_date             DATE,
  escalation_level     INT NOT NULL DEFAULT 1,
  closure_notes        TEXT,
  closed_by            UUID REFERENCES profiles(id) ON DELETE SET NULL,
  closed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_actions_organisation_id     ON actions(organisation_id);
CREATE INDEX idx_actions_store_id            ON actions(store_id);
CREATE INDEX idx_actions_assigned_to         ON actions(assigned_to);
CREATE INDEX idx_actions_raised_by           ON actions(raised_by);
CREATE INDEX idx_actions_status              ON actions(status);
CREATE INDEX idx_actions_priority            ON actions(priority);
CREATE INDEX idx_actions_due_date            ON actions(due_date);
CREATE INDEX idx_actions_related_entity      ON actions(related_entity_type, related_entity_id);
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER actions_updated_at
  BEFORE UPDATE ON actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- TABLE: action_updates
CREATE TABLE action_updates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id        UUID NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  updated_by       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  update_text      TEXT NOT NULL,
  status_change_to VARCHAR(50),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_action_updates_action_id  ON action_updates(action_id);
CREATE INDEX idx_action_updates_updated_by ON action_updates(updated_by);
ALTER TABLE action_updates ENABLE ROW LEVEL SECURITY;

-- TABLE: notifications
CREATE TABLE notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type                VARCHAR(100) NOT NULL,
  title               TEXT NOT NULL,
  message             TEXT NOT NULL,
  related_entity_type VARCHAR(100),
  related_entity_id   UUID,
  is_read             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_organisation_id ON notifications(organisation_id);
CREATE INDEX idx_notifications_user_id         ON notifications(user_id);
CREATE INDEX idx_notifications_is_read         ON notifications(is_read);
CREATE INDEX idx_notifications_created_at      ON notifications(created_at DESC);
CREATE INDEX idx_notifications_related_entity  ON notifications(related_entity_type, related_entity_id);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- TABLE: audit_logs
CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action          VARCHAR(100) NOT NULL,
  entity_type     VARCHAR(100),
  entity_id       UUID,
  old_data        JSONB,
  new_data        JSONB,
  ip_address      VARCHAR(45),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_organisation_id ON audit_logs(organisation_id);
CREATE INDEX idx_audit_logs_user_id         ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity          ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at      ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action          ON audit_logs(action);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- (all tables exist at this point)
-- ============================================================

-- organisations
CREATE POLICY "organisations_select_authenticated"
  ON organisations FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "organisations_all_higher_supervision"
  ON organisations FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin')
    )
  );

-- profiles
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_select_higher_supervision"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('higher_supervision', 'admin')
        AND p.organisation_id = profiles.organisation_id
    )
  );

CREATE POLICY "profiles_select_gm"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'general_manager'
        AND p.organisation_id = profiles.organisation_id
    )
  );

CREATE POLICY "profiles_select_regional_manager"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_region_assignments ura ON ura.user_id = p.id
      JOIN user_store_assignments usa ON usa.user_id = profiles.id
      JOIN stores s ON s.id = usa.store_id
      WHERE p.id = auth.uid()
        AND p.role = 'regional_manager'
        AND s.region_id = ura.region_id
    )
  );

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_all_admin"
  ON profiles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('higher_supervision', 'admin')
    )
  );

-- regions
CREATE POLICY "regions_select_own_org"
  ON regions FOR SELECT
  TO authenticated
  USING (
    organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "regions_all_admin"
  ON regions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager')
        AND organisation_id = regions.organisation_id
    )
  );

-- stores
CREATE POLICY "stores_select_own_org"
  ON stores FOR SELECT
  TO authenticated
  USING (
    organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "stores_all_admin"
  ON stores FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager')
        AND organisation_id = stores.organisation_id
    )
  );

-- user_store_assignments
CREATE POLICY "user_store_assignments_select"
  ON user_store_assignments FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager', 'regional_manager')
    )
  );

CREATE POLICY "user_store_assignments_all_admin"
  ON user_store_assignments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager', 'regional_manager')
    )
  );

-- user_region_assignments
CREATE POLICY "user_region_assignments_select"
  ON user_region_assignments FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager')
    )
  );

CREATE POLICY "user_region_assignments_all_admin"
  ON user_region_assignments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager')
    )
  );

-- schedules
CREATE POLICY "schedules_select_own_org"
  ON schedules FOR SELECT
  TO authenticated
  USING (
    organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "schedules_all_admin"
  ON schedules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin')
        AND organisation_id = schedules.organisation_id
    )
  );

-- form_templates
CREATE POLICY "form_templates_select_own_org"
  ON form_templates FOR SELECT
  TO authenticated
  USING (
    organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "form_templates_all_admin"
  ON form_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin')
        AND organisation_id = form_templates.organisation_id
    )
  );

-- form_sections
CREATE POLICY "form_sections_select"
  ON form_sections FOR SELECT
  TO authenticated
  USING (
    template_id IN (
      SELECT id FROM form_templates
      WHERE organisation_id IN (
        SELECT organisation_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "form_sections_all_admin"
  ON form_sections FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN form_templates ft ON ft.organisation_id = p.organisation_id
      WHERE p.id = auth.uid()
        AND p.role IN ('higher_supervision', 'admin')
        AND ft.id = form_sections.template_id
    )
  );

-- form_questions
CREATE POLICY "form_questions_select"
  ON form_questions FOR SELECT
  TO authenticated
  USING (
    template_id IN (
      SELECT id FROM form_templates
      WHERE organisation_id IN (
        SELECT organisation_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "form_questions_all_admin"
  ON form_questions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN form_templates ft ON ft.organisation_id = p.organisation_id
      WHERE p.id = auth.uid()
        AND p.role IN ('higher_supervision', 'admin')
        AND ft.id = form_questions.template_id
    )
  );

-- expected_submissions
CREATE POLICY "expected_submissions_select_own"
  ON expected_submissions FOR SELECT
  TO authenticated
  USING (
    assigned_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager', 'regional_manager')
        AND organisation_id = expected_submissions.organisation_id
    )
  );

CREATE POLICY "expected_submissions_all_admin"
  ON expected_submissions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin')
        AND organisation_id = expected_submissions.organisation_id
    )
  );

-- submissions
CREATE POLICY "submissions_select_own"
  ON submissions FOR SELECT
  TO authenticated
  USING (
    submitted_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager', 'regional_manager')
        AND organisation_id = submissions.organisation_id
    )
  );

CREATE POLICY "submissions_insert_own"
  ON submissions FOR INSERT
  TO authenticated
  WITH CHECK (submitted_by = auth.uid());

CREATE POLICY "submissions_update_own"
  ON submissions FOR UPDATE
  TO authenticated
  USING (
    submitted_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager', 'regional_manager')
        AND organisation_id = submissions.organisation_id
    )
  );

CREATE POLICY "submissions_all_admin"
  ON submissions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin')
        AND organisation_id = submissions.organisation_id
    )
  );

-- submission_answers
CREATE POLICY "submission_answers_select"
  ON submission_answers FOR SELECT
  TO authenticated
  USING (
    submission_id IN (
      SELECT id FROM submissions
      WHERE submitted_by = auth.uid()
        OR organisation_id IN (
          SELECT organisation_id FROM profiles
          WHERE id = auth.uid()
            AND role IN ('higher_supervision', 'admin', 'general_manager', 'regional_manager')
        )
    )
  );

CREATE POLICY "submission_answers_insert_own"
  ON submission_answers FOR INSERT
  TO authenticated
  WITH CHECK (
    submission_id IN (
      SELECT id FROM submissions WHERE submitted_by = auth.uid()
    )
  );

CREATE POLICY "submission_answers_update_own"
  ON submission_answers FOR UPDATE
  TO authenticated
  USING (
    submission_id IN (
      SELECT id FROM submissions WHERE submitted_by = auth.uid()
    )
  );

-- attachments
CREATE POLICY "attachments_select_own_org"
  ON attachments FOR SELECT
  TO authenticated
  USING (
    organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "attachments_insert_own"
  ON attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "attachments_delete_admin"
  ON attachments FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin')
        AND organisation_id = attachments.organisation_id
    )
  );

-- reviews
CREATE POLICY "reviews_select_own_org"
  ON reviews FOR SELECT
  TO authenticated
  USING (
    organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "reviews_insert_reviewers"
  ON reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager', 'regional_manager')
    )
  );

CREATE POLICY "reviews_all_admin"
  ON reviews FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin')
        AND organisation_id = reviews.organisation_id
    )
  );

-- review_spot_checks
CREATE POLICY "review_spot_checks_select"
  ON review_spot_checks FOR SELECT
  TO authenticated
  USING (
    review_id IN (
      SELECT id FROM reviews
      WHERE organisation_id IN (
        SELECT organisation_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "review_spot_checks_insert_reviewers"
  ON review_spot_checks FOR INSERT
  TO authenticated
  WITH CHECK (
    review_id IN (
      SELECT id FROM reviews WHERE reviewer_id = auth.uid()
    )
  );

-- escalations
CREATE POLICY "escalations_select_own"
  ON escalations FOR SELECT
  TO authenticated
  USING (
    submitted_by = auth.uid()
    OR reviewed_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager')
        AND organisation_id = escalations.organisation_id
    )
  );

CREATE POLICY "escalations_insert_own"
  ON escalations FOR INSERT
  TO authenticated
  WITH CHECK (
    submitted_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('regional_manager', 'general_manager', 'higher_supervision', 'admin')
    )
  );

CREATE POLICY "escalations_update_own"
  ON escalations FOR UPDATE
  TO authenticated
  USING (
    submitted_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager')
        AND organisation_id = escalations.organisation_id
    )
  );

-- missed_submission_entries
CREATE POLICY "missed_submission_entries_select"
  ON missed_submission_entries FOR SELECT
  TO authenticated
  USING (
    escalation_id IN (
      SELECT id FROM escalations
      WHERE submitted_by = auth.uid()
        OR organisation_id IN (
          SELECT organisation_id FROM profiles
          WHERE id = auth.uid()
            AND role IN ('higher_supervision', 'admin', 'general_manager')
        )
    )
  );

CREATE POLICY "missed_submission_entries_insert"
  ON missed_submission_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    escalation_id IN (
      SELECT id FROM escalations WHERE submitted_by = auth.uid()
    )
  );

CREATE POLICY "missed_submission_entries_update"
  ON missed_submission_entries FOR UPDATE
  TO authenticated
  USING (
    escalation_id IN (
      SELECT id FROM escalations WHERE submitted_by = auth.uid()
    )
  );

-- actions
CREATE POLICY "actions_select_own"
  ON actions FOR SELECT
  TO authenticated
  USING (
    raised_by = auth.uid()
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager', 'regional_manager')
        AND organisation_id = actions.organisation_id
    )
  );

CREATE POLICY "actions_insert_own"
  ON actions FOR INSERT
  TO authenticated
  WITH CHECK (
    raised_by = auth.uid()
    AND organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "actions_update_assigned"
  ON actions FOR UPDATE
  TO authenticated
  USING (
    raised_by = auth.uid()
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin', 'general_manager', 'regional_manager')
        AND organisation_id = actions.organisation_id
    )
  );

-- action_updates
CREATE POLICY "action_updates_select"
  ON action_updates FOR SELECT
  TO authenticated
  USING (
    action_id IN (
      SELECT id FROM actions
      WHERE raised_by = auth.uid()
        OR assigned_to = auth.uid()
        OR organisation_id IN (
          SELECT organisation_id FROM profiles
          WHERE id = auth.uid()
            AND role IN ('higher_supervision', 'admin', 'general_manager', 'regional_manager')
        )
    )
  );

CREATE POLICY "action_updates_insert_own"
  ON action_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    updated_by = auth.uid()
    AND action_id IN (
      SELECT id FROM actions
      WHERE raised_by = auth.uid()
        OR assigned_to = auth.uid()
        OR organisation_id IN (
          SELECT organisation_id FROM profiles
          WHERE id = auth.uid()
        )
    )
  );

-- notifications
CREATE POLICY "notifications_select_own"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_insert_system"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    organisation_id IN (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

-- audit_logs
CREATE POLICY "audit_logs_select_admin"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('higher_supervision', 'admin')
        AND organisation_id = audit_logs.organisation_id
    )
  );

CREATE POLICY "audit_logs_insert_authenticated"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO organisations (id, name, slug, settings)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'System',
  'system',
  '{"timezone": "UTC", "date_format": "DD/MM/YYYY", "compliance_threshold": 80}'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO roles (name, description) VALUES
  ('higher_supervision', 'Full access to all areas of the platform across all organisations'),
  ('general_manager',    'Manages all regions and stores within an organisation'),
  ('regional_manager',   'Manages stores within an assigned region'),
  ('branch_manager',     'Manages a single store and submits compliance forms'),
  ('admin',              'System administrator with full access within an organisation')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- MIGRATION: Admin Dashboard v2 — General Areas + Hierarchy
-- Applied: 2026-03-29
-- ============================================================

-- TABLE: general_areas (new)
CREATE TABLE IF NOT EXISTS general_areas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  code                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  general_manager_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_general_areas_updated_at
  BEFORE UPDATE ON general_areas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Extend regions with 3-tier hierarchy
ALTER TABLE regions
  ADD COLUMN IF NOT EXISTS general_area_id     UUID REFERENCES general_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS regional_manager_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived'));

-- Extend stores with direct BM assignment
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS branch_manager_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Extend schedules with template linkage + audience + lifecycle fields
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_ongoing     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id    UUID REFERENCES form_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_date     DATE,
  ADD COLUMN IF NOT EXISTS end_date       DATE,
  ADD COLUMN IF NOT EXISTS audience_type  TEXT CHECK (audience_type IN ('role','branch','region','general_area','user')),
  ADD COLUMN IF NOT EXISTS audience_id    UUID;
