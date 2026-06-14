export type TaskImportance = 'urgent' | 'high' | 'normal' | 'low'
export type BlockKind = 'checklist' | 'task_list'

export interface Database {
  public: {
    Tables: {
      days: {
        Row: {
          id: string
          user_id: string
          date: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['days']['Row'], 'id' | 'updated_at'> & {
          id?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['days']['Insert']>
      }
      library_blocks: {
        Row: {
          id: string
          user_id: string
          kind: BlockKind
          title: string
          default_duration_min: number
          sort_order: number
          repeat_every: number | null
          repeat_unit: 'day' | 'week' | 'month' | 'year' | null
          repeat_time_hhmm: string | null
          repeat_anchor_date: string | null
          repeat_weekday: number | null
          repeat_weekday_times: Record<string, string> | null
          repeat_skipped_dates: string[] | null
          repeat_day_of_month: number | null
          repeat_month: number | null
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['library_blocks']['Row'], 'id' | 'updated_at'> & {
          id?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['library_blocks']['Insert']>
      }
      block_items: {
        Row: {
          id: string
          user_id: string
          block_id: string
          parent_item_id: string | null
          title: string
          sort_order: number
          importance: TaskImportance | null
          duration_min: number
          deadline: string | null
          completed_at: string | null
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['block_items']['Row'], 'id' | 'updated_at'> & {
          id?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['block_items']['Insert']>
      }
      day_instances: {
        Row: {
          id: string
          user_id: string
          day_id: string
          source_block_id: string | null
          title: string
          duration_min: number
          sort_order: number
          scheduled_start: string
          timer_started_at: string | null
          added_at: string
          note_json: string | null
          collapsed: boolean
          alt_group_id: string | null
          alt_group_index: number | null
          alt_stack_index: number | null
          created_by_repeat: boolean
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['day_instances']['Row'], 'id' | 'added_at' | 'updated_at'> & {
          id?: string
          added_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['day_instances']['Insert']>
      }
      day_free_times: {
        Row: {
          id: string
          user_id: string
          day_id: string
          sort_order: number
          duration_min: number
          alt_group_id: string | null
          alt_group_index: number | null
          alt_stack_index: number | null
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['day_free_times']['Row'], 'id' | 'updated_at'> & {
          id?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['day_free_times']['Insert']>
      }
      day_instance_items: {
        Row: {
          id: string
          user_id: string
          instance_id: string
          parent_item_id: string | null
          source_block_item_id: string | null
          title: string
          duration_min: number
          deadline: string | null
          completed: boolean
          sort_order: number
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['day_instance_items']['Row'], 'id' | 'updated_at'> & {
          id?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['day_instance_items']['Insert']>
      }
    }
  }
}
