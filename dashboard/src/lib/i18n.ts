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
    "dashboard.orders_count": "Bestellungen",
    "dashboard.active_count": "aktiv",
    "dashboard.invoice_label": "Rechnung",
    "dashboard.open_label": "Offen",
    "dashboard.price_list": "Preisliste öffnen",
    "dashboard.no_price_list": "Keine Preisliste hinterlegt",
    "dashboard.scan_invoice": "Rechnung scannen (bald)",
    "dashboard.volume_title": "Bestellvolumen pro Monat",
    "dashboard.volume_subtitle": "Letzte 12 Monate · USD",
    "dashboard.debt_title": "Offene Schulden im Verlauf",
    "dashboard.debt_subtitle": "Kumuliert pro Monatsende · USD",

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
    "order.open_sheet": "öffnen",
    "order.last_supplier_update": "Letztes Lieferanten-Update",
    "order.notes": "Notizen",
    "order.edit": "Bearbeiten",
    "order.edit_title": "Bestellung bearbeiten",
    "order.edit_button": "Bestellung bearbeiten",
    "order.save": "Speichern",
    "order.cancel": "Abbrechen",
    "order.saving": "Speichern…",
    "order.delete": "Bestellung löschen",
    "order.confirm_delete": "Bestellung wirklich löschen? Alle Zahlungen, Dokumente und Einträge werden unwiderruflich entfernt.",
    "order.created": "erstellt",
    "order.by": "von",

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
    "order.no_payments_yet": "Noch keine Zahlungen.",
    "order.documents_title": "Dokumente",
    "order.no_documents": "Keine Dokumente vorhanden",
    "order.no_documents_yet": "Noch keine Dokumente.",
    "order.timeline": "Verlauf",
    "order.no_events": "Keine Ereignisse",
    "order.no_events_yet": "Keine Einträge.",

    // Edit form fields
    "order.field.status": "Status",
    "order.field.eta": "Ankunft ca.",
    "order.field.tracking_number": "Tracking-Nummer",
    "order.field.tracking_url": "Tracking-URL",
    "order.field.last_update": "Letztes Lieferanten-Update",
    "order.field.invoice_total": "Rechnungsbetrag (USD)",
    "order.field.weight": "Gewicht (kg)",
    "order.field.packages": "Pakete",
    "order.field.notes": "Notizen",

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

    // Payment form
    "payment.amount_placeholder": "Betrag USD",
    "payment.method_placeholder": "z.B. Sparkasse Überweisung",
    "payment.note_placeholder": "Notiz (optional)",
    "payment.adding": "Hinzufügen…",
    "payment.add": "Zahlung hinzufügen",
    "payment.number": "Zahlung",
    "payment.confirm_delete": "Zahlung wirklich löschen?",
    "payment.method": "Methode",
    "payment.note": "Notiz",

    // Quick docs
    "doc.open_invoice": "Rechnung öffnen",
    "doc.invoice_short": "Rechnung",
    "doc.no_invoice": "Keine Rechnung",
    "doc.open_proof": "Zahlungsnachweis öffnen",
    "doc.proof_short": "Zahlung",
    "doc.no_proof": "Kein Nachweis",
    "doc.already_paid": "Bereits gezahlt",
    "doc.confirm_delete": "Dokument wirklich löschen?",
    "doc.uploading": "Lade hoch…",
    "doc.upload_as": "Datei hochladen als",

    // Document kinds
    "doc.kind.supplier_invoice": "Rechnung",
    "doc.kind.order_overview": "Bestellübersicht",
    "doc.kind.customs_document": "Zolldokumente",
    "doc.kind.waybill": "Waybill",
    "doc.kind.payment_proof": "Zahlungsnachweis",
    "doc.kind.shipping_document": "Versanddokumente",
    "doc.kind.order_screenshot": "Bestell-Screenshot",
    "doc.kind.dhl_document": "DHL-Dokument",
    "doc.kind.damage_report": "Schadensbericht",
    "doc.kind.other": "Sonstige",

    // Legacy doc keys (keep for backwards compat)
    "doc.invoice": "Rechnung",
    "doc.order_overview": "Bestellübersicht",
    "doc.customs": "Zolldokumente",
    "doc.waybill": "Waybill",
    "doc.payment_proof": "Zahlungsnachweis",
    "doc.shipping": "Versanddokumente",
    "doc.other": "Sonstige",

    // Overview doc
    "overview.upload": "Übersicht hochladen",
    "overview.uploading": "Lade…",
    "overview.open": "Übersicht öffnen",
    "overview.label_placeholder": "z.B. Stand 8.4.26",
    "overview.label_add": "Beschriftung +",
    "overview.overview": "Übersicht",
    "overview.replace": "ersetzen",
    "overview.visible": "sichtbar",
    "overview.hidden": "versteckt",
    "overview.visible_tooltip": "Lieferant sieht das Dokument — klicken zum Ausblenden",
    "overview.hidden_tooltip": "Für Lieferant ausgeblendet — klicken zum Einblenden",
    "overview.delete": "löschen",
    "overview.updated": "Aktualisiert",

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

    // New order
    "new_order.title": "Neue Bestellung",
    "new_order.select_supplier": "Wählen…",
    "new_order.order_date": "Bestelldatum",
    "new_order.label": "Bezeichnung",
    "new_order.label_placeholder": "z.B. Amanda 09-04-2026",
    "new_order.auto_generated": "Wird automatisch aus Lieferant + Datum generiert",
    "new_order.description_placeholder": "Was ist im Paket? z.B. Extensions + Kleber",
    "new_order.create": "Bestellung anlegen",

    // Supplier nav
    "nav.suppliers": "Lieferanten",

    // Orders list page
    "orders.total": "insgesamt",
    "orders.suppliers": "Lieferanten",
    "orders.no_orders": "Noch keine Bestellungen.",

    // Common
    "common.back": "Zurück",
    "common.delete": "Löschen",
    "common.edit": "Bearbeiten",
    "common.confirm": "Bestätigen",
    "common.save": "Speichern",
    "common.cancel": "Abbrechen",
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
    "dashboard.orders_count": "orders",
    "dashboard.active_count": "active",
    "dashboard.invoice_label": "Invoice",
    "dashboard.open_label": "Open",
    "dashboard.price_list": "Open price list",
    "dashboard.no_price_list": "No price list available",
    "dashboard.scan_invoice": "Scan invoice (coming soon)",
    "dashboard.volume_title": "Order volume per month",
    "dashboard.volume_subtitle": "Last 12 months · USD",
    "dashboard.debt_title": "Open debt over time",
    "dashboard.debt_subtitle": "Cumulative per month end · USD",

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
    "order.open_sheet": "open",
    "order.last_supplier_update": "Last supplier update",
    "order.notes": "Notes",
    "order.edit": "Edit",
    "order.edit_title": "Edit order",
    "order.edit_button": "Edit order",
    "order.save": "Save",
    "order.cancel": "Cancel",
    "order.saving": "Saving…",
    "order.delete": "Delete order",
    "order.confirm_delete": "Really delete this order? All payments, documents and events will be permanently removed.",
    "order.created": "created",
    "order.by": "by",

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
    "order.no_payments_yet": "No payments yet.",
    "order.documents_title": "Documents",
    "order.no_documents": "No documents uploaded",
    "order.no_documents_yet": "No documents yet.",
    "order.timeline": "Timeline",
    "order.no_events": "No events",
    "order.no_events_yet": "No entries yet.",

    // Edit form fields
    "order.field.status": "Status",
    "order.field.eta": "ETA",
    "order.field.tracking_number": "Tracking number",
    "order.field.tracking_url": "Tracking URL",
    "order.field.last_update": "Last supplier update",
    "order.field.invoice_total": "Invoice amount (USD)",
    "order.field.weight": "Weight (kg)",
    "order.field.packages": "Packages",
    "order.field.notes": "Notes",

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

    // Payment form
    "payment.amount_placeholder": "Amount USD",
    "payment.method_placeholder": "e.g. bank transfer",
    "payment.note_placeholder": "Note (optional)",
    "payment.adding": "Adding…",
    "payment.add": "Add payment",
    "payment.number": "Payment",
    "payment.confirm_delete": "Really delete this payment?",
    "payment.method": "Method",
    "payment.note": "Note",

    // Quick docs
    "doc.open_invoice": "Open invoice",
    "doc.invoice_short": "Invoice",
    "doc.no_invoice": "No invoice",
    "doc.open_proof": "Open payment proof",
    "doc.proof_short": "Payment",
    "doc.no_proof": "No proof",
    "doc.already_paid": "Already paid",
    "doc.confirm_delete": "Really delete this document?",
    "doc.uploading": "Uploading…",
    "doc.upload_as": "Upload file as",

    // Document kinds
    "doc.kind.supplier_invoice": "Invoice",
    "doc.kind.order_overview": "Order overview",
    "doc.kind.customs_document": "Customs documents",
    "doc.kind.waybill": "Waybill",
    "doc.kind.payment_proof": "Payment proof",
    "doc.kind.shipping_document": "Shipping documents",
    "doc.kind.order_screenshot": "Order screenshot",
    "doc.kind.dhl_document": "DHL document",
    "doc.kind.damage_report": "Damage report",
    "doc.kind.other": "Other",

    // Legacy doc keys
    "doc.invoice": "Invoice",
    "doc.order_overview": "Order overview",
    "doc.customs": "Customs documents",
    "doc.waybill": "Waybill",
    "doc.payment_proof": "Payment proof",
    "doc.shipping": "Shipping documents",
    "doc.other": "Other",

    // Overview doc
    "overview.upload": "Upload overview",
    "overview.uploading": "Loading…",
    "overview.open": "Open overview",
    "overview.label_placeholder": "e.g. as of 8 Apr 26",
    "overview.label_add": "Add label +",
    "overview.overview": "Overview",
    "overview.replace": "replace",
    "overview.visible": "visible",
    "overview.hidden": "hidden",
    "overview.visible_tooltip": "Supplier can see this — click to hide",
    "overview.hidden_tooltip": "Hidden from supplier — click to show",
    "overview.delete": "delete",
    "overview.updated": "Updated",

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

    // New order
    "new_order.title": "New order",
    "new_order.select_supplier": "Select…",
    "new_order.order_date": "Order date",
    "new_order.label": "Label",
    "new_order.label_placeholder": "e.g. Amanda 09-04-2026",
    "new_order.auto_generated": "Auto-generated from supplier + date",
    "new_order.description_placeholder": "What's in the package? e.g. Extensions + Glue",
    "new_order.create": "Create order",

    // Supplier nav
    "nav.suppliers": "Suppliers",

    // Orders list page
    "orders.total": "total",
    "orders.suppliers": "suppliers",
    "orders.no_orders": "No orders yet.",

    // Common
    "common.back": "Back",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.confirm": "Confirm",
    "common.save": "Save",
    "common.cancel": "Cancel",
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
    "dashboard.orders_count": "sipariş",
    "dashboard.active_count": "aktif",
    "dashboard.invoice_label": "Fatura",
    "dashboard.open_label": "Açık",
    "dashboard.price_list": "Fiyat listesini aç",
    "dashboard.no_price_list": "Fiyat listesi yok",
    "dashboard.scan_invoice": "Fatura tara (yakında)",
    "dashboard.volume_title": "Aylık sipariş hacmi",
    "dashboard.volume_subtitle": "Son 12 ay · USD",
    "dashboard.debt_title": "Açık borç seyri",
    "dashboard.debt_subtitle": "Ay sonu kümülatif · USD",

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
    "order.open_sheet": "aç",
    "order.last_supplier_update": "Son tedarikçi güncellemesi",
    "order.notes": "Notlar",
    "order.edit": "Düzenle",
    "order.edit_title": "Siparişi düzenle",
    "order.edit_button": "Siparişi düzenle",
    "order.save": "Kaydet",
    "order.cancel": "İptal",
    "order.saving": "Kaydediliyor…",
    "order.delete": "Siparişi sil",
    "order.confirm_delete": "Sipariş silinsin mi? Tüm ödemeler, belgeler ve kayıtlar kalıcı olarak kaldırılacak.",
    "order.created": "oluşturuldu",
    "order.by": "tarafından",

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
    "order.no_payments_yet": "Henüz ödeme yok.",
    "order.documents_title": "Belgeler",
    "order.no_documents": "Yüklü belge yok",
    "order.no_documents_yet": "Henüz belge yok.",
    "order.timeline": "Zaman Çizelgesi",
    "order.no_events": "Olay yok",
    "order.no_events_yet": "Henüz kayıt yok.",

    // Edit form fields
    "order.field.status": "Durum",
    "order.field.eta": "Tahmini Varış",
    "order.field.tracking_number": "Takip numarası",
    "order.field.tracking_url": "Takip URL'si",
    "order.field.last_update": "Son tedarikçi güncellemesi",
    "order.field.invoice_total": "Fatura tutarı (USD)",
    "order.field.weight": "Ağırlık (kg)",
    "order.field.packages": "Paketler",
    "order.field.notes": "Notlar",

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

    // Payment form
    "payment.amount_placeholder": "Tutar USD",
    "payment.method_placeholder": "ör. banka havalesi",
    "payment.note_placeholder": "Not (opsiyonel)",
    "payment.adding": "Ekleniyor…",
    "payment.add": "Ödeme ekle",
    "payment.number": "Ödeme",
    "payment.confirm_delete": "Ödeme silinsin mi?",
    "payment.method": "Yöntem",
    "payment.note": "Not",

    // Quick docs
    "doc.open_invoice": "Faturayı aç",
    "doc.invoice_short": "Fatura",
    "doc.no_invoice": "Fatura yok",
    "doc.open_proof": "Ödeme kanıtını aç",
    "doc.proof_short": "Ödeme",
    "doc.no_proof": "Kanıt yok",
    "doc.already_paid": "Zaten ödendi",
    "doc.confirm_delete": "Belge silinsin mi?",
    "doc.uploading": "Yükleniyor…",
    "doc.upload_as": "Dosya yükle:",

    // Document kinds
    "doc.kind.supplier_invoice": "Fatura",
    "doc.kind.order_overview": "Sipariş özeti",
    "doc.kind.customs_document": "Gümrük belgeleri",
    "doc.kind.waybill": "İrsaliye",
    "doc.kind.payment_proof": "Ödeme kanıtı",
    "doc.kind.shipping_document": "Kargo belgeleri",
    "doc.kind.order_screenshot": "Sipariş ekran görüntüsü",
    "doc.kind.dhl_document": "DHL belgesi",
    "doc.kind.damage_report": "Hasar raporu",
    "doc.kind.other": "Diğer",

    // Legacy doc keys
    "doc.invoice": "Fatura",
    "doc.order_overview": "Sipariş özeti",
    "doc.customs": "Gümrük belgeleri",
    "doc.waybill": "İrsaliye",
    "doc.payment_proof": "Ödeme kanıtı",
    "doc.shipping": "Kargo belgeleri",
    "doc.other": "Diğer",

    // Overview doc
    "overview.upload": "Genel bakış yükle",
    "overview.uploading": "Yükleniyor…",
    "overview.open": "Genel bakışı aç",
    "overview.label_placeholder": "ör. 8.4.26 itibarıyla",
    "overview.label_add": "Etiket +",
    "overview.overview": "Genel Bakış",
    "overview.replace": "değiştir",
    "overview.visible": "görünür",
    "overview.hidden": "gizli",
    "overview.visible_tooltip": "Tedarikçi bu belgeyi görebilir — gizlemek için tıklayın",
    "overview.hidden_tooltip": "Tedarikçiden gizli — göstermek için tıklayın",
    "overview.delete": "sil",
    "overview.updated": "Güncellendi",

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

    // New order
    "new_order.title": "Yeni sipariş",
    "new_order.select_supplier": "Seçin…",
    "new_order.order_date": "Sipariş tarihi",
    "new_order.label": "Etiket",
    "new_order.label_placeholder": "ör. Amanda 09-04-2026",
    "new_order.auto_generated": "Tedarikçi + tarihten otomatik oluşturulur",
    "new_order.description_placeholder": "Pakette ne var? ör. Uzantılar + Yapıştırıcı",
    "new_order.create": "Sipariş oluştur",

    // Supplier nav
    "nav.suppliers": "Tedarikçiler",

    // Orders list page
    "orders.total": "toplam",
    "orders.suppliers": "tedarikçi",
    "orders.no_orders": "Henüz sipariş yok.",

    // Common
    "common.back": "Geri",
    "common.delete": "Sil",
    "common.edit": "Düzenle",
    "common.confirm": "Onayla",
    "common.save": "Kaydet",
    "common.cancel": "İptal",
  },
};

export function t(locale: Locale, key: string): string {
  return messages[locale]?.[key] ?? messages.de[key] ?? key;
}
