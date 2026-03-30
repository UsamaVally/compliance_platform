// ============================================================
// Compliance Platform — TypeScript Types
// ============================================================

// ============================================================
// ENUM TYPES
// ============================================================

export type UserRole =
  | 'higher_supervision'   // Supervisor
  | 'general_manager'
  | 'regional_manager'
  | 'branch_manager'
  | 'admin'

export type EntityStatus = 'active' | 'inactive' | 'archived'

export type FormType =
  | 'branch_check'
  | 'regional_escalation'
  | 'gm_summary'

export type ScheduleFrequency =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'custom'

export type QuestionType =
  | 'text'
  | 'textarea'
  | 'yes_no'
  | 'multiple_choice'
  | 'photo'
  | 'number'
  | 'date'
  | 'signature'

export type SubmissionStatus =
  | 'not_due'
  | 'due'
  | 'submitted_on_time'
  | 'submitted_late'
  | 'missed'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'escalated'
  | 'closed'

export type EscalationType =
  | 'regional_report'
  | 'gm_report'

export type EscalationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'closed'

export type MissedReason =
  | 'manager_absent'
  | 'technical_issue'
  | 'store_closed'
  | 'power_outage'
  | 'internet_outage'
  | 'operational_emergency'
  | 'other'

export type ActionStatus =
  | 'open'
  | 'in_progress'
  | 'awaiting_evidence'
  | 'escalated'
  | 'resolved'
  | 'verified'
  | 'closed'

export type ActionPriority =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'

export type ReviewType =
  | 'spot_check'
  | 'full_review'

// ============================================================
// DATABASE TYPE (Supabase-style)
// ============================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      general_areas: {
        Row: {
          id: string
          organisation_id: string
          name: string
          code: string
          status: EntityStatus
          general_manager_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          name: string
          code: string
          status?: EntityStatus
          general_manager_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          name?: string
          code?: string
          status?: EntityStatus
          general_manager_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      organisations: {
        Row: {
          id: string
          name: string
          slug: string
          settings: Json
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          settings?: Json
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          settings?: Json
          created_at?: string
        }
      }
      roles: {
        Row: {
          id: string
          name: UserRole
          description: string | null
        }
        Insert: {
          id?: string
          name: UserRole
          description?: string | null
        }
        Update: {
          id?: string
          name?: UserRole
          description?: string | null
        }
      }
      profiles: {
        Row: {
          id: string
          organisation_id: string
          role: UserRole
          full_name: string
          email: string
          phone: string | null
          avatar_url: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          organisation_id: string
          role?: UserRole
          full_name: string
          email: string
          phone?: string | null
          avatar_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          role?: UserRole
          full_name?: string
          email?: string
          phone?: string | null
          avatar_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      regions: {
        Row: {
          id: string
          organisation_id: string
          name: string
          code: string
          status: EntityStatus
          general_manager_id: string | null
          general_area_id: string | null
          regional_manager_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          name: string
          code: string
          status?: EntityStatus
          general_manager_id?: string | null
          general_area_id?: string | null
          regional_manager_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          name?: string
          code?: string
          status?: EntityStatus
          general_manager_id?: string | null
          general_area_id?: string | null
          regional_manager_id?: string | null
          created_at?: string
        }
      }
      stores: {
        Row: {
          id: string
          organisation_id: string
          name: string
          code: string
          address: string | null
          region_id: string | null
          branch_manager_id: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          name: string
          code: string
          address?: string | null
          region_id?: string | null
          branch_manager_id?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          name?: string
          code?: string
          address?: string | null
          region_id?: string | null
          branch_manager_id?: string | null
          is_active?: boolean
          created_at?: string
        }
      }
      user_store_assignments: {
        Row: {
          id: string
          user_id: string
          store_id: string
          is_primary: boolean
          assigned_at: string
          assigned_by: string | null
        }
        Insert: {
          id?: string
          user_id: string
          store_id: string
          is_primary?: boolean
          assigned_at?: string
          assigned_by?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          store_id?: string
          is_primary?: boolean
          assigned_at?: string
          assigned_by?: string | null
        }
      }
      user_region_assignments: {
        Row: {
          id: string
          user_id: string
          region_id: string
          assigned_at: string
          assigned_by: string | null
        }
        Insert: {
          id?: string
          user_id: string
          region_id: string
          assigned_at?: string
          assigned_by?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          region_id?: string
          assigned_at?: string
          assigned_by?: string | null
        }
      }
      schedules: {
        Row: {
          id: string
          organisation_id: string
          name: string
          form_type: FormType
          frequency: ScheduleFrequency
          days_of_week: number[] | null
          time_due: string | null
          cutoff_time: string | null
          applicable_role: UserRole | null
          is_ongoing: boolean
          is_active: boolean
          template_id: string | null
          start_date: string | null
          end_date: string | null
          audience_type: 'role' | 'branch' | 'region' | 'general_area' | 'user' | null
          audience_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          name: string
          form_type: FormType
          frequency: ScheduleFrequency
          days_of_week?: number[] | null
          time_due?: string | null
          cutoff_time?: string | null
          applicable_role?: UserRole | null
          is_ongoing?: boolean
          is_active?: boolean
          template_id?: string | null
          start_date?: string | null
          end_date?: string | null
          audience_type?: 'role' | 'branch' | 'region' | 'general_area' | 'user' | null
          audience_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          name?: string
          form_type?: FormType
          frequency?: ScheduleFrequency
          days_of_week?: number[] | null
          time_due?: string | null
          cutoff_time?: string | null
          applicable_role?: UserRole | null
          is_ongoing?: boolean
          is_active?: boolean
          template_id?: string | null
          start_date?: string | null
          end_date?: string | null
          audience_type?: 'role' | 'branch' | 'region' | 'general_area' | 'user' | null
          audience_id?: string | null
          created_at?: string
        }
      }
      form_templates: {
        Row: {
          id: string
          organisation_id: string
          schedule_id: string | null
          name: string
          description: string | null
          version: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          schedule_id?: string | null
          name: string
          description?: string | null
          version?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          schedule_id?: string | null
          name?: string
          description?: string | null
          version?: number
          is_active?: boolean
          created_at?: string
        }
      }
      form_sections: {
        Row: {
          id: string
          template_id: string
          title: string
          order_index: number
          is_required: boolean
        }
        Insert: {
          id?: string
          template_id: string
          title: string
          order_index?: number
          is_required?: boolean
        }
        Update: {
          id?: string
          template_id?: string
          title?: string
          order_index?: number
          is_required?: boolean
        }
      }
      form_questions: {
        Row: {
          id: string
          section_id: string
          template_id: string
          question_text: string
          question_type: QuestionType
          is_required: boolean
          options: Json | null
          order_index: number
          help_text: string | null
        }
        Insert: {
          id?: string
          section_id: string
          template_id: string
          question_text: string
          question_type?: QuestionType
          is_required?: boolean
          options?: Json | null
          order_index?: number
          help_text?: string | null
        }
        Update: {
          id?: string
          section_id?: string
          template_id?: string
          question_text?: string
          question_type?: QuestionType
          is_required?: boolean
          options?: Json | null
          order_index?: number
          help_text?: string | null
        }
      }
      expected_submissions: {
        Row: {
          id: string
          organisation_id: string
          schedule_id: string
          store_id: string
          assigned_user_id: string | null
          due_date: string
          due_time: string | null
          cutoff_time: string | null
          status: SubmissionStatus
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          schedule_id: string
          store_id: string
          assigned_user_id?: string | null
          due_date: string
          due_time?: string | null
          cutoff_time?: string | null
          status?: SubmissionStatus
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          schedule_id?: string
          store_id?: string
          assigned_user_id?: string | null
          due_date?: string
          due_time?: string | null
          cutoff_time?: string | null
          status?: SubmissionStatus
          created_at?: string
        }
      }
      submissions: {
        Row: {
          id: string
          expected_submission_id: string | null
          organisation_id: string
          store_id: string
          submitted_by: string
          form_template_id: string
          status: SubmissionStatus
          submitted_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          review_notes: string | null
          is_late: boolean
          draft_data: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          expected_submission_id?: string | null
          organisation_id: string
          store_id: string
          submitted_by: string
          form_template_id: string
          status?: SubmissionStatus
          submitted_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          review_notes?: string | null
          is_late?: boolean
          draft_data?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          expected_submission_id?: string | null
          organisation_id?: string
          store_id?: string
          submitted_by?: string
          form_template_id?: string
          status?: SubmissionStatus
          submitted_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          review_notes?: string | null
          is_late?: boolean
          draft_data?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      submission_answers: {
        Row: {
          id: string
          submission_id: string
          question_id: string
          answer_text: string | null
          answer_value: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          submission_id: string
          question_id: string
          answer_text?: string | null
          answer_value?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          submission_id?: string
          question_id?: string
          answer_text?: string | null
          answer_value?: Json | null
          created_at?: string
        }
      }
      attachments: {
        Row: {
          id: string
          organisation_id: string
          entity_type: string
          entity_id: string
          file_name: string
          file_url: string
          file_size: number | null
          mime_type: string | null
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          entity_type: string
          entity_id: string
          file_name: string
          file_url: string
          file_size?: number | null
          mime_type?: string | null
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          entity_type?: string
          entity_id?: string
          file_name?: string
          file_url?: string
          file_size?: number | null
          mime_type?: string | null
          uploaded_by?: string
          created_at?: string
        }
      }
      reviews: {
        Row: {
          id: string
          organisation_id: string
          submission_id: string
          reviewer_id: string
          review_type: ReviewType
          score: number | null
          pass_fail: boolean | null
          findings: string | null
          corrective_action: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          submission_id: string
          reviewer_id: string
          review_type: ReviewType
          score?: number | null
          pass_fail?: boolean | null
          findings?: string | null
          corrective_action?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          submission_id?: string
          reviewer_id?: string
          review_type?: ReviewType
          score?: number | null
          pass_fail?: boolean | null
          findings?: string | null
          corrective_action?: string | null
          created_at?: string
        }
      }
      review_spot_checks: {
        Row: {
          id: string
          review_id: string
          question_text: string
          answer: string | null
          is_compliant: boolean | null
          notes: string | null
        }
        Insert: {
          id?: string
          review_id: string
          question_text: string
          answer?: string | null
          is_compliant?: boolean | null
          notes?: string | null
        }
        Update: {
          id?: string
          review_id?: string
          question_text?: string
          answer?: string | null
          is_compliant?: boolean | null
          notes?: string | null
        }
      }
      escalations: {
        Row: {
          id: string
          organisation_id: string
          escalation_type: EscalationType
          submitted_by: string
          period_start: string
          period_end: string
          status: EscalationStatus
          content: Json
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          review_notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          escalation_type: EscalationType
          submitted_by: string
          period_start: string
          period_end: string
          status?: EscalationStatus
          content?: Json
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          escalation_type?: EscalationType
          submitted_by?: string
          period_start?: string
          period_end?: string
          status?: EscalationStatus
          content?: Json
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      missed_submission_entries: {
        Row: {
          id: string
          escalation_id: string
          expected_submission_id: string | null
          store_id: string
          manager_id: string | null
          reason: MissedReason
          reason_notes: string | null
          action_taken: string | null
        }
        Insert: {
          id?: string
          escalation_id: string
          expected_submission_id?: string | null
          store_id: string
          manager_id?: string | null
          reason: MissedReason
          reason_notes?: string | null
          action_taken?: string | null
        }
        Update: {
          id?: string
          escalation_id?: string
          expected_submission_id?: string | null
          store_id?: string
          manager_id?: string | null
          reason?: MissedReason
          reason_notes?: string | null
          action_taken?: string | null
        }
      }
      actions: {
        Row: {
          id: string
          organisation_id: string
          issue_type: string | null
          related_entity_type: string | null
          related_entity_id: string | null
          store_id: string | null
          assigned_to: string | null
          raised_by: string
          title: string
          description: string | null
          action_required: string | null
          action_taken: string | null
          status: ActionStatus
          priority: ActionPriority
          due_date: string | null
          escalation_level: number
          closure_notes: string | null
          closed_by: string | null
          closed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          issue_type?: string | null
          related_entity_type?: string | null
          related_entity_id?: string | null
          store_id?: string | null
          assigned_to?: string | null
          raised_by: string
          title: string
          description?: string | null
          action_required?: string | null
          action_taken?: string | null
          status?: ActionStatus
          priority?: ActionPriority
          due_date?: string | null
          escalation_level?: number
          closure_notes?: string | null
          closed_by?: string | null
          closed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          issue_type?: string | null
          related_entity_type?: string | null
          related_entity_id?: string | null
          store_id?: string | null
          assigned_to?: string | null
          raised_by?: string
          title?: string
          description?: string | null
          action_required?: string | null
          action_taken?: string | null
          status?: ActionStatus
          priority?: ActionPriority
          due_date?: string | null
          escalation_level?: number
          closure_notes?: string | null
          closed_by?: string | null
          closed_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      action_updates: {
        Row: {
          id: string
          action_id: string
          updated_by: string
          update_text: string
          status_change_to: string | null
          created_at: string
        }
        Insert: {
          id?: string
          action_id: string
          updated_by: string
          update_text: string
          status_change_to?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          action_id?: string
          updated_by?: string
          update_text?: string
          status_change_to?: string | null
          created_at?: string
        }
      }
      notifications: {
        Row: {
          id: string
          organisation_id: string
          user_id: string
          type: string
          title: string
          message: string
          related_entity_type: string | null
          related_entity_id: string | null
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          user_id: string
          type: string
          title: string
          message: string
          related_entity_type?: string | null
          related_entity_id?: string | null
          is_read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          user_id?: string
          type?: string
          title?: string
          message?: string
          related_entity_type?: string | null
          related_entity_id?: string | null
          is_read?: boolean
          created_at?: string
        }
      }
      audit_logs: {
        Row: {
          id: string
          organisation_id: string | null
          user_id: string | null
          action: string
          entity_type: string | null
          entity_id: string | null
          old_data: Json | null
          new_data: Json | null
          ip_address: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id?: string | null
          user_id?: string | null
          action: string
          entity_type?: string | null
          entity_id?: string | null
          old_data?: Json | null
          new_data?: Json | null
          ip_address?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string | null
          user_id?: string | null
          action?: string
          entity_type?: string | null
          entity_id?: string | null
          old_data?: Json | null
          new_data?: Json | null
          ip_address?: string | null
          created_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      user_role: UserRole
      form_type: FormType
      schedule_frequency: ScheduleFrequency
      question_type: QuestionType
      submission_status: SubmissionStatus
      escalation_type: EscalationType
      escalation_status: EscalationStatus
      missed_reason: MissedReason
      action_status: ActionStatus
      action_priority: ActionPriority
      review_type: ReviewType
    }
  }
}

// ============================================================
// CONVENIENCE / DOMAIN TYPES
// ============================================================

export type Organisation = Database['public']['Tables']['organisations']['Row']
export type Role         = Database['public']['Tables']['roles']['Row']
export type Profile      = Database['public']['Tables']['profiles']['Row']
export type GeneralArea  = Database['public']['Tables']['general_areas']['Row']
export type Region       = Database['public']['Tables']['regions']['Row']
export type Store        = Database['public']['Tables']['stores']['Row']

export type UserStoreAssignment  = Database['public']['Tables']['user_store_assignments']['Row']
export type UserRegionAssignment = Database['public']['Tables']['user_region_assignments']['Row']

export type Schedule     = Database['public']['Tables']['schedules']['Row']
export type FormTemplate = Database['public']['Tables']['form_templates']['Row']
export type FormSection  = Database['public']['Tables']['form_sections']['Row']
export type FormQuestion = Database['public']['Tables']['form_questions']['Row']

export type ExpectedSubmission = Database['public']['Tables']['expected_submissions']['Row']
export type Submission         = Database['public']['Tables']['submissions']['Row']
export type SubmissionAnswer   = Database['public']['Tables']['submission_answers']['Row']

export type Attachment = Database['public']['Tables']['attachments']['Row']
export type Review     = Database['public']['Tables']['reviews']['Row']
export type ReviewSpotCheck = Database['public']['Tables']['review_spot_checks']['Row']

export type Escalation             = Database['public']['Tables']['escalations']['Row']
export type MissedSubmissionEntry  = Database['public']['Tables']['missed_submission_entries']['Row']

export type Action       = Database['public']['Tables']['actions']['Row']
export type ActionUpdate = Database['public']['Tables']['action_updates']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type AuditLog     = Database['public']['Tables']['audit_logs']['Row']

// rm_reviews (added via migration — not yet in generated types)
export type RmReview = {
  id: string
  organisation_id: string
  regional_manager_id: string
  expected_submission_id: string
  store_id: string
  submission_id: string | null
  submission_status: string
  acknowledged: boolean
  action_taken: string | null
  notes: string | null
  reviewed_at: string
  updated_at: string
}

// ============================================================
// INSERT / UPDATE HELPERS
// ============================================================

export type GeneralAreaInsert  = Database['public']['Tables']['general_areas']['Insert']
export type GeneralAreaUpdate  = Database['public']['Tables']['general_areas']['Update']
export type OrganisationInsert = Database['public']['Tables']['organisations']['Insert']
export type ProfileInsert      = Database['public']['Tables']['profiles']['Insert']
export type ProfileUpdate      = Database['public']['Tables']['profiles']['Update']
export type StoreInsert        = Database['public']['Tables']['stores']['Insert']
export type StoreUpdate        = Database['public']['Tables']['stores']['Update']
export type RegionInsert       = Database['public']['Tables']['regions']['Insert']
export type RegionUpdate       = Database['public']['Tables']['regions']['Update']
export type ScheduleInsert     = Database['public']['Tables']['schedules']['Insert']
export type FormTemplateInsert = Database['public']['Tables']['form_templates']['Insert']
export type FormSectionInsert  = Database['public']['Tables']['form_sections']['Insert']
export type FormQuestionInsert = Database['public']['Tables']['form_questions']['Insert']

export type ExpectedSubmissionInsert = Database['public']['Tables']['expected_submissions']['Insert']
export type ExpectedSubmissionUpdate = Database['public']['Tables']['expected_submissions']['Update']
export type SubmissionInsert         = Database['public']['Tables']['submissions']['Insert']
export type SubmissionUpdate         = Database['public']['Tables']['submissions']['Update']
export type SubmissionAnswerInsert   = Database['public']['Tables']['submission_answers']['Insert']

export type EscalationInsert            = Database['public']['Tables']['escalations']['Insert']
export type EscalationUpdate            = Database['public']['Tables']['escalations']['Update']
export type MissedSubmissionEntryInsert = Database['public']['Tables']['missed_submission_entries']['Insert']

export type ActionInsert       = Database['public']['Tables']['actions']['Insert']
export type ActionUpdate_      = Database['public']['Tables']['actions']['Update']
export type ActionUpdateInsert = Database['public']['Tables']['action_updates']['Insert']
export type NotificationInsert = Database['public']['Tables']['notifications']['Insert']
export type AuditLogInsert     = Database['public']['Tables']['audit_logs']['Insert']

// ============================================================
// ENRICHED / JOINED TYPES
// ============================================================

export type ProfileWithOrg = Profile & {
  organisations: Organisation | null
}

export type StoreWithRegion = Store & {
  regions: Region | null
}

export type RegionWithManager = Region & {
  profiles: Profile | null
}

export type GeneralAreaWithDetails = GeneralArea & {
  gm_profile: Profile | null
  regions: Region[]
}

export type SubmissionWithDetails = Submission & {
  stores: Store | null
  profiles: Profile | null
  form_templates: FormTemplate | null
}

export type ExpectedSubmissionWithDetails = ExpectedSubmission & {
  stores: Store | null
  profiles: Profile | null
  schedules: Schedule | null
}

export type ActionWithDetails = Action & {
  stores: Store | null
  assigned_profile: Profile | null
  raised_profile: Profile | null
}

export type EscalationWithDetails = Escalation & {
  submitted_profile: Profile | null
  reviewed_profile: Profile | null
}

export type ReviewWithDetails = Review & {
  submissions: Submission | null
  reviewer_profile: Profile | null
  review_spot_checks: ReviewSpotCheck[]
}

// ============================================================
// UI / UTILITY TYPES
// ============================================================

export interface ComplianceStats {
  total: number
  submitted_on_time: number
  submitted_late: number
  missed: number
  compliance_rate: number
}

export interface DashboardSummary {
  compliance_rate: number
  total_expected: number
  total_submitted: number
  total_missed: number
  total_late: number
  open_actions: number
  pending_reviews: number
}

export interface PaginatedResponse<T> {
  data: T[]
  count: number
  page: number
  page_size: number
  total_pages: number
}

export interface SelectOption {
  value: string
  label: string
}

export interface DateRange {
  from: Date | undefined
  to: Date | undefined
}
