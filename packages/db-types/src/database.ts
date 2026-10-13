
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log_2026_10": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2026_11": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2026_12": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_01": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_02": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_03": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_04": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_05": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_06": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_07": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_08": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_09": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_10": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_11": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_2027_12": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_log_default": {
                  Row: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles": (Database["public"]['Enums']["org_role"])[],"actor_user_id": string | null,"candidate_id": string | null,"details": NonNullable<Json>,"id": string,"object_id": string | null,"object_table": string | null,"occurred_at": string,"org_id": string,"request_id": string | null,"staff_grant_id": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id": string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_roles"?: (Database["public"]['Enums']["org_role"])[],"actor_user_id"?: string | null,"candidate_id"?: string | null,"details"?: NonNullable<Json>,"id"?: string,"object_id"?: string | null,"object_table"?: string | null,"occurred_at"?: string,"org_id"?: string,"request_id"?: string | null,"staff_grant_id"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"idempotency_keys": {
                  Row: {
                    "expires_at": string,"first_seen_at": string,"key": string,"org_id": string,"result_ref": string | null,"scope": string
                  }
                  ComputedFields: never
                  Insert: {
                    "expires_at": string,"first_seen_at"?: string,"key": string,"org_id": string,"result_ref"?: string | null,"scope": string
                  }
                  Update: {
                    "expires_at"?: string,"first_seen_at"?: string,"key"?: string,"org_id"?: string,"result_ref"?: string | null,"scope"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "idempotency_keys_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"created_by": string | null,"display_name": string,"id": string,"org_id": string,"removed_at": string | null,"roles": (Database["public"]['Enums']["org_role"])[],"status": Database["public"]['Enums']["membership_status"],"team_id": string | null,"user_id": string,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"display_name": string,"id"?: string,"org_id": string,"removed_at"?: string | null,"roles": (Database["public"]['Enums']["org_role"])[],"status"?: Database["public"]['Enums']["membership_status"],"team_id"?: string | null,"user_id": string,"workspace_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"display_name"?: string,"id"?: string,"org_id"?: string,"removed_at"?: string | null,"roles"?: (Database["public"]['Enums']["org_role"])[],"status"?: Database["public"]['Enums']["membership_status"],"team_id"?: string | null,"user_id"?: string,"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_org_id_team_id_fkey"
      columns: ["org_id","team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "memberships_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"orgs": {
                  Row: {
                    "created_at": string,"data_residency": Database["public"]['Enums']["data_residency"],"id": string,"kind": Database["public"]['Enums']["org_kind"],"name": string,"org_id": string,"slug": string,"status": Database["public"]['Enums']["org_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"data_residency"?: Database["public"]['Enums']["data_residency"],"id"?: string,"kind": Database["public"]['Enums']["org_kind"],"name": string,"org_id"?: never,"slug": string,"status"?: Database["public"]['Enums']["org_status"]
                  }
                  Update: {
                    "created_at"?: string,"data_residency"?: Database["public"]['Enums']["data_residency"],"id"?: string,"kind"?: Database["public"]['Enums']["org_kind"],"name"?: string,"org_id"?: never,"slug"?: string,"status"?: Database["public"]['Enums']["org_status"]
                  }
                  Relationships: [
                    
                  ]
                },"platform_staff": {
                  Row: {
                    "active": boolean,"capabilities": (string)[],"created_at": string,"org_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"capabilities"?: (string)[],"created_at"?: string,"org_id": string,"user_id": string
                  }
                  Update: {
                    "active"?: boolean,"capabilities"?: (string)[],"created_at"?: string,"org_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_staff_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_access_grants": {
                  Row: {
                    "approved_by": string,"expires_at": string,"granted_at": string,"id": string,"org_id": string,"revoked_at": string | null,"revoked_by": string | null,"scope": Database["public"]['Enums']["staff_grant_scope"],"staff_user_id": string,"ticket_ref": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_by": string,"expires_at": string,"granted_at"?: string,"id"?: string,"org_id": string,"revoked_at"?: string | null,"revoked_by"?: string | null,"scope"?: Database["public"]['Enums']["staff_grant_scope"],"staff_user_id": string,"ticket_ref": string
                  }
                  Update: {
                    "approved_by"?: string,"expires_at"?: string,"granted_at"?: string,"id"?: string,"org_id"?: string,"revoked_at"?: string | null,"revoked_by"?: string | null,"scope"?: Database["public"]['Enums']["staff_grant_scope"],"staff_user_id"?: string,"ticket_ref"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_access_grants_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "platform_staff"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "staff_access_grants_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_access_grants_staff_user_id_fkey"
      columns: ["staff_user_id"]
isOneToOne: false
      referencedRelation: "platform_staff"
      referencedColumns: ["user_id"]
    }
                  ]
                },"teams": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"org_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "teams_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"id": string,"is_default": boolean,"kind": Database["public"]['Enums']["workspace_kind"],"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"is_default"?: boolean,"kind"?: Database["public"]['Enums']["workspace_kind"],"name": string,"org_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"is_default"?: boolean,"kind"?: Database["public"]['Enums']["workspace_kind"],"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspaces_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "actor_kind": "org_user"|"candidate"|"staff"|"system","data_residency": "r2_apac"|"s3_mumbai","membership_status": "invited"|"active"|"suspended"|"removed","org_kind": "customer"|"trace_library"|"trace_internal","org_role": "org_owner"|"admin"|"recruiter"|"reviewer"|"hiring_manager","org_status": "active"|"suspended","staff_grant_scope": "support_read","workspace_kind": "default"|"client"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "actor_kind": ["org_user", "candidate", "staff", "system"],"data_residency": ["r2_apac", "s3_mumbai"],"membership_status": ["invited", "active", "suspended", "removed"],"org_kind": ["customer", "trace_library", "trace_internal"],"org_role": ["org_owner", "admin", "recruiter", "reviewer", "hiring_manager"],"org_status": ["active", "suspended"],"staff_grant_scope": ["support_read"],"workspace_kind": ["default", "client"]
          }
        }
} as const
