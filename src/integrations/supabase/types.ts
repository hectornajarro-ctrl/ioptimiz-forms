export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      action_plan_items: {
        Row: {
          ai_auditor_argument: string | null
          ai_benefits: string[] | null
          ai_business_impact: string | null
          ai_generated_at: string | null
          ai_risk_summary: string | null
          auditor_id: string | null
          closure_comment: string | null
          closure_evidence_name: string | null
          closure_evidence_path: string | null
          corrective_action: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          expected_evidence: string[]
          finding_comment: string | null
          id: string
          question_id: string
          question_label: string
          recommended_actions: string[]
          reference: Json
          responsible_name: string | null
          responsible_user_id: string | null
          risk: Json
          section_title: string
          status: string
          survey_id: string
          survey_response_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_auditor_argument?: string | null
          ai_benefits?: string[] | null
          ai_business_impact?: string | null
          ai_generated_at?: string | null
          ai_risk_summary?: string | null
          auditor_id?: string | null
          closure_comment?: string | null
          closure_evidence_name?: string | null
          closure_evidence_path?: string | null
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          expected_evidence?: string[]
          finding_comment?: string | null
          id?: string
          question_id: string
          question_label?: string
          recommended_actions?: string[]
          reference?: Json
          responsible_name?: string | null
          responsible_user_id?: string | null
          risk?: Json
          section_title?: string
          status?: string
          survey_id: string
          survey_response_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_auditor_argument?: string | null
          ai_benefits?: string[] | null
          ai_business_impact?: string | null
          ai_generated_at?: string | null
          ai_risk_summary?: string | null
          auditor_id?: string | null
          closure_comment?: string | null
          closure_evidence_name?: string | null
          closure_evidence_path?: string | null
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          expected_evidence?: string[]
          finding_comment?: string | null
          id?: string
          question_id?: string
          question_label?: string
          recommended_actions?: string[]
          reference?: Json
          responsible_name?: string | null
          responsible_user_id?: string | null
          risk?: Json
          section_title?: string
          status?: string
          survey_id?: string
          survey_response_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_plan_items_auditor_id_fkey"
            columns: ["auditor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_plan_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_plan_items_responsible_user_id_fkey"
            columns: ["responsible_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_plan_items_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_plan_items_survey_response_id_fkey"
            columns: ["survey_response_id"]
            isOneToOne: false
            referencedRelation: "survey_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_plan_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          summary: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          summary?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          summary?: string | null
        }
        Relationships: []
      }
      audits: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          lead_auditor_id: string
          name: string
          open_enrollment: boolean
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          lead_auditor_id: string
          name: string
          open_enrollment?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          lead_auditor_id?: string
          name?: string
          open_enrollment?: boolean
        }
        Relationships: []
      }
      audits_members: {
        Row: {
          added_at: string
          group_id: string
          id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          group_id: string
          id?: string
          user_id: string
        }
        Update: {
          added_at?: string
          group_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "audit_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "vw_audits"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      survey_responses: {
        Row: {
          answers: Json
          created_at: string
          draft_answers: Json
          draft_progress: number
          draft_saved_at: string | null
          id: string
          progress: number
          progress_saved_at: string | null
          submitted: boolean
          submitted_at: string | null
          survey_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          created_at?: string
          draft_answers?: Json
          draft_progress?: number
          draft_saved_at?: string | null
          id?: string
          progress?: number
          progress_saved_at?: string | null
          submitted?: boolean
          submitted_at?: string | null
          survey_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          draft_answers?: Json
          draft_progress?: number
          draft_saved_at?: string | null
          id?: string
          progress?: number
          progress_saved_at?: string | null
          submitted?: boolean
          submitted_at?: string | null
          survey_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          approved_at: string | null
          assigned_group_id: string | null
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          lead_auditor_id: string
          mode: Database["public"]["Enums"]["survey_mode"]
          pdf_path: string | null
          schema: Json
          starts_at: string | null
          status: Database["public"]["Enums"]["survey_status"]
          title: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          assigned_group_id?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          lead_auditor_id: string
          mode?: Database["public"]["Enums"]["survey_mode"]
          pdf_path?: string | null
          schema?: Json
          starts_at?: string | null
          status?: Database["public"]["Enums"]["survey_status"]
          title: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          assigned_group_id?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          lead_auditor_id?: string
          mode?: Database["public"]["Enums"]["survey_mode"]
          pdf_path?: string | null
          schema?: Json
          starts_at?: string | null
          status?: Database["public"]["Enums"]["survey_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "surveys_assigned_group_id_fkey"
            columns: ["assigned_group_id"]
            isOneToOne: false
            referencedRelation: "audit_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_assigned_group_id_fkey"
            columns: ["assigned_group_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_assigned_group_id_fkey"
            columns: ["assigned_group_id"]
            isOneToOne: false
            referencedRelation: "vw_audits"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      audit_group_members: {
        Row: {
          added_at: string | null
          group_id: string | null
          id: string | null
          user_id: string | null
        }
        Insert: {
          added_at?: string | null
          group_id?: string | null
          id?: string | null
          user_id?: string | null
        }
        Update: {
          added_at?: string | null
          group_id?: string | null
          id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "audit_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "vw_audits"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_groups: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string | null
          lead_auditor_id: string | null
          name: string | null
          open_enrollment: boolean | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          lead_auditor_id?: string | null
          name?: string | null
          open_enrollment?: boolean | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          lead_auditor_id?: string | null
          name?: string | null
          open_enrollment?: boolean | null
        }
        Relationships: []
      }
      audit_members: {
        Row: {
          added_at: string | null
          group_id: string | null
          id: string | null
          user_id: string | null
        }
        Insert: {
          added_at?: string | null
          group_id?: string | null
          id?: string | null
          user_id?: string | null
        }
        Update: {
          added_at?: string | null
          group_id?: string | null
          id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "audit_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "vw_audits"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_audits: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string | null
          lead_auditor_id: string | null
          name: string | null
          open_enrollment: boolean | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          lead_auditor_id?: string | null
          name?: string | null
          open_enrollment?: boolean | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          lead_auditor_id?: string | null
          name?: string | null
          open_enrollment?: boolean | null
        }
        Relationships: []
      }
      vw_audits_members: {
        Row: {
          added_at: string | null
          group_id: string | null
          id: string | null
          user_id: string | null
        }
        Insert: {
          added_at?: string | null
          group_id?: string | null
          id?: string | null
          user_id?: string | null
        }
        Update: {
          added_at?: string | null
          group_id?: string | null
          id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "audit_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "vw_audits"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _actor_email: { Args: { _uid: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_audit_lead: {
        Args: { _audit_id: string; _user_id: string }
        Returns: boolean
      }
      is_audit_member: {
        Args: { _audit_id: string; _user_id: string }
        Returns: boolean
      }
      is_audit_open_unclaimed: { Args: { _audit_id: string }; Returns: boolean }
      is_group_lead: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_member: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_open_unclaimed: { Args: { _group_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "lead_auditor" | "member_auditor"
      survey_mode: "free" | "compliance"
      survey_status: "draft" | "approved" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "lead_auditor", "member_auditor"],
      survey_mode: ["free", "compliance"],
      survey_status: ["draft", "approved", "archived"],
    },
  },
} as const
