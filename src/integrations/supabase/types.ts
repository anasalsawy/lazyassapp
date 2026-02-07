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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      account_connections: {
        Row: {
          created_at: string
          id: string
          last_validated_at: string | null
          metadata_json: Json | null
          session_blob_enc: string | null
          site_key: string
          status: string
          updated_at: string
          user_id: string
          username_hint: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_validated_at?: string | null
          metadata_json?: Json | null
          session_blob_enc?: string | null
          site_key: string
          status?: string
          updated_at?: string
          user_id: string
          username_hint?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_validated_at?: string | null
          metadata_json?: Json | null
          session_blob_enc?: string | null
          site_key?: string
          status?: string
          updated_at?: string
          user_id?: string
          username_hint?: string | null
        }
        Relationships: []
      }
      agent_execution_logs: {
        Row: {
          agent: string
          created_at: string
          gatekeeper_json: Json | null
          id: string
          input: string | null
          model: string
          output: string | null
          resume_id: string
          step: string
          user_id: string
        }
        Insert: {
          agent: string
          created_at?: string
          gatekeeper_json?: Json | null
          id?: string
          input?: string | null
          model: string
          output?: string | null
          resume_id: string
          step: string
          user_id: string
        }
        Update: {
          agent?: string
          created_at?: string
          gatekeeper_json?: Json | null
          id?: string
          input?: string | null
          model?: string
          output?: string | null
          resume_id?: string
          step?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_logs: {
        Row: {
          agent_name: string
          created_at: string | null
          id: string
          log_level: string
          message: string
          metadata: Json | null
          task_id: string | null
          user_id: string
        }
        Insert: {
          agent_name: string
          created_at?: string | null
          id?: string
          log_level?: string
          message: string
          metadata?: Json | null
          task_id?: string | null
          user_id: string
        }
        Update: {
          agent_name?: string
          created_at?: string | null
          id?: string
          log_level?: string
          message?: string
          metadata?: Json | null
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          created_at: string
          ended_at: string | null
          error_message: string | null
          id: string
          run_type: string
          started_at: string | null
          status: string
          summary_json: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          error_message?: string | null
          id?: string
          run_type: string
          started_at?: string | null
          status?: string
          summary_json?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          error_message?: string | null
          id?: string
          run_type?: string
          started_at?: string | null
          status?: string
          summary_json?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      agent_tasks: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          max_retries: number | null
          payload: Json | null
          priority: number | null
          result: Json | null
          retry_count: number | null
          scheduled_at: string | null
          started_at: string | null
          status: string
          task_type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          max_retries?: number | null
          payload?: Json | null
          priority?: number | null
          result?: Json | null
          retry_count?: number | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          task_type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          max_retries?: number | null
          payload?: Json | null
          priority?: number | null
          result?: Json | null
          retry_count?: number | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          task_type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      application_events: {
        Row: {
          application_id: string
          created_at: string
          event_type: string
          id: string
          payload_json: Json | null
        }
        Insert: {
          application_id: string
          created_at?: string
          event_type: string
          id?: string
          payload_json?: Json | null
        }
        Update: {
          application_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_status_history: {
        Row: {
          application_id: string
          created_at: string
          id: string
          notes: string | null
          status: string
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          notes?: string | null
          status: string
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_status_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          applied_at: string
          company_name: string | null
          cover_letter: string | null
          created_at: string
          email_thread_id: string | null
          extra_metadata: Json | null
          id: string
          job_id: string
          job_title: string | null
          job_url: string | null
          notes: string | null
          platform: string | null
          response_at: string | null
          resume_id: string | null
          status: string
          status_message: string | null
          status_source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string
          company_name?: string | null
          cover_letter?: string | null
          created_at?: string
          email_thread_id?: string | null
          extra_metadata?: Json | null
          id?: string
          job_id: string
          job_title?: string | null
          job_url?: string | null
          notes?: string | null
          platform?: string | null
          response_at?: string | null
          resume_id?: string | null
          status?: string
          status_message?: string | null
          status_source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_at?: string
          company_name?: string | null
          cover_letter?: string | null
          created_at?: string
          email_thread_id?: string | null
          extra_metadata?: Json | null
          id?: string
          job_id?: string
          job_title?: string | null
          job_url?: string | null
          notes?: string | null
          platform?: string | null
          response_at?: string | null
          resume_id?: string | null
          status?: string
          status_message?: string | null
          status_source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_shop_orders: {
        Row: {
          browser_use_task_id: string | null
          cards_tried: string[] | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          max_price: number | null
          notes: string | null
          order_confirmation: string | null
          product_query: string
          quantity: number | null
          selected_deal_price: number | null
          selected_deal_site: string | null
          selected_deal_url: string | null
          shipping_address_id: string | null
          sites_tried: string[] | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          browser_use_task_id?: string | null
          cards_tried?: string[] | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          max_price?: number | null
          notes?: string | null
          order_confirmation?: string | null
          product_query: string
          quantity?: number | null
          selected_deal_price?: number | null
          selected_deal_site?: string | null
          selected_deal_url?: string | null
          shipping_address_id?: string | null
          sites_tried?: string[] | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          browser_use_task_id?: string | null
          cards_tried?: string[] | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          max_price?: number | null
          notes?: string | null
          order_confirmation?: string | null
          product_query?: string
          quantity?: number | null
          selected_deal_price?: number | null
          selected_deal_site?: string | null
          selected_deal_url?: string | null
          shipping_address_id?: string | null
          sites_tried?: string[] | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_shop_orders_shipping_address_id_fkey"
            columns: ["shipping_address_id"]
            isOneToOne: false
            referencedRelation: "shipping_addresses"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_settings: {
        Row: {
          applications_today: number | null
          apply_hours_end: number | null
          apply_hours_start: number | null
          auto_apply_enabled: boolean | null
          created_at: string | null
          daily_apply_limit: number | null
          excluded_companies: string[] | null
          id: string
          last_auto_apply_at: string | null
          min_match_score: number | null
          preferred_job_boards: string[] | null
          require_cover_letter: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          applications_today?: number | null
          apply_hours_end?: number | null
          apply_hours_start?: number | null
          auto_apply_enabled?: boolean | null
          created_at?: string | null
          daily_apply_limit?: number | null
          excluded_companies?: string[] | null
          id?: string
          last_auto_apply_at?: string | null
          min_match_score?: number | null
          preferred_job_boards?: string[] | null
          require_cover_letter?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          applications_today?: number | null
          apply_hours_end?: number | null
          apply_hours_start?: number | null
          auto_apply_enabled?: boolean | null
          created_at?: string | null
          daily_apply_limit?: number | null
          excluded_companies?: string[] | null
          id?: string
          last_auto_apply_at?: string | null
          min_match_score?: number | null
          preferred_job_boards?: string[] | null
          require_cover_letter?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      browser_profiles: {
        Row: {
          browser_use_profile_id: string | null
          created_at: string
          id: string
          last_login_at: string | null
          pending_login_site: string | null
          pending_session_id: string | null
          pending_task_id: string | null
          proxy_password_enc: string | null
          proxy_server: string | null
          proxy_username: string | null
          shop_pending_login_site: string | null
          shop_pending_session_id: string | null
          shop_pending_task_id: string | null
          shop_sites_logged_in: string[] | null
          sites_logged_in: string[] | null
          status: string
          updated_at: string
          use_browserstack: boolean
          user_id: string
        }
        Insert: {
          browser_use_profile_id?: string | null
          created_at?: string
          id?: string
          last_login_at?: string | null
          pending_login_site?: string | null
          pending_session_id?: string | null
          pending_task_id?: string | null
          proxy_password_enc?: string | null
          proxy_server?: string | null
          proxy_username?: string | null
          shop_pending_login_site?: string | null
          shop_pending_session_id?: string | null
          shop_pending_task_id?: string | null
          shop_sites_logged_in?: string[] | null
          sites_logged_in?: string[] | null
          status?: string
          updated_at?: string
          use_browserstack?: boolean
          user_id: string
        }
        Update: {
          browser_use_profile_id?: string | null
          created_at?: string
          id?: string
          last_login_at?: string | null
          pending_login_site?: string | null
          pending_session_id?: string | null
          pending_task_id?: string | null
          proxy_password_enc?: string | null
          proxy_server?: string | null
          proxy_username?: string | null
          shop_pending_login_site?: string | null
          shop_pending_session_id?: string | null
          shop_pending_task_id?: string | null
          shop_sites_logged_in?: string[] | null
          sites_logged_in?: string[] | null
          status?: string
          updated_at?: string
          use_browserstack?: boolean
          user_id?: string
        }
        Relationships: []
      }
      communications: {
        Row: {
          application_id: string | null
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          received_at: string
          sender_email: string | null
          sender_name: string | null
          sender_type: string
          subject: string | null
          user_id: string
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          received_at?: string
          sender_email?: string | null
          sender_name?: string | null
          sender_type: string
          subject?: string | null
          user_id: string
        }
        Update: {
          application_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          received_at?: string
          sender_email?: string | null
          sender_name?: string | null
          sender_type?: string
          subject?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "communications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      email_accounts: {
        Row: {
          created_at: string | null
          email_address: string
          email_provider: string
          id: string
          is_active: boolean | null
          last_synced_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email_address: string
          email_provider?: string
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email_address?: string
          email_provider?: string
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      email_agent_settings: {
        Row: {
          allow_sending: boolean | null
          auto_create_drafts: boolean | null
          auto_send_templates: Json | null
          created_at: string
          enabled: boolean | null
          id: string
          last_processed_at: string | null
          read_emails: boolean | null
          send_mode: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_sending?: boolean | null
          auto_create_drafts?: boolean | null
          auto_send_templates?: Json | null
          created_at?: string
          enabled?: boolean | null
          id?: string
          last_processed_at?: string | null
          read_emails?: boolean | null
          send_mode?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_sending?: boolean | null
          auto_create_drafts?: boolean | null
          auto_send_templates?: Json | null
          created_at?: string
          enabled?: boolean | null
          id?: string
          last_processed_at?: string | null
          read_emails?: boolean | null
          send_mode?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_connections: {
        Row: {
          access_token_enc: string | null
          created_at: string
          email_address: string
          email_cursor: string | null
          expires_at: string | null
          id: string
          last_sync_at: string | null
          metadata_json: Json | null
          provider: string
          refresh_token_enc: string | null
          scopes_json: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_enc?: string | null
          created_at?: string
          email_address: string
          email_cursor?: string | null
          expires_at?: string | null
          id?: string
          last_sync_at?: string | null
          metadata_json?: Json | null
          provider: string
          refresh_token_enc?: string | null
          scopes_json?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_enc?: string | null
          created_at?: string
          email_address?: string
          email_cursor?: string | null
          expires_at?: string | null
          id?: string
          last_sync_at?: string | null
          metadata_json?: Json | null
          provider?: string
          refresh_token_enc?: string | null
          scopes_json?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_drafts: {
        Row: {
          body: string
          connection_id: string | null
          created_at: string
          id: string
          job_email_id: string | null
          metadata_json: Json | null
          provider: string
          sent_at: string | null
          status: string
          subject: string
          thread_id: string | null
          to_email: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          connection_id?: string | null
          created_at?: string
          id?: string
          job_email_id?: string | null
          metadata_json?: Json | null
          provider: string
          sent_at?: string | null
          status?: string
          subject: string
          thread_id?: string | null
          to_email: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          connection_id?: string | null
          created_at?: string
          id?: string
          job_email_id?: string | null
          metadata_json?: Json | null
          provider?: string
          sent_at?: string | null
          status?: string
          subject?: string
          thread_id?: string | null
          to_email?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_drafts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_job_email_id_fkey"
            columns: ["job_email_id"]
            isOneToOne: false
            referencedRelation: "job_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      incoming_emails: {
        Row: {
          ai_sentiment: string | null
          ai_suggested_reply: string | null
          ai_summary: string | null
          application_id: string | null
          body_html: string | null
          body_text: string | null
          created_at: string | null
          email_account_id: string | null
          from_email: string
          from_name: string | null
          id: string
          is_read: boolean | null
          is_replied: boolean | null
          is_verification_email: boolean | null
          received_at: string
          subject: string
          user_id: string
          verification_code: string | null
        }
        Insert: {
          ai_sentiment?: string | null
          ai_suggested_reply?: string | null
          ai_summary?: string | null
          application_id?: string | null
          body_html?: string | null
          body_text?: string | null
          created_at?: string | null
          email_account_id?: string | null
          from_email: string
          from_name?: string | null
          id?: string
          is_read?: boolean | null
          is_replied?: boolean | null
          is_verification_email?: boolean | null
          received_at: string
          subject: string
          user_id: string
          verification_code?: string | null
        }
        Update: {
          ai_sentiment?: string | null
          ai_suggested_reply?: string | null
          ai_summary?: string | null
          application_id?: string | null
          body_html?: string | null
          body_text?: string | null
          created_at?: string | null
          email_account_id?: string | null
          from_email?: string
          from_name?: string | null
          id?: string
          is_read?: boolean | null
          is_replied?: boolean | null
          is_verification_email?: boolean | null
          received_at?: string
          subject?: string
          user_id?: string
          verification_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incoming_emails_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incoming_emails_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      job_board_credentials: {
        Row: {
          created_at: string | null
          credentials_encrypted: Json
          id: string
          is_active: boolean | null
          job_board: string
          last_verified_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          credentials_encrypted: Json
          id?: string
          is_active?: boolean | null
          job_board: string
          last_verified_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          credentials_encrypted?: Json
          id?: string
          is_active?: boolean | null
          job_board?: string
          last_verified_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      job_emails: {
        Row: {
          classification: string
          confidence: number | null
          connection_id: string | null
          created_at: string
          extracted_json: Json | null
          from_email: string
          from_name: string | null
          id: string
          is_processed: boolean | null
          is_read: boolean | null
          linked_application_id: string | null
          message_id: string
          provider: string
          received_at: string
          snippet: string | null
          subject: string
          thread_id: string | null
          user_id: string
        }
        Insert: {
          classification?: string
          confidence?: number | null
          connection_id?: string | null
          created_at?: string
          extracted_json?: Json | null
          from_email: string
          from_name?: string | null
          id?: string
          is_processed?: boolean | null
          is_read?: boolean | null
          linked_application_id?: string | null
          message_id: string
          provider: string
          received_at: string
          snippet?: string | null
          subject: string
          thread_id?: string | null
          user_id: string
        }
        Update: {
          classification?: string
          confidence?: number | null
          connection_id?: string | null
          created_at?: string
          extracted_json?: Json | null
          from_email?: string
          from_name?: string | null
          id?: string
          is_processed?: boolean | null
          is_read?: boolean | null
          linked_application_id?: string | null
          message_id?: string
          provider?: string
          received_at?: string
          snippet?: string | null
          subject?: string
          thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_emails_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_emails_linked_application_id_fkey"
            columns: ["linked_application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      job_preferences: {
        Row: {
          auto_apply_enabled: boolean | null
          company_sizes: string[] | null
          created_at: string
          daily_apply_limit: number | null
          excluded_companies: string[] | null
          id: string
          industries: string[] | null
          job_titles: string[] | null
          locations: string[] | null
          remote_preference: string | null
          salary_max: number | null
          salary_min: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_apply_enabled?: boolean | null
          company_sizes?: string[] | null
          created_at?: string
          daily_apply_limit?: number | null
          excluded_companies?: string[] | null
          id?: string
          industries?: string[] | null
          job_titles?: string[] | null
          locations?: string[] | null
          remote_preference?: string | null
          salary_max?: number | null
          salary_min?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_apply_enabled?: boolean | null
          company_sizes?: string[] | null
          created_at?: string
          daily_apply_limit?: number | null
          excluded_companies?: string[] | null
          id?: string
          industries?: string[] | null
          job_titles?: string[] | null
          locations?: string[] | null
          remote_preference?: string | null
          salary_max?: number | null
          salary_min?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          company: string
          created_at: string
          description: string | null
          expires_at: string | null
          external_id: string | null
          id: string
          is_saved: boolean | null
          job_type: string | null
          location: string | null
          match_score: number | null
          platform: string | null
          posted_at: string | null
          requirements: string[] | null
          salary_max: number | null
          salary_min: number | null
          source: string
          title: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          company: string
          created_at?: string
          description?: string | null
          expires_at?: string | null
          external_id?: string | null
          id?: string
          is_saved?: boolean | null
          job_type?: string | null
          location?: string | null
          match_score?: number | null
          platform?: string | null
          posted_at?: string | null
          requirements?: string[] | null
          salary_max?: number | null
          salary_min?: number | null
          source: string
          title: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          company?: string
          created_at?: string
          description?: string | null
          expires_at?: string | null
          external_id?: string | null
          id?: string
          is_saved?: boolean | null
          job_type?: string | null
          location?: string | null
          match_score?: number | null
          platform?: string | null
          posted_at?: string | null
          requirements?: string[] | null
          salary_max?: number | null
          salary_min?: number | null
          source?: string
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      order_emails: {
        Row: {
          body_html: string | null
          body_text: string | null
          created_at: string
          email_type: string | null
          extracted_data: Json | null
          from_email: string
          from_name: string | null
          gmail_message_id: string
          id: string
          is_read: boolean | null
          order_id: string | null
          received_at: string
          snippet: string | null
          subject: string
          thread_id: string | null
          to_email: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          email_type?: string | null
          extracted_data?: Json | null
          from_email: string
          from_name?: string | null
          gmail_message_id: string
          id?: string
          is_read?: boolean | null
          order_id?: string | null
          received_at: string
          snippet?: string | null
          subject: string
          thread_id?: string | null
          to_email?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          email_type?: string | null
          extracted_data?: Json | null
          from_email?: string
          from_name?: string | null
          gmail_message_id?: string
          id?: string
          is_read?: boolean | null
          order_id?: string | null
          received_at?: string
          snippet?: string | null
          subject?: string
          thread_id?: string | null
          to_email?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_emails_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "auto_shop_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_tracking: {
        Row: {
          carrier: string | null
          created_at: string
          email_source: string | null
          estimated_delivery: string | null
          id: string
          last_update: string | null
          order_id: string | null
          status: string
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          email_source?: string | null
          estimated_delivery?: string | null
          id?: string
          last_update?: string | null
          order_id?: string | null
          status?: string
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          email_source?: string | null
          estimated_delivery?: string | null
          id?: string
          last_update?: string | null
          order_id?: string | null
          status?: string
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_tracking_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "auto_shop_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_cards: {
        Row: {
          billing_address: string | null
          billing_city: string | null
          billing_country: string | null
          billing_state: string | null
          billing_zip: string | null
          card_name: string
          card_number_enc: string
          cardholder_name: string
          created_at: string
          cvv_enc: string
          expiry_enc: string
          id: string
          is_default: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_address?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_state?: string | null
          billing_zip?: string | null
          card_name: string
          card_number_enc: string
          cardholder_name: string
          created_at?: string
          cvv_enc: string
          expiry_enc: string
          id?: string
          is_default?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_address?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_state?: string | null
          billing_zip?: string | null
          card_name?: string
          card_number_enc?: string
          cardholder_name?: string
          created_at?: string
          cvv_enc?: string
          expiry_enc?: string
          id?: string
          is_default?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pipeline_continuations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          next_step: string
          pipeline_state: Json
          resume_id: string
          status: string
          step_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          next_step: string
          pipeline_state?: Json
          resume_id: string
          status?: string
          step_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          next_step?: string
          pipeline_state?: Json
          resume_id?: string
          status?: string
          step_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          linkedin_url: string | null
          location: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resumes: {
        Row: {
          ats_score: number | null
          created_at: string
          experience_years: number | null
          file_path: string | null
          id: string
          is_primary: boolean | null
          original_filename: string | null
          parsed_content: Json | null
          skills: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ats_score?: number | null
          created_at?: string
          experience_years?: number | null
          file_path?: string | null
          id?: string
          is_primary?: boolean | null
          original_filename?: string | null
          parsed_content?: Json | null
          skills?: string[] | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ats_score?: number | null
          created_at?: string
          experience_years?: number | null
          file_path?: string | null
          id?: string
          is_primary?: boolean | null
          original_filename?: string | null
          parsed_content?: Json | null
          skills?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shipping_addresses: {
        Row: {
          address_line1: string
          address_line2: string | null
          address_name: string
          city: string
          country: string | null
          created_at: string
          full_name: string
          id: string
          is_default: boolean | null
          phone: string | null
          state: string
          updated_at: string
          user_id: string
          zip_code: string
        }
        Insert: {
          address_line1: string
          address_line2?: string | null
          address_name: string
          city: string
          country?: string | null
          created_at?: string
          full_name: string
          id?: string
          is_default?: boolean | null
          phone?: string | null
          state: string
          updated_at?: string
          user_id: string
          zip_code: string
        }
        Update: {
          address_line1?: string
          address_line2?: string | null
          address_name?: string
          city?: string
          country?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_default?: boolean | null
          phone?: string | null
          state?: string
          updated_at?: string
          user_id?: string
          zip_code?: string
        }
        Relationships: []
      }
      site_credentials: {
        Row: {
          created_at: string
          email_used: string
          id: string
          last_used_at: string | null
          notes: string | null
          password_enc: string
          site_domain: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_used: string
          id?: string
          last_used_at?: string | null
          notes?: string | null
          password_enc: string
          site_domain: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_used?: string
          id?: string
          last_used_at?: string | null
          notes?: string | null
          password_enc?: string
          site_domain?: string
          user_id?: string
        }
        Relationships: []
      }
      tracking_runs: {
        Row: {
          applications_updated: number | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          platforms_checked: string[] | null
          started_at: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          applications_updated?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          platforms_checked?: string[] | null
          started_at?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          applications_updated?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          platforms_checked?: string[] | null
          started_at?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_analytics: {
        Row: {
          avg_response_days: number | null
          created_at: string
          id: string
          last_calculated_at: string | null
          response_rate: number | null
          top_skills: string[] | null
          total_applications: number | null
          total_interviews: number | null
          total_offers: number | null
          total_responses: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_response_days?: number | null
          created_at?: string
          id?: string
          last_calculated_at?: string | null
          response_rate?: number | null
          top_skills?: string[] | null
          total_applications?: number | null
          total_interviews?: number | null
          total_offers?: number | null
          total_responses?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_response_days?: number | null
          created_at?: string
          id?: string
          last_calculated_at?: string | null
          response_rate?: number | null
          top_skills?: string[] | null
          total_applications?: number | null
          total_interviews?: number | null
          total_offers?: number | null
          total_responses?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          owner_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string | null
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
      get_owner_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "owner" | "family"
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
      app_role: ["owner", "family"],
    },
  },
} as const
