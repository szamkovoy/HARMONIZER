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
  public: {
    Tables: {
      access_promo_grants: {
        Row: {
          created_at: string
          kind: string
          previous_expires_at: string | null
          previous_tier: string
          previous_trial_expires_at: string | null
          revert_at: string
          reverted_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          kind: string
          previous_expires_at?: string | null
          previous_tier: string
          previous_trial_expires_at?: string | null
          revert_at: string
          reverted_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          previous_expires_at?: string | null
          previous_tier?: string
          previous_trial_expires_at?: string | null
          revert_at?: string
          reverted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_promo_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
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
      book_reading_progress: {
        Row: {
          book_id: string
          chapter_label: string | null
          href: string | null
          locale: string
          locator: string
          percent: number | null
          snippet: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          chapter_label?: string | null
          href?: string | null
          locale: string
          locator: string
          percent?: number | null
          snippet?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          chapter_label?: string | null
          href?: string | null
          locale?: string
          locator?: string
          percent?: number | null
          snippet?: string | null
          updated_at?: string
          user_id?: string
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
      crm_product_legacy_ids: {
        Row: {
          legacy_group_id: number
          product_id: string
        }
        Insert: {
          legacy_group_id: number
          product_id: string
        }
        Update: {
          legacy_group_id?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_product_legacy_ids_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_products: {
        Row: {
          created_at: string
          id: string
          slug: string
          sort_order: number
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          slug: string
          sort_order?: number
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          slug?: string
          sort_order?: number
          title?: string
        }
        Relationships: []
      }
      daily_dialog_archives: {
        Row: {
          algo_version: string | null
          closed_at: string | null
          conversation_id: string
          day_tab_mode: string | null
          entry_source: string | null
          id: string
          last_branch: string | null
          last_should_close: boolean | null
          last_turn_mode: string | null
          locale: string | null
          outcome: string
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          started_at: string
          turns: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          algo_version?: string | null
          closed_at?: string | null
          conversation_id: string
          day_tab_mode?: string | null
          entry_source?: string | null
          id?: string
          last_branch?: string | null
          last_should_close?: boolean | null
          last_turn_mode?: string | null
          locale?: string | null
          outcome?: string
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          started_at?: string
          turns?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          algo_version?: string | null
          closed_at?: string | null
          conversation_id?: string
          day_tab_mode?: string | null
          entry_source?: string | null
          id?: string
          last_branch?: string | null
          last_should_close?: boolean | null
          last_turn_mode?: string | null
          locale?: string | null
          outcome?: string
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          started_at?: string
          turns?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_dialog_archives_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_dialog_archives_user_id_fkey"
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
      daily_precompute_claims: {
        Row: {
          claimed_at: string
          local_date: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          local_date: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          local_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_precompute_claims_user_id_fkey"
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
      email_assets: {
        Row: {
          created_at: string
          id: string
          path: string
          public_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          path: string
          public_url: string
        }
        Update: {
          created_at?: string
          id?: string
          path?: string
          public_url?: string
        }
        Relationships: []
      }
      email_automation_enrollments: {
        Row: {
          automation_id: string
          contact_id: string
          created_at: string
          current_position: number
          cycle_key: string | null
          id: string
          next_step_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          automation_id: string
          contact_id: string
          created_at?: string
          current_position?: number
          cycle_key?: string | null
          id?: string
          next_step_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          automation_id?: string
          contact_id?: string
          created_at?: string
          current_position?: number
          cycle_key?: string | null
          id?: string
          next_step_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_automation_enrollments_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "email_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "email_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_automation_sends: {
        Row: {
          automation_id: string
          contact_id: string
          created_at: string
          enrollment_id: string | null
          error_detail: string | null
          id: string
          resend_id: string | null
          status: string
          step_id: string | null
          subject: string
        }
        Insert: {
          automation_id: string
          contact_id: string
          created_at?: string
          enrollment_id?: string | null
          error_detail?: string | null
          id?: string
          resend_id?: string | null
          status?: string
          step_id?: string | null
          subject?: string
        }
        Update: {
          automation_id?: string
          contact_id?: string
          created_at?: string
          enrollment_id?: string | null
          error_detail?: string | null
          id?: string
          resend_id?: string | null
          status?: string
          step_id?: string | null
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_automation_sends_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "email_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_sends_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "email_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_sends_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "email_automation_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_sends_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "email_automation_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      email_automation_steps: {
        Row: {
          automation_id: string
          blocks_i18n: Json
          bounced_count: number
          clicked_count: number
          complained_count: number
          created_at: string
          delay_hours: number
          delivered_count: number
          failed_count: number
          html_body: string
          html_body_i18n: Json
          id: string
          name: string
          opened_count: number
          position: number
          sent_count: number
          subject: string
          subject_i18n: Json
          updated_at: string
        }
        Insert: {
          automation_id: string
          blocks_i18n?: Json
          bounced_count?: number
          clicked_count?: number
          complained_count?: number
          created_at?: string
          delay_hours?: number
          delivered_count?: number
          failed_count?: number
          html_body?: string
          html_body_i18n?: Json
          id?: string
          name?: string
          opened_count?: number
          position: number
          sent_count?: number
          subject?: string
          subject_i18n?: Json
          updated_at?: string
        }
        Update: {
          automation_id?: string
          blocks_i18n?: Json
          bounced_count?: number
          clicked_count?: number
          complained_count?: number
          created_at?: string
          delay_hours?: number
          delivered_count?: number
          failed_count?: number
          html_body?: string
          html_body_i18n?: Json
          id?: string
          name?: string
          opened_count?: number
          position?: number
          sent_count?: number
          subject?: string
          subject_i18n?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_automation_steps_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "email_automations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_automations: {
        Row: {
          activated_at: string | null
          created_at: string
          id: string
          is_active: boolean
          key: string
          name: string
          paused_at: string | null
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          name: string
          paused_at?: string | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          paused_at?: string | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_campaign_access_grants: {
        Row: {
          campaign_id: string
          created_at: string
          kind: string
          previous_expires_at: string | null
          previous_tier: string | null
          previous_trial_expires_at: string | null
          revert_at: string
          reverted_at: string | null
          user_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          kind: string
          previous_expires_at?: string | null
          previous_tier?: string | null
          previous_trial_expires_at?: string | null
          revert_at: string
          reverted_at?: string | null
          user_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          kind?: string
          previous_expires_at?: string | null
          previous_tier?: string | null
          previous_trial_expires_at?: string | null
          revert_at?: string
          reverted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_access_grants_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_access_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_sends: {
        Row: {
          batch_key: string | null
          campaign_id: string
          claimed_at: string | null
          contact_id: string
          created_at: string
          error_detail: string | null
          id: string
          locale: string
          resend_id: string | null
          status: string
        }
        Insert: {
          batch_key?: string | null
          campaign_id: string
          claimed_at?: string | null
          contact_id: string
          created_at?: string
          error_detail?: string | null
          id?: string
          locale: string
          resend_id?: string | null
          status?: string
        }
        Update: {
          batch_key?: string | null
          campaign_id?: string
          claimed_at?: string | null
          contact_id?: string
          created_at?: string
          error_detail?: string | null
          id?: string
          locale?: string
          resend_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_sends_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "email_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          audience_cap: number | null
          blocks_i18n: Json
          bounced_count: number
          clicked_count: number
          complained_count: number
          created_at: string
          delivered_count: number
          error_count: number
          html_body: string
          html_body_i18n: Json
          id: string
          name: string
          next_wave_at: string | null
          next_wave_size: number | null
          opened_count: number
          recipient_count: number
          segment_query: Json
          send_halt_reason: string | null
          send_halted_at: string | null
          send_lease_until: string | null
          send_slow_strikes: number
          sent_at: string | null
          sent_count: number
          skipped_locale_count: number
          status: string
          subject: string
          subject_i18n: Json
          unsubscribed_count: number
          updated_at: string
          warmup_plan: Json
          warmup_wave_index: number
        }
        Insert: {
          audience_cap?: number | null
          blocks_i18n?: Json
          bounced_count?: number
          clicked_count?: number
          complained_count?: number
          created_at?: string
          delivered_count?: number
          error_count?: number
          html_body?: string
          html_body_i18n?: Json
          id?: string
          name?: string
          next_wave_at?: string | null
          next_wave_size?: number | null
          opened_count?: number
          recipient_count?: number
          segment_query?: Json
          send_halt_reason?: string | null
          send_halted_at?: string | null
          send_lease_until?: string | null
          send_slow_strikes?: number
          sent_at?: string | null
          sent_count?: number
          skipped_locale_count?: number
          status?: string
          subject?: string
          subject_i18n?: Json
          unsubscribed_count?: number
          updated_at?: string
          warmup_plan?: Json
          warmup_wave_index?: number
        }
        Update: {
          audience_cap?: number | null
          blocks_i18n?: Json
          bounced_count?: number
          clicked_count?: number
          complained_count?: number
          created_at?: string
          delivered_count?: number
          error_count?: number
          html_body?: string
          html_body_i18n?: Json
          id?: string
          name?: string
          next_wave_at?: string | null
          next_wave_size?: number | null
          opened_count?: number
          recipient_count?: number
          segment_query?: Json
          send_halt_reason?: string | null
          send_halted_at?: string | null
          send_lease_until?: string | null
          send_slow_strikes?: number
          sent_at?: string | null
          sent_count?: number
          skipped_locale_count?: number
          status?: string
          subject?: string
          subject_i18n?: Json
          unsubscribed_count?: number
          updated_at?: string
          warmup_plan?: Json
          warmup_wave_index?: number
        }
        Relationships: []
      }
      email_contacts: {
        Row: {
          country_code: string | null
          created_at: string
          email: string
          email_normalized: string
          engagement_score: number
          id: string
          last_click_at: string | null
          last_open_at: string | null
          last_sent_at: string | null
          locale: string
          marketing_status: string
          source: string
          unsubscribe_token: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          email: string
          email_normalized: string
          engagement_score?: number
          id?: string
          last_click_at?: string | null
          last_open_at?: string | null
          last_sent_at?: string | null
          locale?: string
          marketing_status?: string
          source?: string
          unsubscribe_token?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          country_code?: string | null
          created_at?: string
          email?: string
          email_normalized?: string
          engagement_score?: number
          id?: string
          last_click_at?: string | null
          last_open_at?: string | null
          last_sent_at?: string | null
          locale?: string
          marketing_status?: string
          source?: string
          unsubscribe_token?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          campaign_id: string | null
          contact_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          resend_id: string | null
          send_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          resend_id?: string | null
          send_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          resend_id?: string | null
          send_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "email_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "email_campaign_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_pace: {
        Row: {
          batch_limit: number
          claim_interval_seconds: number
          id: number
          updated_at: string
        }
        Insert: {
          batch_limit?: number
          claim_interval_seconds?: number
          id?: number
          updated_at?: string
        }
        Update: {
          batch_limit?: number
          claim_interval_seconds?: number
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_tracking_keys: {
        Row: {
          campaign_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          resend_id: string | null
          send_id: string | null
          step_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          resend_id?: string | null
          send_id?: string | null
          step_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          resend_id?: string | null
          send_id?: string | null
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_tracking_keys_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_tracking_keys_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "email_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_tracking_keys_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "email_campaign_sends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_tracking_keys_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "email_automation_steps"
            referencedColumns: ["id"]
          },
        ]
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
      fx_daily_quotes: {
        Row: {
          created_at: string
          pairs: Json
          quote_date: string
          source: string
          tbank_failed: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          pairs: Json
          quote_date: string
          source: string
          tbank_failed?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          pairs?: Json
          quote_date?: string
          source?: string
          tbank_failed?: boolean
          updated_at?: string
        }
        Relationships: []
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
          body: string | null
          created_at: string
          id: string
          kind: string
          link_url: string | null
          notification_id: string | null
          read_at: string | null
          source_key: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link_url?: string | null
          notification_id?: string | null
          read_at?: string | null
          source_key?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link_url?: string | null
          notification_id?: string | null
          read_at?: string | null
          source_key?: string | null
          title?: string | null
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
          body_i18n: Json
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
          title_i18n: Json
        }
        Insert: {
          body?: string
          body_i18n?: Json
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
          title_i18n?: Json
        }
        Update: {
          body?: string
          body_i18n?: Json
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
          title_i18n?: Json
        }
        Relationships: []
      }
      otp_send_events: {
        Row: {
          created_at: string
          email: string
          id: number
        }
        Insert: {
          created_at?: string
          email: string
          id?: number
        }
        Update: {
          created_at?: string
          email?: string
          id?: number
        }
        Relationships: []
      }
      otp_send_permits: {
        Row: {
          app_id: string | null
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
        }
        Insert: {
          app_id?: string | null
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
        }
        Update: {
          app_id?: string | null
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
        }
        Relationships: []
      }
      otp_verify_failures: {
        Row: {
          created_at: string
          email: string
          id: number
        }
        Insert: {
          created_at?: string
          email: string
          id?: number
        }
        Update: {
          created_at?: string
          email?: string
          id?: number
        }
        Relationships: []
      }
      payment_alert_sends: {
        Row: {
          contract_id: string
          event_type: string
          sent_at: string
        }
        Insert: {
          contract_id: string
          event_type: string
          sent_at?: string
        }
        Update: {
          contract_id?: string
          event_type?: string
          sent_at?: string
        }
        Relationships: []
      }
      payment_catalog: {
        Row: {
          active: boolean
          amount: number
          created_at: string
          currency: string
          description: string | null
          id: string
          lava_offer_id: string | null
          letter_body_i18n: Json
          letter_subject_i18n: Json
          product_kind: string
          provider: string
          sort_order: number
          tier: string
          title: string
          updated_at: string
          webinar_credits: number | null
          webinar_window_days: number | null
        }
        Insert: {
          active?: boolean
          amount: number
          created_at?: string
          currency: string
          description?: string | null
          id?: string
          lava_offer_id?: string | null
          letter_body_i18n?: Json
          letter_subject_i18n?: Json
          product_kind: string
          provider: string
          sort_order?: number
          tier: string
          title: string
          updated_at?: string
          webinar_credits?: number | null
          webinar_window_days?: number | null
        }
        Update: {
          active?: boolean
          amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          lava_offer_id?: string | null
          letter_body_i18n?: Json
          letter_subject_i18n?: Json
          product_kind?: string
          provider?: string
          sort_order?: number
          tier?: string
          title?: string
          updated_at?: string
          webinar_credits?: number | null
          webinar_window_days?: number | null
        }
        Relationships: []
      }
      payment_contracts: {
        Row: {
          amount: number | null
          buyer_email: string | null
          buyer_letter_sent_at: string | null
          buyer_locale: string | null
          buyer_name: string | null
          cancelled_at: string | null
          catalog_id: string | null
          contract_id: string
          created_at: string
          currency: string
          current_period_end: string | null
          failed_notice_sent_at: string | null
          failure_reason: string | null
          fee_rate: number | null
          fx_source: string | null
          id: string
          net_amount_eur: number | null
          net_amount_rub: number | null
          net_amount_usd: number | null
          page_url: string | null
          pass_reminder_sent_at: string | null
          payment_method_id: string | null
          periodicity: string
          product_kind: string
          product_ref: string | null
          provider: string
          provider_payment_id: string | null
          refunded_at: string | null
          renew_fail_count: number
          source: string
          status: string
          tier: string
          updated_at: string
          user_id: string | null
          widget_id: string | null
        }
        Insert: {
          amount?: number | null
          buyer_email?: string | null
          buyer_letter_sent_at?: string | null
          buyer_locale?: string | null
          buyer_name?: string | null
          cancelled_at?: string | null
          catalog_id?: string | null
          contract_id: string
          created_at?: string
          currency: string
          current_period_end?: string | null
          failed_notice_sent_at?: string | null
          failure_reason?: string | null
          fee_rate?: number | null
          fx_source?: string | null
          id?: string
          net_amount_eur?: number | null
          net_amount_rub?: number | null
          net_amount_usd?: number | null
          page_url?: string | null
          pass_reminder_sent_at?: string | null
          payment_method_id?: string | null
          periodicity?: string
          product_kind?: string
          product_ref?: string | null
          provider?: string
          provider_payment_id?: string | null
          refunded_at?: string | null
          renew_fail_count?: number
          source?: string
          status?: string
          tier: string
          updated_at?: string
          user_id?: string | null
          widget_id?: string | null
        }
        Update: {
          amount?: number | null
          buyer_email?: string | null
          buyer_letter_sent_at?: string | null
          buyer_locale?: string | null
          buyer_name?: string | null
          cancelled_at?: string | null
          catalog_id?: string | null
          contract_id?: string
          created_at?: string
          currency?: string
          current_period_end?: string | null
          failed_notice_sent_at?: string | null
          failure_reason?: string | null
          fee_rate?: number | null
          fx_source?: string | null
          id?: string
          net_amount_eur?: number | null
          net_amount_rub?: number | null
          net_amount_usd?: number | null
          page_url?: string | null
          pass_reminder_sent_at?: string | null
          payment_method_id?: string | null
          periodicity?: string
          product_kind?: string
          product_ref?: string | null
          provider?: string
          provider_payment_id?: string | null
          refunded_at?: string | null
          renew_fail_count?: number
          source?: string
          status?: string
          tier?: string
          updated_at?: string
          user_id?: string | null
          widget_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_contracts_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "payment_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_contracts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_contracts_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "payment_widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          amount: number | null
          buyer_email: string | null
          contract_id: string | null
          created_at: string
          currency: string | null
          error_message: string | null
          event_type: string
          handled_result: Json | null
          http_status: number | null
          id: string
          parent_contract_id: string | null
          provider: string
          raw: Json | null
          status: string | null
        }
        Insert: {
          amount?: number | null
          buyer_email?: string | null
          contract_id?: string | null
          created_at?: string
          currency?: string | null
          error_message?: string | null
          event_type: string
          handled_result?: Json | null
          http_status?: number | null
          id?: string
          parent_contract_id?: string | null
          provider: string
          raw?: Json | null
          status?: string | null
        }
        Update: {
          amount?: number | null
          buyer_email?: string | null
          contract_id?: string | null
          created_at?: string
          currency?: string | null
          error_message?: string | null
          event_type?: string
          handled_result?: Json | null
          http_status?: number | null
          id?: string
          parent_contract_id?: string | null
          provider?: string
          raw?: Json | null
          status?: string | null
        }
        Relationships: []
      }
      payment_offers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          locale: string
          offer_id: string
          tier: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          locale: string
          offer_id: string
          tier: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          locale?: string
          offer_id?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_settlements: {
        Row: {
          amount: number
          contract_id: string
          created_at: string
          currency: string
          event_type: string
          fee_rate: number
          fx_source: string
          id: string
          net_amount_eur: number
          net_amount_rub: number
          net_amount_usd: number
          paid_at: string
          provider: string
          refunded_at: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          contract_id: string
          created_at?: string
          currency: string
          event_type: string
          fee_rate: number
          fx_source: string
          id?: string
          net_amount_eur: number
          net_amount_rub: number
          net_amount_usd: number
          paid_at: string
          provider?: string
          refunded_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          contract_id?: string
          created_at?: string
          currency?: string
          event_type?: string
          fee_rate?: number
          fx_source?: string
          id?: string
          net_amount_eur?: number
          net_amount_rub?: number
          net_amount_usd?: number
          paid_at?: string
          provider?: string
          refunded_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_settlements_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "payment_contracts"
            referencedColumns: ["contract_id"]
          },
          {
            foreignKeyName: "payment_settlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_widgets: {
        Row: {
          active: boolean
          catalog_id: string | null
          config: Json
          created_at: string
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          catalog_id?: string | null
          config?: Json
          created_at?: string
          id?: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          catalog_id?: string | null
          config?: Json
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_widgets_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "payment_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          buyer_email: string | null
          comment: string | null
          created_at: string
          currency: string
          edited_at: string | null
          fx_source: string | null
          id: string
          net_amount_eur: number | null
          net_amount_rub: number | null
          net_amount_usd: number | null
          paid_until: string | null
          source: string
          tier: string
          user_id: string | null
        }
        Insert: {
          amount?: number
          buyer_email?: string | null
          comment?: string | null
          created_at?: string
          currency?: string
          edited_at?: string | null
          fx_source?: string | null
          id?: string
          net_amount_eur?: number | null
          net_amount_rub?: number | null
          net_amount_usd?: number | null
          paid_until?: string | null
          source?: string
          tier: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          buyer_email?: string | null
          comment?: string | null
          created_at?: string
          currency?: string
          edited_at?: string | null
          fx_source?: string | null
          id?: string
          net_amount_eur?: number | null
          net_amount_rub?: number | null
          net_amount_usd?: number | null
          paid_until?: string | null
          source?: string
          tier?: string
          user_id?: string | null
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
          duration_seconds: number | null
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
          duration_seconds?: number | null
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
          duration_seconds?: number | null
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
      restore_credential_challenges: {
        Row: {
          challenge: string
          created_at: string
          expires_at: string
          flow: string
          id: string
          rp_id: string
          user_id: string | null
        }
        Insert: {
          challenge: string
          created_at?: string
          expires_at?: string
          flow: string
          id?: string
          rp_id: string
          user_id?: string | null
        }
        Update: {
          challenge?: string
          created_at?: string
          expires_at?: string
          flow?: string
          id?: string
          rp_id?: string
          user_id?: string | null
        }
        Relationships: []
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
      signin_name_hints: {
        Row: {
          email: string
          locale: string | null
          name: string
          updated_at: string
        }
        Insert: {
          email: string
          locale?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          email?: string
          locale?: string | null
          name?: string
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
      stt_circuit_breaker: {
        Row: {
          blocked_until: string
          consecutive_fallback_count: number
          key: string
          last_error: string | null
          updated_at: string
        }
        Insert: {
          blocked_until?: string
          consecutive_fallback_count?: number
          key: string
          last_error?: string | null
          updated_at?: string
        }
        Update: {
          blocked_until?: string
          consecutive_fallback_count?: number
          key?: string
          last_error?: string | null
          updated_at?: string
        }
        Relationships: []
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
      user_affirmations: {
        Row: {
          audio_url: string | null
          created_at: string
          current_day: number
          cycle_started_at: string
          id: string
          last_practiced_at: string | null
          status: string
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          current_day?: number
          cycle_started_at?: string
          id?: string
          last_practiced_at?: string | null
          status?: string
          text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          current_day?: number
          cycle_started_at?: string
          id?: string
          last_practiced_at?: string | null
          status?: string
          text?: string
          updated_at?: string
          user_id?: string
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
      user_crm_products: {
        Row: {
          created_at: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_crm_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "crm_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_crm_products_user_id_fkey"
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
      user_restore_credentials: {
        Row: {
          counter: number
          created_at: string
          credential_id: string
          public_key: string
          rp_id: string
          transports: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          counter?: number
          created_at?: string
          credential_id: string
          public_key: string
          rp_id: string
          transports?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          counter?: number
          created_at?: string
          credential_id?: string
          public_key?: string
          rp_id?: string
          transports?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          admin_note: string | null
          app_first_open_at: string | null
          avatar_url: string | null
          avatar_variants: Json | null
          birth_date: string | null
          birth_place: Json | null
          birth_time: string | null
          city: string | null
          country_code: string | null
          created_at: string | null
          crm_imported_at: string | null
          display_name: string | null
          geo_place_lat: number | null
          geo_place_lon: number | null
          getcourse_last_activity_at: string | null
          id: string
          last_name: string | null
          last_seen_at: string | null
          lat: number | null
          locale: string | null
          location_name: string | null
          lon: number | null
          membership_expires_at: string | null
          membership_started_at: string | null
          membership_tier: string
          onboarded_at: string | null
          phone: string | null
          skip_email_automations: boolean
          store_review_account: boolean
          trial_expires_at: string | null
          tz: string | null
          updated_at: string | null
        }
        Insert: {
          address_form?: string
          admin_note?: string | null
          app_first_open_at?: string | null
          avatar_url?: string | null
          avatar_variants?: Json | null
          birth_date?: string | null
          birth_place?: Json | null
          birth_time?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string | null
          crm_imported_at?: string | null
          display_name?: string | null
          geo_place_lat?: number | null
          geo_place_lon?: number | null
          getcourse_last_activity_at?: string | null
          id: string
          last_name?: string | null
          last_seen_at?: string | null
          lat?: number | null
          locale?: string | null
          location_name?: string | null
          lon?: number | null
          membership_expires_at?: string | null
          membership_started_at?: string | null
          membership_tier?: string
          onboarded_at?: string | null
          phone?: string | null
          skip_email_automations?: boolean
          store_review_account?: boolean
          trial_expires_at?: string | null
          tz?: string | null
          updated_at?: string | null
        }
        Update: {
          address_form?: string
          admin_note?: string | null
          app_first_open_at?: string | null
          avatar_url?: string | null
          avatar_variants?: Json | null
          birth_date?: string | null
          birth_place?: Json | null
          birth_time?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string | null
          crm_imported_at?: string | null
          display_name?: string | null
          geo_place_lat?: number | null
          geo_place_lon?: number | null
          getcourse_last_activity_at?: string | null
          id?: string
          last_name?: string | null
          last_seen_at?: string | null
          lat?: number | null
          locale?: string | null
          location_name?: string | null
          lon?: number | null
          membership_expires_at?: string | null
          membership_started_at?: string | null
          membership_tier?: string
          onboarded_at?: string | null
          phone?: string | null
          skip_email_automations?: boolean
          store_review_account?: boolean
          trial_expires_at?: string | null
          tz?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      web_ott_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_ott_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_notice_sends: {
        Row: {
          kind: string
          locale: string
          sent_at: string
          user_id: string
          webinar_id: string
        }
        Insert: {
          kind: string
          locale: string
          sent_at?: string
          user_id: string
          webinar_id: string
        }
        Update: {
          kind?: string
          locale?: string
          sent_at?: string
          user_id?: string
          webinar_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_notice_sends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_notice_sends_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_passes: {
        Row: {
          contract_id: string
          created_at: string
          credits: number
          id: string
          status: string
          user_id: string
          valid_from: string
          valid_until: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          credits: number
          id?: string
          status?: string
          user_id: string
          valid_from: string
          valid_until: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          credits?: number
          id?: string
          status?: string
          user_id?: string
          valid_from?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_passes_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: true
            referencedRelation: "payment_contracts"
            referencedColumns: ["contract_id"]
          },
          {
            foreignKeyName: "webinar_passes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_registrations: {
        Row: {
          created_at: string
          join_email_sent_at: string | null
          pass_id: string | null
          user_id: string
          webinar_id: string
        }
        Insert: {
          created_at?: string
          join_email_sent_at?: string | null
          pass_id?: string | null
          user_id: string
          webinar_id: string
        }
        Update: {
          created_at?: string
          join_email_sent_at?: string | null
          pass_id?: string | null
          user_id?: string
          webinar_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_registrations_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "webinar_passes"
            referencedColumns: ["id"]
          },
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
          start_notified_at: string | null
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
          start_notified_at?: string | null
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
          start_notified_at?: string | null
          starts_at?: string
          title?: string
          title_i18n?: Json
          translations_updated_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      yookassa_payment_methods: {
        Row: {
          card_last4: string | null
          created_at: string
          id: string
          payment_method_id: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          card_last4?: string | null
          created_at?: string
          id?: string
          payment_method_id: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          card_last4?: string | null
          created_at?: string
          id?: string
          payment_method_id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "yookassa_payment_methods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _cron_secret: { Args: { p_preferred?: string }; Returns: string }
      _otp_email_ok: { Args: { p_email: string }; Returns: boolean }
      _otp_normalize_email: { Args: { p_email: string }; Returns: string }
      _precompute_local_date: { Args: { p_tz: string }; Returns: string }
      admin_active_users_count: { Args: { p_hours: number }; Returns: number }
      admin_count_users: {
        Args: {
          p_access?: string
          p_city?: string
          p_country_code?: string
          p_created_from?: string
          p_created_to?: string
          p_crm_product_slug?: string
          p_last_seen_older_than_days?: number
          p_last_seen_within_days?: number
          p_locale?: string
          p_marketing_status?: string
          p_onboarded_from?: string
          p_onboarded_to?: string
          p_query?: string
          p_tier?: string
        }
        Returns: number
      }
      admin_dashboard_metrics: { Args: never; Returns: Json }
      admin_dashboard_pulse: {
        Args: { p_days?: number; p_grain?: string }
        Returns: Json
      }
      admin_llm_metrics: { Args: { p_window: string }; Returns: Json }
      admin_search_users: {
        Args: {
          p_access?: string
          p_city?: string
          p_country_code?: string
          p_created_from?: string
          p_created_to?: string
          p_crm_product_slug?: string
          p_last_seen_older_than_days?: number
          p_last_seen_within_days?: number
          p_limit?: number
          p_locale?: string
          p_marketing_status?: string
          p_offset?: number
          p_onboarded_from?: string
          p_onboarded_to?: string
          p_order?: string
          p_query?: string
          p_sort?: string
          p_tier?: string
        }
        Returns: {
          city: string
          country_code: string
          created_at: string
          crm_imported_at: string
          display_name: string
          email: string
          getcourse_last_activity_at: string
          id: string
          last_name: string
          last_seen_at: string
          locale: string
          marketing_status: string
          membership_expires_at: string
          membership_started_at: string
          membership_tier: string
          onboarded_at: string
          phone: string
          trial_expires_at: string
        }[]
      }
      admin_summary_report: {
        Args: { p_test_emails?: string[]; p_weeks?: number }
        Returns: Json
      }
      admin_user_access_segment: {
        Args: {
          p_membership_expires_at: string
          p_tier: string
          p_trial_expires_at: string
        }
        Returns: string
      }
      append_daily_dialog_archive: {
        Args: {
          p_algo_version: string
          p_conversation_id: string
          p_day_tab_mode: string
          p_entry_source: string
          p_last_branch: string
          p_last_should_close: boolean
          p_last_turn_mode: string
          p_locale: string
          p_outcome: string
          p_turns: Json
          p_user_id: string
        }
        Returns: undefined
      }
      apply_email_campaign_delivery: {
        Args: {
          p_counter?: string
          p_detail?: Json
          p_event_type: string
          p_record_event?: boolean
          p_resend_id: string
          p_send_status?: string
          p_suppress_status?: string
          p_touch?: string
        }
        Returns: Json
      }
      apply_my_webinar_passes: { Args: never; Returns: number }
      apply_webinar_passes: { Args: { p_user_id?: string }; Returns: number }
      claim_email_campaign_batch: {
        Args: {
          p_campaign_id: string
          p_limit?: number
          p_stale_minutes?: number
        }
        Returns: {
          batch_key: string
          contact_id: string
          contact_locale: string
          display_name: string
          email: string
          marketing_status: string
          send_id: string
          send_locale: string
          unsubscribe_token: string
        }[]
      }
      claim_push_token: {
        Args: { p_expo_token?: boolean; p_platform: string; p_token: string }
        Returns: undefined
      }
      cleanup_cron_job_run_details: {
        Args: { p_keep?: string }
        Returns: number
      }
      cleanup_daily_dialog_archives: { Args: never; Returns: number }
      cleanup_old_user_event_log: {
        Args: { p_batch_limit?: number }
        Returns: Json
      }
      cleanup_stale_notification_deliveries: {
        Args: {
          p_batch_limit?: number
          p_max_batches?: number
          p_older_than?: string
        }
        Returns: Json
      }
      cleanup_unconfirmed_auth_users: {
        Args: { p_older_than?: string }
        Returns: Json
      }
      email_automation_confirmed_users: {
        Args: { p_since: string }
        Returns: {
          display_name: string
          email_confirmed_at: string
          skip_email_automations: boolean
          user_id: string
        }[]
      }
      email_automation_onboarded_users: {
        Args: { p_since: string }
        Returns: {
          display_name: string
          onboarded_at: string
          skip_email_automations: boolean
          user_id: string
        }[]
      }
      email_automation_welcome_candidates: {
        Args: { p_automation_id: string; p_since: string; p_user_id?: string }
        Returns: {
          display_name: string
          onboarded_at: string
          skip_email_automations: boolean
          user_id: string
        }[]
      }
      email_segment_resolve: {
        Args: { p_mode?: string; p_query: Json }
        Returns: Json
      }
      emails_for_user_ids: {
        Args: { p_ids: string[] }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      ensure_harmonizer_cron_jobs: { Args: never; Returns: Json }
      finalize_email_campaign_batch: {
        Args: { p_campaign_id: string; p_results: Json }
        Returns: {
          failed: number
          sent: number
          skipped: number
        }[]
      }
      get_posts_feed: {
        Args: {
          p_before_id?: string
          p_before_published_at?: string
          p_limit?: number
          p_locale?: string
        }
        Returns: {
          body: string
          body_i18n: Json
          comment_count: number
          cover_url: string
          cover_url_i18n: Json
          duration_seconds: number
          id: string
          kind: string
          published_at: string
          title: string
          title_i18n: Json
          webinar_id: string
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
      grant_harmonizer_trial_if_first_entry: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      invoke_cleanup_expired_stories: { Args: never; Returns: number }
      invoke_email_welcome_for_user: {
        Args: { p_user_id: string }
        Returns: number
      }
      invoke_notify_webinar_start: { Args: never; Returns: number }
      invoke_precompute_daily_forecasts: { Args: never; Returns: number }
      invoke_precompute_global_recommendations: { Args: never; Returns: number }
      invoke_reconcile_expired_memberships: { Args: never; Returns: number }
      invoke_reconcile_lava_payments: { Args: never; Returns: number }
      invoke_run_email_automations: { Args: never; Returns: number }
      invoke_run_email_campaigns: { Args: never; Returns: number }
      invoke_run_yookassa_renewals: { Args: never; Returns: number }
      invoke_send_pass_reminders: { Args: never; Returns: number }
      invoke_sync_email_suppressions: { Args: never; Returns: number }
      is_admin: { Args: { uid: string }; Returns: boolean }
      lapse_stale_subscriptions: { Args: never; Returns: number }
      otp_check_send_limits: { Args: { p_email: string }; Returns: Json }
      otp_check_verify_allowed: { Args: { p_email: string }; Returns: Json }
      otp_consume_send_permit: {
        Args: { p_email: string; p_require_permit?: boolean }
        Returns: Json
      }
      otp_issue_send_permit: {
        Args: { p_app_id?: string; p_email: string; p_ttl_seconds?: number }
        Returns: Json
      }
      otp_record_verify_failure: { Args: { p_email: string }; Returns: Json }
      precompute_daily_forecast_candidates: {
        Args: {
          p_active_days?: number
          p_claim?: boolean
          p_lease_minutes?: number
          p_limit?: number
        }
        Returns: {
          local_date: string
          locale: string
          needs_forecast: boolean
          needs_morning: boolean
          user_id: string
        }[]
      }
      reattach_payment_ledger_for_email: {
        Args: { p_email: string; p_user_id: string }
        Returns: number
      }
      reconcile_expired_memberships: {
        Args: { p_limit?: number }
        Returns: number
      }
      record_first_party_email_open: {
        Args: { p_track_id: string }
        Returns: Json
      }
      record_inbox_notification: {
        Args: {
          p_body?: string
          p_kind: string
          p_link_url?: string
          p_source_key?: string
          p_title: string
        }
        Returns: string
      }
      refresh_email_campaign_counters: { Args: never; Returns: undefined }
      restore_membership_from_ledger: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      revert_access_promo_grants: { Args: never; Returns: number }
      set_signin_name_hint: {
        Args: { p_email: string; p_locale: string; p_name: string }
        Returns: undefined
      }
      shift_email_automation_enrollments_after_pause: {
        Args: {
          p_automation_id: string
          p_paused_at: string
          p_resumed_at?: string
        }
        Returns: number
      }
      sync_email_contact_for_user: {
        Args: { p_user_id: string }
        Returns: Json
      }
      sync_email_contacts_from_users: { Args: never; Returns: Json }
      try_lock_email_campaign_send: { Args: { p_id: string }; Returns: boolean }
      unlock_email_campaign_send: { Args: { p_id: string }; Returns: undefined }
      user_has_active_paid_plan: {
        Args: { p_expires: string; p_tier: string }
        Returns: boolean
      }
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
    Enums: {},
  },
} as const
