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
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_state_proposals: {
        Row: {
          conversation_id: string | null
          created_at: string
          expires_at: string
          id: string
          proposed_label: string
          proposed_planet: string
          proposed_polarity: string
          responded_at: string | null
          status: string
          trigger_phrase: string | null
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          proposed_label: string
          proposed_planet: string
          proposed_polarity: string
          responded_at?: string | null
          status?: string
          trigger_phrase?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          proposed_label?: string
          proposed_planet?: string
          proposed_polarity?: string
          responded_at?: string | null
          status?: string
          trigger_phrase?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_state_proposals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_state_proposals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      announcements: {
        Row: {
          created_at: string | null
          created_by: string | null
          dismiss_on_click: boolean | null
          ends_at: string | null
          id: string
          is_published: boolean | null
          kind: string
          priority: number | null
          starts_at: string | null
          subtitle: Json | null
          title: Json
          updated_at: string | null
          url: string | null
          video_provider: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          dismiss_on_click?: boolean | null
          ends_at?: string | null
          id?: string
          is_published?: boolean | null
          kind: string
          priority?: number | null
          starts_at?: string | null
          subtitle?: Json | null
          title: Json
          updated_at?: string | null
          url?: string | null
          video_provider?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          dismiss_on_click?: boolean | null
          ends_at?: string | null
          id?: string
          is_published?: boolean | null
          kind?: string
          priority?: number | null
          starts_at?: string | null
          subtitle?: Json | null
          title?: Json
          updated_at?: string | null
          url?: string | null
          video_provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      astro_events_global: {
        Row: {
          computed_at: string | null
          computed_by: string | null
          event_type: string
          exact_time_utc: string
          id: string
          longitude_deg: number | null
          meta: Json | null
          participants: string[]
          significance: number
        }
        Insert: {
          computed_at?: string | null
          computed_by?: string | null
          event_type: string
          exact_time_utc: string
          id?: string
          longitude_deg?: number | null
          meta?: Json | null
          participants: string[]
          significance?: number
        }
        Update: {
          computed_at?: string | null
          computed_by?: string | null
          event_type?: string
          exact_time_utc?: string
          id?: string
          longitude_deg?: number | null
          meta?: Json | null
          participants?: string[]
          significance?: number
        }
        Relationships: []
      }
      chakras: {
        Row: {
          color_hex: string
          id: number
          name: Json
          slug: string
        }
        Insert: {
          color_hex: string
          id: number
          name: Json
          slug: string
        }
        Update: {
          color_hex?: string
          id?: number
          name?: Json
          slug?: string
        }
        Relationships: []
      }
      comment_likes: {
        Row: {
          comment_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          body: string
          body_i18n: Json
          created_at: string
          id: string
          is_hidden: boolean
          source_locale: string | null
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          body: string
          body_i18n?: Json
          created_at?: string
          id?: string
          is_hidden?: boolean
          source_locale?: string | null
          target_id: string
          target_type: string
          user_id: string
        }
        Update: {
          body?: string
          body_i18n?: Json
          created_at?: string
          id?: string
          is_hidden?: boolean
          source_locale?: string | null
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_summaries: {
        Row: {
          branch: string | null
          chakras_mentioned: number[] | null
          conversation_id: string
          generated_at: string | null
          id: string
          key_topics: Json | null
          matrix_cells: Json | null
          phase_time: string | null
          plans: Json | null
          practices_mentioned: string[] | null
          related_event_ids: string[] | null
          summary_text: string
          user_id: string
        }
        Insert: {
          branch?: string | null
          chakras_mentioned?: number[] | null
          conversation_id: string
          generated_at?: string | null
          id?: string
          key_topics?: Json | null
          matrix_cells?: Json | null
          phase_time?: string | null
          plans?: Json | null
          practices_mentioned?: string[] | null
          related_event_ids?: string[] | null
          summary_text: string
          user_id: string
        }
        Update: {
          branch?: string | null
          chakras_mentioned?: number[] | null
          conversation_id?: string
          generated_at?: string | null
          id?: string
          key_topics?: Json | null
          matrix_cells?: Json | null
          phase_time?: string | null
          plans?: Json | null
          practices_mentioned?: string[] | null
          related_event_ids?: string[] | null
          summary_text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string | null
          ended_at: string | null
          entry_source: string | null
          id: string
          last_message_at: string | null
          scenario_id: string | null
          started_at: string | null
          title: string | null
          trigger_meta: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          ended_at?: string | null
          entry_source?: string | null
          id?: string
          last_message_at?: string | null
          scenario_id?: string | null
          started_at?: string | null
          title?: string | null
          trigger_meta?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          ended_at?: string | null
          entry_source?: string | null
          id?: string
          last_message_at?: string | null
          scenario_id?: string | null
          started_at?: string | null
          title?: string | null
          trigger_meta?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_forecasts: {
        Row: {
          astro_summary: Json | null
          chakras: Json | null
          forecast_date: string
          generated_at: string | null
          id: string
          long_text_template: Json
          model: string | null
          personalization_version: number | null
          slogan_template: Json
        }
        Insert: {
          astro_summary?: Json | null
          chakras?: Json | null
          forecast_date: string
          generated_at?: string | null
          id?: string
          long_text_template: Json
          model?: string | null
          personalization_version?: number | null
          slogan_template: Json
        }
        Update: {
          astro_summary?: Json | null
          chakras?: Json | null
          forecast_date?: string
          generated_at?: string | null
          id?: string
          long_text_template?: Json
          model?: string | null
          personalization_version?: number | null
          slogan_template?: Json
        }
        Relationships: []
      }
      daily_matrices: {
        Row: {
          created_at: string
          events_count: number
          id: string
          local_date: string
          matrix: Json
          range_metric: number | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          events_count?: number
          id?: string
          local_date: string
          matrix?: Json
          range_metric?: number | null
          source: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          events_count?: number
          id?: string
          local_date?: string
          matrix?: Json
          range_metric?: number | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_matrices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      day_practice_offers: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          duration_sec: number | null
          id: string
          launch: Json
          local_date: string
          practice_id: string | null
          practice_kind: string
          practice_slug: string
          practice_summary: Json
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          launch?: Json
          local_date: string
          practice_id?: string | null
          practice_kind: string
          practice_slug: string
          practice_summary?: Json
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          launch?: Json
          local_date?: string
          practice_id?: string | null
          practice_kind?: string
          practice_slug?: string
          practice_summary?: Json
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_practice_offers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dialogue_phases: {
        Row: {
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean
          is_silent: boolean
          is_terminal: boolean
          phase_id: string
          prompt_key: string
          use_case: string
        }
        Insert: {
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean
          is_silent?: boolean
          is_terminal?: boolean
          phase_id: string
          prompt_key: string
          use_case: string
        }
        Update: {
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean
          is_silent?: boolean
          is_terminal?: boolean
          phase_id?: string
          prompt_key?: string
          use_case?: string
        }
        Relationships: []
      }
      event_reminders: {
        Row: {
          created_at: string | null
          enabled: boolean | null
          event_key: string
          event_title: string | null
          event_type: string
          fired_at: string | null
          id: string
          notify_before_minutes: number
          scheduled_for_utc: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean | null
          event_key: string
          event_title?: string | null
          event_type: string
          fired_at?: string | null
          id?: string
          notify_before_minutes: number
          scheduled_for_utc: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          enabled?: boolean | null
          event_key?: string
          event_title?: string | null
          event_type?: string
          fired_at?: string | null
          id?: string
          notify_before_minutes?: number
          scheduled_for_utc?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_reminders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      global_daily_content: {
        Row: {
          expires_at_utc: string
          forecast_date_utc: string
          generated_at: string
          llm_model: string | null
          llm_tokens_used: number | null
          long_explanation: string
          math_level: Json
          planet_positions: Json
          primary_chakra_number: number
          primary_planet: string
          primary_tone: string
          short_text: string
          slogan: string
          text_i18n: Json
          top_petals: Json
        }
        Insert: {
          expires_at_utc: string
          forecast_date_utc: string
          generated_at?: string
          llm_model?: string | null
          llm_tokens_used?: number | null
          long_explanation: string
          math_level: Json
          planet_positions: Json
          primary_chakra_number: number
          primary_planet: string
          primary_tone: string
          short_text: string
          slogan: string
          text_i18n?: Json
          top_petals: Json
        }
        Update: {
          expires_at_utc?: string
          forecast_date_utc?: string
          generated_at?: string
          llm_model?: string | null
          llm_tokens_used?: number | null
          long_explanation?: string
          math_level?: Json
          planet_positions?: Json
          primary_chakra_number?: number
          primary_planet?: string
          primary_tone?: string
          short_text?: string
          slogan?: string
          text_i18n?: Json
          top_petals?: Json
        }
        Relationships: []
      }
      health_daily: {
        Row: {
          active_energy_kcal: number | null
          activity_score: number | null
          local_date: string
          raw: Json | null
          source: string | null
          steps: number | null
          updated_at: string | null
          user_id: string
          workout_minutes: number | null
        }
        Insert: {
          active_energy_kcal?: number | null
          activity_score?: number | null
          local_date: string
          raw?: Json | null
          source?: string | null
          steps?: number | null
          updated_at?: string | null
          user_id: string
          workout_minutes?: number | null
        }
        Update: {
          active_energy_kcal?: number | null
          activity_score?: number | null
          local_date?: string
          raw?: Json | null
          source?: string | null
          steps?: number | null
          updated_at?: string | null
          user_id?: string
          workout_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "health_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      kp_forecast: {
        Row: {
          forecast_end_utc: string
          forecast_start_utc: string
          id: string
          published_at: string
          raw_payload: Json | null
          samples: Json
          source: string
        }
        Insert: {
          forecast_end_utc: string
          forecast_start_utc: string
          id?: string
          published_at: string
          raw_payload?: Json | null
          samples: Json
          source?: string
        }
        Update: {
          forecast_end_utc?: string
          forecast_start_utc?: string
          id?: string
          published_at?: string
          raw_payload?: Json | null
          samples?: Json
          source?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          audio_url: string | null
          content: string | null
          content_type: string | null
          conversation_id: string
          created_at: string | null
          emotion_segments: Json | null
          id: string
          meta: Json | null
          role: string
          transcript: string | null
          user_id: string
        }
        Insert: {
          audio_url?: string | null
          content?: string | null
          content_type?: string | null
          conversation_id: string
          created_at?: string | null
          emotion_segments?: Json | null
          id?: string
          meta?: Json | null
          role: string
          transcript?: string | null
          user_id: string
        }
        Update: {
          audio_url?: string | null
          content?: string | null
          content_type?: string | null
          conversation_id?: string
          created_at?: string | null
          emotion_segments?: Json | null
          id?: string
          meta?: Json | null
          role?: string
          transcript?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          created_at: string
          notification_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          notification_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          notification_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          link_url: string | null
          push_error_count: number
          push_sent_count: number
          recipient_count: number
          segment: string
          segment_label: string
          sent_at: string | null
          title: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          link_url?: string | null
          push_error_count?: number
          push_sent_count?: number
          recipient_count?: number
          segment: string
          segment_label: string
          sent_at?: string | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          link_url?: string | null
          push_error_count?: number
          push_sent_count?: number
          recipient_count?: number
          segment?: string
          segment_label?: string
          sent_at?: string | null
          title?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          comment: string | null
          created_at: string
          currency: string
          edited_at: string | null
          id: string
          paid_until: string | null
          source: string
          tier: string
          user_id: string
        }
        Insert: {
          amount?: number
          comment?: string | null
          created_at?: string
          currency?: string
          edited_at?: string | null
          id?: string
          paid_until?: string | null
          source?: string
          tier: string
          user_id: string
        }
        Update: {
          amount?: number
          comment?: string | null
          created_at?: string
          currency?: string
          edited_at?: string | null
          id?: string
          paid_until?: string | null
          source?: string
          tier?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      planned_events: {
        Row: {
          cells: Json
          context_snippets: Json
          conversation_id: string | null
          created_at: string
          description: string
          display_order: number | null
          expected_at: string
          explicit_time_text: string | null
          id: string
          outcome_cells: Json | null
          outcome_text: string | null
          planned_at: string
          planned_local_date: string
          recommendation_text: string | null
          status: string
          summarized_at: string | null
          time_phrase_raw: string | null
          time_resolution: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cells?: Json
          context_snippets?: Json
          conversation_id?: string | null
          created_at?: string
          description: string
          display_order?: number | null
          expected_at: string
          explicit_time_text?: string | null
          id?: string
          outcome_cells?: Json | null
          outcome_text?: string | null
          planned_at?: string
          planned_local_date: string
          recommendation_text?: string | null
          status?: string
          summarized_at?: string | null
          time_phrase_raw?: string | null
          time_resolution: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cells?: Json
          context_snippets?: Json
          conversation_id?: string | null
          created_at?: string
          description?: string
          display_order?: number | null
          expected_at?: string
          explicit_time_text?: string | null
          id?: string
          outcome_cells?: Json | null
          outcome_text?: string | null
          planned_at?: string
          planned_local_date?: string
          recommendation_text?: string | null
          status?: string
          summarized_at?: string | null
          time_phrase_raw?: string | null
          time_resolution?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planned_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          body: string
          body_i18n: Json
          cover_url: string | null
          cover_url_i18n: Json
          created_at: string
          created_by: string | null
          id: string
          is_published: boolean
          kind: string
          published_at: string | null
          title: string
          title_i18n: Json
          translations_updated_at: string | null
          updated_at: string
          webinar_id: string | null
        }
        Insert: {
          body?: string
          body_i18n?: Json
          cover_url?: string | null
          cover_url_i18n?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          kind?: string
          published_at?: string | null
          title: string
          title_i18n?: Json
          translations_updated_at?: string | null
          updated_at?: string
          webinar_id?: string | null
        }
        Update: {
          body?: string
          body_i18n?: Json
          cover_url?: string | null
          cover_url_i18n?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          kind?: string
          published_at?: string | null
          title?: string
          title_i18n?: Json
          translations_updated_at?: string | null
          updated_at?: string
          webinar_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_chakras: {
        Row: {
          chakra_id: number
          is_primary: boolean | null
          practice_id: string
          weight: number | null
        }
        Insert: {
          chakra_id: number
          is_primary?: boolean | null
          practice_id: string
          weight?: number | null
        }
        Update: {
          chakra_id?: number
          is_primary?: boolean | null
          practice_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "practice_chakras_chakra_id_fkey"
            columns: ["chakra_id"]
            isOneToOne: false
            referencedRelation: "chakras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_chakras_practice_id_fkey"
            columns: ["practice_id"]
            isOneToOne: false
            referencedRelation: "practices"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_sessions: {
        Row: {
          chakra_focus_ids: number[] | null
          completion_pct: number | null
          context: Json | null
          created_at: string | null
          duration_sec: number | null
          ended_at: string | null
          id: string
          metrics: Json | null
          practice_id: string | null
          practice_slug: string
          practice_version: number
          self_rating: number | null
          started_at: string
          user_id: string
        }
        Insert: {
          chakra_focus_ids?: number[] | null
          completion_pct?: number | null
          context?: Json | null
          created_at?: string | null
          duration_sec?: number | null
          ended_at?: string | null
          id?: string
          metrics?: Json | null
          practice_id?: string | null
          practice_slug: string
          practice_version?: number
          self_rating?: number | null
          started_at: string
          user_id: string
        }
        Update: {
          chakra_focus_ids?: number[] | null
          completion_pct?: number | null
          context?: Json | null
          created_at?: string | null
          duration_sec?: number | null
          ended_at?: string | null
          id?: string
          metrics?: Json | null
          practice_id?: string | null
          practice_slug?: string
          practice_version?: number
          self_rating?: number | null
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_sessions_practice_id_fkey"
            columns: ["practice_id"]
            isOneToOne: false
            referencedRelation: "practices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      practices: {
        Row: {
          created_at: string | null
          default_duration_sec: number | null
          description: Json | null
          id: string
          is_active: boolean | null
          kind: string
          max_duration_sec: number | null
          min_duration_sec: number | null
          params: Json | null
          rating: number | null
          slug: string
          title: Json
          updated_at: string | null
          version: number | null
          video_external_id: string | null
          video_provider: string | null
          video_url: string | null
        }
        Insert: {
          created_at?: string | null
          default_duration_sec?: number | null
          description?: Json | null
          id?: string
          is_active?: boolean | null
          kind: string
          max_duration_sec?: number | null
          min_duration_sec?: number | null
          params?: Json | null
          rating?: number | null
          slug: string
          title: Json
          updated_at?: string | null
          version?: number | null
          video_external_id?: string | null
          video_provider?: string | null
          video_url?: string | null
        }
        Update: {
          created_at?: string | null
          default_duration_sec?: number | null
          description?: Json | null
          id?: string
          is_active?: boolean | null
          kind?: string
          max_duration_sec?: number | null
          min_duration_sec?: number | null
          params?: Json | null
          rating?: number | null
          slug?: string
          title?: Json
          updated_at?: string | null
          version?: number | null
          video_external_id?: string | null
          video_provider?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      profile_report_snapshots: {
        Row: {
          active_days_count: number
          cumulative_matrix: Json
          last_rolled_date: string | null
          life_line_points: Json
          snapshot_version: number
          updated_at: string
          user_id: string
          visual_matrix: Json
        }
        Insert: {
          active_days_count?: number
          cumulative_matrix?: Json
          last_rolled_date?: string | null
          life_line_points?: Json
          snapshot_version?: number
          updated_at?: string
          user_id: string
          visual_matrix?: Json
        }
        Update: {
          active_days_count?: number
          cumulative_matrix?: Json
          last_rolled_date?: string | null
          life_line_points?: Json
          snapshot_version?: number
          updated_at?: string
          user_id?: string
          visual_matrix?: Json
        }
        Relationships: [
          {
            foreignKeyName: "profile_report_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          max_output_tokens: number | null
          model_hint: string | null
          notes: string | null
          prompt_key: string
          prompt_type: string
          response_format: string | null
          temperature: number | null
          template: string
          use_case: string | null
          variables: Json
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          max_output_tokens?: number | null
          model_hint?: string | null
          notes?: string | null
          prompt_key: string
          prompt_type: string
          response_format?: string | null
          temperature?: number | null
          template: string
          use_case?: string | null
          variables?: Json
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          max_output_tokens?: number | null
          model_hint?: string | null
          notes?: string | null
          prompt_key?: string
          prompt_type?: string
          response_format?: string | null
          temperature?: number | null
          template?: string
          use_case?: string | null
          variables?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string | null
          expo_token: boolean | null
          id: string
          is_active: boolean | null
          last_seen_at: string | null
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expo_token?: boolean | null
          id?: string
          is_active?: boolean | null
          last_seen_at?: string | null
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          expo_token?: boolean | null
          id?: string
          is_active?: boolean | null
          last_seen_at?: string | null
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      scenario_cache: {
        Row: {
          cache_key: string
          created_at: string
          data: Json
          scenario_id: string
          user_id: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          data: Json
          scenario_id: string
          user_id: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          data?: Json
          scenario_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenario_cache_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scenario_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      scenarios: {
        Row: {
          cache_strategy: string
          created_at: string
          description: string | null
          dialogue_use_case: string | null
          display_name: Json
          display_order: number | null
          id: string
          is_active: boolean
          monologue_prompt_key: string | null
          output_schema: Json | null
          scenario_type: string
          updated_at: string
        }
        Insert: {
          cache_strategy?: string
          created_at?: string
          description?: string | null
          dialogue_use_case?: string | null
          display_name: Json
          display_order?: number | null
          id: string
          is_active?: boolean
          monologue_prompt_key?: string | null
          output_schema?: Json | null
          scenario_type: string
          updated_at?: string
        }
        Update: {
          cache_strategy?: string
          created_at?: string
          description?: string | null
          dialogue_use_case?: string | null
          display_name?: Json
          display_order?: number | null
          id?: string
          is_active?: boolean
          monologue_prompt_key?: string | null
          output_schema?: Json | null
          scenario_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      stories: {
        Row: {
          caption: Json | null
          cover_url: string | null
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string
          image_url: string | null
          is_evergreen: boolean | null
          is_published: boolean | null
          kind: string
          order_hint: number | null
          publish_at: string | null
          thumbnail_url: string | null
          updated_at: string | null
          video_provider: string | null
          video_url: string | null
        }
        Insert: {
          caption?: Json | null
          cover_url?: string | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_evergreen?: boolean | null
          is_published?: boolean | null
          kind: string
          order_hint?: number | null
          publish_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          video_provider?: string | null
          video_url?: string | null
        }
        Update: {
          caption?: Json | null
          cover_url?: string | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_evergreen?: boolean | null
          is_published?: boolean | null
          kind?: string
          order_hint?: number | null
          publish_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          video_provider?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          processed_at: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          processed_at?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          processed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      support_message_attachments: {
        Row: {
          created_at: string
          id: string
          message_id: string
          mime_type: string
          size_bytes: number
          sort_order: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          mime_type: string
          size_bytes: number
          sort_order?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          mime_type?: string
          size_bytes?: number
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "support_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      tv_sessions: {
        Row: {
          audiotrack: string | null
          created_at: string
          expires_at: string
          id: string
          pairing_code: string
          status: string
          updated_at: string
          user_id: string | null
          vimeo_id: string | null
        }
        Insert: {
          audiotrack?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          pairing_code: string
          status?: string
          updated_at?: string
          user_id?: string | null
          vimeo_id?: string | null
        }
        Update: {
          audiotrack?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          pairing_code?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          vimeo_id?: string | null
        }
        Relationships: []
      }
      user_announcement_views: {
        Row: {
          announcement_id: string
          clicked_at: string | null
          dismissed_at: string | null
          seen_at: string | null
          user_id: string
        }
        Insert: {
          announcement_id: string
          clicked_at?: string | null
          dismissed_at?: string | null
          seen_at?: string | null
          user_id: string
        }
        Update: {
          announcement_id?: string
          clicked_at?: string | null
          dismissed_at?: string | null
          seen_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_announcement_views_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_announcement_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_calibrations: {
        Row: {
          based_on_version: number | null
          created_at: string
          delta_from_initial: Json
          h_calibrated: Json
          id: string
          is_active: boolean
          last_calibration_date: string
          portrait: string | null
          portrait_chunks: Json | null
          raw_feedback: Json
          s_calibrated: Json
          source: string
          states_map: Json
          user_id: string
          user_lexicon: Json
          version: number
        }
        Insert: {
          based_on_version?: number | null
          created_at?: string
          delta_from_initial: Json
          h_calibrated: Json
          id?: string
          is_active?: boolean
          last_calibration_date?: string
          portrait?: string | null
          portrait_chunks?: Json | null
          raw_feedback: Json
          s_calibrated: Json
          source: string
          states_map: Json
          user_id: string
          user_lexicon: Json
          version: number
        }
        Update: {
          based_on_version?: number | null
          created_at?: string
          delta_from_initial?: Json
          h_calibrated?: Json
          id?: string
          is_active?: boolean
          last_calibration_date?: string
          portrait?: string | null
          portrait_chunks?: Json | null
          raw_feedback?: Json
          s_calibrated?: Json
          source?: string
          states_map?: Json
          user_id?: string
          user_lexicon?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_calibrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_daily_forecasts: {
        Row: {
          activation: Json
          alternative_reason_text: string | null
          cache_valid_until: string
          computed_at: string
          corrected_at: string | null
          day_target_chakra: number | null
          day_target_fixed_at: string | null
          day_target_reason: string | null
          forecast_date: string
          id: string
          importance: Json
          is_alternative_choice: boolean
          is_corrected_via_dialog: boolean
          planet_of_the_day: string
          ranked_planets: Json
          recommendation_long_text: string | null
          recommendation_short_text: string | null
          today_planet_state: Json
          transit_chart: Json
          user_id: string
          user_timezone: string
          windows_of_opportunity: Json
        }
        Insert: {
          activation: Json
          alternative_reason_text?: string | null
          cache_valid_until: string
          computed_at?: string
          corrected_at?: string | null
          day_target_chakra?: number | null
          day_target_fixed_at?: string | null
          day_target_reason?: string | null
          forecast_date: string
          id?: string
          importance: Json
          is_alternative_choice?: boolean
          is_corrected_via_dialog?: boolean
          planet_of_the_day: string
          ranked_planets: Json
          recommendation_long_text?: string | null
          recommendation_short_text?: string | null
          today_planet_state: Json
          transit_chart: Json
          user_id: string
          user_timezone: string
          windows_of_opportunity: Json
        }
        Update: {
          activation?: Json
          alternative_reason_text?: string | null
          cache_valid_until?: string
          computed_at?: string
          corrected_at?: string | null
          day_target_chakra?: number | null
          day_target_fixed_at?: string | null
          day_target_reason?: string | null
          forecast_date?: string
          id?: string
          importance?: Json
          is_alternative_choice?: boolean
          is_corrected_via_dialog?: boolean
          planet_of_the_day?: string
          ranked_planets?: Json
          recommendation_long_text?: string | null
          recommendation_short_text?: string | null
          today_planet_state?: Json
          transit_chart?: Json
          user_id?: string
          user_timezone?: string
          windows_of_opportunity?: Json
        }
        Relationships: [
          {
            foreignKeyName: "user_daily_forecasts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_daily_stats: {
        Row: {
          chakras_touched: number[] | null
          local_date: string
          practice_count: number | null
          total_practice_seconds: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          chakras_touched?: number[] | null
          local_date: string
          practice_count?: number | null
          total_practice_seconds?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          chakras_touched?: number[] | null
          local_date?: string
          practice_count?: number | null
          total_practice_seconds?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_daily_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_event_log: {
        Row: {
          id: string
          kind: string
          occurred_at: string | null
          payload: Json | null
          user_id: string
        }
        Insert: {
          id?: string
          kind: string
          occurred_at?: string | null
          payload?: Json | null
          user_id: string
        }
        Update: {
          id?: string
          kind?: string
          occurred_at?: string | null
          payload?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_event_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_natal_charts: {
        Row: {
          ascendant_longitude: number | null
          computed_at: string
          created_at: string
          ephemeris_lib_version: string | null
          house_system: string
          id: string
          is_active: boolean
          is_day_chart: boolean
          planets: Json
          precision_mode: string
          user_id: string
          version: number
        }
        Insert: {
          ascendant_longitude?: number | null
          computed_at?: string
          created_at?: string
          ephemeris_lib_version?: string | null
          house_system: string
          id?: string
          is_active?: boolean
          is_day_chart: boolean
          planets: Json
          precision_mode: string
          user_id: string
          version: number
        }
        Update: {
          ascendant_longitude?: number | null
          computed_at?: string
          created_at?: string
          ephemeris_lib_version?: string | null
          house_system?: string
          id?: string
          is_active?: boolean
          is_day_chart?: boolean
          planets?: Json
          precision_mode?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_natal_charts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_practice_preferences: {
        Row: {
          completion_count: number
          is_favorite: boolean
          is_skipped: boolean
          last_completed_at: string | null
          practice_id: string
          user_id: string
          user_rating: number | null
        }
        Insert: {
          completion_count?: number
          is_favorite?: boolean
          is_skipped?: boolean
          last_completed_at?: string | null
          practice_id: string
          user_id: string
          user_rating?: number | null
        }
        Update: {
          completion_count?: number
          is_favorite?: boolean
          is_skipped?: boolean
          last_completed_at?: string | null
          practice_id?: string
          user_id?: string
          user_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_practice_preferences_practice_id_fkey"
            columns: ["practice_id"]
            isOneToOne: false
            referencedRelation: "practices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_practice_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profile_memory: {
        Row: {
          current_goals: Json | null
          key_facts: Json | null
          last_practice_focus_chakras: number[] | null
          recent_practices: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          current_goals?: Json | null
          key_facts?: Json | null
          last_practice_focus_chakras?: number[] | null
          recent_practices?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          current_goals?: Json | null
          key_facts?: Json | null
          last_practice_focus_chakras?: number[] | null
          recent_practices?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profile_memory_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          role: string
          user_id: string
        }
        Insert: {
          role: string
          user_id: string
        }
        Update: {
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          preferences: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          preferences?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          preferences?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_post_views: {
        Row: {
          post_id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          post_id: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          post_id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_post_views_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_post_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_story_views: {
        Row: {
          completed: boolean | null
          story_id: string
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          completed?: boolean | null
          story_id: string
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          completed?: boolean | null
          story_id?: string
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_story_views_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_story_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          address_form: string
          avatar_url: string | null
          avatar_variants: Json | null
          birth_date: string | null
          birth_place: Json | null
          birth_time: string | null
          created_at: string | null
          display_name: string | null
          id: string
          lat: number | null
          locale: string | null
          location_name: string | null
          lon: number | null
          membership_expires_at: string | null
          membership_tier: string
          onboarded_at: string | null
          trial_expires_at: string | null
          tz: string | null
          updated_at: string | null
        }
        Insert: {
          address_form?: string
          avatar_url?: string | null
          avatar_variants?: Json | null
          birth_date?: string | null
          birth_place?: Json | null
          birth_time?: string | null
          created_at?: string | null
          display_name?: string | null
          id: string
          lat?: number | null
          locale?: string | null
          location_name?: string | null
          lon?: number | null
          membership_expires_at?: string | null
          membership_tier?: string
          onboarded_at?: string | null
          trial_expires_at?: string | null
          tz?: string | null
          updated_at?: string | null
        }
        Update: {
          address_form?: string
          avatar_url?: string | null
          avatar_variants?: Json | null
          birth_date?: string | null
          birth_place?: Json | null
          birth_time?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          lat?: number | null
          locale?: string | null
          location_name?: string | null
          lon?: number | null
          membership_expires_at?: string | null
          membership_tier?: string
          onboarded_at?: string | null
          trial_expires_at?: string | null
          tz?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      webinar_registrations: {
        Row: {
          created_at: string
          user_id: string
          webinar_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
          webinar_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
          webinar_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_registrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_registrations_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
        ]
      }
      webinars: {
        Row: {
          cover_url: string | null
          cover_url_i18n: Json
          created_at: string
          description: string
          description_i18n: Json
          id: string
          is_published: boolean
          join_url: string | null
          recording_url: string | null
          starts_at: string
          title: string
          title_i18n: Json
          translations_updated_at: string | null
          updated_at: string
        }
        Insert: {
          cover_url?: string | null
          cover_url_i18n?: Json
          created_at?: string
          description?: string
          description_i18n?: Json
          id?: string
          is_published?: boolean
          join_url?: string | null
          recording_url?: string | null
          starts_at: string
          title: string
          title_i18n?: Json
          translations_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          cover_url?: string | null
          cover_url_i18n?: Json
          created_at?: string
          description?: string
          description_i18n?: Json
          id?: string
          is_published?: boolean
          join_url?: string | null
          recording_url?: string | null
          starts_at?: string
          title?: string
          title_i18n?: Json
          translations_updated_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_active_users_count: { Args: { p_hours: number }; Returns: number }
      admin_dashboard_metrics: { Args: never; Returns: Json }
      admin_llm_metrics: { Args: { p_window: string }; Returns: Json }
      admin_search_users: {
        Args: { p_limit?: number; p_query?: string; p_tier?: string }
        Returns: {
          created_at: string
          display_name: string
          email: string
          id: string
          membership_expires_at: string
          membership_tier: string
          trial_expires_at: string
        }[]
      }
      get_posts_feed: {
        Args: {
          p_limit?: number
          p_locale?: string | null
          p_before_published_at?: string | null
          p_before_id?: string | null
        }
        Returns: {
          body: string
          body_i18n: Json
          comment_count: number
          cover_url: string
          cover_url_i18n: Json
          id: string
          kind: string
          published_at: string
          title: string
          title_i18n: Json
          webinar_id: string | null
        }[]
      }
      get_target_comments: {
        Args: { p_target_id: string; p_target_type: string; p_user_id: string }
        Returns: {
          body: string
          body_i18n: Json
          created_at: string
          display_name: string
          id: string
          is_mine: boolean
          like_count: number
          liked_by_me: boolean
          source_locale: string
          user_id: string
        }[]
      }
      get_user_announcement: {
        Args: { p_user_id: string }
        Returns: {
          dismiss_on_click: boolean
          ends_at: string
          id: string
          kind: string
          priority: number
          starts_at: string
          subtitle: Json
          title: Json
          url: string
          video_provider: string
        }[]
      }
      get_user_stories: {
        Args: { p_user_id: string }
        Returns: {
          caption: Json
          cover_url: string
          expires_at: string
          id: string
          image_url: string
          is_fresh: boolean
          kind: string
          publish_at: string
          video_provider: string
          video_url: string
        }[]
      }
      get_story_feed: {
        Args: { p_user_id: string }
        Returns: {
          caption: Json
          cover_url: string
          expires_at: string
          id: string
          image_url: string
          is_viewed: boolean
          kind: string
          publish_at: string
          thumbnail_url: string
          video_provider: string
          video_url: string
        }[]
      }
      invoke_precompute_global_recommendations: { Args: never; Returns: number }
      is_admin: { Args: { uid: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
