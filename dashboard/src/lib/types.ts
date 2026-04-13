// Domain types — keep in sync with supabase/migrations/0001_init.sql.

export type OrderStatus =
  | "draft"
  | "sent_to_supplier"
  | "confirmed"
  | "in_production"
  | "ready_to_ship"
  | "shipped"
  | "in_customs"
  | "delivered"
  | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
  "draft",
  "sent_to_supplier",
  "confirmed",
  "in_production",
  "ready_to_ship",
  "shipped",
  "in_customs",
  "delivered",
  "cancelled",
];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Entwurf",
  sent_to_supplier: "An Lieferant gesendet",
  confirmed: "Bestätigt",
  in_production: "In Produktion",
  ready_to_ship: "Versandbereit",
  shipped: "Versandt",
  in_customs: "In Verzollung",
  delivered: "Geliefert",
  cancelled: "Storniert",
};

export type DocumentKind =
  | "supplier_invoice"
  | "order_overview"
  | "customs_document"
  | "waybill"
  | "payment_proof"
  | "shipping_document"
  | "order_screenshot"
  | "dhl_document"
  | "damage_report"
  | "other";

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  supplier_invoice: "Rechnung",
  order_overview: "Bestellübersicht",
  customs_document: "Zolldokumente",
  waybill: "Waybill",
  payment_proof: "Zahlungsnachweis",
  shipping_document: "Versanddokumente",
  order_screenshot: "Bestell-Screenshot",
  dhl_document: "DHL-Dokument",
  damage_report: "Schadensbericht",
  other: "Sonstige",
};

// Reihenfolge + welche Typen als Quick-Buttons im Upload angezeigt werden.
export const DOCUMENT_QUICK_KINDS: DocumentKind[] = [
  "supplier_invoice",
  "order_overview",
  "customs_document",
  "waybill",
  "payment_proof",
  "shipping_document",
  "other",
];

export const TAG_OPTIONS = ["extensions", "kleber", "zubehör", "werkzeug", "sonstiges"] as const;
export type Tag = (typeof TAG_OPTIONS)[number];

export interface Supplier {
  id: string;
  name: string;
  default_lead_weeks: number;
  price_list_url: string | null;
  avatar_path: string | null;
  overview_doc_path: string | null;
  overview_doc_label: string | null;
  overview_visible_to_supplier: boolean;
  sort_order: number;
  regions: string[] | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_address: string | null;
  iban: string | null;
  swift_bic: string | null;
  profile_notes: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  is_admin: boolean;
  approved: boolean;
  language: string;
  supplier_id: string | null;
}

export interface Order {
  id: string;
  supplier_id: string;
  label: string;
  description: string | null;
  tags: string[];
  sheet_url: string | null;
  status: OrderStatus;
  invoice_total: number | null;
  goods_value: number | null;
  shipping_cost: number | null;
  customs_duty: number | null;
  import_vat: number | null;
  weight_kg: number | null;
  package_count: number | null;
  tracking_number: string | null;
  tracking_url: string | null;
  eta: string | null;
  order_date: string | null;
  region: string | null;
  last_supplier_update: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderWithTotals extends Order {
  landed_cost: number;
  paid_total: number;
  remaining_balance: number;
}

export interface Payment {
  id: string;
  order_id: string;
  amount: number;
  paid_at: string;
  method: string | null;
  proof_path: string | null;
  note: string | null;
  created_at: string;
}

export interface OrderDocument {
  id: string;
  order_id: string;
  kind: DocumentKind;
  file_path: string;
  file_name: string;
  created_at: string;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  event_type: string;
  message: string;
  meta: Record<string, unknown> | null;
  actor_id: string | null;
  created_at: string;
}

// ---- Product Catalog ----

export interface ProductMethod {
  id: string;
  supplier_id: string;
  name: string;
  sort_order: number;
}

export interface ProductLength {
  id: string;
  method_id: string;
  value: string;
  unit: string;
  sort_order: number;
}

export interface ProductColor {
  id: string;
  length_id: string;
  name_hairvenly: string;
  name_supplier: string | null;
  name_shopify: string | null;
  sort_order: number;
  updated_at: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  color_id: string | null;
  method_name: string;
  length_value: string;
  color_name: string;
  quantity: number;
  unit: string;
}

/** Full catalog tree loaded for the wizard */
export interface CatalogMethod extends ProductMethod {
  lengths: CatalogLength[];
}

export interface CatalogLength extends ProductLength {
  colors: ProductColor[];
}
