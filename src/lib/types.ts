export type UserType = "admin" | "user" | "basic";
export type UserRole = "administrator" | "schedule_administrator" | "basic";

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
  license_type_id: string | null;
  max_executions: number | null;
  executions_used: number;
  created_at: string;
  updated_at: string;
}

export type LicenseTypeKind = "one_time" | "subscription" | "by_endpoint";

export interface LicenseType {
  id: string;
  name: string;
  description: string | null;
  type: LicenseTypeKind;
  price_cents: number;
  renewal_notification_days: number;
  /** ConnectionType value — set only when type = "by_endpoint" */
  endpoint_type: string | null;
  /** Default execution block — set only when type = "one_time" */
  default_executions: number | null;
  /** Subscription validity window — only when type = "subscription" */
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "waiting" | "active" | "completed" | "completed_with_errors" | "completed_with_warnings" | "cancelled";
export type RecurrenceType = "one-time" | "daily" | "weekly" | "monthly";

export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  user_type: UserType;
  role: UserRole;
  avatar_url: string | null;
  /** For schedule_administrator: scopes the user to one customer. Null = unscoped. */
  customer_id: string | null;
  created_at: string;
}

export type WriteMode = "upsert" | "create_only" | "update_only";

export interface ScheduledTask {
  id: string;
  task_name: string;
  start_date_time: string;
  end_date_time: string | null;
  recurrence: RecurrenceType;
  source_file_path: string | null;
  ivanti_url: string | null;
  status: TaskStatus;
  mapping_profile_id: string | null;
  source_connection_id: string | null;
  target_connection_id: string | null;
  /** Ordered list of mapping profile slots for multi-BO tasks.
   *  When non-empty, overrides the legacy mapping_profile_id field. */
  mapping_slots?: MappingSlot[] | null;
  /** Controls how existing records are handled.
   *  "upsert" (default) — create new or update existing.
   *  "create_only"      — skip the row if a record with the same key already exists. */
  write_mode?: WriteMode;
  customer_id?: string | null;
  /** When true, this is a locked system-provided template. Admins can promote/demote;
   *  all users can clone it via "Use as Template". */
  is_system?: boolean;
  /** When true, every successful create/update stores the Ivanti RecID in
   *  task_created_records, enabling the Undo button to delete by RecID directly. */
  debug_mode?: boolean;
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
  | "expression"
  | "concat"
  | "ai_lookup"
  | "ai_guess"
  | "excel_date";

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
  // AI Guess fields (transform === "ai_guess")
  // AI infers the target field value from source context + optional constraint list.
  aiGuessSourceFields?: string[];  // source field IDs to include as context (empty = all fields)
  aiGuessValidValues?: string[];   // constrained valid values — AI must pick one of these
  aiGuessPrompt?: string;          // optional extra instruction
  aiGuessPicklistBo?: string;      // Ivanti picklist BO to query for valid values (e.g. "CIStatusCIType")
  aiGuessPicklistField?: string;   // Field name within the picklist BO that holds the values (e.g. "ivnt_SubType")
  // When true the proxy resolves this target field's value to an Ivanti RecID
  // before posting, regardless of whether the field name ends in "Link".
  isLinkField?: boolean;
  // Explicit Ivanti business-object name to query when resolving this link field
  // (e.g. "Location", "Employee"). Overrides the name auto-derived from the field name.
  linkFieldBoName?: string;
  // The field within the linked BO that holds the display value to match against
  // (e.g. "Name", "ivnt_SubType"). When set, only this field is tried — no guessing.
  linkFieldLookupField?: string;
  /** When true this target field is part of the composite upsert key.
   *  The proxy uses all key fields together to look up an existing record
   *  before deciding to POST (create) or PATCH (update). */
  isKey?: boolean;
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
  target_business_object?: string | null;
  /** Ivanti relationship name for many-to-many associations (e.g. "ivnt_ContractLineItemAssocCI"). */
  relationship_name?: string | null;
  /** When true, this profile creates a relationship between two existing records rather than
   *  creating/updating a single record. Both sides are looked up by key fields and linked
   *  via `relationship_name` on the target BO. */
  many_to_many?: boolean | null;
  filter_expression?: string | null;
  customer_id?: string | null;
  /** When true, this is a locked system-provided template. Admins can promote/demote;
   *  all users can clone it via "Use as Template". */
  is_system?: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A single slot in a multi-profile task — bundles a mapping profile reference
 *  with an optional display label. Source and target connections are resolved
 *  from the referenced mapping profile (same as single-profile tasks). */
export interface MappingSlot {
  id: string;
  mapping_profile_id: string | null;
  label?: string;
  enabled?: boolean;
}

// ── Endpoint connections ──────────────────────────────────────

export type ConnectionType = "file" | "cloud" | "smtp" | "odbc" | "portal" | "ivanti" | "ivanti_neurons" | "dell" | "cdw" | "azure";

export type FileType = "xlsx" | "json" | "xml" | "csv";
export type FileMode = "file" | "directory";
export interface FileConfig {
  file_type: FileType;
  file_mode: FileMode;
  file_path: string;        // storage path (file mode) or directory prefix (directory mode)
  file_name?: string;       // display name of the selected file
  output_file_name?: string; // explicit output filename (directory mode)
}
export interface CloudConfig  { url: string; customer_id: string; customer_secret: string }
export interface SmtpConfig   { server: string; port: string; login_name: string; password: string; from_address?: string }
export interface OdbcConfig   { server_name: string; login_name: string; password: string; port: string }
export interface PortalConfig { url: string; login_name: string; password: string }
export interface IvantiConfig {
  url: string;
  api_key: string;
  business_object: string;
  tenant_id?: string;
}

export interface IvantiNeuronsConfig {
  auth_url: string;       // e.g. https://<tenant>.ivanticloud.com/<tenant-id>/connect/token
  client_id: string;      // OAuth2 App Registration Client ID
  client_secret: string;  // OAuth2 App Registration Client Secret
  base_url: string;       // e.g. https://<tenant>.ivanticloud.com/api/apigatewaydataservices/v1
  dataset: string;        // "devices" | "people"
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

export interface AzureConfig {
  tenant_id: string;   // Azure AD Tenant ID
  client_id: string;   // App Registration Client ID
  client_secret: string;
  scope: string;       // e.g. https://graph.microsoft.com/.default
  base_url: string;    // API base URL after auth
}

export type ConnectionConfig =
  | FileConfig | CloudConfig | SmtpConfig | OdbcConfig | PortalConfig | IvantiConfig | IvantiNeuronsConfig | DellConfig | CdwConfig | AzureConfig;

export interface EndpointConnection {
  id: string;
  name: string;
  type: ConnectionType;
  config: ConnectionConfig;
  customer_id?: string | null;
  /** When true, this is a locked system-provided template. Admins can promote/demote;
   *  all users can clone it via "Use as Template". */
  is_system?: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Helper: apply a mapping profile to a single source row.
// aiResults — pre-fetched AI output keyed by aiOutputKey (e.g. { device_type: "Laptop", ... })
export function applyMappingProfile(
  sourceRow: Record<string, unknown>,
  profile: MappingProfile,
  aiResults?: Record<string, string>,
  // aiGuessResults: keyed by "mappingRowId" -> guessed value string
  aiGuessResults?: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const mapping of profile.mappings) {
    // Rows with no real source field use the "__static__" sentinel ID,
    // or are ai_guess transforms (value comes entirely from aiGuessResults).
    const isStaticSentinel =
      mapping.sourceFieldId === "__static__" || mapping.transform === "ai_guess";

    // Primary lookup by ID; fall back to name match when IDs have changed
    // (e.g. after re-importing the Excel file new UUIDs are generated).
    let srcField = isStaticSentinel
      ? null
      : profile.source_fields.find((f) => f.id === mapping.sourceFieldId);

    if (!srcField && !isStaticSentinel) {
      // Name-based fallback: treat sourceFieldId as a field name and search
      // profile.source_fields by name (handles re-imported files with new UUIDs).
      const byName = profile.source_fields.find(
        (f) =>
          f.name === mapping.sourceFieldId ||
          f.name.trim() === mapping.sourceFieldId.trim()
      );
      if (byName) {
        srcField = byName;
      } else {
        // Last resort: the sourceFieldId might literally be a column name in the
        // source row — build a synthetic field object so the value lookup works.
        const rawKey = Object.keys(sourceRow).find(
          (k) =>
            k === mapping.sourceFieldId ||
            k.trim() === mapping.sourceFieldId.trim()
        );
        if (rawKey != null) {
          srcField = { id: rawKey, name: rawKey };
        }
      }
    }

    const tgtField = profile.target_fields.find(
      (f) => f.id === mapping.targetFieldId
    );
    if ((!srcField && !isStaticSentinel) || !tgtField) continue;

    // Exact lookup first; fall back to trimmed-name match in case the Excel
    // column header had leading/trailing whitespace when the sheet was saved.
    let value: unknown = srcField ? sourceRow[srcField.name] : undefined;
    if (value === undefined && srcField) {
      const trimmed = srcField.name.trim();
      const fallbackKey = Object.keys(sourceRow).find(
        (k) => k.trim() === trimmed
      );
      if (fallbackKey !== undefined) value = sourceRow[fallbackKey];
    }

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
      case "static": {
        // Works for both __static__ sentinel rows and regular rows with a fixed value.
        // Strip surrounding double-quotes if the whole value is wrapped in them —
        // this happens when users type "Production" instead of Production in the editor,
        // or when values were saved with extra quotes from a previous import.
        let sv = mapping.transformValue ?? "";
        if (sv.length >= 2 && sv.startsWith('"') && sv.endsWith('"')) {
          sv = sv.slice(1, -1);
        }
        value = sv;
        break;
      }
      case "expression": {
        // Replace {FieldName} tokens with values from the source row.
        let expr = mapping.transformValue ?? "";
        expr = expr.replace(/\{([^}]+)\}/g, (_match, fieldName: string) => {
          const direct = sourceRow[fieldName];
          if (direct !== undefined) return String(direct);
          const trimmedKey = Object.keys(sourceRow).find(
            (k) => k.trim() === fieldName.trim()
          );
          return trimmedKey !== undefined ? String(sourceRow[trimmedKey] ?? "") : "";
        });
        value = expr;
        break;
      }
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
      case "ai_guess": {
        // Value comes from per-row AI guess results, keyed by mapping row ID
        value = aiGuessResults?.[mapping.id] ?? "";
        break;
      }
      case "excel_date": {
        // Convert Excel serial date number to ISO date string (YYYY-MM-DD).
        // Excel's epoch is December 30, 1899. Serial 60 is Excel's phantom
        // Feb 29 1900 (leap-year bug); subtracting 25569 converts to Unix days.
        const serial = Number(value);
        if (!isNaN(serial) && serial > 0) {
          const date = new Date((serial - 25569) * 86400 * 1000);
          value = date.toISOString().split("T")[0]; // "YYYY-MM-DD"
        }
        break;
      }
      default:
        break; // "none" — pass through
    }

    // Never assign `undefined` — that would make the key disappear from JSON.stringify.
    // Absent / empty source values become null so the field always appears in the payload.
    result[tgtField.name] = value !== undefined ? value : null;
  }

  return result;
}
