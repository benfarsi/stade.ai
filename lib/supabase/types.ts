// lib/supabase/types.ts
// Auto-generate this with: npx supabase gen types typescript --project-id YOUR_ID > lib/supabase/types.ts
// Below is a hand-crafted version matching schema.sql

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          tier: "free" | "pro";
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          subscription_status: "active" | "inactive" | "canceled" | "past_due";
          monthly_ai_calls: number;
          monthly_ai_calls_reset_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      summaries: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          source_text: string | null;
          overview: string | null;
          key_points: string[] | null;
          concepts: { term: string; definition: string }[] | null;
          quick_facts: string[] | null;
          is_public: boolean;
          share_token: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["summaries"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["summaries"]["Insert"]>;
      };
      quizzes: {
        Row: {
          id: string;
          user_id: string;
          summary_id: string | null;
          title: string;
          difficulty: "easy" | "medium" | "hard" | "mixed";
          multiple_choice: MCQuestion[] | null;
          short_answer: SAQuestion[] | null;
          question_count: number;
          is_public: boolean;
          share_token: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["quizzes"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["quizzes"]["Insert"]>;
      };
      quiz_attempts: {
        Row: {
          id: string;
          user_id: string;
          quiz_id: string;
          score: number | null;
          total: number | null;
          answers: { question_id: string; user_answer: string; correct: boolean }[] | null;
          completed_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["quiz_attempts"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["quiz_attempts"]["Insert"]>;
      };
      study_sessions: {
        Row: {
          id: string;
          user_id: string;
          summary_id: string | null;
          quiz_id: string | null;
          activity_type: "summary" | "quiz" | "review";
          duration_seconds: number | null;
          started_at: string;
          ended_at: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["study_sessions"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["study_sessions"]["Insert"]>;
      };
    };
  };
}

// Shared types
export interface MCQuestion {
  question: string;
  options: string[];
  answer: string;
  difficulty: "easy" | "medium" | "hard";
}

export interface SAQuestion {
  question: string;
  answer: string;
  difficulty: "easy" | "medium" | "hard";
}