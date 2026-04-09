export type Locale = "de" | "en" | "tr";

export const messages: Record<Locale, Record<string, string>> = {
  de: {
    // Navigation
    "nav.overview": "Übersicht",
    "nav.orders": "Bestellungen",
    "nav.users": "Benutzer",
    "nav.logout": "Abmelden",
    "nav.logged_in_as": "Angemeldet als",
    "nav.admin": "Admin",
    "nav.supplier": "Lieferant",

    // Dashboard
    "dashboard.title": "Dashboard",
    "dashboard.subtitle": "Lieferantenbestellungen im Überblick",
    "dashboard.active_orders": "Aktive Bestellungen",
    "dashboard.open_debt": "Offene Schulden",
    "dashboard.open_amount": "Offener Betrag",
    "dashboard.orders_per_supplier": "Bestellungen pro Lieferant",
    "dashboard.orders_subtitle": "Alle aktiven Bestellungen",
    "dashboard.no_active_orders": "Keine aktiven Bestellungen",
    "dashboard.new_order": "Neue Bestellung",
    "dashboard.kg_per_supplier": "kg pro Lieferant",
    "dashboard.ordered_total": "Bestellt gesamt",
    "dashboard.in_transit": "Unterwegs",

    // Table
    "table.label": "Bezeichnung",
    "table.status": "Status",
    "table.eta": "Liefertermin",
    "table.documents": "Dokumente",
    "table.invoice": "Rechnung",
    "table.open": "Offen",

    // Order detail
    "order.details": "Bestelldetails",
    "order.description": "Beschreibung",
    "order.tags": "Tags",
    "order.eta": "Voraussichtliche Lieferung",
    "order.weight_packages": "Gewicht / Pakete",
    "order.tracking": "Sendungsverfolgung",
    "order.google_sheet": "Google Sheet",
    "order.open_link": "Link öffnen",
    "order.last_supplier_update": "Letztes Lieferanten-Update",
    "order.notes": "Notizen",
    "order.edit": "Bearbeiten",
    "order.edit_title": "Bestellung bearbeiten",
    "order.save": "Speichern",
    "order.cancel": "Abbrechen",
    "order.saving": "Speichern…",

    // Finance
    "order.finance": "Finanzen",
    "order.invoice_amount": "Rechnungsbetrag",
    "order.goods": "Warenwert",
    "order.shipping": "Versandkosten",
    "order.customs": "Zoll",
    "order.import_vat": "Einfuhrumsatzsteuer",
    "order.landed_cost": "Gesamtkosten",
    "order.paid": "Bezahlt",
    "order.remaining": "Restbetrag",

    // Payments, Documents, Timeline
    "order.payments": "Zahlungen",
    "order.no_payments": "Keine Zahlungen vorhanden",
    "order.documents_title": "Dokumente",
    "order.no_documents": "Keine Dokumente vorhanden",
    "order.timeline": "Verlauf",
    "order.no_events": "Keine Ereignisse",

    // Order statuses
    "order.status.draft": "Entwurf",
    "order.status.sent_to_supplier": "An Lieferant gesendet",
    "order.status.confirmed": "Bestätigt",
    "order.status.in_production": "In Produktion",
    "order.status.ready_to_ship": "Versandbereit",
    "order.status.shipped": "Versandt",
    "order.status.in_customs": "In Verzollung",
    "order.status.delivered": "Geliefert",
    "order.status.cancelled": "Storniert",

    // Login
    "login.title": "Anmelden",
    "login.subtitle": "Melden Sie sich bei Ihrem Konto an",
    "login.identifier": "Benutzername oder E-Mail",
    "login.password": "Passwort",
    "login.submit": "Anmelden",
    "login.submitting": "Wird angemeldet…",
    "login.no_account": "Noch kein Konto?",
    "login.register": "Registrieren",

    // Register
    "register.title": "Registrieren",
    "register.subtitle": "Erstellen Sie ein neues Konto",
    "register.username": "Benutzername",
    "register.display_name": "Anzeigename",
    "register.email": "E-Mail",
    "register.password": "Passwort",
    "register.confirm_password": "Passwort bestätigen",
    "register.submit": "Registrieren",
    "register.submitting": "Wird registriert…",
    "register.has_account": "Bereits ein Konto?",
    "register.login": "Anmelden",

    // Pending
    "pending.title": "Genehmigung ausstehend",
    "pending.message":
      "Ihr Konto wartet auf Genehmigung durch einen Administrator. Bitte versuchen Sie es später erneut.",
    "pending.logout": "Abmelden",

    // Upload
    "upload.button": "Hochladen",
    "upload.uploading": "Wird hochgeladen…",

    // Document kinds
    "doc.invoice": "Rechnung",
    "doc.order_overview": "Bestellübersicht",
    "doc.customs": "Zolldokumente",
    "doc.waybill": "Waybill",
    "doc.payment_proof": "Zahlungsnachweis",
    "doc.shipping": "Versanddokumente",
    "doc.other": "Sonstige",

    // Common
    "common.back": "Zurück",
    "common.delete": "Löschen",
    "common.edit": "Bearbeiten",
    "common.confirm": "Bestätigen",
  },

  en: {
    // Navigation
    "nav.overview": "Overview",
    "nav.orders": "Orders",
    "nav.users": "Users",
    "nav.logout": "Log out",
    "nav.logged_in_as": "Logged in as",
    "nav.admin": "Admin",
    "nav.supplier": "Supplier",

    // Dashboard
    "dashboard.title": "Dashboard",
    "dashboard.subtitle": "Supplier orders at a glance",
    "dashboard.active_orders": "Active orders",
    "dashboard.open_debt": "Open debt",
    "dashboard.open_amount": "Open amount",
    "dashboard.orders_per_supplier": "Orders per supplier",
    "dashboard.orders_subtitle": "All active orders",
    "dashboard.no_active_orders": "No active orders",
    "dashboard.new_order": "New order",
    "dashboard.kg_per_supplier": "kg per supplier",
    "dashboard.ordered_total": "Ordered total",
    "dashboard.in_transit": "In transit",

    // Table
    "table.label": "Label",
    "table.status": "Status",
    "table.eta": "ETA",
    "table.documents": "Documents",
    "table.invoice": "Invoice",
    "table.open": "Open",

    // Order detail
    "order.details": "Order details",
    "order.description": "Description",
    "order.tags": "Tags",
    "order.eta": "Estimated delivery",
    "order.weight_packages": "Weight / Packages",
    "order.tracking": "Tracking",
    "order.google_sheet": "Google Sheet",
    "order.open_link": "Open link",
    "order.last_supplier_update": "Last supplier update",
    "order.notes": "Notes",
    "order.edit": "Edit",
    "order.edit_title": "Edit order",
    "order.save": "Save",
    "order.cancel": "Cancel",
    "order.saving": "Saving…",

    // Finance
    "order.finance": "Finance",
    "order.invoice_amount": "Invoice amount",
    "order.goods": "Goods value",
    "order.shipping": "Shipping cost",
    "order.customs": "Customs duty",
    "order.import_vat": "Import VAT",
    "order.landed_cost": "Landed cost",
    "order.paid": "Paid",
    "order.remaining": "Remaining",

    // Payments, Documents, Timeline
    "order.payments": "Payments",
    "order.no_payments": "No payments recorded",
    "order.documents_title": "Documents",
    "order.no_documents": "No documents uploaded",
    "order.timeline": "Timeline",
    "order.no_events": "No events",

    // Order statuses
    "order.status.draft": "Draft",
    "order.status.sent_to_supplier": "Sent to supplier",
    "order.status.confirmed": "Confirmed",
    "order.status.in_production": "In production",
    "order.status.ready_to_ship": "Ready to ship",
    "order.status.shipped": "Shipped",
    "order.status.in_customs": "In customs",
    "order.status.delivered": "Delivered",
    "order.status.cancelled": "Cancelled",

    // Login
    "login.title": "Sign in",
    "login.subtitle": "Sign in to your account",
    "login.identifier": "Username or email",
    "login.password": "Password",
    "login.submit": "Sign in",
    "login.submitting": "Signing in…",
    "login.no_account": "Don't have an account?",
    "login.register": "Register",

    // Register
    "register.title": "Register",
    "register.subtitle": "Create a new account",
    "register.username": "Username",
    "register.display_name": "Display name",
    "register.email": "Email",
    "register.password": "Password",
    "register.confirm_password": "Confirm password",
    "register.submit": "Register",
    "register.submitting": "Registering…",
    "register.has_account": "Already have an account?",
    "register.login": "Sign in",

    // Pending
    "pending.title": "Pending approval",
    "pending.message":
      "Your account is awaiting approval by an administrator. Please try again later.",
    "pending.logout": "Log out",

    // Upload
    "upload.button": "Upload",
    "upload.uploading": "Uploading…",

    // Document kinds
    "doc.invoice": "Invoice",
    "doc.order_overview": "Order overview",
    "doc.customs": "Customs documents",
    "doc.waybill": "Waybill",
    "doc.payment_proof": "Payment proof",
    "doc.shipping": "Shipping documents",
    "doc.other": "Other",

    // Common
    "common.back": "Back",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.confirm": "Confirm",
  },

  tr: {
    // Navigation
    "nav.overview": "Genel Bakış",
    "nav.orders": "Siparişler",
    "nav.users": "Kullanıcılar",
    "nav.logout": "Çıkış Yap",
    "nav.logged_in_as": "Giriş yapan",
    "nav.admin": "Yönetici",
    "nav.supplier": "Tedarikçi",

    // Dashboard
    "dashboard.title": "Kontrol Paneli",
    "dashboard.subtitle": "Tedarikçi siparişlerine genel bakış",
    "dashboard.active_orders": "Aktif siparişler",
    "dashboard.open_debt": "Açık borç",
    "dashboard.open_amount": "Açık tutar",
    "dashboard.orders_per_supplier": "Tedarikçi başına siparişler",
    "dashboard.orders_subtitle": "Tüm aktif siparişler",
    "dashboard.no_active_orders": "Aktif sipariş yok",
    "dashboard.new_order": "Yeni sipariş",
    "dashboard.kg_per_supplier": "Tedarikçi başına kg",
    "dashboard.ordered_total": "Toplam sipariş",
    "dashboard.in_transit": "Yolda",

    // Table
    "table.label": "Etiket",
    "table.status": "Durum",
    "table.eta": "Tahmini Varış",
    "table.documents": "Belgeler",
    "table.invoice": "Fatura",
    "table.open": "Açık",

    // Order detail
    "order.details": "Sipariş detayları",
    "order.description": "Açıklama",
    "order.tags": "Etiketler",
    "order.eta": "Tahmini teslimat",
    "order.weight_packages": "Ağırlık / Paketler",
    "order.tracking": "Kargo takibi",
    "order.google_sheet": "Google Sheet",
    "order.open_link": "Bağlantıyı aç",
    "order.last_supplier_update": "Son tedarikçi güncellemesi",
    "order.notes": "Notlar",
    "order.edit": "Düzenle",
    "order.edit_title": "Siparişi düzenle",
    "order.save": "Kaydet",
    "order.cancel": "İptal",
    "order.saving": "Kaydediliyor…",

    // Finance
    "order.finance": "Finans",
    "order.invoice_amount": "Fatura tutarı",
    "order.goods": "Mal bedeli",
    "order.shipping": "Kargo ücreti",
    "order.customs": "Gümrük vergisi",
    "order.import_vat": "İthalat KDV'si",
    "order.landed_cost": "Toplam maliyet",
    "order.paid": "Ödendi",
    "order.remaining": "Kalan",

    // Payments, Documents, Timeline
    "order.payments": "Ödemeler",
    "order.no_payments": "Kayıtlı ödeme yok",
    "order.documents_title": "Belgeler",
    "order.no_documents": "Yüklü belge yok",
    "order.timeline": "Zaman Çizelgesi",
    "order.no_events": "Olay yok",

    // Order statuses
    "order.status.draft": "Taslak",
    "order.status.sent_to_supplier": "Tedarikçiye gönderildi",
    "order.status.confirmed": "Onaylandı",
    "order.status.in_production": "Üretimde",
    "order.status.ready_to_ship": "Gönderime hazır",
    "order.status.shipped": "Gönderildi",
    "order.status.in_customs": "Gümrükte",
    "order.status.delivered": "Teslim edildi",
    "order.status.cancelled": "İptal edildi",

    // Login
    "login.title": "Giriş Yap",
    "login.subtitle": "Hesabınıza giriş yapın",
    "login.identifier": "Kullanıcı adı veya e-posta",
    "login.password": "Şifre",
    "login.submit": "Giriş Yap",
    "login.submitting": "Giriş yapılıyor…",
    "login.no_account": "Hesabınız yok mu?",
    "login.register": "Kayıt Ol",

    // Register
    "register.title": "Kayıt Ol",
    "register.subtitle": "Yeni bir hesap oluşturun",
    "register.username": "Kullanıcı adı",
    "register.display_name": "Görünen ad",
    "register.email": "E-posta",
    "register.password": "Şifre",
    "register.confirm_password": "Şifreyi onayla",
    "register.submit": "Kayıt Ol",
    "register.submitting": "Kaydediliyor…",
    "register.has_account": "Zaten bir hesabınız var mı?",
    "register.login": "Giriş Yap",

    // Pending
    "pending.title": "Onay bekleniyor",
    "pending.message":
      "Hesabınız bir yönetici tarafından onaylanmayı bekliyor. Lütfen daha sonra tekrar deneyin.",
    "pending.logout": "Çıkış Yap",

    // Upload
    "upload.button": "Yükle",
    "upload.uploading": "Yükleniyor…",

    // Document kinds
    "doc.invoice": "Fatura",
    "doc.order_overview": "Sipariş özeti",
    "doc.customs": "Gümrük belgeleri",
    "doc.waybill": "İrsaliye",
    "doc.payment_proof": "Ödeme kanıtı",
    "doc.shipping": "Kargo belgeleri",
    "doc.other": "Diğer",

    // Common
    "common.back": "Geri",
    "common.delete": "Sil",
    "common.edit": "Düzenle",
    "common.confirm": "Onayla",
  },
};

export function t(locale: Locale, key: string): string {
  return messages[locale]?.[key] ?? messages.de[key] ?? key;
}
