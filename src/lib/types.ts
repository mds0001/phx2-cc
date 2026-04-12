export type UserType = "admin" | "user";
export type UserRole = "administrator" | "schedule_administrator";

// ── Back of House ─────────────────────────────────────────────

export type PaymentStatus = "active" | "lapsed" | "failed" | "pending";
export type LicenseStatus = "active" | "trial" | "expired" | "cancelled";
export type RenewalType   = "auto" | "manual";

export interface Customer {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  // Billing address
  billing_street: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  billing_country: string | null;
  // Payment info
  card_type: string | null;
  card_last4: string | null;
  card_expiry_month: number | null;
  card_expiry_year: number | null;
  payment_processor_ref: string | null;
  po_terms: string | null;
  payment_status: PaymentStatus;
  // Settings
  alert_days_before: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerLicense {
  id: string;
  customer_id: string;
  product_name: string;
  license_key: string | null;
  seats: number;
  start_date: string | null;
  expiry_date: string | null;
  status: LicenseStatus;
  renewal_type: RenewalType;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export type TaskStatus = "waiting" | "active" | "completed" | "cancelled";
export type RecurrenceType = "one-time" | "daily" | "weekly" | "monthly";
export type RuleType = "Contact Members" | "Data Transfer" | "Ivanti CI Sync";

export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  user_type: UserType;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
}

export interface ScheduledTask {
  id: string;
  task_name: string;
  start_date_time: string;
  end_date_time: string | null;
  recurrence: RecurrenceType;
  rule_type: RuleType;
  source_file_path: string | null;
  ivanti_url: string | null;
  status: TaskStatus;
  mapping_profile_id: string | null;
  source_connection_id: string | null;
  target_connection_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskLog {
  id: string;
  task_id: string;
  action: string;
  details: string | null;
  created_at: string;
}

// ── Mapping profiles ──────────────────────────────────────────

export interface FieldDef {
  id: string;
  name: string;
  sample?: string; // first-row preview value from Excel
}

export type TransformType =
  | "none"
  | "uppercase"
  | "lowercase"
  | "trim"
  | "static"
  | "concat"
  | "ai_lookup";

export interface MappingRow {
  id: string;
  sourceFieldId: string;
  targetFieldId: string;
  transform: TransformType;
  transformValue?: string;    // for "static"
  concatFieldId?: string;     // for "concat" — second source field
  concatSeparator?: string;   // for "concat" — separator string
  // AI Lookup fields (transform === "ai_lookup")
  aiSourceFields?: string[];  // source field IDs to feed into the AI
  aiOutputKey?: string;       // key to extract from the AI JSON response
  aiPrompt?: string;          // optional custom system prompt / instruction
}

export interface MappingProfile {
  id: string;
  name: string;
  description?: string | null;
  source_fields: FieldDef[];
  target_fields: FieldDef[];
  mappings: MappingRow[];
  source_connection_id?: string | null;
  target_connection_id?: string | null;
  filter_expression?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Endpoint connections ──────────────────────────────────────

export type ConnectionType = "file" | "cloud" | "smtp" | "odbc" | "portal" | "ivanti" | "dell" | "cdw";

export interface FileConfig   { file_path: string; file_name?: string }
export interface CloudConfig  { url: string; customer_id: string; customer_secret: string }
export interface SmtpConfig   { server: string; port: string; login_name: string; password: string }
export interface OdbcConfig   { server_name: string; login_name: string; password: string; port: string }
export interface PortalConfig { url: string; login_name: string; password: string }
export interface IvantiConfig {
  url: string;
  api_key: string;
  business_object: string;
  tenant_id?: string;
}

export interface DellConfig {
  base_url: string;           // https://apigtwb2c.us.dell.com
  client_id: string;          // OAuth2 client ID from Dell
  client_secret: string;      // OAuth2 client secret from Dell
  forwarded_client_id: string; // X-FORWARDED-CLIENT-ID header value
  premier_account_id?: string; // Dell Premier account/store ID
  scope?: string;              // OAuth scope (default: "oob")
}

export interface CdwConfig {
  base_url: string;           // CDW API gateway URL (from CDW after approval)
  subscription_key: string;   // Ocp-Apim-Subscription-Key (Azure API Management)
  account_number?: string;    // CDW customer account number
}

export type ConnectionConfig =
  | FileConfig | CloudConfig | SmtpConfig | OdbcConfig | PortalConfig | IvantiConfig | DellConfig | CdwConfig;

export interface EndpointConnection {
  id: string;
  name: string;
  type: ConnectionType;
  config: ConnectionConfig;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Helper: apply a mapping profile to a single source row.
// aiResults — pre-fetched AI output keyed by aiOutputKey (e.g. { device_type: "Laptop", ... })
export function applyMappingProfile(
  sourceRow: Record<string, unknown>,
  profile: MappingProfile,
  aiResults?: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const mapping of profile.mappings) {
    const srcField = profile.source_fields.find(
      (f) => f.id === mapping.sourceFieldId
    );
    const tgtField = profile.target_fields.find(
      (f) => f.id === mapping.targetFieldId
    );
    if (!srcField || !tgtField) continue;

    let value: unknown = sourceRow[srcField.name];

    switch (mapping.transform) {
      case "uppercase":
        value = String(value ?? "").toUpperCase();
        break;
      case "lowercase":
        value = String(value ?? "").toLowerCase();
        break;
      case "trim":
        value = String(value ?? "").trim();
        break;
      case "static":
        value = mapping.transformValue ?? "";
        break;
      case "concat": {
        const concatSrc = profile.source_fields.find(
          (f) => f.id === mapping.concatFieldId
        );
        const v1 = String(value ?? "");
        const v2 = concatSrc
          ? String(sourceRow[concatSrc.name] ?? "")
          : "";
        value = v1 + (mapping.concatSeparator ?? "") + v2;
        break;
      }
      case "ai_lookup": {
        // Value comes from pre-fetched AI results, keyed by aiOutputKey
        const key = mapping.aiOutputKey ?? "";
        value = aiResults?.[key] ?? "";
        break;
      }
      default:
        break; // "none" — pass through
    }

    result[tgtField.name] = value;
  }

  return result;
}
