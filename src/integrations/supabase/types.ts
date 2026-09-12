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
      tafe_adaptive_runs: {
        Row: {
          attack_success_rate: number
          blocked: number
          created_at: string
          details: Json
          id: string
          passed: boolean
          round: number
          round_name: string
          rule_key: string
          rule_version: number
          run_id: string
          variants: number
        }
        Insert: {
          attack_success_rate?: number
          blocked?: number
          created_at?: string
          details?: Json
          id?: string
          passed?: boolean
          round: number
          round_name: string
          rule_key: string
          rule_version?: number
          run_id: string
          variants?: number
        }
        Update: {
          attack_success_rate?: number
          blocked?: number
          created_at?: string
          details?: Json
          id?: string
          passed?: boolean
          round?: number
          round_name?: string
          rule_key?: string
          rule_version?: number
          run_id?: string
          variants?: number
        }
        Relationships: []
      }
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
          benchmark_version: string | null
          candidate_version: number | null
          dataset_hash: string | null
          decision: Database["public"]["Enums"]["tafe_decision"]
          engine_version: string
          evidence: Json
          filter: Database["public"]["Enums"]["tafe_filter"] | null
          id: string
          model: string
          reason: string
          request_id: string
          resource: string | null
          risk_score: number
          rollback_id: string | null
          rule_id: string | null
          ruleset_hash: string | null
          run_id: string | null
          session_id: string
          tool: string | null
          ts: string
        }
        Insert: {
          actor?: string | null
          after_hash?: string | null
          agent_id?: string
          before_hash?: string | null
          benchmark_version?: string | null
          candidate_version?: number | null
          dataset_hash?: string | null
          decision: Database["public"]["Enums"]["tafe_decision"]
          engine_version?: string
          evidence?: Json
          filter?: Database["public"]["Enums"]["tafe_filter"] | null
          id?: string
          model?: string
          reason?: string
          request_id: string
          resource?: string | null
          risk_score?: number
          rollback_id?: string | null
          rule_id?: string | null
          ruleset_hash?: string | null
          run_id?: string | null
          session_id?: string
          tool?: string | null
          ts?: string
        }
        Update: {
          actor?: string | null
          after_hash?: string | null
          agent_id?: string
          before_hash?: string | null
          benchmark_version?: string | null
          candidate_version?: number | null
          dataset_hash?: string | null
          decision?: Database["public"]["Enums"]["tafe_decision"]
          engine_version?: string
          evidence?: Json
          filter?: Database["public"]["Enums"]["tafe_filter"] | null
          id?: string
          model?: string
          reason?: string
          request_id?: string
          resource?: string | null
          risk_score?: number
          rollback_id?: string | null
          rule_id?: string | null
          ruleset_hash?: string | null
          run_id?: string | null
          session_id?: string
          tool?: string | null
          ts?: string
        }
        Relationships: []
      }
      tafe_benchmarks: {
        Row: {
          attack_family: string
          benchmark_id: string
          created_at: string
          dataset_hash: string
          filter: Database["public"]["Enums"]["tafe_filter"] | null
          id: string
          last_verified_at: string | null
          name: string
          notes: string
          runner: string
          scorer: string
          source: string
          status: Database["public"]["Enums"]["tafe_benchmark_status"]
          updated_at: string
          version: string
        }
        Insert: {
          attack_family?: string
          benchmark_id: string
          created_at?: string
          dataset_hash?: string
          filter?: Database["public"]["Enums"]["tafe_filter"] | null
          id?: string
          last_verified_at?: string | null
          name: string
          notes?: string
          runner?: string
          scorer?: string
          source?: string
          status?: Database["public"]["Enums"]["tafe_benchmark_status"]
          updated_at?: string
          version?: string
        }
        Update: {
          attack_family?: string
          benchmark_id?: string
          created_at?: string
          dataset_hash?: string
          filter?: Database["public"]["Enums"]["tafe_filter"] | null
          id?: string
          last_verified_at?: string | null
          name?: string
          notes?: string
          runner?: string
          scorer?: string
          source?: string
          status?: Database["public"]["Enums"]["tafe_benchmark_status"]
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      tafe_brain_evaluations: {
        Row: {
          candidate_id: string
          candidate_version: number
          created_at: string
          id: string
          payload: Json
          rationale: string
          recommendation: string
          resulting_status: Database["public"]["Enums"]["tafe_lifecycle"]
        }
        Insert: {
          candidate_id: string
          candidate_version?: number
          created_at?: string
          id?: string
          payload?: Json
          rationale?: string
          recommendation?: string
          resulting_status?: Database["public"]["Enums"]["tafe_lifecycle"]
        }
        Update: {
          candidate_id?: string
          candidate_version?: number
          created_at?: string
          id?: string
          payload?: Json
          rationale?: string
          recommendation?: string
          resulting_status?: Database["public"]["Enums"]["tafe_lifecycle"]
        }
        Relationships: []
      }
      tafe_goldset_cases: {
        Row: {
          attack_family: string
          case_id: string
          context: Json
          created_at: string
          expected_decision: Database["public"]["Enums"]["tafe_decision"]
          expected_findings: Json
          filter: Database["public"]["Enums"]["tafe_filter"]
          goldset: string
          id: string
          input: string
          severity: Database["public"]["Enums"]["tafe_severity"]
          source: string
          tags: string[]
          updated_at: string
          version: number
        }
        Insert: {
          attack_family?: string
          case_id: string
          context?: Json
          created_at?: string
          expected_decision?: Database["public"]["Enums"]["tafe_decision"]
          expected_findings?: Json
          filter: Database["public"]["Enums"]["tafe_filter"]
          goldset?: string
          id?: string
          input?: string
          severity?: Database["public"]["Enums"]["tafe_severity"]
          source?: string
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Update: {
          attack_family?: string
          case_id?: string
          context?: Json
          created_at?: string
          expected_decision?: Database["public"]["Enums"]["tafe_decision"]
          expected_findings?: Json
          filter?: Database["public"]["Enums"]["tafe_filter"]
          goldset?: string
          id?: string
          input?: string
          severity?: Database["public"]["Enums"]["tafe_severity"]
          source?: string
          tags?: string[]
          updated_at?: string
          version?: number
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
          attack_family: string
          canonical_form: string
          context: Json
          context_hash: string
          context_signature: string
          decision: Database["public"]["Enums"]["tafe_decision"] | null
          false_positive_count: number
          filter: Database["public"]["Enums"]["tafe_filter"] | null
          fingerprint: string
          first_seen: string
          hit_count: number
          id: string
          last_seen: string
          pattern_id: string
          risk: number
          rule_version: number
          severity: Database["public"]["Enums"]["tafe_severity"]
          source: string
          status: Database["public"]["Enums"]["tafe_lifecycle"]
          verified_count: number
          version: number
        }
        Insert: {
          attack_family?: string
          canonical_form: string
          context?: Json
          context_hash?: string
          context_signature?: string
          decision?: Database["public"]["Enums"]["tafe_decision"] | null
          false_positive_count?: number
          filter?: Database["public"]["Enums"]["tafe_filter"] | null
          fingerprint: string
          first_seen?: string
          hit_count?: number
          id?: string
          last_seen?: string
          pattern_id: string
          risk?: number
          rule_version?: number
          severity?: Database["public"]["Enums"]["tafe_severity"]
          source?: string
          status?: Database["public"]["Enums"]["tafe_lifecycle"]
          verified_count?: number
          version?: number
        }
        Update: {
          attack_family?: string
          canonical_form?: string
          context?: Json
          context_hash?: string
          context_signature?: string
          decision?: Database["public"]["Enums"]["tafe_decision"] | null
          false_positive_count?: number
          filter?: Database["public"]["Enums"]["tafe_filter"] | null
          fingerprint?: string
          first_seen?: string
          hit_count?: number
          id?: string
          last_seen?: string
          pattern_id?: string
          risk?: number
          rule_version?: number
          severity?: Database["public"]["Enums"]["tafe_severity"]
          source?: string
          status?: Database["public"]["Enums"]["tafe_lifecycle"]
          verified_count?: number
          version?: number
        }
        Relationships: []
      }
      tafe_promotions: {
        Row: {
          actor: string | null
          benchmark_version: string
          candidate_version: number
          checks: Json
          created_at: string
          dataset_hash: string
          engine_version: string
          id: string
          metrics: Json
          passed: boolean
          reason: string
          rollback_id: string | null
          rule_key: string
          ruleset_hash: string
          run_id: string
        }
        Insert: {
          actor?: string | null
          benchmark_version?: string
          candidate_version?: number
          checks?: Json
          created_at?: string
          dataset_hash?: string
          engine_version?: string
          id?: string
          metrics?: Json
          passed?: boolean
          reason?: string
          rollback_id?: string | null
          rule_key: string
          ruleset_hash?: string
          run_id: string
        }
        Update: {
          actor?: string | null
          benchmark_version?: string
          candidate_version?: number
          checks?: Json
          created_at?: string
          dataset_hash?: string
          engine_version?: string
          id?: string
          metrics?: Json
          passed?: boolean
          reason?: string
          rollback_id?: string | null
          rule_key?: string
          ruleset_hash?: string
          run_id?: string
        }
        Relationships: []
      }
      tafe_regression_runs: {
        Row: {
          adaptive_attack_success_rate: number
          attack_success_rate: number
          baseline_f1: number
          coverage: number
          created_at: string
          dataset_hash: string
          details: Json
          f1: number
          false_negative_rate: number
          false_positive_rate: number
          fn: number
          fp: number
          goldset: string
          id: string
          latency_ms: number
          passed: boolean
          precision: number
          recall: number
          regression_score: number
          rule_key: string
          rule_version: number
          run_id: string
          security_score: number
          specificity: number
          stability_score: number
          task_utility: number
          tn: number
          tp: number
          utility_score: number
        }
        Insert: {
          adaptive_attack_success_rate?: number
          attack_success_rate?: number
          baseline_f1?: number
          coverage?: number
          created_at?: string
          dataset_hash?: string
          details?: Json
          f1?: number
          false_negative_rate?: number
          false_positive_rate?: number
          fn?: number
          fp?: number
          goldset?: string
          id?: string
          latency_ms?: number
          passed?: boolean
          precision?: number
          recall?: number
          regression_score?: number
          rule_key: string
          rule_version?: number
          run_id?: string
          security_score?: number
          specificity?: number
          stability_score?: number
          task_utility?: number
          tn?: number
          tp?: number
          utility_score?: number
        }
        Update: {
          adaptive_attack_success_rate?: number
          attack_success_rate?: number
          baseline_f1?: number
          coverage?: number
          created_at?: string
          dataset_hash?: string
          details?: Json
          f1?: number
          false_negative_rate?: number
          false_positive_rate?: number
          fn?: number
          fp?: number
          goldset?: string
          id?: string
          latency_ms?: number
          passed?: boolean
          precision?: number
          recall?: number
          regression_score?: number
          rule_key?: string
          rule_version?: number
          run_id?: string
          security_score?: number
          specificity?: number
          stability_score?: number
          task_utility?: number
          tn?: number
          tp?: number
          utility_score?: number
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
      tafe_shadow_evaluations: {
        Row: {
          agreed: boolean
          created_at: string
          id: string
          matched: Json
          production_decision: Database["public"]["Enums"]["tafe_decision"]
          request_id: string
          rule_key: string
          rule_version: number
          shadow_decision: Database["public"]["Enums"]["tafe_decision"]
          would_change: boolean
        }
        Insert: {
          agreed?: boolean
          created_at?: string
          id?: string
          matched?: Json
          production_decision: Database["public"]["Enums"]["tafe_decision"]
          request_id: string
          rule_key: string
          rule_version?: number
          shadow_decision: Database["public"]["Enums"]["tafe_decision"]
          would_change?: boolean
        }
        Update: {
          agreed?: boolean
          created_at?: string
          id?: string
          matched?: Json
          production_decision?: Database["public"]["Enums"]["tafe_decision"]
          request_id?: string
          rule_key?: string
          rule_version?: number
          shadow_decision?: Database["public"]["Enums"]["tafe_decision"]
          would_change?: boolean
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
      app_role: "admin" | "user" | "provider" | "guest"
      tafe_benchmark_status:
        | "REFERENCED"
        | "INTEGRATED"
        | "VERIFIED"
        | "BROKEN"
        | "DEPRECATED"
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
        | "NEEDS_REVIEW"
        | "INVALIDATED"
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
      app_role: ["admin", "user", "provider", "guest"],
      tafe_benchmark_status: [
        "REFERENCED",
        "INTEGRATED",
        "VERIFIED",
        "BROKEN",
        "DEPRECATED",
      ],
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
        "NEEDS_REVIEW",
        "INVALIDATED",
      ],
      tafe_severity: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"],
    },
  },
} as const
