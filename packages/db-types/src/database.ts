
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "assignments": {
                  Row: {
                    "as_role": Database["public"]['Enums']["org_role"],"created_at": string,"created_by": string | null,"id": string,"membership_id": string,"org_id": string,"scope": string,"test_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "as_role": Database["public"]['Enums']["org_role"],"created_at"?: string,"created_by"?: string | null,"id"?: string,"membership_id": string,"org_id": string,"scope"?: string,"test_id": string,"workspace_id": string
                  }
                  Update: {
                    "as_role"?: Database["public"]['Enums']["org_role"],"created_at"?: string,"created_by"?: string | null,"id"?: string,"membership_id"?: string,"org_id"?: string,"scope"?: string,"test_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignments_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_org_id_membership_id_fkey"
      columns: ["org_id","membership_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "assignments_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "assignments_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"audit_log": {
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
                },"consents": {
                  Row: {
                    "event": string,"id": string,"invitation_id": string,"language": string,"notice_version_id": string,"occurred_at": string,"org_id": string,"rendered_sha256": string,"ruleset_version_id": string,"test_id": string,"test_version_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "event"?: string,"id"?: string,"invitation_id": string,"language"?: string,"notice_version_id": string,"occurred_at"?: string,"org_id": string,"rendered_sha256": string,"ruleset_version_id": string,"test_id": string,"test_version_id": string,"workspace_id": string
                  }
                  Update: {
                    "event"?: string,"id"?: string,"invitation_id"?: string,"language"?: string,"notice_version_id"?: string,"occurred_at"?: string,"org_id"?: string,"rendered_sha256"?: string,"ruleset_version_id"?: string,"test_id"?: string,"test_version_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "consents_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "consents_org_id_invitation_id_test_version_id_fkey"
      columns: ["org_id","invitation_id","test_version_id"]
isOneToOne: false
      referencedRelation: "invitations"
      referencedColumns: ["org_id","id","test_version_id"]
    },{
      foreignKeyName: "consents_org_id_notice_version_id_fkey"
      columns: ["org_id","notice_version_id"]
isOneToOne: false
      referencedRelation: "notice_versions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "consents_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "consents_org_id_test_version_id_ruleset_version_id_fkey"
      columns: ["org_id","test_version_id","ruleset_version_id"]
isOneToOne: false
      referencedRelation: "test_versions"
      referencedColumns: ["org_id","id","ruleset_version_id"]
    },{
      foreignKeyName: "consents_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
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
                },"integrity_cards": {
                  Row: {
                    "band": string,"band_rule_version_id": string,"computed_at": string,"coverage_floor_permille": number,"coverage_permille": number,"engine_version": string,"evidence_strength": number,"id": string,"integrity_result_id": string,"org_id": string,"photo_missing": boolean,"review_state": string,"rule_table_version": string,"ruleset_version_id": string,"session_id": string,"test_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "band": string,"band_rule_version_id": string,"computed_at": string,"coverage_floor_permille": number,"coverage_permille": number,"engine_version": string,"evidence_strength": number,"id"?: string,"integrity_result_id": string,"org_id": string,"photo_missing": boolean,"review_state": string,"rule_table_version": string,"ruleset_version_id": string,"session_id": string,"test_id": string,"workspace_id": string
                  }
                  Update: {
                    "band"?: string,"band_rule_version_id"?: string,"computed_at"?: string,"coverage_floor_permille"?: number,"coverage_permille"?: number,"engine_version"?: string,"evidence_strength"?: number,"id"?: string,"integrity_result_id"?: string,"org_id"?: string,"photo_missing"?: boolean,"review_state"?: string,"rule_table_version"?: string,"ruleset_version_id"?: string,"session_id"?: string,"test_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "integrity_cards_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "integrity_cards_org_id_ruleset_version_id_fkey"
      columns: ["org_id","ruleset_version_id"]
isOneToOne: false
      referencedRelation: "ruleset_versions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "integrity_cards_org_id_session_id_fkey"
      columns: ["org_id","session_id"]
isOneToOne: false
      referencedRelation: "sessions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "integrity_cards_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "integrity_cards_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"integrity_timeline_entries": {
                  Row: {
                    "count": number,"entry_kind": string,"family": string | null,"flag_state": string | null,"id": string,"integrity_card_id": string,"observed": NonNullable<Json>,"offset_ms": number,"org_id": string,"position": number,"rule_id": string | null,"session_id": string,"signal_kind": string,"signal_seqs": (number)[],"test_id": string,"tier": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count"?: number,"entry_kind": string,"family"?: string | null,"flag_state"?: string | null,"id"?: string,"integrity_card_id": string,"observed"?: NonNullable<Json>,"offset_ms": number,"org_id": string,"position": number,"rule_id"?: string | null,"session_id": string,"signal_kind": string,"signal_seqs"?: (number)[],"test_id": string,"tier"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "count"?: number,"entry_kind"?: string,"family"?: string | null,"flag_state"?: string | null,"id"?: string,"integrity_card_id"?: string,"observed"?: NonNullable<Json>,"offset_ms"?: number,"org_id"?: string,"position"?: number,"rule_id"?: string | null,"session_id"?: string,"signal_kind"?: string,"signal_seqs"?: (number)[],"test_id"?: string,"tier"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "integrity_timeline_entries_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "integrity_timeline_entries_org_id_integrity_card_id_sessio_fkey"
      columns: ["org_id","integrity_card_id","session_id"]
isOneToOne: false
      referencedRelation: "integrity_cards"
      referencedColumns: ["org_id","id","session_id"]
    },{
      foreignKeyName: "integrity_timeline_entries_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "integrity_timeline_entries_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "adult_confirmed_by_inviter": boolean | null,"adult_self_declared": boolean | null,"age_block_source": string | null,"candidate_id": string,"candidate_label": string,"contact_email": string,"created_at": string,"created_by": string | null,"expires_at": string,"id": string,"link_token_hash": string,"org_id": string,"session_id": string | null,"started_at": string | null,"status": Database["public"]['Enums']["invitation_status"],"test_id": string,"test_version_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "adult_confirmed_by_inviter"?: boolean | null,"adult_self_declared"?: boolean | null,"age_block_source"?: string | null,"candidate_id"?: string,"candidate_label": string,"contact_email": string,"created_at"?: string,"created_by"?: string | null,"expires_at": string,"id"?: string,"link_token_hash": string,"org_id": string,"session_id"?: string | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["invitation_status"],"test_id": string,"test_version_id": string,"workspace_id": string
                  }
                  Update: {
                    "adult_confirmed_by_inviter"?: boolean | null,"adult_self_declared"?: boolean | null,"age_block_source"?: string | null,"candidate_id"?: string,"candidate_label"?: string,"contact_email"?: string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"id"?: string,"link_token_hash"?: string,"org_id"?: string,"session_id"?: string | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["invitation_status"],"test_id"?: string,"test_version_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invitations_org_id_test_version_id_fkey"
      columns: ["org_id","test_version_id"]
isOneToOne: false
      referencedRelation: "test_versions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invitations_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"item_answer_keys": {
                  Row: {
                    "created_at": string,"created_by": string | null,"format": Database["public"]['Enums']["section_format"],"item_version_id": string,"key": NonNullable<Json>,"library_sourced": boolean,"org_id": string,"test_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"format"?: Database["public"]['Enums']["section_format"],"item_version_id": string,"key": NonNullable<Json>,"library_sourced"?: boolean,"org_id": string,"test_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"format"?: Database["public"]['Enums']["section_format"],"item_version_id"?: string,"key"?: NonNullable<Json>,"library_sourced"?: boolean,"org_id"?: string,"test_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_answer_keys_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_answer_keys_org_id_item_version_id_format_fkey"
      columns: ["org_id","item_version_id","format"]
isOneToOne: false
      referencedRelation: "item_versions"
      referencedColumns: ["org_id","id","format"]
    },{
      foreignKeyName: "item_answer_keys_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "item_answer_keys_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"item_exposure_events": {
                  Row: {
                    "id": string,"item_id": string,"org_id": string,"served_at": string,"session_item_id": string,"source_item_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"item_id": string,"org_id": string,"served_at": string,"session_item_id": string,"source_item_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "id"?: string,"item_id"?: string,"org_id"?: string,"served_at"?: string,"session_item_id"?: string,"source_item_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_exposure_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_exposure_events_org_id_session_item_id_fkey"
      columns: ["org_id","session_item_id"]
isOneToOne: false
      referencedRelation: "session_items"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "item_exposure_events_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"item_variant_keys": {
                  Row: {
                    "created_at": string,"created_by": string | null,"item_variant_id": string,"key": NonNullable<Json>,"library_sourced": boolean,"org_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"item_variant_id": string,"key": NonNullable<Json>,"library_sourced"?: boolean,"org_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"item_variant_id"?: string,"key"?: NonNullable<Json>,"library_sourced"?: boolean,"org_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_variant_keys_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_variant_keys_org_id_item_variant_id_fkey"
      columns: ["org_id","item_variant_id"]
isOneToOne: true
      referencedRelation: "item_variants"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "item_variant_keys_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"item_variants": {
                  Row: {
                    "content_sha256": string,"difficulty": number,"id": string,"item_version_id": string,"options": NonNullable<Json>,"org_id": string,"params": NonNullable<Json>,"stem": string,"variant_no": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_sha256": string,"difficulty": number,"id"?: string,"item_version_id": string,"options": NonNullable<Json>,"org_id": string,"params": NonNullable<Json>,"stem": string,"variant_no": number,"workspace_id": string
                  }
                  Update: {
                    "content_sha256"?: string,"difficulty"?: number,"id"?: string,"item_version_id"?: string,"options"?: NonNullable<Json>,"org_id"?: string,"params"?: NonNullable<Json>,"stem"?: string,"variant_no"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_variants_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_variants_org_id_item_version_id_workspace_id_fkey"
      columns: ["org_id","item_version_id","workspace_id"]
isOneToOne: false
      referencedRelation: "item_versions"
      referencedColumns: ["org_id","id","workspace_id"]
    },{
      foreignKeyName: "item_variants_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"item_versions": {
                  Row: {
                    "ai_draft_job_id": string | null,"approved_at": string | null,"approved_by": string | null,"content_sha256": string,"created_at": string,"created_by": string | null,"difficulty": number | null,"format": Database["public"]['Enums']["section_format"],"id": string,"import_job_id": string | null,"import_row_no": number | null,"is_parameterised": boolean,"item_id": string,"key_reviewed_by": string | null,"language": string,"media": Json | null,"options": Json | null,"org_id": string,"origin": string,"param_spec": Json | null,"position": number | null,"reviewed_by": string | null,"rubric_version_id": string | null,"section_id": string | null,"skill_key": string | null,"source_item_version_id": string | null,"status": Database["public"]['Enums']["item_status"],"stem": string,"test_id": string | null,"test_version_id": string | null,"version_no": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_draft_job_id"?: string | null,"approved_at"?: string | null,"approved_by"?: string | null,"content_sha256": string,"created_at"?: string,"created_by"?: string | null,"difficulty"?: number | null,"format": Database["public"]['Enums']["section_format"],"id"?: string,"import_job_id"?: string | null,"import_row_no"?: number | null,"is_parameterised"?: boolean,"item_id"?: string,"key_reviewed_by"?: string | null,"language"?: string,"media"?: Json | null,"options"?: Json | null,"org_id": string,"origin"?: string,"param_spec"?: Json | null,"position"?: number | null,"reviewed_by"?: string | null,"rubric_version_id"?: string | null,"section_id"?: string | null,"skill_key"?: string | null,"source_item_version_id"?: string | null,"status"?: Database["public"]['Enums']["item_status"],"stem": string,"test_id"?: string | null,"test_version_id"?: string | null,"version_no"?: number,"workspace_id": string
                  }
                  Update: {
                    "ai_draft_job_id"?: string | null,"approved_at"?: string | null,"approved_by"?: string | null,"content_sha256"?: string,"created_at"?: string,"created_by"?: string | null,"difficulty"?: number | null,"format"?: Database["public"]['Enums']["section_format"],"id"?: string,"import_job_id"?: string | null,"import_row_no"?: number | null,"is_parameterised"?: boolean,"item_id"?: string,"key_reviewed_by"?: string | null,"language"?: string,"media"?: Json | null,"options"?: Json | null,"org_id"?: string,"origin"?: string,"param_spec"?: Json | null,"position"?: number | null,"reviewed_by"?: string | null,"rubric_version_id"?: string | null,"section_id"?: string | null,"skill_key"?: string | null,"source_item_version_id"?: string | null,"status"?: Database["public"]['Enums']["item_status"],"stem"?: string,"test_id"?: string | null,"test_version_id"?: string | null,"version_no"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_versions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_versions_org_id_rubric_version_id_fkey"
      columns: ["org_id","rubric_version_id"]
isOneToOne: false
      referencedRelation: "rubric_versions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "item_versions_org_id_section_id_format_fkey"
      columns: ["org_id","section_id","format"]
isOneToOne: false
      referencedRelation: "sections"
      referencedColumns: ["org_id","id","format"]
    },{
      foreignKeyName: "item_versions_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "item_versions_org_id_test_version_id_fkey"
      columns: ["org_id","test_version_id"]
isOneToOne: false
      referencedRelation: "test_versions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "item_versions_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"items": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"format": Database["public"]['Enums']["section_format"],"id": string,"org_id": string,"skill_key": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"format": Database["public"]['Enums']["section_format"],"id"?: string,"org_id": string,"skill_key": string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"format"?: Database["public"]['Enums']["section_format"],"id"?: string,"org_id"?: string,"skill_key"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"library_copy_requests": {
                  Row: {
                    "created_at": string,"id": string,"library_item_version_ids": (string)[],"org_id": string,"requested_by": string | null,"result_item_version_ids": (string)[] | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"library_item_version_ids": (string)[],"org_id": string,"requested_by"?: string | null,"result_item_version_ids"?: (string)[] | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"library_item_version_ids"?: (string)[],"org_id"?: string,"requested_by"?: string | null,"result_item_version_ids"?: (string)[] | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "library_copy_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "library_copy_requests_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"media_objects": {
                  Row: {
                    "blurred_on_device": boolean,"bytes": number,"created_at": string,"id": string,"kind": string,"mime": string,"org_id": string,"r2_key": string,"session_id": string,"sha256": string,"test_id": string,"upload_state": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blurred_on_device": boolean,"bytes": number,"created_at"?: string,"id"?: string,"kind": string,"mime": string,"org_id": string,"r2_key": string,"session_id": string,"sha256": string,"test_id": string,"upload_state"?: string,"workspace_id": string
                  }
                  Update: {
                    "blurred_on_device"?: boolean,"bytes"?: number,"created_at"?: string,"id"?: string,"kind"?: string,"mime"?: string,"org_id"?: string,"r2_key"?: string,"session_id"?: string,"sha256"?: string,"test_id"?: string,"upload_state"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "media_objects_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "media_objects_org_id_session_id_fkey"
      columns: ["org_id","session_id"]
isOneToOne: false
      referencedRelation: "sessions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "media_objects_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "media_objects_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
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
                },"notice_versions": {
                  Row: {
                    "body_template": string,"id": string,"language": string,"notice_key": string,"org_id": string,"published_at": string,"template_sha256": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body_template": string,"id"?: string,"language": string,"notice_key": string,"org_id": string,"published_at"?: string,"template_sha256": string,"version": number
                  }
                  Update: {
                    "body_template"?: string,"id"?: string,"language"?: string,"notice_key"?: string,"org_id"?: string,"published_at"?: string,"template_sha256"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "notice_versions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
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
                },"pool_items": {
                  Row: {
                    "added_at": string,"added_by": string | null,"item_version_id": string,"org_id": string,"pool_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"added_by"?: string | null,"item_version_id": string,"org_id": string,"pool_id": string,"workspace_id": string
                  }
                  Update: {
                    "added_at"?: string,"added_by"?: string | null,"item_version_id"?: string,"org_id"?: string,"pool_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pool_items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pool_items_org_id_item_version_id_workspace_id_fkey"
      columns: ["org_id","item_version_id","workspace_id"]
isOneToOne: false
      referencedRelation: "item_versions"
      referencedColumns: ["org_id","id","workspace_id"]
    },{
      foreignKeyName: "pool_items_org_id_pool_id_workspace_id_fkey"
      columns: ["org_id","pool_id","workspace_id"]
isOneToOne: false
      referencedRelation: "pools"
      referencedColumns: ["org_id","id","workspace_id"]
    }
                  ]
                },"pools": {
                  Row: {
                    "created_at": string,"created_by": string | null,"format": Database["public"]['Enums']["section_format"],"id": string,"name": string,"org_id": string,"skill_key": string | null,"status": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"format": Database["public"]['Enums']["section_format"],"id"?: string,"name": string,"org_id": string,"skill_key"?: string | null,"status"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"format"?: Database["public"]['Enums']["section_format"],"id"?: string,"name"?: string,"org_id"?: string,"skill_key"?: string | null,"status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pools_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pools_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"quality_cards": {
                  Row: {
                    "computed_at": string,"grader_adapter_version": string,"grader_model_id": string,"id": string,"meets_cutoff": boolean,"org_id": string,"quality_cutoff": number,"quality_score_id": string,"rubric_set_sha256": string,"rubric_version_ids": (string)[],"score": number,"scoring_version": string,"section_scores": NonNullable<Json>,"session_id": string,"test_id": string,"test_version_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "computed_at": string,"grader_adapter_version": string,"grader_model_id": string,"id"?: string,"meets_cutoff": boolean,"org_id": string,"quality_cutoff": number,"quality_score_id": string,"rubric_set_sha256": string,"rubric_version_ids": (string)[],"score": number,"scoring_version": string,"section_scores": NonNullable<Json>,"session_id": string,"test_id": string,"test_version_id": string,"workspace_id": string
                  }
                  Update: {
                    "computed_at"?: string,"grader_adapter_version"?: string,"grader_model_id"?: string,"id"?: string,"meets_cutoff"?: boolean,"org_id"?: string,"quality_cutoff"?: number,"quality_score_id"?: string,"rubric_set_sha256"?: string,"rubric_version_ids"?: (string)[],"score"?: number,"scoring_version"?: string,"section_scores"?: NonNullable<Json>,"session_id"?: string,"test_id"?: string,"test_version_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quality_cards_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quality_cards_org_id_session_id_fkey"
      columns: ["org_id","session_id"]
isOneToOne: true
      referencedRelation: "sessions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "quality_cards_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "quality_cards_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "created_at": string,"id": string,"integrity_card_id": string | null,"org_id": string,"quality_card_id": string | null,"session_id": string,"test_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"integrity_card_id"?: string | null,"org_id": string,"quality_card_id"?: string | null,"session_id": string,"test_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"integrity_card_id"?: string | null,"org_id"?: string,"quality_card_id"?: string | null,"session_id"?: string,"test_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_org_id_integrity_card_id_session_id_fkey"
      columns: ["org_id","integrity_card_id","session_id"]
isOneToOne: false
      referencedRelation: "integrity_cards"
      referencedColumns: ["org_id","id","session_id"]
    },{
      foreignKeyName: "reports_org_id_quality_card_id_session_id_fkey"
      columns: ["org_id","quality_card_id","session_id"]
isOneToOne: false
      referencedRelation: "quality_cards"
      referencedColumns: ["org_id","id","session_id"]
    },{
      foreignKeyName: "reports_org_id_session_id_fkey"
      columns: ["org_id","session_id"]
isOneToOne: true
      referencedRelation: "sessions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "reports_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "reports_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"responses": {
                  Row: {
                    "answer_kind": string,"answer_sha256": string,"final_choice": string | null,"final_seq": number,"final_text": string | null,"id": string,"org_id": string,"session_id": string,"session_item_id": string,"submitted_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer_kind": string,"answer_sha256": string,"final_choice"?: string | null,"final_seq": number,"final_text"?: string | null,"id"?: string,"org_id": string,"session_id": string,"session_item_id": string,"submitted_at": string
                  }
                  Update: {
                    "answer_kind"?: string,"answer_sha256"?: string,"final_choice"?: string | null,"final_seq"?: number,"final_text"?: string | null,"id"?: string,"org_id"?: string,"session_id"?: string,"session_item_id"?: string,"submitted_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "responses_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "responses_org_id_session_id_fkey"
      columns: ["org_id","session_id"]
isOneToOne: false
      referencedRelation: "sessions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "responses_org_id_session_item_id_session_id_fkey"
      columns: ["org_id","session_item_id","session_id"]
isOneToOne: false
      referencedRelation: "session_items"
      referencedColumns: ["org_id","id","session_id"]
    }
                  ]
                },"rubric_versions": {
                  Row: {
                    "content_sha256": string,"created_at": string,"created_by": string | null,"criteria": NonNullable<Json>,"id": string,"org_id": string,"rubric_key": string,"version_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "content_sha256": string,"created_at"?: string,"created_by"?: string | null,"criteria": NonNullable<Json>,"id"?: string,"org_id": string,"rubric_key": string,"version_no": number
                  }
                  Update: {
                    "content_sha256"?: string,"created_at"?: string,"created_by"?: string | null,"criteria"?: NonNullable<Json>,"id"?: string,"org_id"?: string,"rubric_key"?: string,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "rubric_versions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"ruleset_versions": {
                  Row: {
                    "band_rule_version_id": string | null,"content_sha256": string | null,"id": string,"org_id": string,"published_at": string | null,"signal_settings": NonNullable<Json>,"test_id": string,"version_no": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "band_rule_version_id"?: string | null,"content_sha256"?: string | null,"id"?: string,"org_id": string,"published_at"?: string | null,"signal_settings": NonNullable<Json>,"test_id": string,"version_no": number,"workspace_id": string
                  }
                  Update: {
                    "band_rule_version_id"?: string | null,"content_sha256"?: string | null,"id"?: string,"org_id"?: string,"published_at"?: string | null,"signal_settings"?: NonNullable<Json>,"test_id"?: string,"version_no"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ruleset_versions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ruleset_versions_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "ruleset_versions_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"sections": {
                  Row: {
                    "created_at": string,"format": Database["public"]['Enums']["section_format"],"id": string,"name": string,"org_id": string,"position": number,"test_id": string,"test_version_id": string,"time_limit_seconds": number | null,"weight": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"format": Database["public"]['Enums']["section_format"],"id"?: string,"name": string,"org_id": string,"position": number,"test_id": string,"test_version_id": string,"time_limit_seconds"?: number | null,"weight": number,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"format"?: Database["public"]['Enums']["section_format"],"id"?: string,"name"?: string,"org_id"?: string,"position"?: number,"test_id"?: string,"test_version_id"?: string,"time_limit_seconds"?: number | null,"weight"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sections_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sections_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "sections_org_id_test_version_id_fkey"
      columns: ["org_id","test_version_id"]
isOneToOne: false
      referencedRelation: "test_versions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "sections_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"session_items": {
                  Row: {
                    "id": string,"item_version_id": string,"org_id": string,"position": number,"section_id": string,"served_at": string,"session_id": string,"test_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"item_version_id": string,"org_id": string,"position": number,"section_id": string,"served_at": string,"session_id": string,"test_id": string,"workspace_id": string
                  }
                  Update: {
                    "id"?: string,"item_version_id"?: string,"org_id"?: string,"position"?: number,"section_id"?: string,"served_at"?: string,"session_id"?: string,"test_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "session_items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "session_items_org_id_item_version_id_fkey"
      columns: ["org_id","item_version_id"]
isOneToOne: false
      referencedRelation: "item_versions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "session_items_org_id_section_id_fkey"
      columns: ["org_id","section_id"]
isOneToOne: false
      referencedRelation: "sections"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "session_items_org_id_session_id_fkey"
      columns: ["org_id","session_id"]
isOneToOne: false
      referencedRelation: "sessions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "session_items_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "session_items_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"sessions": {
                  Row: {
                    "adult_confirmed_at_start": boolean,"consent_id": string,"created_at": string,"id": string,"invitation_id": string,"mirror_seq": number,"org_id": string,"receipt_ref": string,"ruleset_version_id": string,"server_deadline_at": string,"started_at": string,"state": string,"submit_kind": string | null,"submitted_at": string | null,"test_id": string,"test_version_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "adult_confirmed_at_start": boolean,"consent_id": string,"created_at"?: string,"id": string,"invitation_id": string,"mirror_seq": number,"org_id": string,"receipt_ref": string,"ruleset_version_id": string,"server_deadline_at": string,"started_at": string,"state": string,"submit_kind"?: string | null,"submitted_at"?: string | null,"test_id": string,"test_version_id": string,"workspace_id": string
                  }
                  Update: {
                    "adult_confirmed_at_start"?: boolean,"consent_id"?: string,"created_at"?: string,"id"?: string,"invitation_id"?: string,"mirror_seq"?: number,"org_id"?: string,"receipt_ref"?: string,"ruleset_version_id"?: string,"server_deadline_at"?: string,"started_at"?: string,"state"?: string,"submit_kind"?: string | null,"submitted_at"?: string | null,"test_id"?: string,"test_version_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sessions_org_id_consent_id_invitation_id_ruleset_version_i_fkey"
      columns: ["org_id","consent_id","invitation_id","ruleset_version_id"]
isOneToOne: false
      referencedRelation: "consents"
      referencedColumns: ["org_id","id","invitation_id","ruleset_version_id"]
    },{
      foreignKeyName: "sessions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sessions_org_id_invitation_id_id_fkey"
      columns: ["org_id","invitation_id","id"]
isOneToOne: false
      referencedRelation: "invitations"
      referencedColumns: ["org_id","id","session_id"]
    },{
      foreignKeyName: "sessions_org_id_invitation_id_test_version_id_fkey"
      columns: ["org_id","invitation_id","test_version_id"]
isOneToOne: false
      referencedRelation: "invitations"
      referencedColumns: ["org_id","id","test_version_id"]
    },{
      foreignKeyName: "sessions_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "sessions_org_id_test_version_id_ruleset_version_id_fkey"
      columns: ["org_id","test_version_id","ruleset_version_id"]
isOneToOne: false
      referencedRelation: "test_versions"
      referencedColumns: ["org_id","id","ruleset_version_id"]
    },{
      foreignKeyName: "sessions_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"skill_taxonomy": {
                  Row: {
                    "format_hint": Database["public"]['Enums']["section_format"] | null,"id": string,"label": string,"org_id": string,"retired_at": string | null,"skill_key": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "format_hint"?: Database["public"]['Enums']["section_format"] | null,"id"?: string,"label": string,"org_id": string,"retired_at"?: string | null,"skill_key": string,"version"?: number
                  }
                  Update: {
                    "format_hint"?: Database["public"]['Enums']["section_format"] | null,"id"?: string,"label"?: string,"org_id"?: string,"retired_at"?: string | null,"skill_key"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "skill_taxonomy_org_id_fkey"
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
                },"test_versions": {
                  Row: {
                    "content_sha256": string | null,"created_at": string,"created_by": string | null,"id": string,"notice_version_id": string | null,"org_id": string,"published_at": string | null,"published_by": string | null,"quality_cutoff": number,"ruleset_version_id": string | null,"status": Database["public"]['Enums']["test_version_status"],"test_id": string,"total_time_seconds": number,"version_no": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_sha256"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"notice_version_id"?: string | null,"org_id": string,"published_at"?: string | null,"published_by"?: string | null,"quality_cutoff": number,"ruleset_version_id"?: string | null,"status"?: Database["public"]['Enums']["test_version_status"],"test_id": string,"total_time_seconds": number,"version_no": number,"workspace_id": string
                  }
                  Update: {
                    "content_sha256"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"notice_version_id"?: string | null,"org_id"?: string,"published_at"?: string | null,"published_by"?: string | null,"quality_cutoff"?: number,"ruleset_version_id"?: string | null,"status"?: Database["public"]['Enums']["test_version_status"],"test_id"?: string,"total_time_seconds"?: number,"version_no"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "test_versions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "test_versions_org_id_notice_version_id_fkey"
      columns: ["org_id","notice_version_id"]
isOneToOne: false
      referencedRelation: "notice_versions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "test_versions_org_id_ruleset_version_id_fkey"
      columns: ["org_id","ruleset_version_id"]
isOneToOne: false
      referencedRelation: "ruleset_versions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "test_versions_org_id_test_id_fkey"
      columns: ["org_id","test_id"]
isOneToOne: false
      referencedRelation: "tests"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "test_versions_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"tests": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"id": string,"invitation_seq": number,"name": string,"org_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"invitation_seq"?: number,"name": string,"org_id": string,"workspace_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"invitation_seq"?: number,"name"?: string,"org_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tests_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
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
            "v_item_bank_quant_share": {
                  Row: {
                    "org_id": string | null,"quant_items_approved": number | null,"quant_items_parameterised": number | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "item_versions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_versions_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"v_item_exposure": {
                  Row: {
                    "item_id": string | null,"org_id": string | null,"served_count": number | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "item_exposure_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_exposure_events_org_id_workspace_id_fkey"
      columns: ["org_id","workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["org_id","id"]
    }
                  ]
                }
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "actor_kind": "org_user"|"candidate"|"staff"|"system","data_residency": "r2_apac"|"s3_mumbai","invitation_status": "created"|"sent"|"otp_verified"|"started"|"submitted"|"expired"|"revoked"|"blocked_age","item_status": "draft"|"in_review"|"approved"|"not_approved"|"retired","membership_status": "invited"|"active"|"suspended"|"removed","org_kind": "customer"|"trace_library"|"trace_internal","org_role": "org_owner"|"admin"|"recruiter"|"reviewer"|"hiring_manager","org_status": "active"|"suspended","section_format": "written"|"mcq","staff_grant_scope": "support_read","test_version_status": "draft"|"published"|"retired","workspace_kind": "default"|"client"
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
            "actor_kind": ["org_user", "candidate", "staff", "system"],"data_residency": ["r2_apac", "s3_mumbai"],"invitation_status": ["created", "sent", "otp_verified", "started", "submitted", "expired", "revoked", "blocked_age"],"item_status": ["draft", "in_review", "approved", "not_approved", "retired"],"membership_status": ["invited", "active", "suspended", "removed"],"org_kind": ["customer", "trace_library", "trace_internal"],"org_role": ["org_owner", "admin", "recruiter", "reviewer", "hiring_manager"],"org_status": ["active", "suspended"],"section_format": ["written", "mcq"],"staff_grant_scope": ["support_read"],"test_version_status": ["draft", "published", "retired"],"workspace_kind": ["default", "client"]
          }
        }
} as const
