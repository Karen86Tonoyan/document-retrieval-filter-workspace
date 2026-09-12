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
      tafe_agent_profiles: {
        Row: {
          agent_id: string
          anomaly_score: number
          baseline: Json
          blocks: number
          created_at: string
          id: string
          last_seen: string
          model: string
          requests: number
          retries: number
          window_stats: Json
        }
        Insert: {
          agent_id: string
          anomaly_score?: number
          baseline?: Json
          blocks?: number
          created_at?: string
          id?: string
          last_seen?: string
          model?: string
          requests?: number
          retries?: number
          window_stats?: Json
        }
        Update: {
          agent_id?: string
          anomaly_score?: number
          baseline?: Json
          blocks?: number
          created_at?: string
          id?: string
          last_seen?: string
          model?: string
          requests?: number
          retries?: number
          window_stats?: Json
        }
        Relationships: []
      }
      tafe_audit_log: {
        Row: {
          actor: string | null
          after_hash: string | null
          agent_id: string
          before_hash: string | null
          decision: Database["public"]["Enums"]["tafe_decision"]
          evidence: Json
          filter: Database["public"]["Enums"]["tafe_filter"] | null
          id: string
          model: string
          reason: string
          request_id: string
          resource: string | null
          risk_score: number
          rule_id: string | null
          session_id: string
          tool: string | null
          ts: string
        }
        Insert: {
          actor?: string | null
          after_hash?: string | null
          agent_id?: string
          before_hash?: string | null
          decision: Database["public"]["Enums"]["tafe_decision"]
          evidence?: Json
          filter?: Database["public"]["Enums"]["tafe_filter"] | null
          id?: string
          model?: string
          reason?: string
          request_id: string
          resource?: string | null
          risk_score?: number
          rule_id?: string | null
          session_id?: string
          tool?: string | null
          ts?: string
        }
        Update: {
          actor?: string | null
          after_hash?: string | null
          agent_id?: string
          before_hash?: string | null
          decision?: Database["public"]["Enums"]["tafe_decision"]
          evidence?: Json
          filter?: Database["public"]["Enums"]["tafe_filter"] | null
          id?: string
          model?: string
          reason?: string
          request_id?: string
          resource?: string | null
          risk_score?: number
          rule_id?: string | null
          session_id?: string
          tool?: string | null
          ts?: string
        }
        Relationships: []
      }
      tafe_incidents: {
        Row: {
          agent_id: string
          created_at: string
          decision: Database["public"]["Enums"]["tafe_decision"]
          filter: Database["public"]["Enums"]["tafe_filter"]
          findings: Json
          id: string
          model: string
          reason: string
          request_id: string
          resolved: boolean
          severity: Database["public"]["Enums"]["tafe_severity"]
        }
        Insert: {
          agent_id?: string
          created_at?: string
          decision: Database["public"]["Enums"]["tafe_decision"]
          filter: Database["public"]["Enums"]["tafe_filter"]
          findings?: Json
          id?: string
          model?: string
          reason?: string
          request_id: string
          resolved?: boolean
          severity?: Database["public"]["Enums"]["tafe_severity"]
        }
        Update: {
          agent_id?: string
          created_at?: string
          decision?: Database["public"]["Enums"]["tafe_decision"]
          filter?: Database["public"]["Enums"]["tafe_filter"]
          findings?: Json
          id?: string
          model?: string
          reason?: string
          request_id?: string
          resolved?: boolean
          severity?: Database["public"]["Enums"]["tafe_severity"]
        }
        Relationships: []
      }
      tafe_patterns: {
        Row: {
          canonical_form: string
          context: Json
          context_hash: string
          decision: Database["public"]["Enums"]["tafe_decision"] | null
          false_positive_count: number
          fingerprint: string
          first_seen: string
          hit_count: number
          id: string
          last_seen: string
          pattern_id: string
          risk: number
          source: string
          status: Database["public"]["Enums"]["tafe_lifecycle"]
          version: number
        }
        Insert: {
          canonical_form: string
          context?: Json
          context_hash?: string
          decision?: Database["public"]["Enums"]["tafe_decision"] | null
          false_positive_count?: number
          fingerprint: string
          first_seen?: string
          hit_count?: number
          id?: string
          last_seen?: string
          pattern_id: string
          risk?: number
          source?: string
          status?: Database["public"]["Enums"]["tafe_lifecycle"]
          version?: number
        }
        Update: {
          canonical_form?: string
          context?: Json
          context_hash?: string
          decision?: Database["public"]["Enums"]["tafe_decision"] | null
          false_positive_count?: number
          fingerprint?: string
          first_seen?: string
          hit_count?: number
          id?: string
          last_seen?: string
          pattern_id?: string
          risk?: number
          source?: string
          status?: Database["public"]["Enums"]["tafe_lifecycle"]
          version?: number
        }
        Relationships: []
      }
      tafe_regression_runs: {
        Row: {
          baseline_f1: number
          created_at: string
          details: Json
          f1: number
          fn: number
          fp: number
          goldset: string
          id: string
          passed: boolean
          precision: number
          recall: number
          rule_key: string
          rule_version: number
          tn: number
          tp: number
        }
        Insert: {
          baseline_f1?: number
          created_at?: string
          details?: Json
          f1?: number
          fn?: number
          fp?: number
          goldset?: string
          id?: string
          passed?: boolean
          precision?: number
          recall?: number
          rule_key: string
          rule_version?: number
          tn?: number
          tp?: number
        }
        Update: {
          baseline_f1?: number
          created_at?: string
          details?: Json
          f1?: number
          fn?: number
          fp?: number
          goldset?: string
          id?: string
          passed?: boolean
          precision?: number
          recall?: number
          rule_key?: string
          rule_version?: number
          tn?: number
          tp?: number
        }
        Relationships: []
      }
      tafe_rules: {
        Row: {
          action: Database["public"]["Enums"]["tafe_decision"]
          conditions: Json
          confidence_threshold: number
          created_at: string
          created_by: string | null
          description: string
          enabled: boolean
          filter: Database["public"]["Enums"]["tafe_filter"]
          id: string
          name: string
          previous_version: Json | null
          rule_key: string
          severity: Database["public"]["Enums"]["tafe_severity"]
          status: Database["public"]["Enums"]["tafe_lifecycle"]
          updated_at: string
          version: number
        }
        Insert: {
          action?: Database["public"]["Enums"]["tafe_decision"]
          conditions?: Json
          confidence_threshold?: number
          created_at?: string
          created_by?: string | null
          description?: string
          enabled?: boolean
          filter: Database["public"]["Enums"]["tafe_filter"]
          id?: string
          name: string
          previous_version?: Json | null
          rule_key: string
          severity?: Database["public"]["Enums"]["tafe_severity"]
          status?: Database["public"]["Enums"]["tafe_lifecycle"]
          updated_at?: string
          version?: number
        }
        Update: {
          action?: Database["public"]["Enums"]["tafe_decision"]
          conditions?: Json
          confidence_threshold?: number
          created_at?: string
          created_by?: string | null
          description?: string
          enabled?: boolean
          filter?: Database["public"]["Enums"]["tafe_filter"]
          id?: string
          name?: string
          previous_version?: Json | null
          rule_key?: string
          severity?: Database["public"]["Enums"]["tafe_severity"]
          status?: Database["public"]["Enums"]["tafe_lifecycle"]
          updated_at?: string
          version?: number
        }
        Relationships: []
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      tafe_decision: "ALLOW" | "WARN" | "HOLD" | "HUMAN_REVIEW" | "BLOCK"
      tafe_filter: "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7"
      tafe_lifecycle:
        | "DETECTED"
        | "CANDIDATE"
        | "SHADOW_TEST"
        | "REGRESSION_TEST"
        | "VERIFIED"
        | "PROMOTED"
        | "ACTIVE"
        | "REJECTED"
        | "RETIRED"
      tafe_severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "user"],
      tafe_decision: ["ALLOW", "WARN", "HOLD", "HUMAN_REVIEW", "BLOCK"],
      tafe_filter: ["F1", "F2", "F3", "F4", "F5", "F6", "F7"],
      tafe_lifecycle: [
        "DETECTED",
        "CANDIDATE",
        "SHADOW_TEST",
        "REGRESSION_TEST",
        "VERIFIED",
        "PROMOTED",
        "ACTIVE",
        "REJECTED",
        "RETIRED",
      ],
      tafe_severity: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"],
    },
  },
} as const
