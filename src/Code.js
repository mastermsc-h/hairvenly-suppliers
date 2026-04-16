// ==========================================
// HAIRVENLY – LAGERBESTAND + BESTELLÜBERSICHT
// Version 2.1 – Rang-basierte Ziel-Caps als Konstanten
// ==========================================

// IDs der externen Bestellungs-Sheets
const CHINA_SHEET_ID    = "1zqh50KeQsworvG5OivfxvECM7HUoArwUEGBTUGVB4ZM";
const AMANDA_SHEET_ID   = "1-8rzUnXOjqhn6i1yLdP1Xtp2WlqmDXCjjLrv2YNNHaE";
const OVERVIEW_SHEET_ID = "1RWrGNPWfP69STGoNnzPSr2gtuj-Tj4fCs8u8l4KZtHs";

// ==========================================
// BESTELLVORSCHLAG – ZIEL-CAPS & RANG-MINDESTZIELE
// Hier anpassen wenn sich die Strategie ändert
// ==========================================

// Maximaler Zielbestand je Tier (Obergrenze für getVerkaufsZielGrams_)
const ZIEL_CAP_TOP7_PREMIUM = 1500; // TOP7  – Premium-Kategorien (Standard Tapes, Bondings, Mini Tapes)
const ZIEL_CAP_MID_PREMIUM  = 1200; // MID   – Premium-Kategorien (niedriger als TOP7 damit Rang respektiert wird)
const ZIEL_CAP_REST_PREMIUM =  400; // REST  – Premium-Kategorien
const ZIEL_CAP_TOP7_NORMAL  = 1000; // TOP7  – andere Kategorien
const ZIEL_CAP_MID_NORMAL   =  500; // MID   – andere Kategorien
const ZIEL_CAP_REST_NORMAL  =  300; // REST  – andere Kategorien

// Rang-basierte Mindestziele für Standard Tapes (Amanda + China)
// Verhindert, dass ausverkaufte Topseller (niedrige 30d-Velocity) weniger Ziel bekommen als MID-Produkte
const RANG_MINZIEL_TOP10 = 1500; // Rang  1–10  → mind. diesen Zielwert
const RANG_MINZIEL_TOP20 = 1000; // Rang 11–20  → mind. diesen Zielwert

// ==========================================
// SHOPIFY INVENTORY FETCH
// ==========================================


// ── Hilfsfunktionen: Chunked Property Storage ──
// PropertiesService hat 9KB Limit pro Property → große Objekte aufteilen
function saveChunked_(props, baseKey, obj) {
  const json = JSON.stringify(obj);
  const CHUNK_SIZE = 8000;
  const chunks = [];
  for (let i = 0; i < json.length; i += CHUNK_SIZE) {
    chunks.push(json.slice(i, i + CHUNK_SIZE));
  }
  // Alte Chunks löschen
  for (let i = 0; i < 20; i++) {
    props.deleteProperty(baseKey + "_" + i);
  }
  // Neue Chunks speichern
  for (let i = 0; i < chunks.length; i++) {
    props.setProperty(baseKey + "_" + i, chunks[i]);
  }
  props.setProperty(baseKey + "_COUNT", String(chunks.length));
}

function loadChunked_(props, baseKey) {
  const countStr = props.getProperty(baseKey + "_COUNT");
  if (!countStr) {
    // Fallback: versuche direkt (alte Version)
    const direct = props.getProperty(baseKey);
    return direct ? JSON.parse(direct) : null;
  }
  const count = parseInt(countStr);
  let json = "";
  for (let i = 0; i < count; i++) {
    json += (props.getProperty(baseKey + "_" + i) || "");
  }
  return json ? JSON.parse(json) : null;
}


function hardReset() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  Logger.log("✅ Alle Properties gelöscht. Jetzt fetchShopifyInventoryData starten.");
}

function fetchShopifyInventoryData() {
  const shopName = "339520-3";
  const accessToken = "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";

  const collectionGroups = {
    "FirstSheet": {
      name: "Usbekisch - WELLIG",
      collections: [
        "Tapes Wellig 45cm",
        "Tapes Wellig 55cm",
        "Tapes Wellig 65cm",
        "Tapes Wellig 85cm",
        "Bondings wellig 65cm",
        "Bondings wellig 85cm",
        "Usbekische Classic Tressen (Wellig)",
        "Usbekische Genius Tressen (Wellig)",
        "Ponytail Extensions kaufen"
      ]
    },
    "SecondSheet": {
      name: "Russisch - GLATT",
      collections: [
        "Clip In Extensions Echthaar",
        "Standard Tapes Russisch",
        "Mini Tapes Glatt",
        "Invisible Mini Tapes",
        "Russische Bondings (Glatt)",
        "Russische Classic Tressen (Glatt)",
        "Russische Genius Tressen (Glatt)",
        "Russische Invisible Tressen (Glatt) | Butterfly Weft",
      ]
    },
    "ThirdSheet": {
      name: "Tools & Haarpflege",
      collections: ["Werkzeuge", "Blessed Haarpflege", "Sonstige Haarpflege", "Accessoires"]
    }
  };

  const scriptProperties = PropertiesService.getScriptProperties();
  let lastProcessedCollection = parseInt(scriptProperties.getProperty("lastProcessedCollection") || "0");
  let processedCollections = JSON.parse(scriptProperties.getProperty("processedCollections") || "[]");
  let batchSize = 4;
  let collectionsProcessed = 0;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = {};
  const totalWeightMap = JSON.parse(scriptProperties.getProperty("totalWeightMap") || "{}");

  const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm") + " Uhr";
  for (let key in collectionGroups) {
    sheets[key] = getOrCreateSheet(ss, collectionGroups[key].name);
    if (!totalWeightMap[key]) totalWeightMap[key] = 0;
    if (lastProcessedCollection === 0) {
      sheets[key].clear();
      // Datum-Zeile oben einfügen (nur für Wellig + Glatt, nicht Tools)
      if (key === "FirstSheet" || key === "SecondSheet") {
        const dateLabel = "Zuletzt aktualisiert: " + nowStr;
        sheets[key].appendRow([dateLabel, "", "", "", ""]);
        sheets[key].getRange(1, 1, 1, 5).merge()
          .setFontStyle("italic").setFontSize(9).setFontColor("#555555")
          .setBackground("#f5f5f5");
      }
      ensureHeaderExists(sheets[key], key);
    }
  }

  let allCollections = fetchAllCollections(shopName, accessToken);
  let collectionList = Object.entries(collectionGroups).flatMap(([key, group]) =>
    group.collections.map(c => ({ key, name: c }))
  );

  for (let i = lastProcessedCollection; i < collectionList.length; i++) {
    if (collectionsProcessed >= batchSize) break;
    collectionsProcessed++;

    let { key: sheetKey, name: collectionName } = collectionList[i];
    let sheet = sheets[sheetKey];
    let collection = allCollections.find(c => c.title === collectionName);
    if (!collection) continue;

    let products = fetchAllCollectionProducts(shopName, accessToken, collection);
    let collectionWeightTotal = 0;

    if (sheetKey === "ThirdSheet") {
      let existingValues = sheet.getDataRange().getValues();
      let existingProducts = existingValues.map(row => row[1]);
      let productCount = 0;

      for (let product of products) {
        let variants = fetchVariantsAndStockByProductId(shopName, accessToken, product.id);
        let totalInventory = variants.reduce((sum, v) => sum + v.availableStock, 0);
        if (!existingProducts.includes(product.title)) {
          sheet.appendRow([collectionName, product.title, totalInventory]);
          productCount++;
        }
      }
      if (productCount > 0) {
        sheet.appendRow([`Total Products in ${collectionName}`, "", productCount]);
      }
      scriptProperties.setProperty("lastProcessedCollection", i + 1);
      processedCollections.push(collectionName);
      continue;
    }

    for (let product of products) {
      let weight = extractWeightFromTitle(product.title);
      let variants = fetchVariantsAndStockByProductId(shopName, accessToken, product.id);

      if (variants.length === 0 && collectionName === "Ponytails 130g") {
        let inventory = fetchInventoryLevel(shopName, accessToken, product.id);
        inventory = Math.max(inventory, 0);
        let rawWeight = extractWeightFromTitle(product.title) || weight;
        let safeWeight = sanitizeWeightForCollection(collectionName, rawWeight);
        let totalWeight = safeWeight * inventory;
        sheet.appendRow([collectionName, product.title, safeWeight, inventory, totalWeight]);
        collectionWeightTotal += totalWeight;
        continue;
      }

      for (let variant of variants) {
        let rawVariantWeight =
          extractWeightFromVariantOption(variant.option) ||
          variant.unitWeight ||
          weight;
        let variantWeight = sanitizeWeightForCollection(collectionName, rawVariantWeight);
        let quantity = Math.max(variant.availableStock, 0);
        let variantTotalWeight = variantWeight * quantity;
        sheet.appendRow([collectionName, product.title, variantWeight, quantity, variantTotalWeight]);
        collectionWeightTotal += variantTotalWeight;
      }
    }

    totalWeightMap[sheetKey] += collectionWeightTotal;
    scriptProperties.setProperty("lastProcessedCollection", i + 1);
    if (sheetKey === "FirstSheet" || sheetKey === "SecondSheet") {
      sheet.appendRow([`Total Weight for ${collectionName}`, "", "", "", collectionWeightTotal]);
    }
    processedCollections.push(collectionName);
  }

  scriptProperties.setProperty("processedCollections", JSON.stringify(processedCollections));
  scriptProperties.setProperty("totalWeightMap", JSON.stringify(totalWeightMap));

  Logger.log("Verarbeitete Kollektionen: " + JSON.stringify(processedCollections, null, 2));

  for (let key of ["FirstSheet", "SecondSheet"]) {
    let sheet = sheets[key];
    let lastRow = sheet.getLastRow();
    for (let row = lastRow; row > 0; row--) {
      let cellValue = sheet.getRange(row, 1).getValue();
      if (typeof cellValue === "string" && cellValue.indexOf("GRAND TOTAL") !== -1) {
        sheet.deleteRow(row);
      }
    }
    let collectionsOfThisSheet = collectionGroups[key].collections;
    let relevantCollections = collectionsOfThisSheet.filter(c => processedCollections.includes(c));
    let sheetTotal = 0;
    let data = sheet.getDataRange().getValues();
    for (let collection of relevantCollections) {
      let weightCellText = `Total Weight for ${collection}`;
      for (let row of data) {
        if (row[0] === weightCellText) {
          sheetTotal += parseFloat(row[4]) || 0;
          break;
        }
      }
    }
    sheet.appendRow(["GRAND TOTAL", "", "", "", sheetTotal]);
  }

  let thirdCollections = collectionGroups["ThirdSheet"].collections;
  let processedThird = thirdCollections.filter(c => processedCollections.includes(c));
  if (processedThird.length === thirdCollections.length) {
    let sheet = sheets["ThirdSheet"];
    let lastRow = sheet.getLastRow();
    for (let row = lastRow; row > 0; row--) {
      let cellValue = sheet.getRange(row, 1).getValue();
      if (typeof cellValue === "string" && cellValue.indexOf("GRAND TOTAL") !== -1) {
        sheet.deleteRow(row);
      }
    }
    let totalProducts = sheet.getLastRow() - 1;
    sheet.appendRow(["GRAND TOTAL", "", totalProducts]);
  }

  if (lastProcessedCollection + collectionsProcessed < collectionList.length) {
    scheduleNextExecution();
  } else {
    scriptProperties.setProperty("lastProcessedCollection", 0);
    scriptProperties.deleteProperty("processedCollections");
    scriptProperties.deleteProperty("totalWeightMap");
    Logger.log("All collections processed.");
    // ── Auto-Refresh-Kette: Jede Funktion als separater Trigger (6-Min-Limit pro Trigger!) ──────────
    // Schritt 1: Verkaufsanalyse (startet sofort, plant danach Schritt 2)
    Logger.log("🔗 Auto-Refresh-Kette: Starte Schritt 1 (Verkaufsanalyse) via Trigger...");
    deleteExistingTriggers("autoChain_verkaufsanalyse");
    ScriptApp.newTrigger("autoChain_verkaufsanalyse").timeBased().after(3000).create();
  }
}

function scheduleNextExecution() {
  // Alte .after()-Trigger aufräumen (nur Einmal-Trigger, NICHT die permanenten Tages-Trigger)
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "fetchShopifyInventoryData") {
      // Nur Trigger ohne festes Timing löschen (= .after()-Einmal-Trigger)
      // Permanente Trigger (atHour/everyDays) haben EventType CLOCK, die behalten wir
      try {
        let src = trigger.getTriggerSource();
        // .after()-Trigger die disabled/abgelaufen sind → löschen
        if (src === ScriptApp.TriggerSource.CLOCK) {
          // Prüfe ob es ein everyDays-Trigger ist (den wollen wir behalten)
          // Leider gibt GAS keine direkte Methode → wir löschen nur wenn > 5 fetchShopify-Trigger existieren
        }
      } catch(e) {}
    }
  });

  // Sicherheitscheck: Wenn zu viele Trigger, alle fetchShopify-Trigger löschen und nur Tages-Trigger + neuen erstellen
  let fetchTriggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "fetchShopifyInventoryData");
  if (fetchTriggers.length > 6) {
    Logger.log("⚠️ Zu viele fetchShopify-Trigger (" + fetchTriggers.length + "), räume auf...");
    fetchTriggers.forEach(t => ScriptApp.deleteTrigger(t));
    // Permanente Tages-Trigger neu erstellen
    [9, 15].forEach(h => {
      ScriptApp.newTrigger("fetchShopifyInventoryData").timeBased().atHour(h).everyDays(1).create();
    });
  }

  ScriptApp.newTrigger("fetchShopifyInventoryData").timeBased().after(2000).create();
  Logger.log("Scheduled next execution in a few seconds.");
}

function setupDailyTrigger() {
  deleteExistingTriggers("fetchShopifyInventoryData");
  ScriptApp.newTrigger("fetchShopifyInventoryData").timeBased().everyDays(1).create();
  Logger.log("Scheduled daily execution.");
}

function setupMultipleDailyTriggers() {
  deleteExistingTriggers("fetchShopifyInventoryData");
  const targetHours = [9, 14];
  targetHours.forEach(hour => {
    ScriptApp.newTrigger("fetchShopifyInventoryData").timeBased().atHour(hour).everyDays(1).create();
  });
  Logger.log("Mehrere tägliche Trigger gesetzt.");
}

/**
 * setupAutoDailyRefresh — einmalig aus dem Apps-Script-Editor ausführen!
 *
 * Installiert PERMANENTE tägliche Trigger (bleiben aktiv, bis man sie löscht):
 *   • 09:30 Uhr → fetchShopifyInventoryData (→ createDashboard → refreshVerkaufsanalyse → refreshTopseller → Bestellvorschläge China+Amanda)
 *   • 15:00 Uhr → fetchShopifyInventoryData (→ selbe Kette)
 *
 * Löscht vorher alle alten Trigger für fetchShopifyInventoryData, damit keine Duplikate entstehen.
 */
function setupAutoDailyRefresh() {
  // Alle alten Shopify-Fetch-Trigger löschen (inkl. veralteter .after()-Einmal-Trigger)
  deleteExistingTriggers("fetchShopifyInventoryData");

  const stunden = [9, 15]; // 09:30 und 15:00 Uhr (atHour = früheste Stunde, GAS feuert 09:00-10:00)
  stunden.forEach(function(h) {
    ScriptApp.newTrigger("fetchShopifyInventoryData")
      .timeBased()
      .atHour(h)
      .everyDays(1)
      .create();
  });

  // Aktive Trigger zur Bestätigung loggen
  const aktiv = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "fetchShopifyInventoryData")
    .map(t => t.getTriggerSource() + " | " + t.getHandlerFunction());
  Logger.log("✅ Auto-Refresh-Trigger installiert (2×/Tag, persistent):\n" + aktiv.join("\n"));
  Logger.log("Kette pro Lauf: fetchShopifyInventoryData → createDashboard → refreshVerkaufsanalyse → refreshTopseller → Bestellvorschläge China+Amanda");
}

function deleteExistingTriggers(functionName) {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === functionName) ScriptApp.deleteTrigger(trigger);
  });
}

/**
 * Löscht ALLE Trigger im Projekt (Cleanup bei zu vielen deaktivierten Triggern).
 * Danach setupAutoDailyRefresh() ausführen um saubere Trigger zu erstellen.
 */
function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log("Lösche " + triggers.length + " Trigger...");
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log("✅ Alle Trigger gelöscht. Jetzt setupAutoDailyRefresh() ausführen!");
}

// ==========================================
// AUTO-REFRESH-KETTE (separierte Trigger)
// Jede Funktion läuft in eigenem 6-Min-Fenster
// Kette: Verkaufsanalyse → Topseller → Dashboard → China → Amanda
// ==========================================

function autoChain_cleanup_() {
  // Alte Chain-Trigger aufräumen (falls welche hängen geblieben sind)
  ["autoChain_verkaufsanalyse","autoChain_topseller","autoChain_dashboard","autoChain_china","autoChain_amanda"]
    .forEach(fn => deleteExistingTriggers(fn));
}

function autoChain_verkaufsanalyse() {
  autoChain_cleanup_(); // Alte Chains aufräumen
  Logger.log("🔗 Auto-Chain Schritt 1/5: Verkaufsanalyse...");
  try { refreshVerkaufsanalyse(); } catch(e) { Logger.log("❌ Verkaufsanalyse Fehler: " + e.message); }
  // Nächsten Schritt planen
  deleteExistingTriggers("autoChain_topseller");
  ScriptApp.newTrigger("autoChain_topseller").timeBased().after(3000).create();
  Logger.log("🔗 → Schritt 2 (Topseller) geplant");
}

function autoChain_topseller() {
  Logger.log("🔗 Auto-Chain Schritt 2/5: Topseller...");
  try { refreshTopseller(); } catch(e) { Logger.log("❌ Topseller Fehler: " + e.message); }
  deleteExistingTriggers("autoChain_dashboard");
  ScriptApp.newTrigger("autoChain_dashboard").timeBased().after(3000).create();
  Logger.log("🔗 → Schritt 3 (Dashboard) geplant");
}

function autoChain_dashboard() {
  Logger.log("🔗 Auto-Chain Schritt 3/5: Dashboard...");
  try { createDashboard(); } catch(e) { Logger.log("❌ Dashboard Fehler: " + e.message); }
  deleteExistingTriggers("autoChain_china");
  PropertiesService.getScriptProperties().setProperty("AUTO_BUDGET", "true");
  ScriptApp.newTrigger("autoChain_china").timeBased().after(3000).create();
  Logger.log("🔗 → Schritt 4 (China) geplant");
}

function autoChain_china() {
  Logger.log("🔗 Auto-Chain Schritt 4/5: Bestellung China...");
  try { createBestellungChina(); } catch(e) { Logger.log("❌ China Fehler: " + e.message); }
  deleteExistingTriggers("autoChain_amanda");
  ScriptApp.newTrigger("autoChain_amanda").timeBased().after(3000).create();
  Logger.log("🔗 → Schritt 5 (Amanda) geplant");
}

function autoChain_amanda() {
  Logger.log("🔗 Auto-Chain Schritt 5/5: Bestellung Amanda...");
  try { createBestellungAmanda(); } catch(e) { Logger.log("❌ Amanda Fehler: " + e.message); }
  PropertiesService.getScriptProperties().deleteProperty("AUTO_BUDGET");
  Logger.log("✅ Auto-Refresh-Kette vollständig abgeschlossen!");
}

function getOrCreateSheet(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  return sheet;
}

function ensureHeaderExists(sheet, sheetKey) {
  if (sheet.getLastRow() === 0) {
    if (sheetKey === "ThirdSheet") {
      sheet.appendRow(["Collection Name", "Product Name", "Inventory Quantity"]);
    } else {
      sheet.appendRow(["Collection Name", "Product Name", "Unit Weight (g)", "Inventory Quantity", "Total Weight (g)"]);
    }
  }
}

function fetchAllCollections(shopName, accessToken) {
  const customCollectionsUrl = `https://${shopName}.myshopify.com/admin/api/2025-01/custom_collections.json`;
  const smartCollectionsUrl  = `https://${shopName}.myshopify.com/admin/api/2025-01/smart_collections.json`;
  let allCollections = [];
  try {
    let customData = fetchWithRetry(customCollectionsUrl, accessToken).custom_collections || [];
    let smartData  = fetchWithRetry(smartCollectionsUrl,  accessToken).smart_collections  || [];
    allCollections = customData.concat(smartData);
  } catch (error) {
    Logger.log("Error fetching collections: " + error.message);
  }
  return allCollections;
}

function fetchAllCollectionProducts(shopName, accessToken, collection) {
  let url = `https://${shopName}.myshopify.com/admin/api/2025-01/collections/${collection.id}/products.json?limit=250`;
  return fetchWithRetry(url, accessToken).products || [];
}

function fetchVariantsAndStockByProductId(shopName, accessToken, productId) {
  let productUrl = `https://${shopName}.myshopify.com/admin/api/2025-01/products/${productId}.json`;
  let variantsData = [];
  try {
    let productData = fetchWithRetry(productUrl, accessToken).product;
    if (!productData || !productData.variants) return [];
    for (let variant of productData.variants) {
      let weight = variant.grams > 0 ? variant.grams : extractWeightFromTitle(productData.title);
      let availableStock = fetchInventoryLevel(shopName, accessToken, variant.inventory_item_id);
      let option = variant.option1 || variant.option2 || variant.option3 || "";
      variantsData.push({ unitWeight: weight, availableStock: availableStock, option: option });
    }
  } catch (error) {
    Logger.log("Error fetching product data: " + error.message);
  }
  return variantsData;
}

function fetchInventoryLevel(shopName, accessToken, inventoryItemId) {
  const inventoryUrl = `https://${shopName}.myshopify.com/admin/api/2025-01/inventory_levels.json?inventory_item_ids=${inventoryItemId}`;
  try {
    let data = fetchWithRetry(inventoryUrl, accessToken);
    if (!data.inventory_levels || data.inventory_levels.length === 0) return 0;
    // Wenn mehrere Locations: die Location mit dem höchsten Bestand nehmen (= Hauptlager)
    // NICHT summieren (eine Location könnte ein Fulfillment-Center mit alten Daten sein)
    // Log bei mehreren Locations für Debugging
    if (data.inventory_levels.length > 1) {
      const levels = data.inventory_levels.map(l => "loc=" + l.location_id + ":avail=" + l.available);
      Logger.log("[Inventory Multi-Location] item=" + inventoryItemId + " → " + levels.join(", "));
    }
    // Nimm den niedrigsten non-negative Wert wenn alle Locations 0 oder 1 haben,
    // ansonsten die Summe aller positiven Werte
    let total = 0;
    for (let level of data.inventory_levels) {
      total += Math.max(level.available || 0, 0);
    }
    return total;
  } catch (error) {
    Logger.log("Error fetching inventory level: " + error.message);
  }
  return 0;
}

function extractWeightFromTitle(title) {
  let match = title.match(/(\d+)\s*g\b/i);
  return match ? Math.max(parseInt(match[1], 10), 1) : null;
}

function extractWeightFromVariantOption(option) {
  let match = option.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function sanitizeWeightForCollection(collectionName, rawWeight) {
  const expectedWeights = {
    "Russische Invisible Tressen (Glatt) | Butterfly Weft": 50,
    "Russische Invisible Tressen (Glatt)": 50,  // alter Name
    "Russische Tressen (Glatt)": 50,
    "Usbekische Genius Tressen (Wellig)": 50,
    "Usbekische Classic Tressen (Wellig)": 50,
    "Mini Tapes Glatt": 50,
    "Tapes Wellig 45cm": 25,
    "Russische Classic Tressen (Glatt)": 50,
    "Russische Genius Tressen (Glatt)": 50,
    "Russische Bondings (Glatt)": 25,
    "Usbekische Bondings (Wellig)": 25,
    "Bondings wellig 85cm": 25,
    "Standard Tapes Russisch": 25,
    "Tapes Wellig 65cm": 25,
    "Tapes Wellig 85cm": 25
  };
  const expected = expectedWeights[collectionName];
  if (!expected) return rawWeight;
  if (rawWeight == null || isNaN(rawWeight) || rawWeight <= 0) return expected;
  if (rawWeight === expected) return rawWeight;
  if (rawWeight === expected * 10) return expected;
  if (rawWeight === 1) return expected;
  return rawWeight;
}

function fetchWithRetry(url, accessToken) {
  let response = UrlFetchApp.fetch(url, {
    headers: { "X-Shopify-Access-Token": accessToken },
    muteHttpExceptions: true
  });
  return JSON.parse(response.getContentText());
}


// ==========================================
// BESTELLUNGEN ABRUFEN (CHINA & AMANDA)
// ==========================================

/**
 * DEBUG: Zeigt für jeden Tab die ersten 2 Zeilen, erkannten Status, Format und Item-Count.
 * Über Menü "Hairvenly Tools" → "Debug Order Tabs" ausführen.
 */
function debugOrderTabs() {
  let output = [];

  // CHINA
  let chinaSs = SpreadsheetApp.openById(CHINA_SHEET_ID);
  for (let sheet of chinaSs.getSheets()) {
    let sName = sheet.getName().trim();
    let date = extractDateFromTabName(sName);
    if (!date) continue;
    let data = sheet.getRange(1, 1, Math.min(5, sheet.getLastRow()), Math.min(4, sheet.getLastColumn())).getValues();
    let status = getOrderStatusFromTab(sheet);
    let items = parseChinaOrderSheet(sheet);
    output.push("CHINA | Tab: " + sName + " | Date: " + date + " | Status: " + status + " | Items: " + items.length +
      "\n  Row1: " + JSON.stringify(data[0] || []) +
      "\n  Row2: " + JSON.stringify(data[1] || []) +
      "\n  Row3: " + JSON.stringify(data[2] || []) +
      "\n  Row4: " + JSON.stringify(data[3] || []));
  }

  // AMANDA
  let amandaSs = SpreadsheetApp.openById(AMANDA_SHEET_ID);
  for (let sheet of amandaSs.getSheets()) {
    let sName = sheet.getName().trim();
    if (!sName.match(/Amanda|Sunny/i)) continue;
    let date = extractDateFromTabName(sName);
    if (!date) continue;
    let data = sheet.getRange(1, 1, Math.min(5, sheet.getLastRow()), Math.min(4, sheet.getLastColumn())).getValues();
    let status = getOrderStatusFromTab(sheet);
    let items = parseAmandaOrderSheet(sheet);
    output.push("AMANDA | Tab: " + sName + " | Date: " + date + " | Status: " + status + " | Items: " + items.length +
      "\n  Row1: " + JSON.stringify(data[0] || []) +
      "\n  Row2: " + JSON.stringify(data[1] || []) +
      "\n  Row3: " + JSON.stringify(data[2] || []) +
      "\n  Row4: " + JSON.stringify(data[3] || []));
  }

  let result = output.join("\n\n");
  Logger.log(result);

  // Schreibe auch ins DEBUG_VA Sheet für einfaches Lesen
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let debugSheet = ss.getSheetByName("DEBUG_VA");
  if (debugSheet) {
    let debugRow = debugSheet.getLastRow() + 2;
    debugSheet.getRange(debugRow, 1).setValue("=== DEBUG ORDER TABS " + new Date().toLocaleString() + " ===");
    let lines = result.split("\n");
    for (let i = 0; i < lines.length; i++) {
      debugSheet.getRange(debugRow + 1 + i, 1).setValue(lines[i]);
    }
  }

  return result;
}

/**
 * Liest die Übersichtstabelle aus und gibt ein Set von Datums-Strings zurück,
 * die den Status "unbekannt" haben (also noch nicht angekommen sind).
 * Struktur: A=Anbieter, B=Datum, C=Zahlungsstatus, L=Ankunftsstatus ("bereits angekommen" / "unbekannt")
 */
function getActiveOrderDates() {
  let activeChina  = new Set();
  let activeAmanda = new Set();
  let allChina     = new Set(); // Alle Daten (auch "angekommen"), für Fallback-Erkennung
  let allAmanda    = new Set();
  
  try {
    let overviewSs = SpreadsheetApp.openById(OVERVIEW_SHEET_ID);
    let sheet = overviewSs.getSheetByName("2026");
    if (!sheet) return { china: activeChina, amanda: activeAmanda };
    
    let data = sheet.getDataRange().getValues();
    let currentProvider = "";
    
    for (let i = 2; i < data.length; i++) { // Ab Zeile 3 (Index 2), Zeile 1+2 = Header
      let row = data[i];
      
      // Spalte A = Anbieter (nur wenn nicht leer)
      if (row[0] && String(row[0]).trim() !== "") {
        currentProvider = String(row[0]).trim();
      }
      
      // Spalte B = Datum der Bestellung
      let orderDate = "";
      if (row[1] instanceof Date) {
        orderDate = Utilities.formatDate(row[1], Session.getScriptTimeZone(), "dd.MM.yyyy");
      } else if (row[1]) {
        // String-Datum normalisieren: "6.1.2026" -> "06.01.2026"
        let raw = String(row[1]).trim();
        let parts = raw.split(".");
        if (parts.length === 3) {
          orderDate = parts[0].padStart(2,"0") + "." + parts[1].padStart(2,"0") + "." + parts[2];
        } else {
          orderDate = raw;
        }
      }
      
      // Spalte L (Index 11) = "Ankunftsstatus" enthält "bereits angekommen" oder "unbekannt"
      let status = String(row[11] || "").trim().toLowerCase();
      
      Logger.log("[Overview] Zeile " + (i+1) + ": Anbieter='" + currentProvider + "' Datum='" + orderDate + "' Status='" + status + "'");
      
      // Alle Daten merken (für Fallback: "existiert in Übersicht aber nicht aktiv")
      if (orderDate) {
        if (currentProvider === "China") allChina.add(orderDate);
        else if (currentProvider === "Amanda") allAmanda.add(orderDate);
      }

      // "unbekannt" UND "verzollung" einbeziehen (= noch unterwegs, Paket in DE)
      const istAktiv = status.includes("unbekannt") || status.includes("verzollung");
      if (orderDate && istAktiv) {
        if (currentProvider === "China") {
          activeChina.add(orderDate);
        } else if (currentProvider === "Amanda") {
          activeAmanda.add(orderDate);
        }
      }
    }
    
  } catch (e) {
    Logger.log("Fehler beim Lesen der Übersichtstabelle: " + e.message);
  }
  
  Logger.log("Aktive China-Bestellungen: " + JSON.stringify([...activeChina]));
  Logger.log("Aktive Amanda-Bestellungen: " + JSON.stringify([...activeAmanda]));
  
  return { china: activeChina, amanda: activeAmanda, chinaAll: allChina, amandaAll: allAmanda };
}

/**
 * Liest Status einer Bestellung direkt aus dem Tab (Zeile 2, Spalte B).
 * Gibt zurück: "aktiv" | "entwurf" | "storniert" | "angekommen"
 * Aktiv = unterwegs/bestellt. Nur aktive Bestellungen werden als "unterwegs" gezählt.
 */
function getOrderStatusFromTab(sheet) {
  try {
    let data = sheet.getRange(1, 1, 2, 4).getValues(); // Zeile 1-2, Spalte A-D
    let b1 = String(data[0][1] || "").trim().toLowerCase(); // B1
    let b2 = String(data[1][1] || "").trim().toLowerCase(); // B2
    let a1 = String(data[0][0] || "").trim().toLowerCase(); // A1

    // Strategie: Flexibel erkennen ob Status vorhanden ist.
    // 1) Wenn B1 "status" enthält → B2 ist der Status-Wert
    // 2) Wenn A1 "bestellung" enthält → neues Format, B2 ist Status
    // 3) Wenn B2 direkt einen bekannten Status-Wert enthält → nutze ihn
    // 4) Sonst: altes Format ohne Status-Zeile → Fallback

    let hasStatusRow = (b1.includes("status") || a1.includes("bestellung"));

    // Auch ohne erkannten Header: prüfe ob B2 einen bekannten Status enthält
    let statusVal = b2;
    if (hasStatusRow || statusVal.includes("angekommen") || statusVal.includes("eingetroffen") ||
        statusVal.includes("geliefert") || statusVal.includes("entwurf") ||
        statusVal.includes("storniert") || statusVal.includes("storno") ||
        statusVal.includes("unterwegs") || statusVal.includes("bestellt") || statusVal.includes("verzollung")) {

      if (statusVal.includes("entwurf"))    return "entwurf";
      if (statusVal.includes("storniert") || statusVal.includes("storno")) return "storniert";
      if (statusVal.includes("angekommen") || statusVal.includes("abgekommen") || statusVal.includes("eingetroffen") || statusVal.includes("geliefert")) return "angekommen";

      // "unterwegs", "bestellt", "verzollung", leer = aktiv
      return "aktiv";
    }

    // Kein Status erkannt → altes Format, als aktiv behandeln
    Logger.log("getOrderStatusFromTab: Kein Status erkannt für '" + sheet.getName() + "' (A1='" + a1 + "', B1='" + b1 + "', B2='" + b2 + "')");
    return "aktiv";
  } catch(e) {
    return "aktiv"; // Fehler → sicherheitshalber als aktiv
  }
}

/**
 * Liest alle aktiven Bestellungs-Tabs aus China- und Amanda-Sheets.
 * Status wird direkt aus jedem Tab gelesen (Spalte B2), NICHT aus Übersichts-Sheet.
 * Gibt ein Array von Bestellobjekten zurück:
 * { provider, date, name, items: [{type, length, color, weight}] }
 */
function getAllOrders() {
  Logger.log(">>> getAllOrders() START");
  let orders = [];

  try {
    // --- CHINA ---
    let chinaSs = SpreadsheetApp.openById(CHINA_SHEET_ID);
    let chinaSheets = chinaSs.getSheets();
    for (let sheet of chinaSheets) {
      let sName = sheet.getName().trim();
      let date = extractDateFromTabName(sName);
      if (!date) continue;

      let status = getOrderStatusFromTab(sheet);
      if (status !== "aktiv") {
        Logger.log("China " + date + " übersprungen (Status: " + status + ")");
        continue;
      }

      let items = parseChinaOrderSheet(sheet);
      if (items.length > 0) {
        orders.push({
          provider: "China",
          date: date,
          name: "China " + date,
          items: items
        });
      }
    }

    // --- AMANDA ---
    let amandaSs = SpreadsheetApp.openById(AMANDA_SHEET_ID);
    let amandaSheets = amandaSs.getSheets();
    for (let sheet of amandaSheets) {
      let sName = sheet.getName().trim();
      if (!sName.match(/Amanda|Sunny/i)) continue;
      let date = extractDateFromTabName(sName);
      if (!date) continue;

      let status = getOrderStatusFromTab(sheet);
      if (status !== "aktiv") {
        Logger.log("Amanda " + date + " übersprungen (Status: " + status + ")");
        continue;
      }

      let items = parseAmandaOrderSheet(sheet);
      Logger.log("Amanda Tab '" + sName + "' -> date='" + date + "' status=" + status + " items=" + items.length);
      if (items.length > 0) {
        orders.push({
          provider: "Amanda",
          date: date,
          name: sName,
          items: items
        });
        Logger.log("Amanda PUSHED: " + sName + " -> orders.length=" + orders.length);
      }
    }

  } catch (e) {
    Logger.log("Fehler beim Laden der Bestellungen: " + e.message);
  }

  // Sortiere nach Datum (älteste zuerst)
  orders.sort((a, b) => parseDateDE(a.date) - parseDateDE(b.date));

  Logger.log("Aktive Bestellungen gesamt: " + orders.length);
  return orders;
}

/**
 * Extrahiert ein Datum im Format TT.MM.JJJJ aus einem Tab-Namen.
 * Unterstützt auch TT.MM (ohne Jahr).
 */
function extractDateFromTabName(name) {
  let m = name.match(/(\d{2}\.\d{2}\.\d{4})/);
  if (m) return m[1];
  m = name.match(/(\d{2}\.\d{2})/);
  if (m) return m[1] + ".2026"; // Fallback: aktuelles Jahr
  return null;
}

/**
 * Parst ein Datum im deutschen Format TT.MM.JJJJ zu einem Date-Objekt.
 */
function parseDateDE(dateStr) {
  let parts = dateStr.split(".");
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  return new Date(0);
}

/**
 * Liest ein China-Bestell-Sheet aus.
 * Format A (4 Spalten): A=Produkttyp, B=Länge, C=Farbcode, D=Gramm
 * Format B (2 Spalten): A=Farbcode, B=Gramm (Typ steht als Überschrift in Zeile 1 Spalte A)
 */
function parseChinaOrderSheet(sheet) {
  let data = sheet.getDataRange().getValues();
  let items = [];
  let currentType   = "";
  let currentLength = "";

  // Format V3 erkennen: B1 enthält "Status" = zuverlässiger Indikator für Status-Zeile
  // NICHT A1 "bestellung" allein, da alte Tabs "Amanda & Sunny Bestellung..." in A1 haben!
  let row0a = String((data[0] || [])[0] || "").trim().toLowerCase();
  let row0b = String((data[0] || [])[1] || "").trim().toLowerCase();
  let isV3 = row0b.includes("status");
  let dataOffset = 0; // Wo die eigentlichen Daten anfangen

  if (isV3) {
    // V3: Zeile 1-2 = Meta/Status, dann Header-Zeile oder erste Datenzeile finden
    for (let i = 2; i < Math.min(data.length, 10); i++) {
      let cellA = String(data[i][0] || "").trim().toLowerCase();
      let cellC = String(data[i][2] || "").trim().toLowerCase();
      // Header-Zeile erkennen (Typ/Type/Method/Farbcode etc.)
      if (cellA.includes("typ") || cellA.includes("type") || cellA.includes("method") ||
          cellA.includes("farbcode") || cellC.includes("farbcode") || cellC.includes("farbe") || cellC.includes("color")) {
        dataOffset = i + 1;
        break;
      }
      // Erste Datenzeile erkennen (Tapes/Bondings/Genius/Invisible etc.)
      if (cellA.includes("tapes") || cellA.includes("bondings") || cellA.includes("genius") || cellA.includes("invisible")) {
        dataOffset = i;
        break;
      }
    }
    if (dataOffset === 0) dataOffset = 4; // Fallback
    Logger.log('[China Parse V3] dataOffset=' + dataOffset + ' (A1="' + row0a + '", B1="' + row0b + '")');
  }

  // Format erkennen für nicht-V3: Wenn Zeile 1 Spalte C leer und Spalte B numerisch -> Format B (2-spaltig)
  let headerRowIdx = isV3 ? (dataOffset - 1) : 0;
  let headerRow = data[headerRowIdx] || [];
  let col2Header = String(headerRow[2] || "").trim();
  let col1Header = String(headerRow[1] || "").trim().toLowerCase();
  let isTwoColumnFormat = !isV3 && (col2Header === "" && (col1Header.includes("quantity") || col1Header.includes("gramm") || col1Header.includes("g)")));
  Logger.log('[China Parse] Sheet: ' + sheet.getName() + ' | rows: ' + data.length + ' | isV3: ' + isV3 + ' | isTwoCol: ' + isTwoColumnFormat);
  
  let startIdx = isV3 ? dataOffset : 1; // V3: nach Status+Header, sonst ab Zeile 2

  if (isTwoColumnFormat) {
    // Format B: Zeile 1 = Typ-Überschrift (z.B. "Invisible Tapes"), Zeile 2 = Header, ab Zeile 3 = Daten
    currentType = String(data[0][0] || "").trim();
    currentLength = "";

    for (let i = startIdx; i < data.length; i++) {
      let row = data[i];
      let col0 = String(row[0]).trim(); // Farbcode
      let col1 = String(row[1]).trim(); // Gramm
      
      if (col0.toLowerCase().includes("subtotal") || col0.toLowerCase() === "total") break;
      if (col0 === "" || col0.toLowerCase() === "farbcode" || col0.toLowerCase() === "color") continue;
      
      let weight = parseFloat(col1.replace(/[^0-9.]/g, "")) || 0;
      if (col0 !== "" && weight > 0) {
        items.push({
          type:   currentType,
          length: currentLength,
          color:  col0,
          weight: weight
        });
      }
    }
  } else {
    // Format A: A=Typ, B=Länge, C=Farbcode, D=Gramm
    // Funktioniert mit UND ohne merged cells (carry-over via currentType/currentLength)
    for (let i = startIdx; i < data.length; i++) {
      let row = data[i];
      let col0 = String(row[0]).trim();
      let col1 = String(row[1]).trim();
      let col2 = String(row[2]).trim();
      let col3 = String(row[3]).trim();

      if (col0.toLowerCase() === "subtotal" || col0.toLowerCase().includes("subtotal")) break;

      if (col0 !== "") currentType   = col0;
      if (col1 !== "") currentLength = col1;

      let weight = parseFloat(col3.replace(/[^0-9.]/g, "")) || 0;

      if (col2 !== "" && weight > 0) {
        items.push({
          type:   currentType,
          length: currentLength,
          color:  col2,
          weight: weight
        });
      }
    }
  }
  Logger.log('[China Parse] Sheet: ' + sheet.getName() + ' -> items: ' + items.length);
  return items;
}

/**
 * Liest ein Amanda-Bestell-Sheet aus.
 * Unterstützt DREI Formate:
 *   Format V3 (mit Status):  Zeile 1=Meta-Header, Zeile 2=Werte(Bestellung,Status,Gewicht,Lieferung),
 *                             Zeile 3=leer, Zeile 4=Spalten-Header, ab Zeile 5=Daten
 *                             A=Method, B=Length/Variant, C=Farbcode, D=Quantity(g)
 *   Format V2 (4 Spalten):   Zeile 1=Titel, Zeile 2=Header, ab Zeile 3=Daten
 *                             A=Method, B=Length/Variant, C=Farbcode, D=Quantity(g)
 *   Format V1 (5 Spalten):   Zeile 1=Titel, Zeile 2=Header, ab Zeile 3=Daten
 *                             A=Quality, B=Method, C=Length/Variant, D=Farbcode, E=Quantity(g)
 */
function parseAmandaOrderSheet(sheet) {
  let data = sheet.getDataRange().getValues();
  let items = [];
  let currentMethod = "";
  let currentLength = "";

  // Format-Erkennung: B1 enthält "Status" = zuverlässiger V3-Indikator
  // NICHT A1 "bestellung" allein, da alte Tabs "Amanda & Sunny Bestellung..." in A1 haben!
  let row0a = String((data[0] || [])[0] || "").trim().toLowerCase();
  let row0b = String((data[0] || [])[1] || "").trim().toLowerCase();
  let isV3 = row0b.includes("status");

  if (isV3) {
    // FORMAT V3: Status-Header in Zeile 1-2, dann Header-Zeile finden, dann Daten
    // Header kann V1 (Quality,Method,Length,Farbcode,Quantity) oder V2 (Method,Length,Farbcode,Quantity) sein
    let dataStartIdx = 4; // Standard: Zeile 5
    let isV3_V1 = false; // V1-Daten (5 Spalten) innerhalb V3?
    for (let i = 2; i < Math.min(data.length, 10); i++) {
      let cellA = String(data[i][0] || "").trim().toLowerCase();
      if (cellA === "quality" || cellA === "qualität") {
        dataStartIdx = i + 1;
        isV3_V1 = true; // 5-Spalten: A=Quality, B=Method, C=Length, D=Farbcode, E=Quantity
        break;
      }
      if (cellA === "method" || cellA === "methode") {
        dataStartIdx = i + 1;
        isV3_V1 = false; // 4-Spalten: A=Method, B=Length, C=Farbcode, D=Quantity
        break;
      }
    }
    Logger.log("[Amanda Parse V3] dataStartIdx=" + dataStartIdx + " isV1=" + isV3_V1 + " (A1='" + row0a + "', B1='" + row0b + "')");

    if (isV3_V1) {
      // V3 mit V1-Daten: A=Quality, B=Method, C=Length/Variant, D=Farbcode, E=Quantity(g)
      for (let i = dataStartIdx; i < data.length; i++) {
        let row = data[i];
        let col1 = String(row[1]).trim(); // Method
        let col2 = String(row[2]).trim(); // Length
        let col3 = String(row[3]).trim(); // Farbcode
        let col4 = String(row[4] || "").trim(); // Quantity

        if (col1.toLowerCase().includes("subtotal")) break;
        if (col1 !== "") currentMethod = col1;
        if (col2 !== "") currentLength = col2;

        let weight = parseFloat(col4.replace(/[^0-9.]/g, "")) || 0;
        if (col3 !== "" && weight > 0) {
          items.push({ method: currentMethod, length: currentLength, color: col3, weight: weight });
        }
      }
    } else {
      // V3 mit V2-Daten: A=Method, B=Length/Variant, C=Farbcode, D=Quantity(g)
      for (let i = dataStartIdx; i < data.length; i++) {
        let row = data[i];
        let col0 = String(row[0]).trim();
        let col1 = String(row[1]).trim();
        let col2 = String(row[2]).trim();
        let col3 = String(row[3]).trim();

        if (col0.toLowerCase() === "subtotal" || col0.toLowerCase().includes("subtotal")) break;
        if (col0 !== "") currentMethod = col0;
        if (col1 !== "") currentLength = col1;

        let weight = parseFloat(col3.replace(/[^0-9.]/g, "")) || 0;
        if (col2 !== "" && weight > 0) {
          items.push({ method: currentMethod, length: currentLength, color: col2, weight: weight });
        }
      }
    }
    Logger.log("[Amanda Parse] Sheet: " + sheet.getName() + " | format=V3(" + (isV3_V1 ? "5col" : "4col") + ") | dataStart=" + dataStartIdx + " | items=" + items.length);
  } else {
    // V1 oder V2: Header in Zeile 2 (Index 1)
    let headerRow = data[1] || [];
    let h0 = String(headerRow[0] || "").trim().toLowerCase();
    let isV2 = (h0 === "method" || h0 === "methode");

    if (isV2) {
      // FORMAT V2: A=Method, B=Length/Variant, C=Farbcode, D=Quantity(g)
      for (let i = 2; i < data.length; i++) {
        let row = data[i];
        let col0 = String(row[0]).trim();
        let col1 = String(row[1]).trim();
        let col2 = String(row[2]).trim();
        let col3 = String(row[3]).trim();

        if (col0.toLowerCase() === "subtotal" || col0.toLowerCase().includes("subtotal")) break;
        if (col0 !== "") currentMethod = col0;
        if (col1 !== "") currentLength = col1;

        let weight = parseFloat(col3.replace(/[^0-9.]/g, "")) || 0;
        if (col2 !== "" && weight > 0) {
          items.push({ method: currentMethod, length: currentLength, color: col2, weight: weight });
        }
      }
      Logger.log("[Amanda Parse] Sheet: " + sheet.getName() + " | format=V2(4col) | items=" + items.length);
    } else {
      // FORMAT V1: A=Quality, B=Method, C=Length/Variant, D=Farbcode, E=Quantity(g)
      for (let i = 2; i < data.length; i++) {
        let row = data[i];
        let col1 = String(row[1]).trim();
        let col2 = String(row[2]).trim();
        let col3 = String(row[3]).trim();
        let col4 = String(row[4]).trim();

        if (col1 !== "") currentMethod = col1;
        if (col2 !== "") currentLength = col2;

        let weight = parseFloat(col4.replace(/[^0-9.]/g, "")) || 0;
        if (col3 !== "" && weight > 0) {
          items.push({ method: currentMethod, length: currentLength, color: col3, weight: weight });
        }
      }
      Logger.log("[Amanda Parse] Sheet: " + sheet.getName() + " | format=V1(5col) | items=" + items.length);
    }
  }
  return items;
}


// ==========================================
// MATCHING: Dashboard-Produkt <-> Bestellung
// ==========================================

/**
 * Gibt die bestellte Menge (in Gramm) für ein Produkt in einer bestimmten Bestellung zurück.
 * Für Clip-Ins wird zusätzlich die Variante (z.B. 100, 150, 225) übergeben.
 * Gibt 0 zurück, wenn das Produkt in dieser Bestellung nicht enthalten ist.
 */
function getOrderedWeightForProduct(productName, collectionName, order, variant) {
  let totalWeight = 0;
  let pUpper = productName.toUpperCase();
  let cUpper = collectionName.toUpperCase();
  
  if (order.provider === "China") {
    // China = Usbekisch / Wellig (keine Clip-Ins)
    let isWellig = cUpper.includes("WELLIG") || cUpper.includes("USBEKISCH") ||
                   cUpper.includes("TAPES WELLIG") || cUpper.includes("BONDINGS WELLIG");
    if (!isWellig) return 0;
    
    for (let item of order.items) {
      if (!matchTypeChina(item.type, cUpper)) continue;
      if (!matchLength(item.length, pUpper, cUpper)) continue;
      if (!matchColor(item.color, pUpper)) continue;
      totalWeight += item.weight;
    }
    
  } else if (order.provider === "Amanda") {
    // Amanda = Russisch / Glatt + Clip-ins
    let isGlatt   = cUpper.includes("RUSSISCH") || cUpper.includes("GLATT");
    let isClipIn  = cUpper.includes("CLIP IN") || cUpper.includes("CLIP-IN");
    if (!isGlatt && !isClipIn) return 0;
    
    for (let item of order.items) {
      if (!matchTypeAmanda(item.method, cUpper, isClipIn)) continue;
      
      if (isClipIn) {
        // Clip-In Matching: Variante (100g/150g/225g) muss übereinstimmen
        // item.length enthält z.B. "100g", variant ist z.B. 100 (Zahl)
        if (variant) {
          let itemVariantNum = parseFloat(String(item.length).replace(/[^0-9.]/g, "")) || 0;
          if (itemVariantNum !== variant) continue; // Falsche Variante – überspringen
        }
        // Farbcode-Matching für Clip-Ins
        if (!matchColor(item.color, pUpper)) continue;
      } else {
        // Nicht-Clip-In Amanda: Farbcode-Matching
        if (!matchColor(item.color, pUpper)) continue;
      }
      
      totalWeight += item.weight;
    }
  }
  
  return totalWeight;
}

/** Prüft ob der Produkttyp aus China zur Dashboard-Kollektion passt */
function matchTypeChina(itemType, cUpper) {
  let t = itemType.toUpperCase();
  if (t.includes("TAPE") && cUpper.includes("TAPE")) return true;
  if (t.includes("BONDING") && cUpper.includes("BONDING")) return true;
  // "Classic Weft" (Skript-intern) UND "Classic Tressen" (China-Bestellsheet Spalte A) matchen
  if ((t.includes("CLASSIC WEFT") || t.includes("CLASSIC TRESSEN")) && cUpper.includes("CLASSIC TRESSEN")) return true;
  // "Genius Weft" UND "Genius Tressen" matchen
  if ((t.includes("GENIUS WEFT") || t.includes("GENIUS TRESSEN")) && cUpper.includes("GENIUS TRESSEN")) return true;
  if (t.includes("INVISIBLE WEFT") && cUpper.includes("INVISIBLE TRESSEN")) return true;
  if (t.includes("INVISIBLE TAPE") && (cUpper.includes("INVISIBLE") || cUpper.includes("TAPE"))) return true;
  return false;
}

/** Prüft ob die Methode aus Amanda zur Dashboard-Kollektion passt */
function matchTypeAmanda(method, cUpper, isClipIn) {
  let m = method.toUpperCase();
  if (isClipIn && m.includes("CLIP")) return true;
  if (m.includes("STANDARD TAPE") && cUpper.includes("STANDARD TAPES")) return true;
  if (m.includes("INVISIBLE MINITAPE") && cUpper.includes("INVISIBLE MINI")) return true;
  if (m.includes("MINITAPE") && cUpper.includes("MINI TAPES")) return true;
  if (m.includes("BONDING") && cUpper.includes("BONDING")) return true;
  if (m.includes("CLASSIC WEFT") && cUpper.includes("CLASSIC TRESSEN")) return true;
  if (m.includes("GENIUS WEFT") && cUpper.includes("GENIUS TRESSEN")) return true;
  if (m.includes("INVISIBLE WEFT") && cUpper.includes("INVISIBLE TRESSEN")) return true;
  return false;
}

/** Prüft ob die Längenangabe im Produktnamen oder Kollektionsnamen vorkommt */
function matchLength(itemLength, pUpper, cUpper) {
  if (!itemLength) return true; // Kein Längenfilter
  let l = itemLength.toUpperCase();
  return pUpper.includes(l) || cUpper.includes(l);
}

/** Prüft ob das Clip-in-Gewicht (z.B. "100g") im Produktnamen vorkommt */
function matchClipInWeight(itemLength, pUpper) {
  if (!itemLength) return false;
  let l = itemLength.toUpperCase().replace(/\s/g, "");
  return pUpper.replace(/\s/g, "").includes(l);
}

/** Normalisiert einen Farb-String auf kanonische Form:
 *  Großbuchstaben, Bindestriche/Unterstriche → Leerzeichen, Whitespace kollabiert.
 *  Beide Seiten (Bestellung + Produktname) werden damit identisch formatiert,
 *  egal ob Shopify Bindestriche oder Leerzeichen verwendet.
 */
/**
 * Extrahiert den vollständigen Farbnamen aus einem Produkttitel (bis Stopword).
 * z.B. "TRESSEN #LATTE BROWN RU GLATT CLASSIC WEFT ♡" → "#LATTE BROWN"
 * z.B. "#5P18A ASCHIG GESTRÄHNTES LICHTBLOND..." → "#5P18A ASCHIG GESTRÄHNTES LICHTBLOND"
 */
const COLOR_STOP_WORDS_ = new Set(["RU","US","RUSSISCH","RUSSISCHE","RUSSISCHES","USBEKISCH","USBEKISCHE",
  "GLATT","GLATTES","GLATTE","WELLIG","WELLIGE","WELLIGES","TAPE","TAPES","BONDING","BONDINGS",
  "TRESSEN","TRESSE","CLASSIC","GENIUS","INVISIBLE","WEFT","MINI","MINITAPE","MINITAPES",
  "EXTENSIONS","EXTENSION","ECHTHAAR","CLIP","CLIP-IN","CLIP-INS","KERATIN","BUTTERFLY",
  "45CM","55CM","60CM","65CM","85CM","1G","0.5G","HAAR","HAIR","STANDARD"]);
function extractFullColor_(productName) {
  const upper = (productName || "").toUpperCase();
  const hashIdx = upper.indexOf("#");
  if (hashIdx < 0) return "";
  const afterHash = upper.substring(hashIdx).replace(/♡/g, "").trim();
  const words = afterHash.split(/\s+/);
  let colorParts = [words[0]];
  for (let i = 1; i < words.length; i++) {
    if (COLOR_STOP_WORDS_.has(words[i])) break;
    colorParts.push(words[i]);
  }
  return colorParts.join(" ");
}

function normalizeColorStr_(s) {
  if (!s) return "";
  return s.toUpperCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bekannte Schreibvarianten → kanonische Form.
 *  Beide Seiten erhalten dieselbe Transformation → kein Mismatch mehr.
 */
function applyColorAliases_(s) {
  return s
    .replace(/\bNORWEGIAN\b/g, "NORVEGIAN")
    .replace(/\bCAPPUCINO\b/g, "CAPPUCCINO")
    .replace(/\bBISQUID\b/g, "BISCUIT")
    // MOCHA MELT (mit Leerzeichen) ist die kanonische Form
    .replace(/\bMOCHAMELT\b/g, "MOCHA MELT");
}

/** Prüft ob der Farbcode aus der Bestellung zum Produkt passt.
 *
 *  Strategie: Beide Seiten auf dieselbe kanonische Form bringen, dann
 *  Farbsegment (alles ab "#" im Produktnamen) mit Bestellfarbe vergleichen.
 *  Bidirektionaler Präfix-Match deckt ab:
 *    - Bestellung hat nur Code  "#2E"              → Produkt "#2E Dunkelbraun"   ✓
 *    - Bestellung hat vollen Namen "#Soft Blond Balayage" → Produkt "#SOFT-BLOND-BALAYAGE" ✓
 *    - Bestellung "#Pearl White" matcht NICHT "#3T Pearl White"                  ✓
 */
function matchColor(itemColor, pUpper) {
  if (!itemColor) return false;

  // 1. Bestellfarbe normalisieren
  let orderColor = applyColorAliases_(normalizeColorStr_(itemColor));
  if (!orderColor.startsWith("#")) orderColor = "#" + orderColor;

  // 2. Farbsegment aus Produktnamen extrahieren (alles ab dem ersten "#")
  let pNorm = applyColorAliases_(normalizeColorStr_(pUpper));
  const hashIdx = pNorm.indexOf("#");
  if (hashIdx < 0) return false;
  let prodColor = pNorm.substring(hashIdx); // z.B. "#3T PEARL WHITE"

  // 3. Bidirektionaler Präfix-Vergleich
  if (orderColor === prodColor) return true;
  if (prodColor.startsWith(orderColor + " ")) return true; // Order = kurzer Code, Produkt = voller Name
  if (orderColor.startsWith(prodColor + " ")) return true; // Order = voller Name, Produkt = kurzer Code

  return false;
}


// ==========================================
// DASHBOARD ERSTELLEN
// ==========================================

/**
 * Liest die Gesamtmengen der noch unterwegs befindlichen Bestellungen.
 * Mengen kommen aus den Detailsheets ("Subtotal"-Zeile in Spalte E).
 * Zahlungsstatus kommt weiterhin aus der Übersichtstabelle (Spalte C).
 * Gibt zurück: { china: {bezahlt, offen}, amanda: {bezahlt, offen} }
 */
function getUnterwegsKPIs() {
  let result = {
    china:  { bezahlt: 0, offen: 0 },
    amanda: { bezahlt: 0, offen: 0 }
  };

  try {
    // Schritt 1: Zahlungsstatus aus Übersichtstabelle lesen
    // { "China|10.03.2026": "bezahlt", "Amanda|03.03.2026": "offen", ... }
    let paymentStatus = {};
    let overviewSs = SpreadsheetApp.openById(OVERVIEW_SHEET_ID);
    let overviewSheet = overviewSs.getSheetByName("2026");
    if (overviewSheet) {
      let data = overviewSheet.getDataRange().getValues();
      let currentProvider = "";
      for (let i = 2; i < data.length; i++) {
        let row = data[i];
        if (row[0] && String(row[0]).trim() !== "") currentProvider = String(row[0]).trim();
        let orderDate = "";
        if (row[1] instanceof Date) {
          orderDate = Utilities.formatDate(row[1], Session.getScriptTimeZone(), "dd.MM.yyyy");
        } else if (row[1]) {
          orderDate = String(row[1]).trim();
        }
        // Spalte L (Index 11) = "Ankunftsstatus": "bereits eingetroffen", "unbekannt", "Verzollung" (= in DE, bald da)
        let status = String(row[11] || "").trim().toLowerCase();
        let zahlung = String(row[2]  || "").trim().toLowerCase();
        // Als "unterwegs" zählen: "unbekannt" ODER "verzollung" (Paket in DE, noch nicht eingetroffen)
        const istUnterwegs = status.includes("unbekannt") || status.includes("verzollung");
        if (!orderDate || !istUnterwegs) continue;
        let key = currentProvider + "|" + orderDate;
        paymentStatus[key] = zahlung.includes("komplett bezahlt") ? "bezahlt" : "offen";
      }
    }

    // Schritt 2: Mengen aus Detailsheets lesen (Subtotal-Zeile)
    // China-Sheets
    let chinaSs = SpreadsheetApp.openById(CHINA_SHEET_ID);
    for (let sheet of chinaSs.getSheets()) {
      let date = extractDateFromTabName(sheet.getName().trim());
      if (!date) continue;
      let key = "China|" + date;
      if (!paymentStatus[key]) continue; // Nicht aktiv oder nicht in Übersicht
      let subtotal = getSubtotalFromSheet(sheet);
      if (subtotal <= 0) continue;
      if (paymentStatus[key] === "bezahlt") result.china.bezahlt += subtotal;
      else                                   result.china.offen   += subtotal;
    }

    // Amanda-Sheets
    let amandaSs = SpreadsheetApp.openById(AMANDA_SHEET_ID);
    for (let sheet of amandaSs.getSheets()) {
      let sName = sheet.getName().trim();
      if (!sName.match(/Amanda|Sunny/i)) continue;
      let date = extractDateFromTabName(sName);
      if (!date) continue;
      let key = "Amanda|" + date;
      if (!paymentStatus[key]) continue; // Nicht aktiv oder nicht in Übersicht
      let subtotal = getSubtotalFromSheet(sheet);
      if (subtotal <= 0) continue;
      if (paymentStatus[key] === "bezahlt") result.amanda.bezahlt += subtotal;
      else                                   result.amanda.offen   += subtotal;
    }

  } catch (e) {
    Logger.log("Fehler bei getUnterwegsKPIs: " + e.message);
  }

  Logger.log("Unterwegs KPIs: " + JSON.stringify(result));
  return result;
}

/**
 * Liest den Subtotal-Wert aus einem Bestell-Sheet.
 * Strategie 1: Sucht nach einer Zeile mit "Subtotal" in einer beliebigen Spalte und gibt den größten numerischen Wert zurück.
 * Strategie 2 (Fallback): Summiert alle numerischen Werte in Spalte E (Quantity).
 */
function getSubtotalFromSheet(sheet) {
  let data = sheet.getDataRange().getValues();
  
  // Strategie 1: Zeile mit "Subtotal" oder "Total" finden
  for (let row of data) {
    // Prüfe alle Spalten auf "Subtotal"-Text
    let hasSubtotal = false;
    for (let cell of row) {
      let s = String(cell || "").trim().toLowerCase();
      if (s === "subtotal" || s === "total" || s === "gesamt") {
        hasSubtotal = true;
        break;
      }
    }
    if (!hasSubtotal) continue;
    
    // Finde den größten numerischen Wert in dieser Zeile
    let maxVal = 0;
    for (let cell of row) {
      let v = parseFloat(String(cell).replace(/[^0-9.]/g, "")) || 0;
      if (v > maxVal) maxVal = v;
    }
    if (maxVal > 0) {
      Logger.log("Subtotal gefunden: " + maxVal + " in Sheet " + sheet.getName());
      return maxVal;
    }
  }
  
  // Strategie 2: Summiere alle Werte in Spalte E (Index 4) – Fallback
  let total = 0;
  for (let i = 2; i < data.length; i++) {
    let row = data[i];
    // Überspringe Header-ähnliche Zeilen
    let col0 = String(row[0] || "").trim().toLowerCase();
    if (col0.includes("quality") || col0.includes("method") || col0.includes("header")) continue;
    let v = parseFloat(row[4]) || 0;
    total += v;
  }
  if (total > 0) {
    Logger.log("Subtotal (Fallback-Summe): " + total + " in Sheet " + sheet.getName());
    return total;
  }
  
  Logger.log("Kein Subtotal gefunden in Sheet: " + sheet.getName());
  return 0;
}

/**
 * Berechnet die geschätzte Ankunft einer Bestellung.
 * China = +56 Tage (8 Wochen), Amanda = +42 Tage (6 Wochen)
 * Gibt einen String zurück: "ca. Ankunft: TT.MM.JJJJ"
 */
function calcAnkunft_(order) {
  try {
    let parts = order.date.split(".");
    if (parts.length !== 3) return "";
    let bestellDatum = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    let tage = order.provider === "China" ? 56 : 42;
    let ankunft = new Date(bestellDatum.getTime() + tage * 24 * 60 * 60 * 1000);
    let d = String(ankunft.getDate()).padStart(2, "0");
    let m = String(ankunft.getMonth() + 1).padStart(2, "0");
    let y = ankunft.getFullYear();
    return "ca. Ankunft: " + d + "." + m + "." + y;
  } catch(e) { return ""; }
}

function createDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let dash = ss.getSheetByName("📊 Dashboard");
  if (dash) {
    dash.clear();
    let charts = dash.getCharts();
    for (let chart of charts) dash.removeChart(chart);
  } else {
    dash = ss.insertSheet("📊 Dashboard");
    ss.setActiveSheet(dash);
    ss.moveActiveSheet(1);
  }

  const sheetDefs = [
    { name: "Usbekisch - WELLIG", key: "wellig", color: "#c9daf8" },
    { name: "Russisch - GLATT",   key: "glatt",  color: "#d9ead3" },
    { name: "Tools & Haarpflege", key: "tools",  color: "#fff2cc" }
  ];

  let summaryData = [];
  let nullbestand = [];
  let kritischbestand = []; // Produkte mit niedrigem aber > 0 Bestand
  let grandTotals = { wellig: 0, glatt: 0, tools: 0 };

  // Schwellenwerte für Kritisch-Liste
  const SCHWELLE_KRITISCH = 300; // < 300g = kritisch (Orange)
  const SCHWELLE_NIEDRIG  = 600; // < 600g = niedrig (Gelb)

  for (let def of sheetDefs) {
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) continue;
    let data = sheet.getDataRange().getValues();
    for (let row of data) {
      let col0 = String(row[0]).trim();
      let col4 = parseFloat(row[4]) || 0;
      let col3 = parseFloat(row[3]) || 0;
      let col2 = parseFloat(row[2]) || 0; // Unit Weight
      if (col0.startsWith("Total Weight for ")) {
        let colName = col0.replace("Total Weight for ", "").trim();
        // Clip-Ins gehören zu Russisch Glatt / Amanda
        let isClipInCollection = colName.toUpperCase().includes("CLIP IN") || colName.toUpperCase().includes("CLIP-IN");
        let effectiveKey = isClipInCollection ? "glatt" : def.key;
        let effectiveName = isClipInCollection ? "Russisch - GLATT" : def.name;
        let effectiveColor = isClipInCollection ? "#d9ead3" : def.color;
        grandTotals[effectiveKey] += col4;
        summaryData.push({
          sheetName: effectiveName, sheetKey: effectiveKey, color: effectiveColor,
          collectionName: colName, totalWeightG: col4, totalWeightKg: col4 / 1000
        });
      }
      if (def.key !== "tools" && col0 !== "" && col0 !== "Collection Name"
        && !col0.startsWith("Total") && !col0.startsWith("GRAND")) {
        let isClipIn = col0.toUpperCase().includes("CLIP IN") || col0.toUpperCase().includes("CLIP-IN");
        let variant = isClipIn ? (col2 || null) : null;
        // Clip-Ins gehören immer zu Russisch Glatt / Amanda
        let effectiveSheetKey = isClipIn ? "glatt" : def.key;
        let effectiveSheetName = isClipIn ? "Russisch - GLATT" : def.name;
        let totalWeightG = col4; // Gesamtgewicht auf Lager (Menge * Einheitsgew.)
        if (col3 === 0) {
          // Nullbestand
          nullbestand.push({ collection: col0, product: String(row[1]), variant: variant, sheetKey: effectiveSheetKey, sheetName: effectiveSheetName });
        } else if (totalWeightG > 0 && totalWeightG < SCHWELLE_NIEDRIG) {
          // Kritisch oder Niedrig – aber nicht Null
          let stufe = totalWeightG < SCHWELLE_KRITISCH ? "kritisch" : "niedrig";
          kritischbestand.push({
            collection: col0,
            product: String(row[1]),
            variant: variant,
            bestandG: totalWeightG,
            stufe: stufe,
            sheetKey: effectiveSheetKey,
            sheetName: effectiveSheetName
          });
        }
      }
    }
  }

  let sorted = summaryData.filter(d => d.totalWeightKg > 0).sort((a, b) => b.totalWeightKg - a.totalWeightKg);
  let r = 1;

  // getAllOrders() EINMAL aufrufen und für alle Bereiche wiederverwenden
  let allOrdersCache = getAllOrders();
  Logger.log("allOrdersCache.length = " + allOrdersCache.length);

  // ─────────────────────────────────────────
  // HEADER
  // ─────────────────────────────────────────
  dash.getRange(r, 1, 1, 8).merge()
    .setValue("HAIRVENLY  ·  LAGERBESTAND ÜBERSICHT")
    .setFontSize(18).setFontWeight("bold").setHorizontalAlignment("center")
    .setBackground("#1a1a2e").setFontColor("#e0e0e0")
    .setFontFamily("Arial");
  r++;
  dash.getRange(r, 1, 1, 8).merge()
    .setValue("Stand: " + new Date().toLocaleString("de-DE"))
    .setFontSize(9).setHorizontalAlignment("center")
    .setBackground("#16213e").setFontColor("#888888");
  r += 2;

  // ─────────────────────────────────────────
  // LAGERBESTAND KPIs (3 Kacheln)
  // ─────────────────────────────────────────
  dash.getRange(r, 1, 1, 8).merge()
    .setValue("▸  LAGERBESTAND")
    .setFontWeight("bold").setFontSize(10).setFontColor("#555555")
    .setBackground("#f0f0f0");
  r++;

  let lagerKpis = [
    { label: "Usbekisch · Wellig", value: (grandTotals["wellig"] / 1000).toFixed(2) + " kg", bg: "#1a73e8", fg: "#ffffff" },
    { label: "Russisch · Glatt",   value: (grandTotals["glatt"]  / 1000).toFixed(2) + " kg", bg: "#0f9d58", fg: "#ffffff" },
    { label: "Gesamt Lager",       value: ((grandTotals["wellig"] + grandTotals["glatt"]) / 1000).toFixed(2) + " kg", bg: "#f4b400", fg: "#1a1a1a" }
  ];
  for (let i = 0; i < lagerKpis.length; i++) {
    let col = i * 2 + 1;
    dash.getRange(r, col, 1, 2).merge()
      .setValue(lagerKpis[i].label)
      .setFontSize(9).setFontColor(lagerKpis[i].fg).setBackground(lagerKpis[i].bg)
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
    dash.getRange(r + 1, col, 1, 2).merge()
      .setValue(lagerKpis[i].value)
      .setFontSize(20).setFontWeight("bold").setFontColor(lagerKpis[i].fg)
      .setBackground(lagerKpis[i].bg).setHorizontalAlignment("center").setVerticalAlignment("middle");
    dash.setRowHeight(r, 22);
    dash.setRowHeight(r + 1, 38);
  }
  r += 3;

  // ─────────────────────────────────────────
  // UNTERWEGS KPIs – kompakt: China in Sp. A-B, Amanda in Sp. C-D
  // ─────────────────────────────────────────
  let unterwegsData = getUnterwegsKPIs();
  let chinaGesamt  = unterwegsData.china.bezahlt  + unterwegsData.china.offen;
  let amandaGesamt = unterwegsData.amanda.bezahlt + unterwegsData.amanda.offen;

  dash.getRange(r, 1, 1, 4).merge()
    .setValue("▸  UNTERWEGS (offene Bestellungen – inkl. Verzollung = in DE, bald da)")
    .setFontWeight("bold").setFontSize(10).setFontColor("#555555")
    .setBackground("#f0f0f0");
  r++;

  // ---- CHINA BLOCK (Spalten 1-2): 3 Zeilen übereinander ----
  // Zeile 1: China Gesamt (volle Breite A-B)
  dash.getRange(r, 1, 1, 2).merge()
    .setValue("China  ·  " + (chinaGesamt / 1000).toFixed(2) + " kg gesamt")
    .setFontSize(12).setFontWeight("bold").setFontColor("#ffffff")
    .setBackground("#1a73e8").setHorizontalAlignment("center").setVerticalAlignment("middle");
  // Zeile 2: bezahlt (A) | offen (B)
  dash.getRange(r + 1, 1)
    .setValue("bezahlt:  " + (unterwegsData.china.bezahlt / 1000).toFixed(2) + " kg")
    .setFontSize(10).setFontWeight("bold").setFontColor("#ffffff")
    .setBackground("#4a86e8").setHorizontalAlignment("center").setVerticalAlignment("middle");
  dash.getRange(r + 1, 2)
    .setValue(unterwegsData.china.offen > 0
      ? "offen:  " + (unterwegsData.china.offen / 1000).toFixed(2) + " kg"
      : "alles bezahlt")
    .setFontSize(10).setFontWeight("bold")
    .setFontColor(unterwegsData.china.offen > 0 ? "#b31412" : "#1e5631")
    .setBackground(unterwegsData.china.offen > 0 ? "#f4c7c3" : "#ceead6")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");

  dash.setRowHeight(r,     28);
  dash.setRowHeight(r + 1, 24);

  // ---- AMANDA BLOCK (Spalten 3-4): 2 Zeilen übereinander ----
  dash.getRange(r, 3, 1, 2).merge()
    .setValue("Amanda  \u00b7  " + (amandaGesamt / 1000).toFixed(2) + " kg gesamt")
    .setFontSize(12).setFontWeight("bold").setFontColor("#ffffff")
    .setBackground("#0f9d58").setHorizontalAlignment("center").setVerticalAlignment("middle");
  dash.getRange(r + 1, 3)
    .setValue("bezahlt:  " + (unterwegsData.amanda.bezahlt / 1000).toFixed(2) + " kg")
    .setFontSize(10).setFontWeight("bold").setFontColor("#1e5631")
    .setBackground("#81c995").setHorizontalAlignment("center").setVerticalAlignment("middle");
  dash.getRange(r + 1, 4)
    .setValue(unterwegsData.amanda.offen > 0
      ? "offen:  " + (unterwegsData.amanda.offen / 1000).toFixed(2) + " kg"
      : "alles bezahlt")
    .setFontSize(10).setFontWeight("bold")
    .setFontColor(unterwegsData.amanda.offen > 0 ? "#b31412" : "#1e5631")
    .setBackground(unterwegsData.amanda.offen > 0 ? "#f4c7c3" : "#ceead6")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");

  // Zeile r merken für Diagramm-Position (Unterwegs-Block beginnt hier)
  let unterwegsChartRow = r;

  r += 3;

  // ─────────────────────────────────────────
  // KG PRO KOLLEKTION (kompakte Tabelle)
  // ─────────────────────────────────────────
  dash.getRange(r, 1, 1, 4).merge()
    .setValue("▸  KG PRO KOLLEKTION")
    .setFontWeight("bold").setFontSize(10).setFontColor("#555555")
    .setBackground("#f0f0f0");
  r++;

  let tblHeaders = ["Kategorie", "Kollektion", "kg", "Anteil"];
  for (let i = 0; i < tblHeaders.length; i++) {
    dash.getRange(r, i + 1)
      .setValue(tblHeaders[i])
      .setFontWeight("bold").setFontSize(9)
      .setBackground("#1a1a2e").setFontColor("#ffffff")
      .setHorizontalAlignment(i >= 2 ? "right" : "left");
  }
  dash.setRowHeight(r, 20);
  r++;

  let gesamtKg = (grandTotals["wellig"] + grandTotals["glatt"]) / 1000;
  let rowBg = false;
  for (let d of sorted) {
    let anteil = gesamtKg > 0 ? (d.totalWeightKg / gesamtKg * 100).toFixed(1) + "%" : "0%";
    let bg = rowBg ? "#f9f9f9" : "#ffffff";
    dash.getRange(r, 1).setValue(d.sheetName).setBackground(bg).setFontSize(9);
    dash.getRange(r, 2).setValue(d.collectionName).setBackground(bg).setFontSize(9);
    dash.getRange(r, 3).setValue(d.totalWeightKg.toFixed(2)).setBackground(bg).setFontSize(9).setHorizontalAlignment("right");
    dash.getRange(r, 4).setValue(anteil).setBackground(bg).setFontSize(9).setHorizontalAlignment("right");

    // Farbiger Balken in Spalte 5 als visueller Anteil
    let barLen = Math.round(d.totalWeightKg / gesamtKg * 20);
    let barStr = "█".repeat(Math.max(barLen, 1));
    let barColor = d.sheetKey === "wellig" ? "#1a73e8" : "#0f9d58";
    dash.getRange(r, 5).setValue(barStr).setFontColor(barColor).setFontSize(7).setBackground(bg);

    rowBg = !rowBg;
    r++;
  }
  r += 2;

   // ───────────────────────────────────────
  // NULLBESTAND TABELLEN (getrennt nach Usbekisch + Russisch)
  // ───────────────────────────────────────
  let uniqueNullWellig = [];
  let uniqueNullGlatt = [];
  let seenP = new Set();
  for (let n of nullbestand) {
    // Für Clip-Ins: Variante (100g/150g/225g) als Teil des Schlüssels, damit jede Variante separat erscheint
    let key = n.collection + "|" + n.product + "|" + (n.variant || "");
    if (!seenP.has(key)) {
      seenP.add(key);
      if (n.sheetKey === "wellig") uniqueNullWellig.push(n);
      else if (n.sheetKey === "glatt") uniqueNullGlatt.push(n);
    }
  }

  // Hilfsfunktion: rendert eine Nullbestand-Tabelle für eine Gruppe
  function renderNullbestandTabelle_(items, label, accentColor, providerFilter) {
    if (items.length === 0) return;
    let allOrders = providerFilter
      ? allOrdersCache.filter(o => o.provider === providerFilter)
      : allOrdersCache;
    // Spalten: Kollektion | Produkt | Lager (g) | Unterwegs gesamt | Order1 | Order2 ...
    let totalCols = Math.max(4 + allOrders.length, 6);

    // Titelzeile
    dash.getRange(r, 1, 1, totalCols).merge()
      .setValue("⚠  NULLBESTAND " + label + "  ·  " + items.length + " Produkte")
      .setFontSize(12).setFontWeight("bold").setHorizontalAlignment("left")
      .setBackground(accentColor).setFontColor("#ffffff").setFontFamily("Arial");
    dash.setRowHeight(r, 28); r++;

    // Header
    dash.getRange(r, 1).setValue("Kollektion").setFontWeight("bold").setFontSize(9).setBackground("#2d2d2d").setFontColor("#ffffff");
    dash.getRange(r, 2).setValue("Produkt").setFontWeight("bold").setFontSize(9).setBackground("#2d2d2d").setFontColor("#ffffff");
    dash.getRange(r, 3).setValue("Lager (g)").setFontWeight("bold").setFontSize(9).setBackground("#2d2d2d").setFontColor("#ffffff").setHorizontalAlignment("center");
    dash.getRange(r, 4).setValue("Unterwegs gesamt").setFontWeight("bold").setFontSize(9).setBackground("#e65c00").setFontColor("#ffffff").setHorizontalAlignment("center");
    for (let i = 0; i < allOrders.length; i++) {
      let hBg = allOrders[i].provider === "China" ? "#1a73e8" : "#0f9d58";
      let ankunft = calcAnkunft_(allOrders[i]);
      dash.getRange(r, 5 + i).setValue(allOrders[i].name + (ankunft ? "\n" + ankunft : ""))
        .setFontWeight("bold").setFontSize(8).setBackground(hBg).setFontColor("#ffffff")
        .setHorizontalAlignment("center").setWrap(true);
    }
    dash.setRowHeight(r, 46); r++;

    // Datenzeilen
    let evenRow = false;
    for (let n of items) {
      let totalUnterwegs = 0;
      for (let i = 0; i < allOrders.length; i++) totalUnterwegs += getOrderedWeightForProduct(n.product, n.collection, allOrders[i], n.variant);
      let noOrder = totalUnterwegs <= 0;
      let baseBg = noOrder ? "#fffde7" : (evenRow ? "#fff5f5" : "#ffffff");
      let fw = noOrder ? "bold" : "normal";
      dash.getRange(r, 1).setValue(n.collection).setFontSize(9).setBackground(baseBg).setFontColor("#444444").setFontWeight(fw);
      let displayProduct = n.product + (n.variant ? "  [" + n.variant + "g]" : "");
      dash.getRange(r, 2).setValue(displayProduct).setFontSize(9).setBackground(baseBg).setFontColor("#222222").setFontWeight(fw);
      // Lager (g) = 0 (Definition Nullbestand), grau hinterlegt
      dash.getRange(r, 3).setValue(0).setFontSize(9).setBackground("#eeeeee").setFontColor("#999999").setHorizontalAlignment("center").setFontWeight("bold");
      if (totalUnterwegs > 0) {
        dash.getRange(r, 4).setValue(totalUnterwegs).setFontSize(10).setFontWeight("bold").setBackground("#e65c00").setFontColor("#ffffff").setHorizontalAlignment("center");
      } else {
        dash.getRange(r, 4).setValue("–").setFontSize(9).setBackground(baseBg).setFontColor("#bbbbbb").setFontWeight(fw).setHorizontalAlignment("center");
      }
      for (let i = 0; i < allOrders.length; i++) {
        let w = getOrderedWeightForProduct(n.product, n.collection, allOrders[i], n.variant);
        let cell = dash.getRange(r, 5 + i);
        if (w > 0) {
          cell.setValue(w).setFontSize(9).setFontWeight("bold").setBackground(allOrders[i].provider === "China" ? "#d2e3fc" : "#ceead6").setFontColor("#1a1a1a").setHorizontalAlignment("center");
        } else {
          cell.setValue("–").setFontSize(9).setBackground(baseBg).setFontColor("#dddddd").setHorizontalAlignment("center");
        }
      }
      dash.setRowHeight(r, 18); evenRow = !evenRow; r++;
    }

    // Summenzeile
    r++;
    dash.getRange(r, 1, 1, 3 + allOrders.length + 1).setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold");
    dash.getRange(r, 1).setValue("GESAMT").setFontSize(9).setFontWeight("bold").setBackground("#2d2d2d").setFontColor("#ffffff");
    dash.getRange(r, 2).setValue("").setBackground("#2d2d2d");
    dash.getRange(r, 3).setValue("0").setBackground("#2d2d2d").setHorizontalAlignment("center");
    let totalUnterwegsAll = 0;
    for (let n of items) for (let i = 0; i < allOrders.length; i++) totalUnterwegsAll += getOrderedWeightForProduct(n.product, n.collection, allOrders[i], n.variant);
    dash.getRange(r, 4).setValue(totalUnterwegsAll).setFontSize(10).setFontWeight("bold").setBackground("#e65c00").setFontColor("#ffffff").setHorizontalAlignment("center");
    for (let i = 0; i < allOrders.length; i++) {
      let colTotal = 0;
      for (let n of items) colTotal += getOrderedWeightForProduct(n.product, n.collection, allOrders[i], n.variant);
      dash.getRange(r, 5 + i).setValue(colTotal > 0 ? colTotal : "–").setFontSize(9).setFontWeight("bold")
        .setBackground(allOrders[i].provider === "China" ? "#1a56b0" : "#0d7a3e").setFontColor("#ffffff").setHorizontalAlignment("center");
    }
    dash.setRowHeight(r, 22); r++;
    r++;
  }

  renderNullbestandTabelle_(uniqueNullWellig, "USBEKISCH WELLIG", "#c62828", "China");
  renderNullbestandTabelle_(uniqueNullGlatt,  "RUSSISCH GLATT",  "#ad1457", "Amanda");

  // ─────────────────────────────────────────
  // KRITISCH-LISTEN (getrennt nach Usbekisch + Russisch)
  // ─────────────────────────────────────────
  function renderKritischTabelle_(items, label, accentColor, providerFilter) {
    if (items.length === 0) return;
    // Nur Bestellspalten des relevanten Lieferanten anzeigen
    let allOrders = providerFilter
      ? allOrdersCache.filter(o => o.provider === providerFilter)
      : allOrdersCache;
    let totalCols = Math.max(4 + allOrders.length, 6);

    // Titelzeile
    dash.getRange(r, 1, 1, totalCols).merge()
      .setValue("🔔  KRITISCHER BESTAND " + label + "  ·  " + items.length + " Produkte  (< 600g)")
      .setFontSize(12).setFontWeight("bold").setHorizontalAlignment("left")
      .setBackground(accentColor).setFontColor("#ffffff").setFontFamily("Arial");
    dash.setRowHeight(r, 28); r++;

    // Header
    dash.getRange(r, 1).setValue("Kollektion").setFontWeight("bold").setFontSize(9).setBackground("#2d2d2d").setFontColor("#ffffff");
    dash.getRange(r, 2).setValue("Produkt").setFontWeight("bold").setFontSize(9).setBackground("#2d2d2d").setFontColor("#ffffff");
    dash.getRange(r, 3).setValue("Lager (g)").setFontWeight("bold").setFontSize(9).setBackground("#2d2d2d").setFontColor("#ffffff").setHorizontalAlignment("center");
    dash.getRange(r, 4).setValue("Unterwegs gesamt").setFontWeight("bold").setFontSize(9).setBackground("#e65c00").setFontColor("#ffffff").setHorizontalAlignment("center");
    for (let i = 0; i < allOrders.length; i++) {
      let hBg = allOrders[i].provider === "China" ? "#1a73e8" : "#0f9d58";
      let ankunft = calcAnkunft_(allOrders[i]);
      dash.getRange(r, 5 + i).setValue(allOrders[i].name + (ankunft ? "\n" + ankunft : ""))
        .setFontWeight("bold").setFontSize(8).setBackground(hBg).setFontColor("#ffffff")
        .setHorizontalAlignment("center").setWrap(true);
    }
    dash.setRowHeight(r, 36); r++;

    // Datenzeilen
    let evenRow = false;
    for (let k of items) {
      let isCritical = k.stufe === "kritisch";
      let baseBg = isCritical ? (evenRow ? "#fff0e0" : "#fff8f0") : (evenRow ? "#fffde7" : "#ffffff");
      dash.getRange(r, 1).setValue(k.collection).setFontSize(9).setBackground(baseBg).setFontColor("#444444");
      let displayProduct = k.product + (k.variant ? "  [" + k.variant + "g]" : "");
      dash.getRange(r, 2).setValue(displayProduct).setFontSize(9).setBackground(baseBg).setFontColor("#222222");
      let lagerBg = isCritical ? "#e37400" : "#f9ab00";
      dash.getRange(r, 3).setValue(k.bestandG).setFontSize(10).setFontWeight("bold").setBackground(lagerBg).setFontColor("#ffffff").setHorizontalAlignment("center");
      let totalUnterwegs = 0;
      for (let i = 0; i < allOrders.length; i++) totalUnterwegs += getOrderedWeightForProduct(k.product, k.collection, allOrders[i], k.variant);
      if (totalUnterwegs > 0) {
        dash.getRange(r, 4).setValue(totalUnterwegs).setFontSize(10).setFontWeight("bold").setBackground("#e65c00").setFontColor("#ffffff").setHorizontalAlignment("center");
      } else {
        dash.getRange(r, 4).setValue("–").setFontSize(9).setBackground("#f0f0f0").setFontColor("#bbbbbb").setHorizontalAlignment("center");
      }
      for (let i = 0; i < allOrders.length; i++) {
        let w = getOrderedWeightForProduct(k.product, k.collection, allOrders[i], k.variant);
        let cell = dash.getRange(r, 5 + i);
        if (w > 0) {
          cell.setValue(w).setFontSize(9).setFontWeight("bold").setBackground(allOrders[i].provider === "China" ? "#d2e3fc" : "#ceead6").setFontColor("#1a1a1a").setHorizontalAlignment("center");
        } else {
          cell.setValue("–").setFontSize(9).setBackground(baseBg).setFontColor("#dddddd").setHorizontalAlignment("center");
        }
      }
      dash.setRowHeight(r, 18); evenRow = !evenRow; r++;
    }
    r += 2;
  }

  {
    let seenK = new Set();
    let kritWellig = [];
    let kritGlatt = [];
    for (let k of kritischbestand) {
      let key = k.collection + "|" + k.product + "|" + (k.variant || "");
      if (!seenK.has(key)) {
        seenK.add(key);
        if (k.sheetKey === "wellig") kritWellig.push(k);
        else if (k.sheetKey === "glatt") kritGlatt.push(k);
      }
    }
    const sortKrit = arr => arr.sort((a, b) => a.stufe !== b.stufe ? (a.stufe === "kritisch" ? -1 : 1) : a.bestandG - b.bestandG);
    renderKritischTabelle_(sortKrit(kritWellig), "USBEKISCH WELLIG", "#e65100", "China");
    renderKritischTabelle_(sortKrit(kritGlatt),  "RUSSISCH GLATT",  "#6a1b9a", "Amanda");
  }

  // ───────────────────────────────────────
  // ÜBERSICHT BESTELLTER WARE (UNTERWEGS) – aufgeteilt in Usbekisch Wellig und Russisch Glatt
  // ───────────────────────────────────────
  {
    // Alle Produkte mit Unterwegs-Bestand einlesen und nach Lieferant trennen
    let unterwegsWellig = [];
    let unterwegsGlatt  = [];
    let allOrders = allOrdersCache;

    // China-Bestellungen (Usbekisch Wellig)
    let chinaOrders  = allOrders.filter(o => o.provider === "China");
    // Amanda-Bestellungen (Russisch Glatt)
    let amandaOrders = allOrders.filter(o => o.provider === "Amanda");

    for (let def of sheetDefs) {
      if (def.key === "tools") continue;
      let sheet = ss.getSheetByName(def.name);
      if (!sheet) continue;
      let data = sheet.getDataRange().getValues();
      for (let row of data) {
        let col0 = String(row[0]).trim(); // Kollektion
        let col1 = String(row[1]).trim(); // Produkt
        let col4 = parseFloat(row[4]) || 0; // Gesamtgewicht
        if (!col0 || col0 === "Collection Name" || col0.startsWith("Total") || col0.startsWith("GRAND")) continue;
        if (!col1) continue;

        // Clip-Ins → immer Russisch Glatt / Amanda
        let isClipIn = col0.toUpperCase().includes("CLIP IN") || col0.toUpperCase().includes("CLIP-IN");
        let effectiveKey = isClipIn ? "glatt" : def.key;

        // Unterwegs-Menge pro Lieferant
        let totalChina  = 0;
        let totalAmanda = 0;
        if (isClipIn) {
          // Clip-Ins: pro Variante (100g/150g/225g) separat auflisten
          let col2 = parseFloat(row[2]) || 0; // Gewicht pro Stück
          if (col2 > 0) {
            let amandaClip = 0;
            for (let ord of amandaOrders) amandaClip += getOrderedWeightForProduct(col1, col0, ord, col2);
            if (amandaClip > 0) {
              unterwegsGlatt.push({ collection: col0, product: col1, variant: col2, lagerG: col4, unterwegsG: amandaClip });
            }
          }
          continue; // Clip-Ins werden oben pro Variante behandelt
        }
        for (let ord of chinaOrders)  totalChina  += getOrderedWeightForProduct(col1, col0, ord, null);
        for (let ord of amandaOrders) totalAmanda += getOrderedWeightForProduct(col1, col0, ord, null);
        if (effectiveKey === "wellig" && totalChina > 0) {
          unterwegsWellig.push({ collection: col0, product: col1, lagerG: col4, unterwegsG: totalChina });
        }
        if (effectiveKey === "glatt" && totalAmanda > 0) {
          unterwegsGlatt.push({ collection: col0, product: col1, lagerG: col4, unterwegsG: totalAmanda });
        }
      }
    }

    // Duplikate entfernen
    function dedupUnterwegs(arr) {
      let seen = new Set();
      return arr.filter(u => {
        let k = u.collection + "|" + u.product + "|" + (u.variant || "");
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    }
    unterwegsWellig = dedupUnterwegs(unterwegsWellig);
    unterwegsGlatt  = dedupUnterwegs(unterwegsGlatt);
    unterwegsWellig.sort((a, b) => b.unterwegsG - a.unterwegsG);
    unterwegsGlatt.sort((a, b) => b.unterwegsG - a.unterwegsG);

    // ─── Hilfsfunktion: Abschnitt rendern ─────────────────────────────────────
    function renderUnterwegsAbschnitt(items, orders, title, titleBg, headerBg) {
      if (items.length === 0) return;
      let numOrderCols = orders.length;
      let totalCols = Math.max(4 + numOrderCols, 6);

      // Titelzeile
      dash.getRange(r, 1, 1, totalCols).merge()
        .setValue(title + "  ·  " + items.length + " Produkte unterwegs")
        .setFontSize(12).setFontWeight("bold").setHorizontalAlignment("left")
        .setBackground(titleBg).setFontColor("#ffffff")
        .setFontFamily("Arial");
      dash.setRowHeight(r, 28);
      r++;

      // Header
      dash.getRange(r, 1).setValue("Kollektion")
        .setFontWeight("bold").setFontSize(9).setBackground(headerBg).setFontColor("#ffffff");
      dash.getRange(r, 2).setValue("Produkt")
        .setFontWeight("bold").setFontSize(9).setBackground(headerBg).setFontColor("#ffffff");
      dash.getRange(r, 3).setValue("Lager (g)")
        .setFontWeight("bold").setFontSize(9).setBackground(headerBg).setFontColor("#ffffff")
        .setHorizontalAlignment("center");
      dash.getRange(r, 4).setValue("Unterwegs gesamt")
        .setFontWeight("bold").setFontSize(9).setBackground(headerBg).setFontColor("#ffffff")
        .setHorizontalAlignment("center");
      for (let i = 0; i < orders.length; i++) {
        let ord = orders[i];
        let hBg = ord.provider === "China" ? "#1a73e8" : "#0f9d58";
        let ankunft = calcAnkunft_(ord);
        dash.getRange(r, 5 + i).setValue(ord.name + (ankunft ? "\n" + ankunft : ""))
          .setFontWeight("bold").setFontSize(8).setBackground(hBg).setFontColor("#ffffff")
          .setHorizontalAlignment("center").setWrap(true);
      }
      dash.setRowHeight(r, 36);
      r++;

      // Datenzeilen
      let evenRow = false;
      let totalUnterwegsGesamt = 0;
      for (let u of items) {
        let baseBg = evenRow ? "#eceff1" : "#ffffff";
        dash.getRange(r, 1).setValue(u.collection)
          .setFontSize(9).setBackground(baseBg).setFontColor("#444444");
        let displayProdU = u.product + (u.variant ? "  [" + u.variant + "g]" : "");
        dash.getRange(r, 2).setValue(displayProdU)
          .setFontSize(9).setBackground(baseBg).setFontColor("#222222");
        let lagerBg = u.lagerG === 0 ? "#db4437" : (u.lagerG < 300 ? "#e37400" : (u.lagerG < 600 ? "#f9ab00" : baseBg));
        let lagerFg = (u.lagerG === 0 || u.lagerG < 600) ? "#ffffff" : "#222222";
        dash.getRange(r, 3).setValue(u.lagerG)
          .setFontSize(9).setFontWeight(u.lagerG < 300 ? "bold" : "normal")
          .setBackground(lagerBg).setFontColor(lagerFg)
          .setHorizontalAlignment("center");
        dash.getRange(r, 4).setValue(u.unterwegsG)
          .setFontSize(10).setFontWeight("bold")
          .setBackground("#455a64").setFontColor("#ffffff")
          .setHorizontalAlignment("center");
        totalUnterwegsGesamt += u.unterwegsG;
        for (let i = 0; i < orders.length; i++) {
          let w = getOrderedWeightForProduct(u.product, u.collection, orders[i], u.variant || null);
          let cell = dash.getRange(r, 5 + i);
          if (w > 0) {
            let cellBg = orders[i].provider === "China" ? "#d2e3fc" : "#ceead6";
            cell.setValue(w).setFontSize(9).setFontWeight("bold")
              .setBackground(cellBg).setFontColor("#1a1a1a").setHorizontalAlignment("center");
          } else {
            cell.setValue("–").setFontSize(9).setBackground(baseBg).setFontColor("#dddddd")
              .setHorizontalAlignment("center");
          }
        }
        dash.setRowHeight(r, 18);
        evenRow = !evenRow;
        r++;
      }

      // Summenzeile
      dash.getRange(r, 1, 1, 3).merge()
        .setValue("GESAMT UNTERWEGS")
        .setFontSize(9).setFontWeight("bold").setBackground("#2d2d2d").setFontColor("#ffffff");
      dash.getRange(r, 4).setValue(totalUnterwegsGesamt)
        .setFontSize(10).setFontWeight("bold")
        .setBackground("#455a64").setFontColor("#ffffff").setHorizontalAlignment("center");
      for (let i = 0; i < orders.length; i++) {
        let colTotal = 0;
        for (let u of items) colTotal += getOrderedWeightForProduct(u.product, u.collection, orders[i], u.variant || null);
        let sumBg = orders[i].provider === "China" ? "#1a56b0" : "#0d7a3e";
        dash.getRange(r, 5 + i).setValue(colTotal > 0 ? colTotal : "–")
          .setFontSize(9).setFontWeight("bold")
          .setBackground(sumBg).setFontColor("#ffffff").setHorizontalAlignment("center");
      }
      dash.setRowHeight(r, 22);
      r += 2;
    }

    // ─── Abschnitt 1: Usbekisch Wellig (China) ────────────────────────────────
    renderUnterwegsAbschnitt(
      unterwegsWellig, chinaOrders,
      "📦  UNTERWEGS – USBEKISCH WELLIG (China)",
      "#1a56b0",  // Titelzeile dunkelblau
      "#2d4a7a"   // Header-Zeile
    );

    // ─── Abschnitt 2: Russisch Glatt (Amanda) ────────────────────────────────
    renderUnterwegsAbschnitt(
      unterwegsGlatt, amandaOrders,
      "📦  UNTERWEGS – RUSSISCH GLATT (Amanda)",
      "#0d7a3e",  // Titelzeile dunkelgrün
      "#1a5c30"   // Header-Zeile
    );
  }

  // ───────────────────────────────────────
  // SPALTENBREITEN
  // ───────────────────────────────────────────
  dash.setColumnWidth(1, 175);
  dash.setColumnWidth(2, 340);
  dash.setColumnWidth(3, 115);
  dash.setColumnWidth(4, 80);
  dash.setColumnWidth(5, 80);
  for (let i = 0; i < 20; i++) {
    dash.setColumnWidth(4 + i, 125);
  }

  // ─────────────────────────────────────────
  // TORTENDIAGRAMM (Hilfsdaten versteckt)
  // ─────────────────────────────────────────
  let chartCol = 30;
  dash.getRange(4, chartCol).setValue("Kategorie");
  dash.getRange(4, chartCol + 1).setValue("KG");
  dash.getRange(5, chartCol).setValue("Usbekisch");
  dash.getRange(5, chartCol + 1).setValue(grandTotals["wellig"] / 1000);
  dash.getRange(6, chartCol).setValue("Russisch");
  dash.getRange(6, chartCol + 1).setValue(grandTotals["glatt"] / 1000);

  SpreadsheetApp.flush();

  let pieChart = dash.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(dash.getRange(4, chartCol, 3, 2))
    .setOption("title", "Lager: Wellig vs. Glatt")
    .setOption("colors", ["#1a73e8", "#0f9d58"])
    .setOption("pieHole", 0.45)
    .setOption("backgroundColor", "#f9f9f9")
    .setOption("width", 300)
    .setOption("height", 200)
    // Diagramm rechts neben China/Amanda Block (Zeile = unterwegsChartRow, Spalte H=8)
    .setPosition(unterwegsChartRow, 8, 0, 0)
    .build();
  dash.insertChart(pieChart);

  SpreadsheetApp.flush();
  dash.hideColumns(chartCol, 2);

  Logger.log("✅ Dashboard (v3 – modern) erstellt.");

  Logger.log("✅ Dashboard erstellt. Bestellvorschläge separat über Menü generieren.");
}



// ==========================================
// BESTELLVORSCHLAG – HILFSFUNKTIONEN
// ==========================================

/**
 * Liest alle Inventar-Zeilen aus einem Sheet.
 * Gibt ein Array von { collection, product, unitWeight, quantity, totalWeight } zurück.
 * Überspringt Header-, Total- und GRAND-TOTAL-Zeilen.
 */
function readInventoryRowsFromSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  let data = sheet.getDataRange().getValues();
  let rows = [];
  let currentCollection = "";
  for (let row of data) {
    let col0 = String(row[0]).trim();
    let col1 = String(row[1]).trim();
    let col2 = parseFloat(row[2]) || 0; // Gewicht pro Stück (für Clip-In Varianten: 100, 150, 225)
    let col3 = parseFloat(row[3]) || 0; // Stückzahl
    let col4 = parseFloat(row[4]) || 0; // Gesamtgewicht
    if (col0 === "Collection Name") continue;
    if (col0.startsWith("Total") || col0.startsWith("GRAND")) continue;
    if (col0 !== "") currentCollection = col0;
    if (!col1) continue;
    rows.push({
      collection: currentCollection,
      product: col1,
      productUpper: col1.toUpperCase(),
      unitWeight: col2,   // Gewicht pro Stück
      quantity: col3,     // Stückzahl
      totalWeight: col4   // Gesamtgewicht
    });
  }
  return rows;
}

/**
 * Liest den aktuellen Lagerbestand aus einem Sheet.
 * Gibt ein Map zurück: { "PRODUKTNAME_UPPER" -> totalWeightG }
 */
function readInventoryFromSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return {};
  let data = sheet.getDataRange().getValues();
  let map = {};
  for (let row of data) {
    let col0 = String(row[0]).trim();
    let col1 = String(row[1]).trim();
    let col2 = parseFloat(row[2]) || 0; // Gewicht pro Stück (für Clip-In Varianten)
    let col4 = parseFloat(row[4]) || 0;
    if (!col1 || col0 === "Collection Name" || col0.startsWith("Total") || col0.startsWith("GRAND")) continue;
    let isClipInRow = col0.toUpperCase().includes("CLIP IN") || col0.toUpperCase().includes("CLIP-IN");
    if (isClipInRow && col2 > 0) {
      // Clip-Ins: Key mit Variante speichern, z.B. "#PEARL WHITE - INVISIBLE CLIP EXTENSIONS|100"
      let variantKey = col1.toUpperCase() + "|" + col2;
      map[variantKey] = col4;
    } else {
      map[col1.toUpperCase()] = col4;
    }
  }
  return map;
}

/**
 * Sucht den Lagerbestand für ein Produkt anhand von Farbcode + Kollektion + Länge.
 * Gibt totalWeightG zurück (0 wenn nicht gefunden).
 */
function findInventoryForProduct(inventoryMap, colorCode, collectionKeyword, lengthKeyword) {
  let colorUpper = colorCode.toUpperCase().trim();
  let collUpper  = collectionKeyword.toUpperCase();
  let lenUpper   = lengthKeyword ? lengthKeyword.toUpperCase() : "";

  // Clip-In Varianten-Matching: collectionKeyword = "CLIP", lengthKeyword = "100G"/"150G"/"225G"
  let isClipInSearch = collUpper.includes("CLIP");
  if (isClipInSearch && lenUpper) {
    let variantNum = parseFloat(lenUpper.replace(/[^0-9.]/g, "")) || 0;
    if (variantNum > 0) {
      for (let key in inventoryMap) {
        // Clip-In Keys haben Format "PRODUKTNAME|VARIANTE"
        let pipeIdx = key.lastIndexOf("|");
        if (pipeIdx < 0) continue;
        let prodKey = key.substring(0, pipeIdx);
        let keyVariant = parseFloat(key.substring(pipeIdx + 1)) || 0;
        if (keyVariant !== variantNum) continue;
        if (!matchColor(colorUpper, prodKey)) continue;
        return inventoryMap[key];
      }
      return 0; // Variante nicht gefunden
    }
  }
  for (let key in inventoryMap) {
    // Farbcode muss im Produktnamen vorkommen
    if (!matchColor(colorUpper, key)) continue;
    // Kollektion-Keyword muss vorkommen (z.B. "TAPE", "BONDING", "CLASSIC")
    if (collUpper && !key.includes(collUpper)) continue;
    // Länge muss vorkommen (wenn angegeben)
    if (lenUpper && !key.includes(lenUpper)) continue;
    return inventoryMap[key];
  }
  return 0;
}

/**
 * Berechnet die bereits unterwegs befindliche Menge für ein Produkt
 * aus allen aktiven Bestellungen des angegebenen Anbieters.
 */
function getUnterwegsForProduct(allOrders, provider, colorCode, collectionName, lengthHint, clipVariant) {
  let total = 0;
  for (let order of allOrders) {
    if (order.provider !== provider) continue;
    // Wir nutzen getOrderedWeightForProduct mit einem synthetischen Produktnamen
    // der Farbcode + Länge enthält
    let syntheticProduct = colorCode + " " + (lengthHint || "") + " PRODUCT";
    let w = getOrderedWeightForProduct(syntheticProduct, collectionName, order, clipVariant || null);
    total += w;
  }
  return total;
}
/**
 * Gibt unterwegs-Mengen pro Bestellung zurück: [{date, menge}]
 * Ermöglicht präzisen Velocity-Check mit echtem Ankunftsdatum.
 */
function getUnterwegsDetailForProduct(allOrders, provider, colorCode, collectionName, lengthHint, clipVariant) {
  let details = [];
  for (let order of allOrders) {
    if (order.provider !== provider) continue;
    let syntheticProduct = colorCode + " " + (lengthHint || "") + " PRODUCT";
    let w = getOrderedWeightForProduct(syntheticProduct, collectionName, order, clipVariant || null);
    if (w > 0) {
      details.push({ date: order.date, menge: w });
    }
  }
  return details;
}


/**
 * Hilfsfunktion: Farbe leicht aufhellen (Zebra-Streifen)
 */
function lightenColor(hex) {
  try {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.min(255, r + 22);
    g = Math.min(255, g + 22);
    b = Math.min(255, b + 22);
    return "#" + r.toString(16).padStart(2, "0") + g.toString(16).padStart(2, "0") + b.toString(16).padStart(2, "0");
  } catch(e) { return "#ffffff"; }
}

/**
 * Schreibt eine Bestellvorschlag-Tabelle in ein Sheet.
 * rows = Array von { typ, länge, farbcode, lager, unterwegs, ziel, bedarf }
 */
function writeBestellungSheet(sheet, title, columns, rows, headerBg, topColor, midColor) {
  let sheetRows = [];
  // Header bestimmen (columns = Anzahl Datenspalten pro Zeile)
  let headerRow = [];
  if (columns <= 5) {
    // China: Typ, Länge, Farbcode, Lager, Unterwegs, Ziel, Bedarf = 7 Spalten
    headerRow = ["Typ", "Länge", "Farbcode", "Lager (g)", "Unterwegs (g)", "Ziel (g) Minimum", "Bestellung (g)"];
  } else {
    // Amanda: Quality, Method, Länge, Farbcode, Lager, Unterwegs, Ziel, Bedarf = 8 Spalten
    headerRow = ["Quality", "Method", "Länge/Variante", "Farbcode", "Lager (g)", "Unterwegs (g)", "Ziel (g) Minimum", "Bestellung (g)"];
  }
  // Titel-Zeile mit korrekter Spaltenanzahl
  sheetRows.push([title, ...Array(headerRow.length - 1).fill("")]);
  sheetRows.push(headerRow);

  let dataRows = [];
  for (let row of rows) {
    dataRows.push(row);
  }

  // Subtotal
  let totalBedarf = rows.reduce((s, r) => s + (r[r.length - 1] || 0), 0);
  let subtotalRow = Array(headerRow.length).fill("");
  subtotalRow[0] = "Subtotal";
  subtotalRow[subtotalRow.length - 1] = totalBedarf;
  dataRows.push(subtotalRow);

  let allRows = [sheetRows[0], sheetRows[1], ...dataRows];
  let colCount = headerRow.length;

  sheet.getRange(1, 1, allRows.length, colCount).setValues(allRows);

  // Spaltenbreiten
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 90);
  sheet.setColumnWidth(3, 160);
  if (colCount > 7) {
    sheet.setColumnWidth(4, 160);
    sheet.setColumnWidth(5, 90);
    sheet.setColumnWidth(6, 90);
    sheet.setColumnWidth(7, 90);
    sheet.setColumnWidth(8, 100);
  } else {
    sheet.setColumnWidth(4, 90);
    sheet.setColumnWidth(5, 90);
    sheet.setColumnWidth(6, 90);
    sheet.setColumnWidth(7, 100);
  }

  // Titelzeile
  sheet.getRange(1, 1, 1, colCount).merge()
    .setBackground(headerBg).setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center");

  // Headerzeile
  sheet.getRange(2, 1, 1, colCount)
    .setBackground("#2d2d2d").setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(10)
    .setHorizontalAlignment("center");

  // Datenzeilen
  // ── Tier-Farbschema (konsistent mit Topseller-Tab) ──
  // TOP7: Goldgelb | MID: Hellblau | REST: Hellgrün
  const TIER_ROW_TOP7  = "#fff9c4"; // Goldgelb (wie Topseller-Tab)
  const TIER_ROW_TOP7B = "#fff3a0"; // Goldgelb dunkel (ungerade)
  const TIER_ROW_MID   = "#e3f2fd"; // Hellblau (wie Topseller-Tab)
  const TIER_ROW_MIDB  = "#bbdefb"; // Hellblau dunkel (ungerade)
  const TIER_ROW_REST  = "#f1f8e9"; // Hellgrün
  const TIER_ROW_RESTB = "#dcedc8"; // Hellgrün dunkel (ungerade)
  const TIER_COL_TOP7  = "#f9a825"; // Dunkelgold
  const TIER_COL_MID   = "#1565c0"; // Dunkelblau
  const TIER_COL_REST  = "#558b2f"; // Olivgrün

  for (let i = 2; i < allRows.length - 1; i++) {
    let row = allRows[i];
    let ziel   = row[row.length - 2];
    let bedarf = row[row.length - 1];
    // Tier aus Ziel ableiten
    let isTop7 = (ziel >= 1000);
    let isMid  = (ziel >= 500 && ziel < 1000);
    let bg;
    if (isTop7)      bg = (i % 2 === 0) ? TIER_ROW_TOP7  : TIER_ROW_TOP7B;
    else if (isMid)  bg = (i % 2 === 0) ? TIER_ROW_MID   : TIER_ROW_MIDB;
    else             bg = (i % 2 === 0) ? TIER_ROW_REST  : TIER_ROW_RESTB;
    sheet.getRange(i + 1, 1, 1, colCount).setBackground(bg).setFontSize(10);
    // TOP7: Schrift fett
    if (isTop7) sheet.getRange(i + 1, 1, 1, colCount).setFontWeight("bold");

    // Bestellspalte (letzte Spalte) hervorheben
    if (typeof bedarf === "number" && bedarf > 0) {
      let bedarfBg = isTop7 ? TIER_COL_TOP7 : (isMid ? TIER_COL_MID : TIER_COL_REST);
      sheet.getRange(i + 1, colCount)
        .setBackground(bedarfBg).setFontColor("#ffffff").setFontWeight("bold")
        .setHorizontalAlignment("center");
    }
    // Lager-Spalte: rot wenn 0
    let lagerCol = (colCount === 8) ? 5 : 4;
    let lager = row[lagerCol - 1];
    if (typeof lager === "number" && lager === 0) {
      sheet.getRange(i + 1, lagerCol)
        .setBackground("#db4437").setFontColor("#ffffff").setFontWeight("bold")
        .setHorizontalAlignment("center");
    }
  }

  // Subtotal-Zeile
  sheet.getRange(allRows.length, 1, 1, colCount)
    .setBackground("#2d2d2d").setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(11)
    .setHorizontalAlignment("center");
  sheet.getRange(allRows.length, 1).setHorizontalAlignment("left");

  // Hinweis
  sheet.getRange(allRows.length + 2, 1)
    .setValue("ℹ️  Nur Produkte mit Bedarf (Lager + Unterwegs < Ziel) werden angezeigt. Ziel: TOP7 = 1.000g | MID = 500g | REST = 300g. Topseller via refreshTopseller() aktualisieren.")
    .setFontSize(9).setFontColor("#555555").setFontStyle("italic");
}


// ==========================================
// BESTELLVORSCHLAG CHINA (dynamisch)
// ==========================================

function createBestellungChina() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = "Vorschlag - China";
  const isAutoRun = PropertiesService.getScriptProperties().getProperty("AUTO_BUDGET") === "true";
  let sheet = ss.getSheetByName(tabName);
  // Bei manuellem Aufruf: Budget aus Zelle I2 lesen BEVOR der Tab gelöscht wird
  if (sheet && !isAutoRun) {
    const cellVal = sheet.getRange(2, 9).getValue();
    if (cellVal && parseInt(cellVal) > 0) {
      PropertiesService.getScriptProperties().setProperty("BUDGET_CHINA", String(parseInt(cellVal)));
    }
  }
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(tabName);
  sheet.setTabColor("#1a73e8");

  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "dd.MM.yyyy, HH:mm");

  // Alle Inventar-Zeilen aus "Usbekisch - WELLIG" Sheet lesen
  const invRows = readInventoryRowsFromSheet("Usbekisch - WELLIG");

  // Aktive Bestellungen laden
  const allOrders = getAllOrders();

  // ─── TOPSELLER-RÄNGE: Dynamisch aus refreshTopseller() oder Fallback ───
  // Prüfen ob Topseller-Daten vorhanden sind
  const hasTopsellerdaten = !!(PropertiesService.getScriptProperties().getProperty("TOPSELLER_DATA_COUNT"));

  // Kollektion -> Typ + collName Mapping
  const collMapping = [
    { keyword: "TAPES WELLIG 45CM",  typ: "Tapes",       länge: "45CM", collKeyword: "TAPE",    collName: "Tapes Wellig 45cm" },
    { keyword: "TAPES WELLIG 55CM",  typ: "Tapes",       länge: "55CM", collKeyword: "TAPE",    collName: "Tapes Wellig 55cm" },
    { keyword: "TAPES WELLIG 65CM",  typ: "Tapes",       länge: "65CM", collKeyword: "TAPE",    collName: "Tapes Wellig 65cm" },
    { keyword: "TAPES WELLIG 85CM",  typ: "Tapes",       länge: "85CM", collKeyword: "TAPE",    collName: "Tapes Wellig 85cm" },
    { keyword: "BONDINGS WELLIG 65CM", typ: "Bondings",  länge: "65CM", collKeyword: "BONDING", collName: "Bondings wellig 65cm" },
    { keyword: "BONDINGS WELLIG 85CM", typ: "Bondings",  länge: "85CM", collKeyword: "BONDING", collName: "Bondings wellig 85cm" },
    { keyword: "CLASSIC TRESSEN",    typ: "Classic Weft",länge: "65CM", collKeyword: "CLASSIC", collName: "Usbekische Classic Tressen (Wellig)" },
    { keyword: "GENIUS TRESSEN",     typ: "Genius Weft", länge: "65CM", collKeyword: "GENIUS",  collName: "Usbekische Genius Tressen (Wellig)" },
  ];

  // Hilfsfunktion: Farbcode aus Produktname extrahieren (erstes Token mit #)
  function extractColorFromProduct(productUpper) {
    let m = productUpper.match(/(#[A-Z0-9][A-Z0-9 ]*?)(?=\s+[A-Z]{2,}|$)/);
    if (m) return m[1].trim();
    let parts = productUpper.split(" ");
    if (parts[0].startsWith("#")) return parts[0];
    return null;
  }

  // Tier für Produkt bestimmen (dynamisch oder Fallback)
  function getTierChina(colorOneWord, typ) {
    if (hasTopsellerdaten) {
      return getTopsellertierTS_("Usbekisch Wellig", typ, colorOneWord);
    }
    // Fallback: alle als REST (1000g Ziel)
    return "REST";
  }

  // ─── TIER-COUNTS vorberechnen (für proportionale Zielmengen) ───
  const hasVerkaufsdaten = !!PropertiesService.getScriptProperties().getProperty("VERKAUFS_DATA");
  const tierCountsCache = {}; // key: collLabel -> { TOP7, MID, REST }
  for (let m of collMapping) {
    if (tierCountsCache[m.collName]) continue;
    tierCountsCache[m.collName] = countTiersForCollection_(
      invRows, "Usbekisch Wellig", m.collName, m.typ,
      (c, t) => getTierChina(c, t),
      (p) => { const h = p.indexOf("#"); return h >= 0 ? p.substring(h).split(" ")[0] : null; },
      m.keyword
    );
  }

  // ─── BEDARFSBERECHNUNG: über alle Inventar-Zeilen iterieren ───
  // Gruppierung: Typ + Länge als Gruppenkey
  let rowsByGroup = {}; // key: "Typ|Länge" -> [{...}]
  let groupOrder = [];

  for (let invRow of invRows) {
    let cUpper = invRow.collection.toUpperCase();

    // Clip-Ins und Ponytail überspringen (gehören zu Amanda)
    if (cUpper.includes("CLIP") || cUpper.includes("PONYTAIL")) continue;

    // Kollektion matchen
    let mapping = null;
    for (let m of collMapping) {
      if (cUpper.includes(m.keyword)) { mapping = m; break; }
    }
    if (!mapping) continue;

    let lager = invRow.totalWeight;
    let produktUpper = invRow.productUpper;

    // Farbcode extrahieren
    let colorRaw = null;
    let firstHash = produktUpper.indexOf("#");
    if (firstHash >= 0) colorRaw = produktUpper.substring(firstHash);
    if (!colorRaw) continue;
    // Farbcode: vollständiger Farbname bis Stopword (z.B. "#LATTE BROWN", "#2E")
    let colorOneWord = extractFullColor_(produktUpper) || colorRaw.split(" ")[0];
    let tier = getTierChina(colorOneWord, mapping.typ);
    // < 150g Lager = unverkäuflich (Kunden kaufen min. ~150g) → wie ausverkauft behandeln
    if (tier === "KAUM" && lager >= 150) continue; // Genug Lager + keine Verkäufe → wirklich langsam
    // KAUM + lager < 150g → Nachbestellen auf verkaufbare Menge

    // Ziel: verkaufsbasiert (70% Ø3M + 30% letzter Monat) oder Fallback auf fixe Stufen
    let tierCounts = tierCountsCache[mapping.collName] || { TOP7: 1, MID: 1, REST: 1 };
    let ziel = (tier === "KAUM")
      ? 300  // Ausverkauft – Mindestbestellung
      : getVerkaufsZielGrams_("Usbekisch Wellig", mapping.collName, tier, tierCounts, 10, colorOneWord, lager); // China: 8 Wochen Lieferzeit + 2 Wochen Puffer = 10
    if (ziel === 0) continue; // Nicht bestellen
    // Echter Rang aus Topseller-Daten
    let rang = getRangTS_("Usbekisch Wellig", mapping.typ, colorOneWord);
    // Rang-Mindestziele: NUR noch als Fallback wenn keine Produktdaten vorhanden (kein VA_PRODUCT_DATA).
    // Bei vorhandenen Produktdaten regelt getVerkaufsZielGrams_ (inkl. Ausverkauf-Erkennung) das Ziel.
    const hasProdData = !!(PropertiesService.getScriptProperties().getProperty("VA_PRODUCT_DATA_COUNT") ||
                           PropertiesService.getScriptProperties().getProperty("VA_PRODUCT_DATA_0"));
    if (!hasProdData && mapping.typ === "Tapes" && rang < 999) {
      if (rang <= 10)       ziel = Math.max(ziel, RANG_MINZIEL_TOP10);
      else if (rang <= 20)  ziel = Math.max(ziel, RANG_MINZIEL_TOP20);
    } // Für Sortierung
    let nächsteBestellungChina = 0; // Vorausblick: Fehlmenge für nächste Bestellung
    let unterwegs = getUnterwegsForProduct(allOrders, "China", colorRaw.split(" ")[0], mapping.collName, mapping.länge.toLowerCase(), null);
    // Auch mit 2-Wort-Farbcode versuchen falls unterwegs = 0
    if (unterwegs === 0 && colorRaw.split(" ").length > 1) {
      let twoWord = colorRaw.split(" ")[0] + " " + colorRaw.split(" ")[1];
      unterwegs = getUnterwegsForProduct(allOrders, "China", twoWord, mapping.collName, mapping.länge.toLowerCase(), null);
    }
    let verfügbar = lager + unterwegs;
    let bedarf = Math.max(0, ziel - verfügbar);

    // Option B China: werden im Velocity-Check gesetzt
    let tagesrateC = 0;           // Echte Tagesrate aus Velocity-Daten
    let stock_at_84C = null;      // Simulierter Lagerstand bei Ankunft neuer Bestellung (Tag 84)
    let hat_lückeC = false;       // Wird Regal leer bevor erste Lieferung ankommt?
    let lücken_dauerC = 0;        // Anzahl Tage mit leerem Regal (geschätzt)
    let lastTagesBisAnkunftC = 0; // Tage bis letzte bekannte Unterwegs-Lieferung ankommt

    // ─── VELOCITY-CHECK: Pro Bestellung mit echtem Ankunftsdatum ─────────────────────────────────
    // Für jede unterwegs-Bestellung: Ankunft = Bestelldatum + 56 Tage (8 Wochen China)
    // Lager bei Ankunft = Lager heute - Verbrauch bis Ankunft
    // Verfügbar bei Ankunft = Lager bei Ankunft + diese Bestellung + frühere Bestellungen
    {
      const rawVD2 = PropertiesService.getScriptProperties().getProperty("VERKAUFS_DATA");
      if (rawVD2) {
        try {
          const vd2 = JSON.parse(rawVD2);
          // collMapping.collName (z.B. "Tapes Wellig 45cm") → VERKAUFS_DATA-Label (z.B. "Tapes 45cm")
          const VD_KEY_MAP_C = {
            "Tapes Wellig 45cm": "Tapes 45cm", "Tapes Wellig 55cm": "Tapes 55cm",
            "Tapes Wellig 65cm": "Tapes 65cm", "Tapes Wellig 85cm": "Tapes 85cm",
            "Bondings wellig 65cm": "Bondings 65cm", "Bondings wellig 85cm": "Bondings 85cm",
            "Usbekische Classic Tressen (Wellig)": "Classic Weft",
            "Usbekische Genius Tressen (Wellig)": "Genius Weft"
          };
          const vdKey2 = "Usbekisch Wellig|" + (VD_KEY_MAP_C[mapping.collName] || mapping.collName);
          const vdEntry2 = vd2[vdKey2];
          if (vdEntry2 && vdEntry2.g30d) {
            const tc2 = tierCountsCache[mapping.collName] || { TOP7: 1, MID: 1, REST: 1 };
            const TIER_W2 = { "TOP7": 7, "MID": 4, "REST": 1 };
            const totalA2 = (tc2.TOP7||0)*7 + (tc2.MID||0)*4 + (tc2.REST||0)*1 || 1;
            const anteilFaktor2 = (TIER_W2[tier] || 1) / totalA2;
            const g30dProdukt2 = vdEntry2.g30d * anteilFaktor2;
            const tagesVerkauf2 = g30dProdukt2 / 30;
            tagesrateC = tagesVerkauf2; // Option B: für Budget-Runden merken
            const heute2 = new Date();
            // Unterwegs-Details pro Bestellung laden
            const unterwegsDetails2 = getUnterwegsDetailForProduct(allOrders, "China", colorRaw.split(" ")[0], mapping.collName, mapping.länge.toLowerCase(), null);
            // Bestellungen nach Datum sortieren (älteste zuerst = kommt zuerst an)
            unterwegsDetails2.sort((a, b) => parseDateDE(a.date) - parseDateDE(b.date));
            // Für jede Bestellung: Lager bei Ankunft berechnen
            let lagerSimuliert = lager;
            let bedarfVelocity2 = bedarf;
            for (const detail of unterwegsDetails2) {
              const bestellDatum2 = parseDateDE(detail.date);
              const ankunftDatum2 = new Date(bestellDatum2.getTime() + 56 * 24 * 60 * 60 * 1000); // +56 Tage
              const tagesBisAnkunft2 = Math.max(0, Math.round((ankunftDatum2 - heute2) / (24 * 60 * 60 * 1000)));
              const verbrauchBisAnkunft2 = Math.round(tagesVerkauf2 * tagesBisAnkunft2);
              lagerSimuliert = Math.max(0, lagerSimuliert - verbrauchBisAnkunft2);
              // Verfügbar bei Ankunft dieser Bestellung = simuliertes Lager + diese Lieferung
              const verfügbarBeiAnkunft2 = lagerSimuliert + detail.menge;
              const bedarfNachAnkunft2 = Math.max(0, ziel - verfügbarBeiAnkunft2);
              if (bedarfNachAnkunft2 > bedarfVelocity2) {
                bedarfVelocity2 = bedarfNachAnkunft2;
              }
              Logger.log("⚡ Velocity China: " + invRow.product +
                " | Bestellung:" + detail.date + " | Ankunft in ~" + tagesBisAnkunft2 + "T" +
                " | LagerBeiAnkunft:" + lagerSimuliert + "g | +Lieferung:" + detail.menge + "g" +
                " | Verfügbar:" + verfügbarBeiAnkunft2 + "g | Bedarf:" + bedarfNachAnkunft2 + "g");
              // Lager nach Ankunft = Lager + Lieferung (für nächste Bestellung)
              lagerSimuliert = verfügbarBeiAnkunft2;
              lastTagesBisAnkunftC = tagesBisAnkunft2; // Option B: letzter Ankunftstag merken
            }
            // Falls keine Bestellungen unterwegs: Velocity mit neuer Bestellung in 56T prüfen
            if (unterwegsDetails2.length === 0) {
              const verbrauchBisAnkunft2 = Math.round(tagesVerkauf2 * 56);
              const lagerBeiAnkunft2 = Math.max(0, lager - verbrauchBisAnkunft2);
              bedarfVelocity2 = Math.max(bedarfVelocity2, Math.max(0, ziel - lagerBeiAnkunft2));
            }
            if (bedarfVelocity2 > bedarf) {
              bedarf = bedarfVelocity2;
            }

            // ── VORAUSBLICK China: Reicht das Lager nach Ankunft bis zur nächsten Bestellung? ──
            // Nächste Bestellung kommt frühestens in (tagesBisAnkunft + 56) Tagen an
            // Lager bei nächster Ankunft = Lager nach dieser Lieferung - Verbrauch in 56 Tagen
            {
              let lagerNachLieferung = lager;
              let tagesBisLetzte = 0;
              if (unterwegsDetails2.length > 0) {
                // Letzte (späteste) Bestellung als Basis
                const letzteDetail = unterwegsDetails2[unterwegsDetails2.length - 1];
                const letzteBestellDatum = parseDateDE(letzteDetail.date);
                const letzteAnkunft = new Date(letzteBestellDatum.getTime() + 56 * 24 * 60 * 60 * 1000);
                tagesBisLetzte = Math.max(0, Math.round((letzteAnkunft - heute2) / (24 * 60 * 60 * 1000)));
                const verbrauchBisLetzte = Math.round(tagesVerkauf2 * tagesBisLetzte);
                lagerNachLieferung = Math.max(0, lager - verbrauchBisLetzte) + letzteDetail.menge;
              }
              // Nächste Bestellung: jetzt aufgeben → kommt in 56 Tagen an
              const tagesBisNächste = tagesBisLetzte + 56;
              const verbrauchBisNächste = Math.round(tagesVerkauf2 * tagesBisNächste);
              const lagerBeiNächster = Math.max(0, lagerNachLieferung - verbrauchBisNächste);
              const minPuffer = Math.round(tagesVerkauf2 * 14); // 2 Wochen Mindestpuffer
              if (lagerBeiNächster < minPuffer) {
                const fehlmengeVorausblick = Math.max(0, minPuffer - lagerBeiNächster);
                if (fehlmengeVorausblick > bedarfVelocity2) {
                  bedarfVelocity2 = fehlmengeVorausblick;
                  nächsteBestellungChina = fehlmengeVorausblick;
                  Logger.log("⚡ Vorausblick China: " + invRow.product +
                    " | LagerNachLieferung=" + lagerNachLieferung + "g" +
                    " | LagerBeiNächster=" + lagerBeiNächster + "g < Puffer=" + minPuffer + "g" +
                    " → Fehlmenge=" + fehlmengeVorausblick + "g");
                }
              }
              if (bedarfVelocity2 > bedarf) bedarf = bedarfVelocity2;
            }
            // ── Option B: stock_at_84 — Lager wenn neue Bestellung ankommt (Tag 84) ─────
            // lagerSimuliert = Bestand nach letzter bekannter Lieferung
            // lastTagesBisAnkunftC = wann diese letzte Lieferung ankommt
            // Neue Bestellung: 84 Tage = 56T Lieferzeit + 14T Puffer für Verzögerungen + 14T Sicherheit
            {
              const daysToNew84 = Math.max(0, 84 - lastTagesBisAnkunftC);
              stock_at_84C = Math.max(0, lagerSimuliert - Math.round(tagesVerkauf2 * daysToNew84));
              Logger.log("📦 Option B stock_at_84 " + invRow.product + ": lagerSim=" + lagerSimuliert +
                "g lastArrival=T+" + lastTagesBisAnkunftC + " daysToNew=" + daysToNew84 +
                " → stock_at_84=" + stock_at_84C + "g");
            }
            // ── Lücken-Erkennung: Wird Regal leer bevor erste Lieferung ankommt? ─────────
            if (tagesVerkauf2 > 0) {
              const reichweite = lager / tagesVerkauf2; // Tage bis Lager leer
              if (unterwegsDetails2.length > 0) {
                // Prüfe ob Lager vor ERSTER Lieferung auf 0 fällt
                const erstesDetail = unterwegsDetails2[0]; // bereits sortiert (älteste zuerst)
                const ersteBestellDatum = parseDateDE(erstesDetail.date);
                const ersteAnkunft = new Date(ersteBestellDatum.getTime() + 56 * 24 * 60 * 60 * 1000);
                const ersteAnkunftTage = Math.max(0, Math.round((ersteAnkunft - heute2) / (24 * 60 * 60 * 1000)));
                if (reichweite < ersteAnkunftTage) {
                  hat_lückeC = true;
                  lücken_dauerC = Math.round(ersteAnkunftTage - reichweite);
                }
              } else {
                // Keine Bestellungen unterwegs – Lücke nur wenn wirklich dringend
                // (< 14 Tage Stock = weniger als 1 Bestellzyklus, KEINE Ware in der Pipeline)
                if (lager === 0) {
                  hat_lückeC = true;
                  lücken_dauerC = 84; // Regal jetzt leer, nichts kommt
                } else if (reichweite < 14) {
                  hat_lückeC = true;
                  lücken_dauerC = Math.round(84 - reichweite); // < 2 Wochen Stock, nichts bestellt
                }
                // reichweite >= 14 → genug Lager um nächsten Bestellzyklus zu überbrücken, KEIN Notfall
              }
              if (hat_lückeC) Logger.log("⚠️ Lücke China: " + invRow.product +
                " | Reichweite=" + Math.round(reichweite) + "T | Lücke=" + lücken_dauerC + "T");
            }
          }
        } catch(e2) { Logger.log("Velocity-Check China Fehler: " + e2.message); }
      }
    }
    // ──────────────────────────────────────────────────────────────────────────────────────

    if (bedarf <= 0) continue;
    // Mindestbestellmenge 500g (Lieferant akzeptiert keine kleineren Bestellungen)
    if (bedarf < 500) bedarf = 500;

    let groupKey = mapping.typ + "|" + mapping.länge;
    if (!rowsByGroup[groupKey]) {
      rowsByGroup[groupKey] = [];
      groupOrder.push({ key: groupKey, typ: mapping.typ, länge: mapping.länge.toLowerCase() });
    }
    // Standard Tapes Russisch: Key = "Standard Tapes|" (keine Länge im Produktnamen)
    const isPremiumKeys = ["tapes|55cm", "tapes|65cm", "bondings|65cm", "genius weft|65cm", "standard tapes|"];
    const isPremium = isPremiumKeys.includes((mapping.typ + "|" + mapping.länge).toLowerCase());
    rowsByGroup[groupKey].push({ rang, tier, isPremium, lager, unterwegs, ziel, bedarf, nächste: nächsteBestellungChina, product: invRow.product,
      tagesrate: tagesrateC, stock_at_84: stock_at_84C, hat_lücke: hat_lückeC, lücken_dauer: lücken_dauerC });
  }

  // Zeilen zusammenbauen (nach Rang sortiert innerhalb jeder Gruppe)
  let rows = [];
  for (let g of groupOrder) {
    let gruppenRows = rowsByGroup[g.key];
    // Nach Rang sortieren (Top-6 zuerst, dann aufsteigend nach Lager)
    gruppenRows.sort((a, b) => a.rang - b.rang || a.lager - b.lager);
    let first = true;
    for (let r of gruppenRows) {
      rows.push([
        first ? g.typ : "",
        g.länge,
        r.product,
        r.lager,
        r.unterwegs,
        r.ziel,
        r.bedarf
      ]);
      first = false;
    }
  }

  if (rows.length === 0) {
    sheet.getRange(1, 1).setValue("✅ Kein Bestellbedarf für China – alle Produkte ausreichend bevorratet.");
    sheet.getRange(1, 1).setFontSize(12).setFontWeight("bold").setFontColor("#0f9d58");
    Logger.log("✅ Bestellung China: kein Bedarf.");
    return;
  }

  // ─── BUDGET: Empfehlung berechnen (2-Wochen-Bedarf) und als Default nutzen ───
  let empfBudgetChina = 0;
  {
    const rawVDbudget = PropertiesService.getScriptProperties().getProperty("VERKAUFS_DATA");
    if (rawVDbudget) {
      try {
        const vdBudget = JSON.parse(rawVDbudget);
        const chinaLabels = ["Tapes 45cm","Tapes 55cm","Tapes 65cm","Tapes 85cm",
          "Bondings 65cm","Bondings 85cm","Classic Weft","Genius Weft"];
        for (const label of chinaLabels) {
          const e = vdBudget["Usbekisch Wellig|" + label];
          if (e && (e.avgG3M || e.g30d)) {
            empfBudgetChina += Math.round((e.avgG3M || 0) * 0.5 + (e.g30d || 0) * 0.5) * 0.5;
          }
        }
      } catch(ex) {}
    }
    empfBudgetChina = Math.round(empfBudgetChina / 1000) * 1000; // auf ganze kg runden
  }
  // Budget: Auto-Trigger → Empfehlung | Manuell → Zellenwert/Property → Empfehlung → 20kg
  let budgetG;
  if (isAutoRun) {
    budgetG = empfBudgetChina > 0 ? empfBudgetChina : 20000;
    Logger.log("🤖 Auto-Budget China: " + (budgetG/1000).toFixed(1) + " kg (Empfehlung)");
  } else {
    let budgetProp = PropertiesService.getScriptProperties().getProperty("BUDGET_CHINA");
    budgetG = (budgetProp && parseInt(budgetProp) > 0) ? parseInt(budgetProp)
      : (empfBudgetChina > 0 ? empfBudgetChina : 20000);
    Logger.log("👤 Manuelles Budget China: " + (budgetG/1000).toFixed(1) + " kg");
  }

  // ─── BUDGET-LISTE berechnen (8-Runden-Strategie – Option B China) ──────────────────────────
  // Kernprinzip: Alle 2 Wochen bestellen → jede Bestellung deckt ~21 Tage (3W Sicherheitspuffer).
  // stock_at_84 statt rohem lager+unterwegs → unterwegs-Ware die bis Tag 84 verbraucht wird,
  // zählt nicht als "gedeckt". NOTFALL-Produkte (Lücke unvermeidbar) bekommen immer Vorrang.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  let allCandidates = [];
  for (let g of groupOrder) {
    for (let r of rowsByGroup[g.key]) {
      if (r.bedarf <= 0) continue;
      let isTop = (r.tier === "TOP7");
      let isMid = (r.tier === "MID");
      // grundbedarf: Anteil dieser Bestellung = 21 Tage Verbrauch (3 Wochen Sicherheitspuffer)
      // mind. 500g (Mindestbestellmenge China)
      const gbd = (r.tagesrate > 0)
        ? Math.max(500, Math.round(r.tagesrate * 21 / 100) * 100)
        : 500;
      // notfall: Regal leer+nichts kommt ODER echte Versorgungslücke > 14 Tage
      const notfall = (r.lager === 0 && r.unterwegs === 0) ||
        (r.hat_lücke && r.lücken_dauer > 14);
      allCandidates.push({
        rang: r.rang, tier: r.tier, isPremium: r.isPremium, isTop, isMid,
        lager: r.lager, unterwegs: r.unterwegs, verfügbar: r.lager + r.unterwegs,
        ziel: r.ziel, bedarf: r.bedarf, nächste: r.nächste || 0,
        product: r.product, typ: g.typ, länge: g.länge,
        tagesrate: r.tagesrate || 0, stock_at_84: r.stock_at_84,
        hat_lücke: r.hat_lücke || false, lücken_dauer: r.lücken_dauer || 0,
        notfall, grundbedarf: gbd,
        zugeteilt: 0
      });
    }
  }

  const tierPrio = (c) => c.isTop ? 0 : (c.isMid ? 1 : 2);

  // MID-Cap: nur wenn Budget < Gesamtbedarf der Grundversorgung aller Produkte
  const gesamtGrundbedarf = allCandidates.reduce((s, c) => s + c.grundbedarf, 0);
  const budgetKnappC = budgetG < gesamtGrundbedarf;
  const MID_CAP_C = 0.6;
  if (budgetKnappC) {
    Logger.log("⚠️ Budget knapp China: " + (budgetG/1000).toFixed(1) + "kg < Grundbedarf " + (gesamtGrundbedarf/1000).toFixed(1) + "kg → MID-Cap 60% aktiv");
  } else {
    Logger.log("✅ Budget China ausreichend: " + (budgetG/1000).toFixed(1) + "kg >= Grundbedarf " + (gesamtGrundbedarf/1000).toFixed(1) + "kg");
  }

  function midCapC(c, proposed) {
    if (!c.isMid || !budgetKnappC) return proposed;
    const maxTotal = Math.max(500, Math.round(c.grundbedarf * MID_CAP_C / 100) * 100);
    const remaining = Math.max(0, maxTotal - c.zugeteilt);
    return Math.min(proposed, remaining);
  }
  // TOP7: aufrunden, MID/REST: abrunden. Budget-Cap am Ende korrigiert Überschreitung.
  function rundeC_(val, c) {
    const fn = (c && c.isTop) ? Math.ceil : Math.floor;
    return fn(val / 100) * 100;
  }

  let restBudget = budgetG;

  // ─── RUNDE 0: lager=0 & unterwegs=0 → Mindestmenge 500g ──────────────────────────────────
  // Niemand bleibt dauerhaft bei Null — auch REST bekommt etwas. TOP → MID → REST.
  {
    let r0 = allCandidates
      .filter(c => c.lager === 0 && c.unterwegs === 0)
      .sort((a, b) => tierPrio(a) - tierPrio(b) || a.rang - b.rang);
    for (let c of r0) {
      if (restBudget <= 0) break;
      if (c.zugeteilt >= 500) continue;
      let zugeteilt = Math.min(500, restBudget, c.bedarf - c.zugeteilt);
      zugeteilt = rundeC_(zugeteilt, c);
      if (zugeteilt >= 100) { c.zugeteilt += zugeteilt; restBudget -= zugeteilt; }
    }
  }

  // ─── RUNDE 1: NOTFALL → Aufholbedarf ──────────────────────────────────────────────────────
  // Produkte mit Lücke > 14T oder stock_at_84 < 7 Tage. TOP7 zuerst.
  // TOP7: grundbedarf × 2 | MID: × 1.5 | REST: × 1 — capped bei c.bedarf
  {
    let r1 = allCandidates
      .filter(c => c.notfall)
      .sort((a, b) => tierPrio(a) - tierPrio(b) || a.rang - b.rang);
    for (let c of r1) {
      if (restBudget <= 0) break;
      const aufholFaktor = c.isTop ? 2.0 : (c.isMid ? 1.5 : 1.0);
      let aufhol = Math.min(c.bedarf, rundeC_(c.grundbedarf * aufholFaktor, c));
      aufhol = midCapC(c, aufhol);
      let restBedarf = aufhol - c.zugeteilt;
      if (restBedarf <= 0) continue;
      let zugeteilt = Math.min(restBedarf, restBudget);
      zugeteilt = rundeC_(zugeteilt, c);
      if (zugeteilt >= 100) { c.zugeteilt += zugeteilt; restBudget -= zugeteilt; }
    }
  }

  // ─── RUNDE 2: KRITISCH (stock_at_84 < 14 Tage Rate) → Nachholbedarf ──────────────────────
  // Produkte die bei Ankunft fast leer sind. grundbedarf × 1.5. TOP7 → MID.
  {
    let r2 = allCandidates
      .filter(c => !c.notfall && c.stock_at_84 != null && c.tagesrate > 0 && c.stock_at_84 < c.tagesrate * 14)
      .sort((a, b) => {
        const reichwA = a.stock_at_84 / Math.max(0.1, a.tagesrate);
        const reichwB = b.stock_at_84 / Math.max(0.1, b.tagesrate);
        return tierPrio(a) - tierPrio(b) || reichwA - reichwB;
      });
    for (let c of r2) {
      if (restBudget <= 0) break;
      let nachhol = Math.min(c.bedarf, rundeC_(c.grundbedarf * 1.5, c));
      nachhol = midCapC(c, nachhol);
      let restBedarf = nachhol - c.zugeteilt;
      if (restBedarf <= 0) continue;
      let zugeteilt = Math.min(restBedarf, restBudget);
      zugeteilt = rundeC_(zugeteilt, c);
      if (zugeteilt >= 100) { c.zugeteilt += zugeteilt; restBudget -= zugeteilt; }
    }
  }

  // ─── RUNDE 3: Grundversorgung ALLE → grundbedarf (21 Tage × Rate) ─────────────────────────
  // Jedes Produkt bekommt seinen Bestellintervall-Anteil. TOP → MID (60%-Cap) → REST.
  {
    let r3 = allCandidates
      .sort((a, b) => tierPrio(a) - tierPrio(b) || a.rang - b.rang);
    for (let c of r3) {
      if (restBudget <= 0) break;
      let target = midCapC(c, c.grundbedarf);
      let restBedarf = Math.min(c.bedarf, target) - c.zugeteilt;
      if (restBedarf <= 0) continue;
      let zugeteilt = Math.min(restBedarf, restBudget);
      zugeteilt = rundeC_(zugeteilt, c);
      if (zugeteilt >= 100) { c.zugeteilt += zugeteilt; restBudget -= zugeteilt; }
    }
  }

  // ─── RUNDE 4: TOP7 → Aufstocken bis Ziel (stock_at_84-basiert) ────────────────────────────
  // Benutze stock_at_84 statt rohem lager+unterwegs (Option B)
  {
    let r4 = allCandidates
      .filter(c => c.isTop)
      .sort((a, b) => a.rang - b.rang);
    for (let c of r4) {
      if (restBudget <= 0) break;
      const stockBase = (c.stock_at_84 != null) ? c.stock_at_84 : (c.lager + c.unterwegs);
      let bereits = stockBase + c.zugeteilt;
      if (bereits >= c.ziel) continue;
      let aufstockung = Math.min(c.ziel - bereits, c.bedarf - c.zugeteilt);
      aufstockung = rundeC_(aufstockung, c);
      aufstockung = Math.min(aufstockung, restBudget);
      if (aufstockung >= 100) { c.zugeteilt += aufstockung; restBudget -= aufstockung; }
    }
  }

  // ─── RUNDE 5: MID → Aufstocken bis Ziel (stock_at_84-basiert) ─────────────────────────────
  {
    let r5 = allCandidates
      .filter(c => c.isMid)
      .sort((a, b) => a.rang - b.rang);
    for (let c of r5) {
      if (restBudget <= 0) break;
      const stockBase = (c.stock_at_84 != null) ? c.stock_at_84 : (c.lager + c.unterwegs);
      let bereits = stockBase + c.zugeteilt;
      if (bereits >= c.ziel) continue;
      let aufstockung = Math.min(c.ziel - bereits, c.bedarf - c.zugeteilt);
      aufstockung = rundeC_(aufstockung, c);
      aufstockung = Math.min(aufstockung, restBudget);
      if (aufstockung >= 100) { c.zugeteilt += aufstockung; restBudget -= aufstockung; }
    }
  }

  // ─── RUNDE 6: REST → Restbedarf ────────────────────────────────────────────────────────────
  {
    let r6 = allCandidates
      .filter(c => !c.isTop && !c.isMid)
      .sort((a, b) => a.rang - b.rang);
    for (let c of r6) {
      if (restBudget <= 0) break;
      let restBedarf = c.bedarf - c.zugeteilt;
      if (restBedarf <= 0) continue;
      let zugeteilt = Math.min(restBedarf, restBudget);
      zugeteilt = rundeC_(zugeteilt, c);
      if (zugeteilt >= 100) { c.zugeteilt += zugeteilt; restBudget -= zugeteilt; }
    }
  }

  // ─── RUNDE 7: Breite Verteilung – Restbudget nach Coverage-Ratio ──────────────────────────
  // Sortiert nach niedrigster Coverage (stock_at_84 + zugeteilt / ziel).
  // Pro Pass: max grundbedarf extra. Bis zu 5 Durchläufe. Cap: 2× Ziel.
  {
    for (let pass = 0; pass < 5; pass++) {
      if (restBudget <= 0) break;
      let r7 = allCandidates.sort((a, b) => {
        const sA = (a.stock_at_84 != null ? a.stock_at_84 : (a.lager + a.unterwegs)) + a.zugeteilt;
        const sB = (b.stock_at_84 != null ? b.stock_at_84 : (b.lager + b.unterwegs)) + b.zugeteilt;
        const rA = sA / Math.max(1, a.ziel);
        const rB = sB / Math.max(1, b.ziel);
        if (Math.abs(rA - rB) > 0.01) return rA - rB;
        return tierPrio(a) - tierPrio(b) || (a.rang || 999) - (b.rang || 999);
      });
      let anyAdded = false;
      for (let c of r7) {
        if (restBudget <= 0) break;
        const stockBase = (c.stock_at_84 != null) ? c.stock_at_84 : (c.lager + c.unterwegs);
        if ((stockBase + c.zugeteilt) / Math.max(1, c.ziel) >= 2.0) continue;
        let extra = Math.max(100, rundeC_(c.grundbedarf, c));
        extra = Math.min(extra, restBudget, c.bedarf - c.zugeteilt);
        extra = rundeC_(extra, c);
        if (extra >= 100) { c.zugeteilt += extra; restBudget -= extra; anyAdded = true; }
      }
      if (!anyAdded) break;
    }
    if (restBudget > 0) Logger.log("💰 China Runde 7: Restbudget: " + (restBudget/1000).toFixed(1) + "kg");
  }

  // ─── HARTER BUDGET-CAP CHINA ───
  {
    let totalZ = allCandidates.reduce((s, c) => s + c.zugeteilt, 0);
    let über = totalZ - budgetG;
    if (über > 0) {
      Logger.log("⚠️ China Budget-Cap: " + (über/1000).toFixed(1) + "kg über Budget → kürze REST, dann MID");
      const restS = allCandidates.filter(c => !c.isTop && !c.isMid && c.zugeteilt > 0)
        .sort((a, b) => (b.rang || 999) - (a.rang || 999));
      for (let c of restS) {
        if (über <= 0) break;
        const min = 500;
        const kürzbar = c.zugeteilt - min;
        if (kürzbar <= 0) continue;
        const k = Math.min(kürzbar, über);
        const kR = Math.floor(k / 100) * 100;
        c.zugeteilt -= kR; über -= kR;
      }
      if (über > 0) {
        const midS = allCandidates.filter(c => c.isMid && c.zugeteilt > 0)
          .sort((a, b) => (b.rang || 999) - (a.rang || 999));
        for (let c of midS) {
          if (über <= 0) break;
          const min = 500;
          const kürzbar = c.zugeteilt - min;
          if (kürzbar <= 0) continue;
          const k = Math.min(kürzbar, über);
          const kR = Math.floor(k / 100) * 100;
          c.zugeteilt -= kR; über -= kR;
        }
      }
      restBudget = budgetG - allCandidates.reduce((s, c) => s + c.zugeteilt, 0);
    }
  }

  // Nur Kandidaten mit Zuteilung > 0, nach Typ+Länge gruppiert sortieren
  // Sortierung NOTFALL-Produkte zuerst innerhalb ihrer Gruppe
  let budgetCandidatesSorted_ = allCandidates
    .filter(c => c.zugeteilt > 0)
    .sort((a, b) => {
      let typOrder = ["Tapes", "Bondings", "Classic Weft", "Genius Weft"];
      let ai = typOrder.indexOf(a.typ), bi = typOrder.indexOf(b.typ);
      if (ai !== bi) return ai - bi;
      if (a.länge !== b.länge) return a.länge.localeCompare(b.länge);
      // NOTFALL zuerst, dann nach Rang
      if (a.notfall !== b.notfall) return a.notfall ? -1 : 1;
      return a.rang - b.rang;
    });

  let budgetItems = budgetCandidatesSorted_
    .map(c => [c.typ, c.länge, c.product, c.lager, c.unterwegs, c.ziel, c.zugeteilt]);

  // Gruppenstruktur: Typ nur in erster Zeile
  let lastTypBudget = null;
  let budgetRows = budgetItems.map(r => {
    let row = [...r];
    if (row[0] === lastTypBudget) row[0] = "";
    else lastTypBudget = row[0];
    return row;
  });

  // NOTFALL-Warnzeilen sammeln (Produkte mit unvermeidbarer Lücke)
  const notfallProdukte = allCandidates.filter(c => c.notfall && c.hat_lücke && c.lücken_dauer > 0);
  const notfallText = notfallProdukte.length > 0
    ? "🚨 NOTFALL (" + notfallProdukte.length + " Produkte): " +
      notfallProdukte.map(c => c.product.split(" ").slice(0,2).join(" ") + " (" + c.lücken_dauer + "T Lücke)").join(" · ")
    : null;

  // ─── BUDGET-LISTE oben schreiben ───
  let colCount = 7;
  let headerRow = ["Typ", "Länge", "Farbcode", "Lager (g)", "Unterwegs (g)", "Ziel (g)", "Bestellung (g)"];
  let budgetTitle = "CHINA (Usbekisch Wellig) – BUDGET-BESTELLUNG " + dateStr + "  |  Budget: " + (budgetG/1000).toFixed(1) + " kg  |  Verbraucht: " + ((budgetG - restBudget)/1000).toFixed(1) + " kg";
  let budgetTotalBedarf = budgetItems.reduce((s, r) => s + (typeof r[6] === "number" ? r[6] : 0), 0);
  let budgetSubtotal = Array(colCount).fill("");
  budgetSubtotal[0] = "Subtotal";
  budgetSubtotal[6] = budgetTotalBedarf;

  let budgetAllRows = [
    [budgetTitle, ...Array(colCount - 1).fill("")],
    ...(notfallText ? [[notfallText, ...Array(colCount - 1).fill("")]] : []),
    headerRow,
    ...budgetRows,
    budgetSubtotal
  ];

  sheet.getRange(1, 1, budgetAllRows.length, colCount).setValues(budgetAllRows);

  // Formatierung Budget-Titel
  sheet.getRange(1, 1, 1, colCount).merge()
    .setBackground("#1a73e8").setFontColor("#ffffff").setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center");
  // Header (Zeile 2 wenn kein NOTFALL, Zeile 3 wenn NOTFALL-Warnzeile vorhanden)
  const headerSheetRow = notfallText ? 3 : 2;
  sheet.getRange(headerSheetRow, 1, 1, colCount)
    .setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10)
    .setHorizontalAlignment("center");
  // ── Tier-Farbschema (konsistent mit Topseller-Tab) ──
  const B_TOP7  = "#fff9c4"; const B_TOP7B = "#fff3a0";
  const B_MID   = "#e3f2fd"; const B_MIDB  = "#bbdefb";
  const B_REST  = "#f1f8e9"; const B_RESTB = "#dcedc8";
  const BC_TOP7 = "#f9a825"; const BC_MID  = "#1565c0"; const BC_REST = "#558b2f";

  // NOTFALL-Warnzeile formatieren (falls vorhanden: Zeile 2)
  let dataRowOffset = notfallText ? 3 : 2; // Zeile ab der Datenzeilen beginnen (1-basiert: nach Titel [+Warnung] +Header)
  if (notfallText) {
    sheet.getRange(2, 1, 1, colCount).merge()
      .setBackground("#b71c1c").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10)
      .setHorizontalAlignment("center");
  }

  // Datenzeilen Budget-Liste
  // budgetCandidatesSorted_ bereits korrekt sortiert (mit NOTFALL zuerst)
  for (let i = dataRowOffset; i < budgetAllRows.length - 1; i++) {
    let r = budgetAllRows[i];
    let itemIdx = i - dataRowOffset;
    let cand = budgetCandidatesSorted_[itemIdx];
    let isTop7 = cand && cand.isTop;
    let isMid  = cand && cand.isMid;
    let isNotfall = cand && cand.notfall;
    let bg;
    if (isNotfall)  bg = (i % 2 === 0) ? "#ffcdd2" : "#ef9a9a"; // Rot für NOTFALL
    else if (isTop7) bg = (i % 2 === 0) ? B_TOP7  : B_TOP7B;
    else if (isMid)  bg = (i % 2 === 0) ? B_MID   : B_MIDB;
    else             bg = (i % 2 === 0) ? B_REST  : B_RESTB;
    sheet.getRange(i + 1, 1, 1, colCount).setBackground(bg).setFontSize(10);
    if (isTop7 || isNotfall) sheet.getRange(i + 1, 1, 1, colCount).setFontWeight("bold");
    let bedarf = r[6];
    if (typeof bedarf === "number" && bedarf > 0) {
      let bedarfBg = isTop7 ? BC_TOP7 : (isMid ? BC_MID : BC_REST);
      sheet.getRange(i + 1, 7).setBackground(bedarfBg)
        .setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
    }
    let lager = r[3];
    if (typeof lager === "number" && lager === 0)
      sheet.getRange(i + 1, 4).setBackground("#db4437").setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
  }
  // Subtotal Budget
  sheet.getRange(budgetAllRows.length, 1, 1, colCount)
    .setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold").setFontSize(11)
    .setHorizontalAlignment("center");
  sheet.getRange(budgetAllRows.length, 1).setHorizontalAlignment("left");

  // MID-Cap Hinweis China
  if (budgetKnappC) {
    sheet.getRange(budgetAllRows.length + 1, 9).setValue("⚠️ Budget knapp").setFontWeight("bold").setFontSize(9)
      .setBackground("#e65100").setFontColor("#ffffff").setHorizontalAlignment("center");
    sheet.getRange(budgetAllRows.length + 2, 9).setValue("MID auf 60% gedeckelt").setFontSize(8)
      .setFontColor("#e65100").setHorizontalAlignment("center");
  }

  // Hinweis wenn keine Topseller-Daten vorhanden
  if (!hasTopsellerdaten) {
    sheet.getRange(budgetAllRows.length + 1, 1, 1, colCount).merge()
      .setValue("⚠️ Keine Topseller-Daten vorhanden. Bitte refreshTopseller() ausführen für dynamische Ranglisten.")
      .setBackground("#fff3e0").setFontColor("#e65100").setFontWeight("bold").setFontSize(10)
      .setHorizontalAlignment("center");
  }

  // ─── TRENNZEILE ───
  let sepRow = budgetAllRows.length + (hasTopsellerdaten ? 2 : 3);
  sheet.getRange(sepRow, 1, 1, colCount).merge()
    .setValue("▼▼▼  VOLLSTÄNDIGE LISTE (alle Produkte mit Bedarf)  ▼▼▼")
    .setBackground("#455a64").setFontColor("#ffffff").setFontWeight("bold").setFontSize(11)
    .setHorizontalAlignment("center");

  // ─── KOMPLETTE LISTE darunter ───
  let fullStartRow = sepRow + 1;
  // rows enthält 9 Felder (inkl. tier) – auf 8 kürzen
  const rows8C = rows.map(r => r.slice(0, 8));
  writeBestellungSheetAt(
    sheet, fullStartRow,
    "CHINA (Usbekisch Wellig) – Bestellvorschlag " + dateStr + " (vollständig)",
    5, rows8C,
    "#1a73e8", "#1a73e8", "#4a90d9"
  );

  // Spaltenbreiten
  sheet.setColumnWidth(1, 160); sheet.setColumnWidth(2, 90); sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 90); sheet.setColumnWidth(5, 100); sheet.setColumnWidth(6, 90); sheet.setColumnWidth(7, 100); sheet.setColumnWidth(8, 120);

  // ─── BUDGET-EINGABEFELD (Spalte I, Zeile 1-5) ───
  sheet.getRange(1, 9).setValue("💰 Budget China").setFontWeight("bold").setFontSize(10)
    .setBackground("#1a73e8").setFontColor("#ffffff").setHorizontalAlignment("center");
  sheet.getRange(2, 9).setValue(budgetG).setFontSize(14).setFontWeight("bold")
    .setBackground("#e8f0fe").setFontColor("#1a73e8").setHorizontalAlignment("center")
    .setNumberFormat("#,##0");
  sheet.getRange(3, 9).setValue((budgetG/1000).toFixed(1) + " kg").setFontSize(10)
    .setFontColor("#1a73e8").setHorizontalAlignment("center");
  sheet.getRange(4, 9).setValue("↑ Wert ändern,").setFontSize(8)
    .setFontColor("#888888").setFontStyle("italic").setHorizontalAlignment("center");
  sheet.getRange(5, 9).setValue("dann Skript neu ausführen").setFontSize(8)
    .setFontColor("#888888").setFontStyle("italic").setHorizontalAlignment("center");
  sheet.setColumnWidth(9, 150);

  // ─── EMPFEHLUNGS-BOX (Spalte I, Zeile 7-12) ───
  // Empfohlenes Budget = 2-Wochen-Bedarf aller Collections (Bestellzyklus)
  {
    const rawVD = PropertiesService.getScriptProperties().getProperty("VERKAUFS_DATA");
    let empfehlung = 0;
    if (rawVD) {
      let vd;
      try { vd = JSON.parse(rawVD); } catch(e) { vd = {}; }
      // Nur China-Collections (Usbekisch Wellig, ohne Clip-ins/Ponytail)
      const chinaCollLabels = [
        "Tapes 45cm", "Tapes 55cm", "Tapes 65cm", "Tapes 85cm",
        "Bondings 65cm", "Bondings 85cm",
        "Classic Weft 65cm", "Classic Weft 85cm",
        "Genius Weft 65cm", "Genius Weft 85cm"
      ];
      for (const label of chinaCollLabels) {
        const entry = vd["Usbekisch Wellig|" + label];
        if (entry && (entry.avgG3M || entry.g30d)) {
          const basis = Math.round((entry.avgG3M || 0) * 0.5 + (entry.g30d || 0) * 0.5);
          empfehlung += basis * 0.5; // 2-Wochen-Bedarf: (50% Ø3M + 50% letzte 30 Tage) × 0,5
        }
      }
    }
    const empfG = Math.round(empfehlung / 1000); // in kg
    const abweichung = empfG > 0 ? Math.round((budgetG/1000 - empfG) / empfG * 100) : 0;
    const abweichColor = Math.abs(abweichung) <= 10 ? "#2e7d32" : (abweichung < 0 ? "#c62828" : "#e65100");

    sheet.getRange(7, 9).setValue("📊 Empfehlung China").setFontWeight("bold").setFontSize(10)
      .setBackground("#455a64").setFontColor("#ffffff").setHorizontalAlignment("center");
    sheet.getRange(8, 9).setValue(empfG > 0 ? empfG * 1000 : "–").setFontSize(14).setFontWeight("bold")
      .setBackground("#eceff1").setFontColor("#37474f").setHorizontalAlignment("center")
      .setNumberFormat("#,##0");
    sheet.getRange(9, 9).setValue(empfG > 0 ? empfG + " kg" : "Keine Daten").setFontSize(10)
      .setFontColor("#37474f").setHorizontalAlignment("center");
    sheet.getRange(10, 9).setValue("2-Wochen-Bedarf").setFontSize(8)
      .setFontColor("#888888").setFontStyle("italic").setHorizontalAlignment("center");
    sheet.getRange(11, 9).setValue("(50% Ø3M + 50% 30T) × 0,5").setFontSize(7)
      .setFontColor("#aaaaaa").setFontStyle("italic").setHorizontalAlignment("center");
    if (empfG > 0) {
      const diffText = (abweichung >= 0 ? "+" : "") + abweichung + "% vs. Budget";
      sheet.getRange(12, 9).setValue(diffText).setFontSize(8)
        .setFontColor(abweichColor).setFontWeight("bold").setHorizontalAlignment("center");
    }
  }

  // ── Farblegende (Spalte I, Zeile 14-19) ──
  sheet.getRange(14, 9).setValue("🎨 Farblegende").setFontWeight("bold").setFontSize(9)
    .setBackground("#eeeeee").setHorizontalAlignment("center");
  sheet.getRange(15, 9).setValue("⬛ TOP7 – Bestseller (Rang 1–7)").setFontSize(8)
    .setBackground("#fff9c4").setFontWeight("bold").setHorizontalAlignment("left");
  sheet.getRange(16, 9).setValue("⬛ MID – Mittelfeld (Rang 8–14)").setFontSize(8)
    .setBackground("#e3f2fd").setHorizontalAlignment("left");
  sheet.getRange(17, 9).setValue("⬛ REST – Sonstige (Rang 15+)").setFontSize(8)
    .setBackground("#f1f8e9").setHorizontalAlignment("left");
  sheet.getRange(18, 9).setValue("🔴 Lager = 0 (ausverkauft)").setFontSize(8)
    .setBackground("#fce4ec").setHorizontalAlignment("left");

  // Budget in Properties speichern (wird beim nächsten Ausführen gelesen)
  PropertiesService.getScriptProperties().setProperty("BUDGET_CHINA", String(budgetG));

  Logger.log("✅ Bestellung China erstellt. Budget-Liste: " + budgetItems.length + " Pos., Vollständig: " + rows.length + " Pos.");
}


// ==========================================
// BESTELLVORSCHLAG AMANDA (dynamisch)
// ==========================================

function createBestellungAmanda() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = "Vorschlag - Amanda";
  const isAutoRun = PropertiesService.getScriptProperties().getProperty("AUTO_BUDGET") === "true";
  let sheet = ss.getSheetByName(tabName);
  // Bei manuellem Aufruf: Budget aus Zelle J2 lesen BEVOR der Tab gelöscht wird
  if (sheet && !isAutoRun) {
    const cellVal = sheet.getRange(2, 10).getValue();
    if (cellVal && parseInt(cellVal) > 0) {
      PropertiesService.getScriptProperties().setProperty("BUDGET_AMANDA", String(parseInt(cellVal)));
    }
  }
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(tabName);
  sheet.setTabColor("#0f9d58");

  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "dd.MM.yyyy, HH:mm");
  const CODE_VERSION = "v5.0 – Breite vor Tiefe | " + dateStr + " Uhr";

  // Alle Inventar-Zeilen aus "Russisch - GLATT" Sheet lesen
  const invRows = readInventoryRowsFromSheet("Russisch - GLATT");
  // Clip-Ins kommen aus "Russisch - GLATT" Sheet, Ponytails aus "Usbekisch - WELLIG"
  const invGlattRows = readInventoryRowsFromSheet("Russisch - GLATT");  // für Clip-Ins (alle Varianten)
  const invWellig = readInventoryFromSheet("Usbekisch - WELLIG");  // für Ponytails

  // Aktive Bestellungen laden
  const allOrders = getAllOrders();

  // ─── TOPSELLER-DATEN: Dynamisch aus refreshTopseller() oder Fallback ───
  const hasTopsellerdatenA = !!(PropertiesService.getScriptProperties().getProperty("TOPSELLER_DATA_COUNT"));
  // TOPSELLER_DATA einmal laden (Performance: kein wiederholter PropertiesService-Aufruf in Schleifen)
  const tsDataA = hasTopsellerdatenA ? loadChunked_(PropertiesService.getScriptProperties(), "TOPSELLER_DATA") : null;

  // ─── PER-PRODUCT VELOCITY LOOKUP (aus VA_PRODUCT_DATA) ───
  // Ermöglicht produktspezifische Tagesrate statt Collection-Durchschnitt
  const vaVelocityLookup = {}; // key: "handle|#FARBE" → { g30d, g60d_alt, g90d }
  try {
    const vaDataA = loadChunked_(PropertiesService.getScriptProperties(), "VA_PRODUCT_DATA");
    if (vaDataA) {
      for (const vaKey in vaDataA) {
        const vp = vaDataA[vaKey];
        if (!vp.handle) continue;
        const farbe = extractFullColor_(vp.name || "");
        if (!farbe) continue;
        const lookupKey = vp.handle + "|" + farbe;
        // Höchste Velocity behalten (falls mehrere Einträge für gleiche Farbe)
        if (!vaVelocityLookup[lookupKey] || (vp.g30d || 0) > vaVelocityLookup[lookupKey].g30d) {
          vaVelocityLookup[lookupKey] = {
            g30d: vp.g30d || 0,
            g60d_alt: vp.g60d_alt || 0,
            g90d: vp.g90d || 0
          };
        }
      }
      Logger.log("✅ VA-Velocity-Lookup: " + Object.keys(vaVelocityLookup).length + " Einträge");
    }
  } catch(eVAvel) { Logger.log("⚠️ VA-Velocity-Lookup fehlgeschlagen: " + eVAvel.message); }

  // Method → Shopify Handle Mapping (für VA-Velocity-Lookup)
  const METHOD_TO_HANDLE_A = {
    "Standard Tapes": "russische-normal-tapes",
    "Minitapes": "mini-tapes",
    "Bondings": "bondings-glatt",
    "Classic Weft": "tressen-russisch-classic",
    "Genius Weft": "tressen-russisch-genius",
    "Invisible Weft": "tressen-russisch-invisible"
  };

  // Tier für Amanda-Produkt bestimmen (dynamisch oder Fallback)
  function getTierAmanda(colorOneWord, method, isInvisible) {
    // Alle Methoden bekommen echten Tier aus Topseller-Daten (inkl. Invisible Weft)
    // Invisible Weft ist keine Prio-Kategorie, aber Top-Seller dort sollen trotzdem als TOP7/MID erkannt werden
    if (hasTopsellerdatenA && tsDataA) {
      return getTopsellertierTS_cached_(tsDataA, "Russisch Glatt", method, colorOneWord);
    }
    return "REST"; // Fallback
  }

  // Kollektion -> Method + collName Mapping für Amanda
  const collMappingAmanda = [
    { keyword: "STANDARD TAPES",  method: "Standard Tapes", collKeyword: "STANDARD TAPES", collName: "Standard Tapes Russisch",             isInvisible: false },
    { keyword: "MINI TAPES",      method: "Minitapes",      collKeyword: "MINI TAPES",      collName: "Mini Tapes Glatt",                   isInvisible: false },
    { keyword: "BONDING",         method: "Bondings",       collKeyword: "BONDING",         collName: "Russische Bondings (Glatt)",          isInvisible: false },
    { keyword: "CLASSIC TRESSEN", method: "Classic Weft",   collKeyword: "CLASSIC",         collName: "Russische Classic Tressen (Glatt)",   isInvisible: false },
    { keyword: "GENIUS TRESSEN",  method: "Genius Weft",    collKeyword: "GENIUS",          collName: "Russische Genius Tressen (Glatt)",    isInvisible: false },
    { keyword: "INVISIBLE TRESSEN",method: "Invisible Weft",collKeyword: "INVISIBLE",       collName: "Russische Invisible Tressen (Glatt) | Butterfly Weft", isInvisible: true  },
  ];

  // ─── TIER-COUNTS vorberechnen (für proportionale Zielmengen) ───
  const tierCountsCacheA = {}; // key: collName -> { TOP7, MID, REST }
  for (let m of collMappingAmanda) {
    if (tierCountsCacheA[m.collName]) continue;
    tierCountsCacheA[m.collName] = countTiersForCollection_(
      invRows, "Russisch Glatt", m.collName, m.method,
      (c, meth) => getTierAmanda(c, meth, false),
      (p) => { const h = p.indexOf("#"); return h >= 0 ? p.substring(h).split(" ")[0] : null; },
      m.keyword
    );
  }

  // ─── BEDARFSBERECHNUNG: über alle Inventar-Zeilen iterieren ───
  let rows = [];
  let rowsByGroup = {};
  let groupOrder = [];

  for (let invRow of invRows) {
    let cUpper = invRow.collection.toUpperCase();

    // Kollektion matchen
    let mapping = null;
    for (let m of collMappingAmanda) {
      if (cUpper.includes(m.keyword)) { mapping = m; break; }
    }
    if (!mapping) continue;

    let lager = invRow.totalWeight;
    let produktUpper = invRow.productUpper;

    // Farbcode extrahieren (vollständiger Farbname bis Stopword)
    let firstHash = produktUpper.indexOf("#");
    if (firstHash < 0) continue;
    let colorRaw = produktUpper.substring(firstHash);
    let colorOneWord = extractFullColor_(produktUpper) || colorRaw.split(" ")[0];

    // Tier bestimmen (dynamisch)
    let tier = getTierAmanda(colorOneWord, mapping.method, mapping.isInvisible);
    // KAUM-Logik: < 150g Lager gilt als "unverkäuflich" (Kunden kaufen min. ~150g)
    // → 30d-Verkauf = 0 weil niemand so wenig kaufen kann, nicht weil kein Interesse
    // → Historische Daten (g60d_alt) prüfen ob das Produkt früher verkauft wurde
    const MIN_VERKAUFSMENGE = 150; // g — unter dieser Menge kauft niemand (außer Clip-ins)
    const istUnverkaeuflich = (lager > 0 && lager < MIN_VERKAUFSMENGE && mapping.method !== "Clip-ins");
    if (tier === "KAUM" && !istUnverkaeuflich && lager > 0) continue; // Genug Lager + keine Verkäufe → wirklich langsam
    // KAUM + lager=0 oder < 150g → Nachbestellen

    // Bei KAUM + unverkäuflich: Historische Daten prüfen → wenn früher verkauft, als REST behandeln
    if (tier === "KAUM" && istUnverkaeuflich) {
      const handleUV = METHOD_TO_HANDLE_A[mapping.method] || "";
      const vaUV = handleUV ? vaVelocityLookup[handleUV + "|" + colorOneWord.toUpperCase()] : null;
      if (vaUV && (vaUV.g60d_alt > 0 || vaUV.g90d > 0)) {
        tier = "REST"; // Früher verkauft → nicht tot, nur unverkäuflicher Restbestand
        Logger.log("🔄 KAUM→REST: " + invRow.product + " | Lager=" + lager + "g < " + MIN_VERKAUFSMENGE + "g (unverkäuflich) | g60d_alt=" + (vaUV.g60d_alt||0));
      }
    }

    // Ziel: verkaufsbasiert oder Fallback
    // Alle Methoden (inkl. Invisible Weft) bekommen echte verkaufsbasierte Ziele
    let ziel;
    if (tier === "KAUM") {
      ziel = 300; // Ausverkauft/unverkäuflich – Mindestbestellung
    } else {
      let tierCounts = tierCountsCacheA[mapping.collName] || { TOP7: 1, MID: 1, REST: 1 };
      ziel = getVerkaufsZielGrams_("Russisch Glatt", mapping.collName, tier, tierCounts, 6, colorOneWord, lager); // Amanda: 6 Wochen
    }
    if (ziel === 0) continue; // Nicht bestellen
    // Echten Rang aus Topseller-Daten laden (statt pauschaler Platzhalter 1/8/15)
    const rangReal = getRangTS_cached_(tsDataA, "Russisch Glatt", mapping.method, colorOneWord, null);
    let rang = (rangReal === 999) ? ((tier === "TOP7") ? 1 : (tier === "MID") ? 8 : 15) : rangReal;
    // Rang-basiertes Mindestziel für Standard Tapes:
    // - Echter Rang bekannt (rangReal < 999): exakte Rang-Schwelle verwenden
    // - Kein Rang gefunden (999) aber Tier = TOP7: trotzdem Mindestziel setzen
    //   (verhindert, dass ausverkaufte Topseller durch niedrige 30d-Velocity benachteiligt werden)
    // MID ohne Rang bekommt keinen Override – Tier allein reicht nicht als Beweis für TOP10-Rang
    // Rang-Mindestziele: NUR noch als Fallback wenn keine Produktdaten vorhanden.
    // Wenn VA_PRODUCT_DATA vorhanden: Ausverkauf-Erkennung in getVerkaufsZielGrams_ liefert das korrekte Ziel.
    if (mapping.method === "Standard Tapes") {
      Logger.log("[Rang-Debug] " + colorOneWord + ": rangReal=" + rangReal + " tier=" + tier + " ziel_vor=" + ziel);
      const hasProdDataA = !!(PropertiesService.getScriptProperties().getProperty("VA_PRODUCT_DATA_COUNT") ||
                              PropertiesService.getScriptProperties().getProperty("VA_PRODUCT_DATA_0"));
      if (!hasProdDataA) {
        if (rangReal < 999) {
          if (rangReal <= 10)      ziel = Math.max(ziel, RANG_MINZIEL_TOP10);
          else if (rangReal <= 20) ziel = Math.max(ziel, RANG_MINZIEL_TOP20);
        } else if (tier === "TOP7") {
          ziel = Math.max(ziel, RANG_MINZIEL_TOP10);
        }
      }
      Logger.log("[Rang-Debug] " + colorOneWord + ": ziel_nach=" + ziel);
    }
    let unterwegs = getUnterwegsForProduct(allOrders, "Amanda", colorOneWord, mapping.collName, "60cm", null);
    if (unterwegs === 0 && colorRaw.split(" ").length > 1) {
      let twoWord = colorRaw.split(" ")[0] + " " + colorRaw.split(" ")[1];
      unterwegs = getUnterwegsForProduct(allOrders, "Amanda", twoWord, mapping.collName, "60cm", null);
    }
    let verfügbar = lager + unterwegs;
    let bedarf = Math.max(0, ziel - verfügbar);

    let stockAt42A2 = null; // Option B: Simulierter Lagerbestand bei Ankunft der neuen Bestellung (Tag 42)
    let tagesVerkaufA2 = 0; // Tagesrate für grundbedarf-Berechnung (wird im Velocity-Check gesetzt)

    // ─── VELOCITY-CHECK: Pro Bestellung mit echtem Ankunftsdatum (Amanda) ────────────────────────
    // Für jede unterwegs-Bestellung: Ankunft = Bestelldatum + 42 Tage (6 Wochen Amanda)
    {
      const rawVDA2 = PropertiesService.getScriptProperties().getProperty("VERKAUFS_DATA");
      if (rawVDA2) {
        try {
          const vdA2 = JSON.parse(rawVDA2);
          // collMappingAmanda.collName (z.B. "Standard Tapes Russisch") → VERKAUFS_DATA-Label (z.B. "Standard Tapes")
          const VD_KEY_MAP_A = {
            "Standard Tapes Russisch": "Standard Tapes",
            "Mini Tapes Glatt": "Minitapes",
            "Russische Bondings (Glatt)": "Bondings",
            "Russische Classic Tressen (Glatt)": "Classic Weft",
            "Russische Genius Tressen (Glatt)": "Genius Weft",
            "Russische Invisible Tressen (Glatt) | Butterfly Weft": "Invisible Weft",
            "Russische Invisible Tressen (Glatt)": "Invisible Weft"  // alter Name
          };
          const vdKeyA2 = "Russisch Glatt|" + (VD_KEY_MAP_A[mapping.collName] || mapping.collName);
          const vdEntryA2 = vdA2[vdKeyA2];
          if (vdEntryA2 && vdEntryA2.g30d) {
            // ── Per-Product Velocity (bevorzugt) oder Collection-Durchschnitt (Fallback) ──
            const handleA2 = METHOD_TO_HANDLE_A[mapping.method] || "";
            const vaVelEntry = handleA2 ? vaVelocityLookup[handleA2 + "|" + colorOneWord.toUpperCase()] : null;

            // tagesVerkaufA2 ist oben deklariert (= 0), hier wird sie befüllt
            if (vaVelEntry && (vaVelEntry.g30d > 0 || vaVelEntry.g60d_alt > 0)) {
              // Per-product Daten vorhanden → Ausverkauf-korrigierte Rate verwenden
              const rateNeuA2 = vaVelEntry.g30d / 30;
              const rateAltA2 = (vaVelEntry.g60d_alt || 0) / 60;
              // Ausverkauf-Erkennung: wenn alte Rate deutlich höher → Ausverkauf, alte Rate verwenden
              if (rateAltA2 > 0.5 && rateNeuA2 < rateAltA2 * 0.6) {
                tagesVerkaufA2 = rateAltA2; // Historische Rate (vor Ausverkauf)
              } else {
                tagesVerkaufA2 = Math.max(rateNeuA2, rateAltA2 * 0.3); // Aktuelle Rate, min. 30% der alten
              }
              Logger.log("📊 Velocity per-product: " + colorOneWord + " " + mapping.method +
                " | g30d=" + vaVelEntry.g30d + " g60d_alt=" + (vaVelEntry.g60d_alt||0) +
                " → " + (tagesVerkaufA2*30).toFixed(0) + "g/30T");
            } else {
              // Fallback: Collection-Durchschnitt / Tier-Gewicht
              const tcA2 = tierCountsCacheA[mapping.collName] || { TOP7: 1, MID: 1, REST: 1 };
              const TIER_WA2 = { "TOP7": 7, "MID": 4, "REST": 1 };
              const totalAA2 = (tcA2.TOP7||0)*7 + (tcA2.MID||0)*4 + (tcA2.REST||0)*1 || 1;
              const anteilFaktorA2 = (TIER_WA2[tier] || 1) / totalAA2;
              const g30dProduktA2 = vdEntryA2.g30d * anteilFaktorA2;
              tagesVerkaufA2 = g30dProduktA2 / 30;
              Logger.log("📊 Velocity fallback (Collection-Ø): " + colorOneWord + " " + mapping.method +
                " | anteil=" + (anteilFaktorA2*100).toFixed(1) + "% → " + (tagesVerkaufA2*30).toFixed(0) + "g/30T");
            }
            const heuteA2 = new Date();
            let lastTagesBisAnkunftA2 = 0; // Option B: Tage bis zur letzten bekannten Lieferung
            // Unterwegs-Details pro Bestellung laden
            const unterwegsDetailsA2 = getUnterwegsDetailForProduct(allOrders, "Amanda", colorRaw.split(" ")[0], mapping.collName, "60cm", null);
            unterwegsDetailsA2.sort((a, b) => parseDateDE(a.date) - parseDateDE(b.date));
            let lagerSimuliertA2 = lager;
            let bedarfVelocityA2 = bedarf;
            for (const detail of unterwegsDetailsA2) {
              const bestellDatumA2 = parseDateDE(detail.date);
              const ankunftDatumA2 = new Date(bestellDatumA2.getTime() + 42 * 24 * 60 * 60 * 1000); // +42 Tage
              const tagesBisAnkunftA2 = Math.max(0, Math.round((ankunftDatumA2 - heuteA2) / (24 * 60 * 60 * 1000)));
              const verbrauchBisAnkunftA2 = Math.round(tagesVerkaufA2 * tagesBisAnkunftA2);
              lagerSimuliertA2 = Math.max(0, lagerSimuliertA2 - verbrauchBisAnkunftA2);
              const verfügbarBeiAnkunftA2 = lagerSimuliertA2 + detail.menge;
              const bedarfNachAnkunftA2 = Math.max(0, ziel - verfügbarBeiAnkunftA2);
              if (bedarfNachAnkunftA2 > bedarfVelocityA2) {
                bedarfVelocityA2 = bedarfNachAnkunftA2;
              }
              // ── VORAUSBLICK: Reicht das Lager nach Ankunft bis zur nächsten Bestellung? ──
              // Nächste Bestellung kommt frühestens in (tagesBisAnkunftA2 + 42) Tagen an
              // (= aktuelle Lieferung kommt an, dann sofort neu bestellen, +42 Tage Lieferzeit)
              const tagesBisNächsteAnkunftA2 = tagesBisAnkunftA2 + 42;
              const verbrauchBisNächsteA2 = Math.round(tagesVerkaufA2 * tagesBisNächsteAnkunftA2);
              const lagerBeiNächsterAnkunftA2 = Math.max(0, verfügbarBeiAnkunftA2 - verbrauchBisNächsteA2);
              const minLagerA2 = Math.round(tagesVerkaufA2 * 14); // 2 Wochen Mindestpuffer
              if (lagerBeiNächsterAnkunftA2 < minLagerA2) {
                // Lager würde unter 2-Wochen-Puffer fallen → jetzt schon nachbestellen
                const fehlmengeA2 = Math.max(0, minLagerA2 - lagerBeiNächsterAnkunftA2);
                if (fehlmengeA2 > bedarfVelocityA2) {
                  bedarfVelocityA2 = fehlmengeA2;
                  Logger.log("⚡ Vorausblick Amanda: " + invRow.product +
                    " | Lager nach Ankunft+6W=" + lagerBeiNächsterAnkunftA2 + "g < Puffer=" + minLagerA2 + "g → Fehlmenge=" + fehlmengeA2 + "g");
                }
              }
              Logger.log("⚡ Velocity Amanda: " + invRow.product +
                " | Bestellung:" + detail.date + " | Ankunft in ~" + tagesBisAnkunftA2 + "T" +
                " | LagerBeiAnkunft:" + lagerSimuliertA2 + "g | +Lieferung:" + detail.menge + "g" +
                " | Verfügbar:" + verfügbarBeiAnkunftA2 + "g | Bedarf:" + bedarfNachAnkunftA2 + "g");
              lagerSimuliertA2 = verfügbarBeiAnkunftA2;
              lastTagesBisAnkunftA2 = tagesBisAnkunftA2; // Option B: merke Ankunftstag der letzten Lieferung
            }
            if (unterwegsDetailsA2.length === 0) {
              // Nichts unterwegs. Frage: Reicht das Lager bis diese Bestellung ankommt (42 Tage)?
              const verbrauchBisAnkunftA2 = Math.round(tagesVerkaufA2 * 42);
              const lagerBeiAnkunftA2 = Math.max(0, lager - verbrauchBisAnkunftA2);
              bedarfVelocityA2 = Math.max(bedarfVelocityA2, Math.max(0, ziel - lagerBeiAnkunftA2));
            }
            if (bedarfVelocityA2 > bedarf) {
              bedarf = bedarfVelocityA2;
            }
            // ── Option B: Lager bei Ankunft der NEUEN Bestellung (Tag 42 ab heute) ──────────────
            // lagerSimuliertA2 = Bestand nach letzter bekannter Lieferung
            // lastTagesBisAnkunftA2 = Tage bis diese letzte Lieferung ankommt (0 wenn keine unterwegs)
            // Neue Bestellung kommt in 42 Tagen an → verbrauche bis dahin weiter
            {
              const daysToNew42 = Math.max(0, 42 - lastTagesBisAnkunftA2);
              stockAt42A2 = Math.max(0, lagerSimuliertA2 - Math.round(tagesVerkaufA2 * daysToNew42));
              Logger.log("📦 Option B stock_at_42 " + invRow.product + ": lagerSim=" + lagerSimuliertA2 +
                "g lastArrival=T+" + lastTagesBisAnkunftA2 + " daysToNew=" + daysToNew42 +
                " → stock_at_42=" + stockAt42A2 + "g (vs. raw unterwegs=" + unterwegs + "g)");
            }
          }
        } catch(eA2) { Logger.log("Velocity-Check Amanda Fehler: " + eA2.message); }
      }
    }
    // ──────────────────────────────────────────────────────────────────────────────────────────

    // Produkt aufnehmen wenn:
    // 1. bedarf > 0 (normaler Fall: ziel > verfügbar), ODER
    // 2. stock_at_42 ≤ 0 (wird vor Ankunft ausverkauft, auch wenn viel unterwegs)
    //    → grundbedarf (21 Tage) als Bedarf setzen, damit bei nächster Bestellung Nachschub kommt
    if (bedarf <= 0) {
      if (stockAt42A2 != null && stockAt42A2 <= 0 && tagesVerkaufA2 > 0) {
        // stock_at_arrival sagt: Produkt wird leer sein → grundbedarf als Minimum
        bedarf = Math.max(100, Math.ceil(tagesVerkaufA2 * 21 / 100) * 100);
        Logger.log("🔄 Bedarf erzwungen für " + invRow.product + ": stock_at_42=" + stockAt42A2 + " → grundbedarf=" + bedarf + "g");
      } else {
        continue;
      }
    }

    let groupKey = mapping.method;
    if (!rowsByGroup[groupKey]) {
      rowsByGroup[groupKey] = [];
      groupOrder.push({ key: groupKey, quality: "Russian Straight hair", method: mapping.method });
    }
    rowsByGroup[groupKey].push({ rang, tier, lager, unterwegs, ziel, bedarf, product: invRow.product, stock_at_42: stockAt42A2, tagesrate: tagesVerkaufA2 || 0 });
  }

  // Zeilen zusammenbauen (nach Rang sortiert) – Quality + Method IMMER gesetzt (für Budget-Sortierung)
  for (let g of groupOrder) {
    let gruppenRows = rowsByGroup[g.key];
    gruppenRows.sort((a, b) => a.rang - b.rang || a.lager - b.lager);
    for (let r of gruppenRows) {
      rows.push([
        g.quality,      // [0] immer gesetzt
        g.method,       // [1] immer gesetzt
        "60cm",         // [2]
        r.product,      // [3]
        r.lager,        // [4]
        r.unterwegs,    // [5]
        r.ziel,         // [6]
        r.bedarf,       // [7]
        r.tier,         // [8] "TOP7" | "MID" | "REST"
        r.rang,         // [9] echter Rang (1, 2, 3...)
        r.stock_at_42 != null ? r.stock_at_42 : null,  // [10] Option B: Lager bei Ankunft neue Bestellung
        r.tagesrate || 0  // [11] tagesrate (g/Tag) für grundbedarf-Berechnung
      ]);
    }
  }

   // ─── CLIP-INS: Dynamisch aus Lager-Sheet lesen (Usbekisch-WELLIG, Collection "Clip In Extensions Echthaar") ───
  // Alle einzigartigen Clip-In Produkte + Varianten direkt aus dem Sheet ermitteln
  {
    // Sammle alle Clip-In Zeilen aus Russisch - GLATT
    let clipInMap = {}; // key: "PRODUKTNAME|VARIANTE" → { productName, variant, lagerG }
    for (let row of invGlattRows) {
      let collUpper = row.collection.toUpperCase();
      if (!collUpper.includes("CLIP IN") && !collUpper.includes("CLIP-IN")) continue;
      let variant = row.unitWeight || 0; // Gewicht pro Stück (100, 150, 225)
      if (variant <= 0) continue;
      let key = row.product + "|" + variant;
      if (!clipInMap[key]) {
        clipInMap[key] = { productName: row.product, variant: variant, lagerG: row.totalWeight };
      }
    }
    // Ziel je Variante
    function clipZiel(variant) {
      if (variant <= 100) return 400;  // 4 Stück à 100g
      if (variant <= 150) return 450;  // 3 Stück à 150g
      return 450;                       // 2 Stück à 225g
    }
    // Mindestbestellmenge: Lager=0+MID/TOP7→500g, Lager=0+REST→300g, Lager>0→200g
    function clipMin(variant, lager, tier) {
      let basis;
      if (lager === 0) {
        basis = (tier === "TOP7" || tier === "MID") ? 500 : 300;
      } else {
        basis = 200;
      }
      return Math.ceil(basis / variant) * variant;
    }
    for (let key in clipInMap) {
      let ci = clipInMap[key];
      let lager = ci.lagerG;
      let unterwegs = getUnterwegsForProduct(allOrders, "Amanda", ci.productName, "Clip In Extensions Echthaar", null, ci.variant);
      // Tier aus Topseller-Daten lesen (pro Variante)
      let colorOneWordClip = ci.productName.indexOf("#") >= 0 ? ci.productName.substring(ci.productName.indexOf("#")).split(" ")[0] : ci.productName.split(" ")[0];
      let tierClip = (hasTopsellerdatenA && tsDataA)
        ? getTopsellertierTS_cached_(tsDataA, "Russisch Glatt", "Clip-ins", colorOneWordClip, ci.variant)
        : "REST";
      if (tierClip === "KAUM" && lager > 0) {
        // 100g Clip-Ins: immer min. 300g sicherstellen – auch bei KAUM
        // Nur überspringen wenn bereits genug Lager vorhanden
        if (ci.variant > 100 || lager >= 300) continue;
        // 100g KAUM mit lager < 300g → auf 300g auffüllen
      }
      // KAUM + lager===0 → ausverkaufte Clip-In Variante → minimal bestellen
      // Echter Rang aus Topseller-Daten
      let rangClipFarbe = ci.productName.indexOf("#") >= 0 ? ci.productName.substring(ci.productName.indexOf("#")).split(" ")[0] : ci.productName.split(" ")[0];
      let rangClip = (hasTopsellerdatenA && tsDataA) ? getRangTS_cached_(tsDataA, "Russisch Glatt", "Clip-ins", rangClipFarbe, ci.variant) : 999;
      // Ausverkauf-Erkennung für Clip-Ins: VA_PRODUCT_DATA prüfen
      let clipAusverkauf = false;
      if (lager === 0) {
        try {
          const vaClipData = loadChunked_(PropertiesService.getScriptProperties(), "VA_PRODUCT_DATA");
          if (vaClipData) {
            for (const vaKey in vaClipData) {
              const vp = vaClipData[vaKey];
              if (vp.handle !== "clip-extensions") continue;
              if (vp.clipVariant !== ci.variant) continue;
              const nameUp = (vp.name || "").toUpperCase();
              const colorUp = colorOneWordClip.toUpperCase();
              // Wortgrenze-Check: gleiche Logik wie in getVerkaufsZielGrams_
              const idxClip = nameUp.indexOf(colorUp);
              if (idxClip === -1) continue;
              const charAfterClip = nameUp[idxClip + colorUp.length];
              const isWordBoundaryClip = (charAfterClip === undefined || charAfterClip === ' ' || charAfterClip === '-' || charAfterClip === '_');
              if (!isWordBoundaryClip) continue;
              // g60d_alt: NUR echtes Feld verwenden (kein g90d-g30d Fallback)
              const g60dAltClip = vp.g60d_alt || 0;
              const rateAlt = g60dAltClip / 60;
              const rateNeu = (vp.g30d || 0) / 30;
              if (rateAlt > 0.5 && rateNeu < rateAlt * 0.4) {
                clipAusverkauf = true;
                Logger.log("[Ausverkauf Clip-In] " + colorOneWordClip + " " + ci.variant + "g: " +
                  "Rate_alt=" + rateAlt.toFixed(2) + "g/Tag, Rate_neu=" + rateNeu.toFixed(2) + "g/Tag → Ziel erhöht");
              }
              break;
            }
          }
        } catch(eClip) { /* ignorieren */ }
      }
      // Ziel: rang-basiert für 100g, sonst bisherig; bei Ausverkauf +50% Aufschlag
      let ziel;
      if (ci.variant <= 100) {
        // 100g Clip-Ins: mindestens 300g (= 3 Stück) für jedes Produkt
        const MIN_100G_CLIP = 300;
        if (rangClip <= 10)            ziel = 600;  // Rang 1-10: 6 Stück
        else if (rangClip <= 20)       ziel = 400;  // Rang 11-20: 4 Stück
        else if (tierClip === "TOP7")  ziel = 400;
        else if (tierClip === "MID")   ziel = 300;
        else if (tierClip === "KAUM")  ziel = MIN_100G_CLIP; // KAUM: Minimalabdeckung 300g
        else                           ziel = 200; // REST: 200g (2 Stück)
      } else if (ci.variant <= 150) {
        ziel = tierClip === "TOP7" ? 450 : (tierClip === "MID" ? 300 : clipZiel(ci.variant));
      } else {
        ziel = tierClip === "TOP7" ? 450 : (tierClip === "MID" ? 225 : clipZiel(ci.variant));
      }
      // Ausverkauf-Aufschlag: Ziel um 50% erhöhen (auf 25g gerundet)
      if (clipAusverkauf) {
        ziel = Math.round(ziel * 1.5 / 25) * 25;
      }
      let verfügbar = lager + unterwegs;
      let bedarf = Math.max(0, ziel - verfügbar);
      if (bedarf <= 0) continue;
      // Bedarf auf Vielfaches der Einheitsgröße runden
      bedarf = Math.ceil(bedarf / ci.variant) * ci.variant;
      let minClip = clipMin(ci.variant, lager, tierClip);
      if (bedarf < minClip) bedarf = minClip;
      rows.push([
        "Russian Straight hair",
        "Clip-ins",
        ci.variant + "g",
        ci.productName,  // echter Produktname aus dem Lager-Sheet
        lager,
        unterwegs,
        ziel,
        bedarf,
        tierClip,         // [8] tier für Budget-Priorisierung
        rangClip           // [9] echter Rang aus Topseller-Daten
      ]);
    }
  }

  // ─── PONYTAIL ───
  const ponytailFarben = ["#PEARL WHITE", "#1A", "#NATURAL", "#2E", "#2A", "#SILVER"];
  for (let color of ponytailFarben) {
    let lager = findInventoryForProduct(invWellig, color, "PONYTAIL", "");
    let unterwegs = getUnterwegsForProduct(allOrders, "Amanda", color, "Ponytail Extensions kaufen", null, null);
    let verfügbar = lager + unterwegs;
    let bedarf = Math.max(0, 260 - verfügbar);
    if (bedarf <= 0) continue;

    rows.push([
      "Russian Straight hair",  // immer gesetzt
      "Ponytail",               // immer gesetzt
      "one size",
      color,
      lager,
      unterwegs,
      260,
      bedarf
    ]);
  }

  if (rows.length === 0) {
    sheet.getRange(1, 1).setValue("✅ Kein Bestellbedarf für Amanda – alle Produkte ausreichend bevorratet.");
    sheet.getRange(1, 1).setFontSize(12).setFontWeight("bold").setFontColor("#0f9d58");
    Logger.log("✅ Bestellung Amanda: kein Bedarf.");
    return;
  }

  // ─── BUDGET: Empfehlung berechnen (2-Wochen-Bedarf) und als Default nutzen ───
  let empfBudgetAmanda = 0;
  {
    const rawVDbudgetA = PropertiesService.getScriptProperties().getProperty("VERKAUFS_DATA");
    if (rawVDbudgetA) {
      try {
        const vdBA = JSON.parse(rawVDbudgetA);
        const amandaLabels = ["Standard Tapes","Minitapes","Bondings",
          "Classic Weft","Genius Weft","Invisible Weft","Clip-ins"];
        for (const label of amandaLabels) {
          const e = vdBA["Russisch Glatt|" + label];
          if (e && (e.avgG3M || e.g30d)) {
            empfBudgetAmanda += Math.round((e.avgG3M || 0) * 0.5 + (e.g30d || 0) * 0.5) * 0.5;
          }
        }
      } catch(ex) {}
    }
    empfBudgetAmanda = Math.round(empfBudgetAmanda / 1000) * 1000;
  }
  // Budget: Auto-Trigger → Empfehlung | Manuell → Zellenwert/Property → Empfehlung → 20kg
  let budgetGA;
  if (isAutoRun) {
    budgetGA = empfBudgetAmanda > 0 ? empfBudgetAmanda : 20000;
    Logger.log("🤖 Auto-Budget Amanda: " + (budgetGA/1000).toFixed(1) + " kg (Empfehlung)");
  } else {
    let budgetPropA = PropertiesService.getScriptProperties().getProperty("BUDGET_AMANDA");
    budgetGA = (budgetPropA && parseInt(budgetPropA) > 0) ? parseInt(budgetPropA)
      : (empfBudgetAmanda > 0 ? empfBudgetAmanda : 20000);
    Logger.log("👤 Manuelles Budget Amanda: " + (budgetGA/1000).toFixed(1) + " kg");
  }

  // ─── BUDGET-LISTE berechnen (3-Runden-Strategie) ───
  // rows hat: [quality, method, länge, product, lager, unterwegs, ziel, bedarf, tier]
  // Amanda absolute Mindestmengen (unabhängig von Ziel/Premium-Regeln):
  //   Lager = 0 + MID/TOP7 → 500g
  //   Lager = 0 + REST      → 300g
  //   Lager > 0             → 200g
  function mindestAmanda(c) {
    let basis;
    if (c.lager === 0) {
      basis = (c.isTop || c.isMid) ? 500 : 300;
    } else {
      basis = 200;
    }
    return Math.ceil(basis / c.einheit) * c.einheit;
  }
  const methodOrderA = ["Standard Tapes", "Minitapes", "Bondings", "Classic Weft", "Genius Weft", "Invisible Weft", "Clip-ins", "Ponytail"];

  // ── Prio-Kategorien: Diese Methoden haben Vorrang bei Budgetverteilung ──
  // Russisch Glatt: Standard Tapes, Minitapes, Bondings
  const PRIO_METHODS_A = ["Standard Tapes", "Minitapes", "Bondings"];

  let allCandidatesA = rows.filter(r => (r[7] || 0) > 0).map(r => {
    let quality = r[0], method = r[1], länge = r[2], product = r[3];
    let lager = r[4], unterwegs = r[5], ziel = r[6], bedarf = r[7];
    let tier = r[8] || "REST";
    let rang = r[9] || 999;
    let isTop = (tier === "TOP7");
    let isMid = (tier === "MID");
    let isPrio = PRIO_METHODS_A.indexOf(method) >= 0; // Prio-Kategorie?
    let verfügbar = lager + unterwegs;
    // Einheitsgröße für Clip-ins aus länge ("100g", "150g", "225g"), Ponytails 130g, sonst 100g
    let einheit = 100;
    if (method === "Clip-ins") {
      let m = String(länge).match(/(\d+)/);
      if (m) einheit = parseInt(m[1]);
    } else if (method === "Ponytail") {
      einheit = 130;
    }
    const stock_at_arrival = (r[10] != null) ? r[10] : null;
    const tagesrate = r[11] || 0;

    // ── grundbedarf: Wie China — Anteil DIESER Bestellung = 21 Tage Verbrauch ──
    // Bei knappem Budget wird nur grundbedarf bestellt, nicht voller 45-Tage-bedarf.
    // Bei genug Budget wird voller bedarf bestellt.
    // mind. 1 Einheit (100g/150g/225g)
    let grundbedarf;
    if (tagesrate > 0) {
      grundbedarf = Math.max(einheit, Math.ceil(tagesrate * 21 / einheit) * einheit);
    } else {
      // Kein Velocity → fallback mindestAmanda-Menge
      grundbedarf = (lager === 0 && (isTop || isMid)) ? 500 : (lager === 0 ? 300 : 200);
      grundbedarf = Math.ceil(grundbedarf / einheit) * einheit;
    }
    grundbedarf = Math.min(grundbedarf, bedarf); // nie mehr als tatsächlichen Bedarf

    return { quality, method, länge, product, lager, unterwegs, verfügbar, ziel, bedarf, tier, rang,
             isTop, isMid, isPrio, einheit, zugeteilt: 0, stock_at_arrival, tagesrate, grundbedarf };
  });

  let restBudgetA = budgetGA;

  // Hilfsfunktion: Rundung auf 100g für Standard-Produkte, auf Einheit für Clip-ins/Ponytails
  function rundeAmanda(val, c) {
    // TOP7: aufrunden (Bestseller sollen nicht zu kurz kommen)
    // MID/REST: abrunden (Budget schützen)
    const fn = c.isTop ? Math.ceil : Math.floor;
    if (c.method === "Clip-ins" || c.method === "Ponytail") {
      return fn(val / c.einheit) * c.einheit;
    }
    return fn(val / 100) * 100;
  }

  // ─── BUDGET-RUNDEN A–K (v8 – "Grundbedarf + Proportional") ────────────────────────────────
  // Kernkonzept: Wir bestellen alle 2 Wochen → jede Bestellung deckt NUR 21 Tage (grundbedarf).
  // Bei knappem Budget: grundbedarf pro Produkt, NICHT voller 45-Tage-Bedarf.
  // Bei ausreichendem Budget: voller Bedarf.
  // Clip-ins sind GLEICHBERECHTIGT — ein TOP7 Clip-in = TOP7 Tape.
  // Innerhalb jedes Tiers: PROPORTIONAL statt sequentiell.
  // Prio-Kategorien (Tapes, Minitapes, Bondings) > Non-Prio bei gleichem Tier.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  // Budget-Knappheit: Vergleiche mit Gesamtgrundbedarf (21 Tage), nicht vollem 45-Tage-Bedarf
  const gesamtBedarfA = allCandidatesA.reduce((s, c) => s + c.bedarf, 0);
  const gesamtGrundbedarfA = allCandidatesA.reduce((s, c) => s + c.grundbedarf, 0);
  const budgetKnappA = budgetGA < gesamtBedarfA;
  const MID_CAP_FACTOR = 0.6;
  if (budgetKnappA) {
    Logger.log("⚠️ Budget knapp: " + (budgetGA/1000).toFixed(1) + "kg < Bedarf " + (gesamtBedarfA/1000).toFixed(1) + "kg (Grundbedarf " + (gesamtGrundbedarfA/1000).toFixed(1) + "kg) → grundbedarf-Modus + MID-Cap 60%");
  } else {
    Logger.log("✅ Budget ausreichend: " + (budgetGA/1000).toFixed(1) + "kg >= Bedarf " + (gesamtBedarfA/1000).toFixed(1) + "kg → voller Bedarf-Modus");
  }

  // Hilfsfunktion: Tier-Priorität (niedrigere Zahl = höhere Priorität)
  // Clip-ins werden NICHT mehr degradiert — ein TOP7 Clip-in = TOP7 Tape
  // Ponytails kommen am Ende, alles andere nach Tier
  const tierPrioA = (c) => {
    if (c.method === "Ponytail") return 10;
    if (c.isTop) return 0;
    if (c.isMid) return 1;
    return 3;
  };

  // ── Kritisch-Check: Produkt wird vor Ankunft der neuen Bestellung ausverkauft sein ──
  // Berücksichtigt Lieferzeit (42 Tage) + aktuelle Velocity
  function isCriticalA(c) {
    if (c.lager === 0 && c.unterwegs === 0) return true;
    if (c.stock_at_arrival != null && c.stock_at_arrival <= 0) return true;
    return false;
  }

  // Log: Kritische Produkte mit Lager > 0
  allCandidatesA.filter(c => c.lager > 0 && c.stock_at_arrival != null && c.stock_at_arrival <= 0).forEach(c => {
    Logger.log("🔴 KRITISCH trotz Lager: " + c.product + " | Lager=" + c.lager + "g → stock_at_arrival=" + c.stock_at_arrival + "g | tier=" + c.tier);
  });

  // Hilfsfunktion: MID-Cap anwenden — NUR bei knappem Budget
  function midCap(c, proposed) {
    if (!c.isMid || !budgetKnappA) return proposed;
    const maxTotal = Math.max(mindestAmanda(c), Math.round(c.grundbedarf * MID_CAP_FACTOR));
    const remaining = Math.max(0, maxTotal - c.zugeteilt);
    return Math.min(proposed, remaining);
  }

  // Hilfsfunktion: effektiver Bedarf für diese Runde
  // Bei knappem Budget: grundbedarf (21 Tage). Bei genug Budget: voller bedarf.
  function effektiverBedarf(c) {
    return budgetKnappA ? c.grundbedarf : c.bedarf;
  }

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  RUNDE A: NUR TOP7 + MID kritisch → Mindestmenge                      ║
  // ║  REST/KAUM kommen NICHT hierhin — die bekommen erst Budget in Runde E  ║
  // ║  nach TOP7/MID vollständig versorgt sind.                              ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  {
    let rundeA = allCandidatesA
      .filter(c => (c.isTop || c.isMid) && isCriticalA(c) && c.method !== "Ponytail")
      .sort((a, b) => tierPrioA(a) - tierPrioA(b) || (a.rang || 999) - (b.rang || 999));
    let sumA = 0;
    for (let c of rundeA) {
      if (restBudgetA <= 0) break;
      let restBedarf = c.bedarf - c.zugeteilt;
      if (restBedarf <= 0) continue;
      let mindest = mindestAmanda(c);
      let zugeteilt = Math.min(mindest, restBedarf, restBudgetA);
      zugeteilt = rundeAmanda(zugeteilt, c);
      if (zugeteilt > 0) { c.zugeteilt += zugeteilt; restBudgetA -= zugeteilt; sumA += zugeteilt; }
    }
    Logger.log("📦 Runde A (TOP7+MID mindest): " + rundeA.length + " Produkte, " + (sumA/1000).toFixed(1) + "kg vergeben");
  }

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  RUNDE A2: TOP7 kritisch → PROPORTIONALE Auffüllung                    ║
  // ║  Bei knappem Budget: nur grundbedarf (21 Tage). Bei genug: voller Bed. ║
  // ║  PROPORTIONAL: Desert+Dubai bekommen gleich viel, nicht Rang1 alles.   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  {
    let top7Crit = allCandidatesA
      .filter(c => c.isTop && isCriticalA(c) && c.method !== "Ponytail" && (effektiverBedarf(c) - c.zugeteilt) > 0);
    let totalRestBedarf = top7Crit.reduce((s, c) => s + Math.max(0, effektiverBedarf(c) - c.zugeteilt), 0);
    let availForTop7 = Math.min(restBudgetA, totalRestBedarf);
    let sumA2 = 0;
    top7Crit.sort((a, b) => (a.rang || 999) - (b.rang || 999));
    for (let c of top7Crit) {
      let restBedarf = effektiverBedarf(c) - c.zugeteilt;
      if (restBedarf <= 0 || restBudgetA <= 0) continue;
      let fairShare = totalRestBedarf > 0 ? Math.round(availForTop7 * (restBedarf / totalRestBedarf)) : 0;
      let zugeteilt = Math.min(fairShare, restBedarf, restBudgetA);
      zugeteilt = rundeAmanda(zugeteilt, c);
      if (zugeteilt > 0) { c.zugeteilt += zugeteilt; restBudgetA -= zugeteilt; sumA2 += zugeteilt; }
    }
    Logger.log("📦 Runde A2 (TOP7 proportional " + (budgetKnappA ? "grundbedarf" : "vollbedarf") + "): " + top7Crit.length + " Produkte, " + (sumA2/1000).toFixed(1) + "kg von " + (totalRestBedarf/1000).toFixed(1) + "kg");
  }

  // RUNDE A3: MID kritisch → proportionale Auffüllung mit MID-Cap
  {
    let midCrit = allCandidatesA
      .filter(c => c.isMid && isCriticalA(c) && c.method !== "Ponytail" && (effektiverBedarf(c) - c.zugeteilt) > 0);
    let totalMidBedarf = midCrit.reduce((s, c) => s + Math.max(0, midCap(c, effektiverBedarf(c) - c.zugeteilt)), 0);
    let availForMid = Math.min(restBudgetA, totalMidBedarf);
    let sumA3 = 0;
    midCrit.sort((a, b) => (a.rang || 999) - (b.rang || 999));
    for (let c of midCrit) {
      let restBedarf = midCap(c, effektiverBedarf(c) - c.zugeteilt);
      if (restBedarf <= 0 || restBudgetA <= 0) continue;
      let fairShare = totalMidBedarf > 0 ? Math.round(availForMid * (restBedarf / totalMidBedarf)) : 0;
      let zugeteilt = Math.min(fairShare, restBedarf, restBudgetA);
      zugeteilt = rundeAmanda(zugeteilt, c);
      if (zugeteilt > 0) { c.zugeteilt += zugeteilt; restBudgetA -= zugeteilt; sumA3 += zugeteilt; }
    }
    Logger.log("📦 Runde A3 (MID proportional): " + midCrit.length + " Produkte, " + (sumA3/1000).toFixed(1) + "kg");
  }

  // RUNDE B: TOP + MID mit lager=0 aber unterwegs > 0 → proportionale Bedarfszuteilung
  {
    let rundeB = allCandidatesA
      .filter(c => (c.isTop || c.isMid) && c.lager === 0 && c.unterwegs > 0 && c.method !== "Ponytail" && (effektiverBedarf(c) - c.zugeteilt) > 0);
    let effBedarfMap = new Map();
    let totalEffBedarf = 0;
    for (let c of rundeB) {
      let eff = midCap(c, effektiverBedarf(c) - c.zugeteilt);
      eff = Math.max(eff, mindestAmanda(c));
      eff = Math.min(eff, effektiverBedarf(c) - c.zugeteilt);
      effBedarfMap.set(c, eff);
      totalEffBedarf += eff;
    }
    let availB = Math.min(restBudgetA, totalEffBedarf);
    let sumB = 0;
    rundeB.sort((a, b) => tierPrioA(a) - tierPrioA(b) || (a.rang || 999) - (b.rang || 999));
    for (let c of rundeB) {
      if (restBudgetA <= 0) break;
      let eff = effBedarfMap.get(c) || 0;
      if (eff <= 0) continue;
      let fairShare = totalEffBedarf > 0 ? Math.round(availB * (eff / totalEffBedarf)) : 0;
      let zugeteilt = Math.min(fairShare, effektiverBedarf(c) - c.zugeteilt, restBudgetA);
      zugeteilt = rundeAmanda(zugeteilt, c);
      let mindest = mindestAmanda(c);
      if (zugeteilt < mindest) zugeteilt = Math.min(mindest, effektiverBedarf(c) - c.zugeteilt, restBudgetA);
      zugeteilt = rundeAmanda(zugeteilt, c);
      if (zugeteilt > 0) { c.zugeteilt += zugeteilt; restBudgetA -= zugeteilt; sumB += zugeteilt; }
    }
    Logger.log("📦 Runde B (TOP/MID lager=0 uw>0): " + rundeB.length + " Produkte, " + (sumB/1000).toFixed(1) + "kg");
  }

  // RUNDE C: TOP + MID mit Lager > 0 aber knapp → proportionale Auffüllung
  {
    let rundeC = allCandidatesA
      .filter(c => (c.isTop || c.isMid) && c.lager > 0 && effektiverBedarf(c) > c.zugeteilt && c.method !== "Ponytail"
        && (c.verfügbar < 500 || (c.stock_at_arrival != null && c.stock_at_arrival < 500)));
    let effBedarfC = new Map();
    let totalEffC = 0;
    for (let c of rundeC) {
      let eff = midCap(c, effektiverBedarf(c) - c.zugeteilt);
      eff = Math.max(0, eff);
      effBedarfC.set(c, eff);
      totalEffC += eff;
    }
    let availC = Math.min(restBudgetA, totalEffC);
    let sumC = 0;
    for (let c of rundeC) {
      if (restBudgetA <= 0) break;
      let eff = effBedarfC.get(c) || 0;
      if (eff <= 0) continue;
      let fairShare = totalEffC > 0 ? Math.round(availC * (eff / totalEffC)) : 0;
      let zugeteilt = Math.min(fairShare, effektiverBedarf(c) - c.zugeteilt, restBudgetA);
      zugeteilt = rundeAmanda(zugeteilt, c);
      if (zugeteilt > 0) { c.zugeteilt += zugeteilt; restBudgetA -= zugeteilt; sumC += zugeteilt; }
    }
    Logger.log("📦 Runde C (TOP/MID knapp): " + rundeC.length + " Produkte, " + (sumC/1000).toFixed(1) + "kg");
  }

  // RUNDE D entfernt — Clip-ins werden jetzt gleichberechtigt in allen Runden (A-C, E-K) behandelt.
  // Ein TOP7 Clip-in hat dieselbe Priorität wie ein TOP7 Tape.

  // RUNDE E: REST-Produkte → nur Mindestmenge, nur wenn Budget übrig
  //   REST erhält Budget ERST nachdem TOP/MID (inkl. Clip-in Topseller!) versorgt sind
  {
    let rundeE = allCandidatesA
      .filter(c => !c.isTop && !c.isMid && c.method !== "Ponytail")
      // Prio-Kategorien zuerst, dann nach Lager (knappste zuerst)
      .sort((a, b) => (b.isPrio ? 1 : 0) - (a.isPrio ? 1 : 0) || a.lager - b.lager);
    for (let c of rundeE) {
      if (restBudgetA <= 0) break;
      let mindest = mindestAmanda(c);
      let restBedarf = c.bedarf - c.zugeteilt;
      if (restBedarf <= 0) continue;
      let zugeteilt = Math.min(mindest, restBedarf, restBudgetA);
      zugeteilt = rundeAmanda(zugeteilt, c);
      if (zugeteilt > 0) { c.zugeteilt += zugeteilt; restBudgetA -= zugeteilt; }
    }
  }

  // RUNDE F: Ponytails zuletzt
  {
    let rundeF = allCandidatesA
      .filter(c => c.method === "Ponytail")
      .sort((a, b) => a.lager - b.lager);
    for (let c of rundeF) {
      if (restBudgetA <= 0) break;
      let restBedarf = c.bedarf - c.zugeteilt;
      if (restBedarf <= 0) continue;
      let zugeteilt = Math.min(restBedarf, restBudgetA);
      zugeteilt = rundeAmanda(zugeteilt, c);
      if (zugeteilt > 0) { c.zugeteilt += zugeteilt; restBudgetA -= zugeteilt; }
    }
  }

  // RUNDE G: Restbudget → TOP/MID PROPORTIONAL aufstocken bis Wunschziel
  //   Standard Tapes rang 1-10 → 1500g, rang 11-20 → 1000g
  //   MID: auf 60% gedeckelt.
  //   PROPORTIONAL: Jedes Produkt bekommt (seinBedarf/gesamtBedarf)×Budget
  //   → Bitter Cacao und Dubai bekommen gleich viel, nicht erst Rang1 alles
  {
    let rundeG = allCandidatesA
      .filter(c => (c.isTop || c.isMid) && c.method !== "Ponytail");
    // Effektive Aufstockung pro Produkt berechnen
    let effMapG = new Map();
    let totalEffG = 0;
    for (let c of rundeG) {
      let wunschziel;
      if (c.method === "Standard Tapes") {
        wunschziel = (c.rang <= 10) ? 1500 : 1000;
      } else {
        wunschziel = c.ziel;
      }
      const stockBaseG = (c.stock_at_arrival != null) ? c.stock_at_arrival : (c.lager + c.unterwegs);
      let bereits = stockBaseG + c.zugeteilt;
      let restBedarf = effektiverBedarf(c) - c.zugeteilt;
      let aufstockungBisWunsch = Math.max(0, wunschziel - bereits);
      let aufstockung = Math.max(aufstockungBisWunsch, restBedarf);
      aufstockung = midCap(c, aufstockung);
      if (aufstockung <= 0) { effMapG.set(c, 0); continue; }
      effMapG.set(c, aufstockung);
      totalEffG += aufstockung;
    }
    let availG = Math.min(restBudgetA, totalEffG);
    let sumG = 0;
    rundeG.sort((a, b) => tierPrioA(a) - tierPrioA(b) || (a.rang || 999) - (b.rang || 999));
    for (let c of rundeG) {
      if (restBudgetA <= 0) break;
      let eff = effMapG.get(c) || 0;
      if (eff <= 0) continue;
      let fairShare = totalEffG > 0 ? Math.round(availG * (eff / totalEffG)) : 0;
      let aufstockung = Math.min(fairShare, eff, restBudgetA);
      aufstockung = rundeAmanda(aufstockung, c);
      if (aufstockung >= 100) { c.zugeteilt += aufstockung; restBudgetA -= aufstockung; sumG += aufstockung; }
    }
    Logger.log("📦 Runde G (TOP/MID proportional aufstocken): " + (sumG/1000).toFixed(1) + "kg von " + (totalEffG/1000).toFixed(1) + "kg Bedarf");
  }

  // RUNDE H: Restbudget → REST-Produkte über Mindestmenge hinaus aufstocken
  //   In Runde E bekam REST nur die Mindestmenge. Wenn Budget übrig ist,
  //   bekommen REST-Produkte jetzt ihren restlichen Bedarf (bis max c.ziel).
  //   Sortierung: nach Lager aufsteigend (knappste zuerst), dann nach Rang
  {
    let rundeH = allCandidatesA
      .filter(c => !c.isTop && !c.isMid && c.method !== "Ponytail")
      .sort((a, b) => a.lager - b.lager || (a.rang || 999) - (b.rang || 999));
    for (let c of rundeH) {
      if (restBudgetA <= 0) break;
      let restBedarf = c.bedarf - c.zugeteilt;
      if (restBedarf <= 0) continue;
      let zugeteilt = Math.min(restBedarf, restBudgetA);
      zugeteilt = rundeAmanda(zugeteilt, c);
      if (zugeteilt >= 100) { c.zugeteilt += zugeteilt; restBudgetA -= zugeteilt; }
    }
  }

  // RUNDE I: Restbudget → TOP/MID PROPORTIONAL über Wunschziel hinaus aufstocken (bis volles Ziel)
  {
    let rundeI = allCandidatesA
      .filter(c => (c.isTop || c.isMid) && c.method !== "Ponytail");
    let effMapI = new Map();
    let totalEffI = 0;
    for (let c of rundeI) {
      const stockBaseI = (c.stock_at_arrival != null) ? c.stock_at_arrival : (c.lager + c.unterwegs);
      let bereits = stockBaseI + c.zugeteilt;
      if (bereits >= c.ziel) { effMapI.set(c, 0); continue; }
      let aufstockung = c.ziel - bereits;
      effMapI.set(c, aufstockung);
      totalEffI += aufstockung;
    }
    let availI = Math.min(restBudgetA, totalEffI);
    let sumI = 0;
    rundeI.sort((a, b) => tierPrioA(a) - tierPrioA(b) || (a.rang || 999) - (b.rang || 999));
    for (let c of rundeI) {
      if (restBudgetA <= 0) break;
      let eff = effMapI.get(c) || 0;
      if (eff <= 0) continue;
      let fairShare = totalEffI > 0 ? Math.round(availI * (eff / totalEffI)) : 0;
      let aufstockung = Math.min(fairShare, eff, restBudgetA);
      aufstockung = rundeAmanda(aufstockung, c);
      if (aufstockung >= 100) { c.zugeteilt += aufstockung; restBudgetA -= aufstockung; sumI += aufstockung; }
    }
    Logger.log("📦 Runde I (TOP/MID proportional bis Ziel): " + (sumI/1000).toFixed(1) + "kg");
  }

  // RUNDE J: Restbudget → Alle Bestseller (inkl. Clip-ins) proportional aufstocken
  //   Wenn nach Runde A–I noch Budget übrig ist, geht der Rest an TOP7/MID-Produkte.
  //   Sortierung: TOP vor MID, dann nach Rang (Bestseller zuerst)
  //   Jedes Produkt bekommt maximal 1 Bestellintervall (= 2 Wochen Velocity) extra pro Runde.
  //   Bis zu 3 Durchläufe, damit das Budget gleichmäßiger verteilt wird.
  {
    for (let pass = 0; pass < 3; pass++) {
      if (restBudgetA <= 0) break;
      let rundeJ = allCandidatesA
        .filter(c => (c.isTop || c.isMid) && c.method !== "Ponytail" && c.bedarf > 0)
        .sort((a, b) => tierPrioA(a) - tierPrioA(b) || (a.rang || 999) - (b.rang || 999));
      for (let c of rundeJ) {
        if (restBudgetA <= 0) break;
        // Extra = 2 Wochen Velocity (= c.ziel / 3, da ziel ≈ 6 Wochen)
        let extra = Math.max(c.einheit, Math.round(c.ziel / 3 / c.einheit) * c.einheit);
        extra = Math.min(extra, restBudgetA);
        extra = rundeAmanda(extra, c);
        if (extra >= c.einheit) { c.zugeteilt += extra; restBudgetA -= extra; }
      }
    }
  }

  // RUNDE K: Option B – Breite Verteilung – Restbudget auf ALLE Produkte (TOP/MID/REST + Clip-ins)
  //   Ziel: "Lager in die Breite befüllen" – auch REST-Produkte und Clip-ins erhalten Extra-Budget,
  //   wenn nach Runde J noch Budget übrig ist.
  //   Sortierung nach Option-B Coverage-Ratio: stock_at_arrival + zugeteilt / ziel (niedrigste zuerst).
  //   Pro Pass: max 1 Bestellintervall (≈ ziel/3) je Produkt. Bis zu 5 Durchläufe.
  //   Cap: Kein Produkt bekommt mehr als 2× sein Ziel (verhindert Überbestellung).
  {
    for (let pass = 0; pass < 5; pass++) {
      if (restBudgetA <= 0) break;
      let rundeK = allCandidatesA
        .filter(c => c.method !== "Ponytail" && c.bedarf > 0)
        .sort((a, b) => {
          const sA = (a.stock_at_arrival != null ? a.stock_at_arrival : (a.lager + a.unterwegs)) + a.zugeteilt;
          const sB = (b.stock_at_arrival != null ? b.stock_at_arrival : (b.lager + b.unterwegs)) + b.zugeteilt;
          const rA = sA / Math.max(1, a.ziel);
          const rB = sB / Math.max(1, b.ziel);
          if (Math.abs(rA - rB) > 0.01) return rA - rB; // niedrigste Coverage zuerst
          return tierPrioA(a) - tierPrioA(b) || (a.rang || 999) - (b.rang || 999);
        });
      let anyAdded = false;
      for (let c of rundeK) {
        if (restBudgetA <= 0) break;
        const stockBase = (c.stock_at_arrival != null) ? c.stock_at_arrival : (c.lager + c.unterwegs);
        const currentCoverage = (stockBase + c.zugeteilt) / Math.max(1, c.ziel);
        if (currentCoverage >= 2.0) continue; // Nicht mehr als 2× Ziel bestellen
        // Extra = 1 Bestellintervall (≈ ziel/3 ≈ 2 Wochen Velocity), mind. 1 Einheit
        let extra = Math.max(c.einheit, Math.round(c.ziel / 3 / c.einheit) * c.einheit);
        extra = Math.min(extra, restBudgetA);
        extra = rundeAmanda(extra, c);
        if (extra >= c.einheit) { c.zugeteilt += extra; restBudgetA -= extra; anyAdded = true; }
      }
      if (!anyAdded) break; // Keine Kandidaten mehr → frühzeitig abbrechen
    }
    if (restBudgetA > 0) {
      Logger.log("💰 Runde K: Verbleibendes Budget nach breiter Verteilung: " + (restBudgetA/1000).toFixed(1) + "kg");
    }
  }

    // Absolutes Minimum erzwingen: Wenn zugeteilt > 0 aber unter Mindest, auf Mindest anheben
  // Budget-Tracking: Differenz wird von restBudgetA abgezogen
  allCandidatesA.forEach(c => {
    if (c.zugeteilt > 0) {
      const mindest = mindestAmanda(c);
      if (c.zugeteilt < mindest) {
        const diff = mindest - c.zugeteilt;
        c.zugeteilt = mindest;
        restBudgetA -= diff;
      }
    }
  });

  // ─── HARTER BUDGET-CAP: Überschreitung korrigieren ───
  // Phase 1: REST auf Mindestmenge kürzen
  // Phase 2: REST komplett streichen (unwichtigste zuerst)
  // Phase 3: MID auf Mindestmenge kürzen
  // Phase 4: MID komplett streichen
  // TOP7 bleibt IMMER unangetastet.
  {
    let totalZugeteilt = allCandidatesA.reduce((s, c) => s + c.zugeteilt, 0);
    let überschuss = totalZugeteilt - budgetGA;
    if (überschuss > 0) {
      Logger.log("⚠️ Budget-Cap: " + (überschuss/1000).toFixed(1) + "kg über Budget");

      // Phase 1: REST auf Mindest kürzen
      const restSorted = allCandidatesA
        .filter(c => !c.isTop && !c.isMid && c.zugeteilt > 0 && c.method !== "Ponytail")
        .sort((a, b) => (b.rang || 999) - (a.rang || 999));
      for (let c of restSorted) {
        if (überschuss <= 0) break;
        const mindest = mindestAmanda(c);
        if (c.zugeteilt > mindest) {
          const diff = c.zugeteilt - mindest;
          c.zugeteilt = mindest;
          überschuss -= diff;
        }
      }

      // Phase 2: REST komplett streichen (unwichtigste zuerst)
      if (überschuss > 0) {
        for (let c of restSorted) {
          if (überschuss <= 0) break;
          if (c.zugeteilt > 0) {
            überschuss -= c.zugeteilt;
            c.zugeteilt = 0;
          }
        }
      }

      // Phase 3: MID auf Mindest kürzen
      if (überschuss > 0) {
        const midSorted = allCandidatesA
          .filter(c => c.isMid && c.zugeteilt > 0)
          .sort((a, b) => (b.rang || 999) - (a.rang || 999));
        for (let c of midSorted) {
          if (überschuss <= 0) break;
          const mindest = mindestAmanda(c);
          if (c.zugeteilt > mindest) {
            const diff = c.zugeteilt - mindest;
            c.zugeteilt = mindest;
            überschuss -= diff;
          }
        }

        // Phase 4: MID komplett streichen
        if (überschuss > 0) {
          for (let c of midSorted) {
            if (überschuss <= 0) break;
            if (c.zugeteilt > 0) {
              überschuss -= c.zugeteilt;
              c.zugeteilt = 0;
            }
          }
        }
      }

      restBudgetA = budgetGA - allCandidatesA.reduce((s, c) => s + c.zugeteilt, 0);
      const gestrichen = allCandidatesA.filter(c => c.zugeteilt === 0 && c.bedarf > 0).length;
      Logger.log("📊 Nach Budget-Cap: " + ((budgetGA - restBudgetA)/1000).toFixed(1) + "kg / " + (budgetGA/1000).toFixed(1) + "kg" +
        (gestrichen > 0 ? " | " + gestrichen + " Produkte gestrichen (Budget zu knapp)" : ""));
    }
  }

  // Nach Method-Reihenfolge sortieren, dann innerhalb nach Lager aufsteigend
  let budgetItemsA = allCandidatesA
    .filter(c => c.zugeteilt > 0)
    .sort((a, b) => {
      let ai = methodOrderA.indexOf(a.method), bi = methodOrderA.indexOf(b.method);
      if (ai !== bi) return ai - bi;
      return a.lager - b.lager;
    })
    .map(c => {
      return [c.quality, c.method, c.länge, c.product, c.lager, c.unterwegs, c.ziel, c.zugeteilt];
    });

  // Gruppenstruktur: Quality + Method nur in erster Zeile der Gruppe
  let lastMethodA = null;
  let budgetRowsA = budgetItemsA.map(r => {
    let row = [...r];
    if (row[1] === lastMethodA) { row[0] = ""; row[1] = ""; }
    else lastMethodA = row[1];
    return row;
  });

  // ─── BUDGET-LISTE oben schreiben ───
  let colCountA = 8;
  let headerRowA = ["Quality", "Method", "Länge/Variante", "Farbcode", "Lager (g)", "Unterwegs (g)", "Ziel (g)", "Bestellung (g)"];
  let budgetTitleA = "AMANDA (Russisch Glatt) – BUDGET-BESTELLUNG " + dateStr + "  |  Budget: " + (budgetGA/1000).toFixed(1) + " kg  |  Verbraucht: " + ((budgetGA - restBudgetA)/1000).toFixed(1) + " kg";
  let budgetTotalA = budgetItemsA.reduce((s, r) => s + (r[7] || 0), 0);
  let budgetSubtotalA = Array(colCountA).fill("");
  budgetSubtotalA[0] = "Subtotal";
  budgetSubtotalA[7] = budgetTotalA;

  let budgetAllRowsA = [
    [budgetTitleA, ...Array(colCountA - 1).fill("")],
    headerRowA,
    ...budgetRowsA,
    budgetSubtotalA
  ];

  sheet.getRange(1, 1, budgetAllRowsA.length, colCountA).setValues(budgetAllRowsA);

  // Formatierung Budget-Titel
  sheet.getRange(1, 1, 1, colCountA).merge()
    .setBackground("#0f9d58").setFontColor("#ffffff").setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center");
  sheet.getRange(2, 1, 1, colCountA)
    .setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10)
    .setHorizontalAlignment("center");
  let sectionColorsA = { "Standard Tapes": "#e8f0fe", "Minitapes": "#e3f2fd", "Bondings": "#fce8e6",
    "Classic Weft": "#e6f4ea", "Genius Weft": "#fef9e7", "Invisible Weft": "#f3e8fd",
    "Clip-ins": "#fce4ec", "Ponytail": "#fff8e1" };
  let curBgA = "#e8f0fe";
  // budgetItemsA hat die vollständige Info (vor Leer-Feldern), für isTop-Lookup
  let budgetItemsAFull = allCandidatesA.filter(c => c.zugeteilt > 0)
    .sort((a, b) => {
      let ai = methodOrderA.indexOf(a.method), bi = methodOrderA.indexOf(b.method);
      if (ai !== bi) return ai - bi;
      return a.lager - b.lager;
    });

  // ── Tier-Farbschema (konsistent mit Topseller-Tab) ──
  const A_TOP7  = "#fff9c4"; const A_TOP7B = "#fff3a0";
  const A_MID   = "#e3f2fd"; const A_MIDB  = "#bbdefb";
  const A_REST  = "#f1f8e9"; const A_RESTB = "#dcedc8";
  const AC_TOP7 = "#f9a825"; const AC_MID  = "#1565c0"; const AC_REST = "#558b2f";

  for (let i = 2; i < budgetAllRowsA.length - 1; i++) {
    let r = budgetAllRowsA[i];
    let itemIdx = i - 2;
    let cand = budgetItemsAFull[itemIdx];
    let isTop7 = cand && cand.isTop;
    let isMid  = cand && cand.isMid;
    let bg;
    if (isTop7)     bg = (i % 2 === 0) ? A_TOP7  : A_TOP7B;
    else if (isMid) bg = (i % 2 === 0) ? A_MID   : A_MIDB;
    else            bg = (i % 2 === 0) ? A_REST  : A_RESTB;
    sheet.getRange(i + 1, 1, 1, colCountA).setBackground(bg).setFontSize(10);
    if (isTop7) sheet.getRange(i + 1, 1, 1, colCountA).setFontWeight("bold");
    let bestellung = r[7];
    if (typeof bestellung === "number" && bestellung > 0) {
      let bedarfBgA = isTop7 ? AC_TOP7 : (isMid ? AC_MID : AC_REST);
      sheet.getRange(i + 1, 8).setBackground(bedarfBgA)
        .setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
    }
    let lager = r[4];
    if (typeof lager === "number" && lager === 0)
      sheet.getRange(i + 1, 5).setBackground("#db4437").setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center");
  }
  sheet.getRange(budgetAllRowsA.length, 1, 1, colCountA)
    .setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold").setFontSize(11)
    .setHorizontalAlignment("center");
  sheet.getRange(budgetAllRowsA.length, 1).setHorizontalAlignment("left");

  // Hinweis wenn keine Topseller-Daten vorhanden
  if (!hasTopsellerdatenA) {
    sheet.getRange(budgetAllRowsA.length + 1, 1, 1, colCountA).merge()
      .setValue("⚠️ Keine Topseller-Daten vorhanden. Bitte refreshTopseller() ausführen für dynamische Ranglisten.")
      .setBackground("#fff3e0").setFontColor("#e65100").setFontWeight("bold").setFontSize(10)
      .setHorizontalAlignment("center");
  }

  // ─── TRENNZEILE ───
  let sepRowA = budgetAllRowsA.length + (hasTopsellerdatenA ? 2 : 3);
  sheet.getRange(sepRowA, 1, 1, colCountA).merge()
    .setValue("▼▼▼  VOLLSTÄNDIGE LISTE (alle Produkte mit Bedarf)  ▼▼▼")
    .setBackground("#455a64").setFontColor("#ffffff").setFontWeight("bold").setFontSize(11)
    .setHorizontalAlignment("center");

  // ─── KOMPLETTE LISTE darunter ───
  let fullStartRowA = sepRowA + 1;
  // rows enthält 9 Felder (inkl. tier an Index 8) – auf 8 kürzen für writeBestellungSheetAt
  const rows8A = rows.map(r => r.slice(0, 8));
  writeBestellungSheetAt(
    sheet, fullStartRowA,
    "AMANDA (Russisch Glatt) – Bestellvorschlag " + dateStr + " (vollständig)",
    6, rows8A,
    "#0f9d58", "#0f9d58", "#34a853"
  );

  // Spaltenbreiten
  sheet.setColumnWidth(1, 140); sheet.setColumnWidth(2, 120); sheet.setColumnWidth(3, 100);
  sheet.setColumnWidth(4, 200); sheet.setColumnWidth(5, 90); sheet.setColumnWidth(6, 100);
  sheet.setColumnWidth(7, 90); sheet.setColumnWidth(8, 100); sheet.setColumnWidth(9, 110);

  // ─── BUDGET-EINGABEFELD (Spalte J, Zeile 1-5) ───
  sheet.getRange(1, 10).setValue("💰 Budget Amanda").setFontWeight("bold").setFontSize(10)
    .setBackground("#0f9d58").setFontColor("#ffffff").setHorizontalAlignment("center");
  sheet.getRange(2, 10).setValue(budgetGA).setFontSize(14).setFontWeight("bold")
    .setBackground("#e6f4ea").setFontColor("#0f9d58").setHorizontalAlignment("center")
    .setNumberFormat("#,##0");
  sheet.getRange(3, 10).setValue((budgetGA/1000).toFixed(1) + " kg").setFontSize(10)
    .setFontColor("#0f9d58").setHorizontalAlignment("center");
  sheet.getRange(4, 10).setValue("↑ Wert ändern,").setFontSize(8)
    .setFontColor("#888888").setFontStyle("italic").setHorizontalAlignment("center");
  sheet.getRange(5, 10).setValue("dann Skript neu ausführen").setFontSize(8)
    .setFontColor("#888888").setFontStyle("italic").setHorizontalAlignment("center");
  sheet.setColumnWidth(10, 150);

  // ─── EMPFEHLUNGS-BOX (Spalte J, Zeile 7-12) ───
  // Empfohlenes Budget = 2-Wochen-Bedarf aller Collections (Bestellzyklus)
  {
    const rawVDA = PropertiesService.getScriptProperties().getProperty("VERKAUFS_DATA");
    let empfehlungA = 0;
    if (rawVDA) {
      let vdA;
      try { vdA = JSON.parse(rawVDA); } catch(e) { vdA = {}; }
      // Amanda-Collections (Russisch Glatt + Clip-ins)
      const amandaCollLabels = [
        "Standard Tapes", "Minitapes", "Bondings",
        "Classic Weft", "Genius Weft", "Invisible Weft", "Clip-ins"
      ];
      for (const label of amandaCollLabels) {
        const entry = vdA["Russisch Glatt|" + label];
        if (entry && (entry.avgG3M || entry.g30d)) {
          const basis = Math.round((entry.avgG3M || 0) * 0.5 + (entry.g30d || 0) * 0.5);
          empfehlungA += basis * 0.5; // 2-Wochen-Bedarf: (50% Ø3M + 50% letzte 30 Tage) × 0,5
        }
      }
    }
    const empfGA = Math.round(empfehlungA / 1000); // in kg
    const abweichungA = empfGA > 0 ? Math.round((budgetGA/1000 - empfGA) / empfGA * 100) : 0;
    const abweichColorA = Math.abs(abweichungA) <= 10 ? "#2e7d32" : (abweichungA < 0 ? "#c62828" : "#e65100");

    sheet.getRange(7, 10).setValue("📊 Empfehlung Amanda").setFontWeight("bold").setFontSize(10)
      .setBackground("#1b5e20").setFontColor("#ffffff").setHorizontalAlignment("center");
    sheet.getRange(8, 10).setValue(empfGA > 0 ? empfGA * 1000 : "–").setFontSize(14).setFontWeight("bold")
      .setBackground("#f1f8e9").setFontColor("#1b5e20").setHorizontalAlignment("center")
      .setNumberFormat("#,##0");
    sheet.getRange(9, 10).setValue(empfGA > 0 ? empfGA + " kg" : "Keine Daten").setFontSize(10)
      .setFontColor("#1b5e20").setHorizontalAlignment("center");
    sheet.getRange(10, 10).setValue("2-Wochen-Bedarf").setFontSize(8)
      .setFontColor("#888888").setFontStyle("italic").setHorizontalAlignment("center");
    sheet.getRange(11, 10).setValue("(50% Ø3M + 50% 30T) × 0,5").setFontSize(7)
      .setFontColor("#aaaaaa").setFontStyle("italic").setHorizontalAlignment("center");
    if (empfGA > 0) {
      const diffTextA = (abweichungA >= 0 ? "+" : "") + abweichungA + "% vs. Budget";
      sheet.getRange(12, 10).setValue(diffTextA).setFontSize(8)
        .setFontColor(abweichColorA).setFontWeight("bold").setHorizontalAlignment("center");
    }
  }

  // ── Farblegende (Spalte J, Zeile 14-19) ──
  sheet.getRange(14, 10).setValue("🎨 Farblegende").setFontWeight("bold").setFontSize(9)
    .setBackground("#eeeeee").setHorizontalAlignment("center");
  sheet.getRange(15, 10).setValue("⬛ TOP7 – Bestseller (Rang 1–7)").setFontSize(8)
    .setBackground("#fff9c4").setFontWeight("bold").setHorizontalAlignment("left");
  sheet.getRange(16, 10).setValue("⬛ MID – Mittelfeld (Rang 8–14)").setFontSize(8)
    .setBackground("#e3f2fd").setHorizontalAlignment("left");
  sheet.getRange(17, 10).setValue("⬛ REST – Sonstige (Rang 15+)").setFontSize(8)
    .setBackground("#f1f8e9").setHorizontalAlignment("left");
  sheet.getRange(18, 10).setValue("🔴 Lager = 0 (ausverkauft)").setFontSize(8)
    .setBackground("#fce4ec").setHorizontalAlignment("left");

  // MID-Cap Hinweis wenn Budget knapp
  if (budgetKnappA) {
    sheet.getRange(20, 10).setValue("⚠️ Budget knapp").setFontWeight("bold").setFontSize(9)
      .setBackground("#e65100").setFontColor("#ffffff").setHorizontalAlignment("center");
    sheet.getRange(21, 10).setValue("MID auf 60% gedeckelt").setFontSize(8)
      .setFontColor("#e65100").setHorizontalAlignment("center");
  }

  // Budget in Properties speichern (wird beim nächsten Ausführen gelesen)
  PropertiesService.getScriptProperties().setProperty("BUDGET_AMANDA", String(budgetGA));

  Logger.log("✅ Bestellung Amanda erstellt. Budget-Liste: " + budgetItemsA.length + " Pos., Vollständig: " + rows.length + " Pos.");
}

// ==========================================
// HILFSFUNKTION: Bestelltabelle ab bestimmter Zeile schreiben
// ==========================================

function writeBestellungSheetAt(sheet, startRow, title, columns, rows, headerBg, topColor, midColor) {
  let headerRow = [];
  if (columns <= 5) {
    headerRow = ["Typ", "Länge", "Farbcode", "Lager (g)", "Unterwegs (g)", "Ziel (g) Minimum", "Bestellung (g)"];
  } else {
    headerRow = ["Quality", "Method", "Länge/Variante", "Farbcode", "Lager (g)", "Unterwegs (g)", "Ziel (g) Minimum", "Bestellung (g)"];
  }
  let colCount = headerRow.length;

  let totalBedarf = rows.reduce((s, r) => s + (r[r.length - 1] || 0), 0);
  let subtotalRow = Array(colCount).fill("");
  subtotalRow[0] = "Subtotal";
  subtotalRow[colCount - 1] = totalBedarf;

  let allRows = [
    [title, ...Array(colCount - 1).fill("")],
    headerRow,
    ...rows,
    subtotalRow
  ];

  sheet.getRange(startRow, 1, allRows.length, colCount).setValues(allRows);

  // Titelzeile
  sheet.getRange(startRow, 1, 1, colCount).merge()
    .setBackground(headerBg).setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(12)
    .setHorizontalAlignment("center");

  // Headerzeile
  sheet.getRange(startRow + 1, 1, 1, colCount)
    .setBackground("#2d2d2d").setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(10)
    .setHorizontalAlignment("center");

  // Datenzeilen
  // ── Tier-Farbschema (konsistent mit Topseller-Tab) ──
  const F_TOP7  = "#fff9c4"; const F_TOP7B = "#fff3a0";
  const F_MID   = "#e3f2fd"; const F_MIDB  = "#bbdefb";
  const F_REST  = "#f1f8e9"; const F_RESTB = "#dcedc8";
  const FC_TOP7 = "#f9a825"; const FC_MID  = "#1565c0"; const FC_REST = "#558b2f";

  for (let i = 2; i < allRows.length - 1; i++) {
    let row = allRows[i];
    let ziel   = row[row.length - 2];
    let bedarf = row[row.length - 1];
    let isTop7 = (ziel >= 1000);
    let isMid  = (ziel >= 500 && ziel < 1000);
    let bg;
    if (isTop7)     bg = (i % 2 === 0) ? F_TOP7  : F_TOP7B;
    else if (isMid) bg = (i % 2 === 0) ? F_MID   : F_MIDB;
    else            bg = (i % 2 === 0) ? F_REST  : F_RESTB;
    sheet.getRange(startRow + i, 1, 1, colCount).setBackground(bg).setFontSize(10);
    if (isTop7) sheet.getRange(startRow + i, 1, 1, colCount).setFontWeight("bold");

    if (typeof bedarf === "number" && bedarf > 0) {
      let bedarfBg = isTop7 ? FC_TOP7 : (isMid ? FC_MID : FC_REST);
      sheet.getRange(startRow + i, colCount)
        .setBackground(bedarfBg).setFontColor("#ffffff").setFontWeight("bold")
        .setHorizontalAlignment("center");
    }
    let lagerCol = (colCount === 8) ? 5 : 4;
    let lager = row[lagerCol - 1];
    if (typeof lager === "number" && lager === 0) {
      sheet.getRange(startRow + i, lagerCol)
        .setBackground("#db4437").setFontColor("#ffffff").setFontWeight("bold")
        .setHorizontalAlignment("center");
    }
  }

  // Subtotal-Zeile
  sheet.getRange(startRow + allRows.length - 1, 1, 1, colCount)
    .setBackground("#2d2d2d").setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(11)
    .setHorizontalAlignment("center");
  sheet.getRange(startRow + allRows.length - 1, 1).setHorizontalAlignment("left");

  // Hinweis
  sheet.getRange(startRow + allRows.length + 1, 1)
    .setValue("ℹ️  Nur Produkte mit Bedarf (Lager + Unterwegs < Ziel) werden angezeigt. Ziel: TOP7 = 1.000g | MID = 500g | REST = 300g. Topseller via refreshTopseller() aktualisieren.")
    .setFontSize(9).setFontColor("#555555").setFontStyle("italic");
}


// ==========================================
// ONEDIT TRIGGER – Budget automatisch anpassen
// ==========================================
// Diesen Trigger einmalig einrichten über:
//   Apps Script → Trigger → + Trigger hinzufügen
//   Funktion: onEditBudget, Ereignis: Bei Bearbeitung (onEdit)
// ODER: Funktion "installBudgetTrigger" einmalig ausführen

function installBudgetTrigger() {
  // Alle bestehenden onEdit-Trigger entfernen (Duplikate vermeiden)
  let triggers = ScriptApp.getProjectTriggers();
  for (let t of triggers) {
    if (t.getHandlerFunction() === "onEditBudget") {
      ScriptApp.deleteTrigger(t);
    }
  }
  // Neuen installierbaren onEdit-Trigger erstellen
  ScriptApp.newTrigger("onEditBudget")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  Logger.log("✅ Budget-Trigger installiert.");
}

function onEditBudget(e) {
  if (!e) return;
  let sheet = e.range.getSheet();
  let sheetName = sheet.getName();
  let row = e.range.getRow();
  let col = e.range.getColumn();

  // Vorschlag - China: Budget in Spalte I (9), Zeile 2
  if (sheetName === "Vorschlag - China" && row === 2 && col === 9) {
    let newBudget = parseInt(e.value);
    if (!isNaN(newBudget) && newBudget > 0) {
      PropertiesService.getScriptProperties().setProperty("BUDGET_CHINA", String(newBudget));
      // Komplette Funktion aufrufen für konsistente Logik + Formatierung
      createBestellungChina();
    }
  }

  // Vorschlag - Amanda: Budget in Spalte J (10), Zeile 2
  if (sheetName === "Vorschlag - Amanda" && row === 2 && col === 10) {
    let newBudget = parseInt(e.value);
    if (!isNaN(newBudget) && newBudget > 0) {
      PropertiesService.getScriptProperties().setProperty("BUDGET_AMANDA", String(newBudget));
      // Komplette Funktion aufrufen für konsistente Logik + Formatierung
      createBestellungAmanda();
    }
  }
}

// ─── Budget-Liste für China neu berechnen und in Sheet schreiben ───
function applyBudgetChina(sheet, budgetG) {
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Vorschlag - China");
  if (!sheet) return;
  if (!budgetG) {
    budgetG = parseInt(PropertiesService.getScriptProperties().getProperty("BUDGET_CHINA")) || 20000;
  }

  // Vollständige Liste aus dem Sheet lesen (unterhalb der Trennzeile)
  let lastRow = sheet.getLastRow();
  let sepRow = -1;
  for (let r = 1; r <= lastRow; r++) {
    let val = sheet.getRange(r, 1).getValue();
    if (String(val).includes("VOLLSTÄNDIGE LISTE")) { sepRow = r; break; }
  }
  if (sepRow < 0) return; // Kein vollständige Liste gefunden

  // Daten aus vollständiger Liste lesen (ab sepRow+2, nach Titelzeile und Headerzeile)
  let dataStartRow = sepRow + 3; // +1 Titelzeile, +1 Headerzeile
  let dataEndRow = lastRow;
  if (dataEndRow < dataStartRow) return;

  let rawData = sheet.getRange(dataStartRow, 1, dataEndRow - dataStartRow + 1, 7).getValues();
  // Letzte Zeile (Subtotal) und Hinweis-Zeile entfernen
  let rows = rawData.filter(r => r[0] !== "Subtotal" && r[0] !== "" || r[1] !== "");

  // Typ-Spalte wiederherstellen (leere Felder mit letztem Wert füllen)
  let lastTyp = "";
  let fullRows = rows.map(r => {
    if (r[0] && r[0] !== "") lastTyp = r[0];
    else r[0] = lastTyp;
    return r;
  }).filter(r => typeof r[3] === "number"); // nur echte Datenzeilen

  // Priorität berechnen
  let allCandidates = fullRows.map(r => {
    let typ = r[0], länge = r[1], product = r[2], lager = r[3], unterwegs = r[4], ziel = r[5], bedarf = r[6];
    let isTop = ziel >= 1000; // TOP7 = 1000g Ziel
    let prio;
    if      (lager === 0 && isTop)  prio = 1;
    else if (lager === 0 && !isTop) prio = 2;
    else if (lager < 300 && isTop)  prio = 3;
    else if (lager < 300 && !isTop) prio = 4;
    else if (lager < 600 && isTop)  prio = 5;
    else if (lager < 600 && !isTop) prio = 6;
    else if (isTop)                 prio = 7;
    else                            prio = 8;
    return { prio, typ, länge, product, lager, unterwegs, ziel, bedarf };
  });
  allCandidates.sort((a, b) => a.prio - b.prio || a.lager - b.lager);

  let restBudget = budgetG;
  let budgetItems = [];
  for (let c of allCandidates) {
    if (restBudget <= 0) break;
    let zugeteilt = Math.min(c.bedarf, restBudget);
    zugeteilt = Math.floor(zugeteilt / 25) * 25;
    if (zugeteilt <= 0) continue;
    restBudget -= zugeteilt;
    budgetItems.push([c.typ, c.länge, c.product, c.lager, c.unterwegs, c.ziel, zugeteilt]);
  }

  // Budget-Liste neu schreiben (Zeilen 3 bis sepRow-2 überschreiben)
  let colCount = 7;
  let today = new Date();
  let dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "dd.MM.yyyy");
  let budgetTitle = "CHINA (Usbekisch Wellig) – BUDGET-BESTELLUNG " + dateStr + "  |  Budget: " + (budgetG/1000).toFixed(1) + " kg  |  Verbraucht: " + ((budgetG - restBudget)/1000).toFixed(1) + " kg";
  let headerRow = ["Typ", "Länge", "Farbcode", "Lager (g)", "Unterwegs (g)", "Ziel (g) Minimum", "Bestellung (g)"];
  let totalBedarf = budgetItems.reduce((s, r) => s + r[6], 0);
  let subtotalRow = ["Subtotal", "", "", "", "", "", totalBedarf];

  // Gruppenstruktur
  let lastTyp2 = null;
  let budgetRows = budgetItems.map(r => {
    let row = [...r];
    if (row[0] === lastTyp2) row[0] = "";
    else lastTyp2 = row[0];
    return row;
  });

  let newBudgetBlock = [[budgetTitle, "", "", "", "", "", ""], headerRow, ...budgetRows, subtotalRow];

  // Alte Budget-Liste löschen (Zeilen 1 bis sepRow-2)
  let oldBudgetRows = sepRow - 2;
  if (oldBudgetRows > 0) {
    sheet.deleteRows(1, oldBudgetRows);
  }
  // Neue Zeilen einfügen
  sheet.insertRows(1, newBudgetBlock.length);
  sheet.getRange(1, 1, newBudgetBlock.length, colCount).setValues(newBudgetBlock);

  // Formatierung
  sheet.getRange(1, 1, 1, colCount).merge()
    .setBackground("#1a73e8").setFontColor("#ffffff").setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center");
  sheet.getRange(2, 1, 1, colCount)
    .setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10)
    .setHorizontalAlignment("center");
  sheet.getRange(newBudgetBlock.length, 1, 1, colCount)
    .setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold").setFontSize(11)
    .setHorizontalAlignment("center");

  // Budget-Box aktualisieren
  sheet.getRange(2, 9).setValue(budgetG).setNumberFormat("#,##0");
  sheet.getRange(3, 9).setValue((budgetG/1000).toFixed(1) + " kg");

  SpreadsheetApp.flush();
  Logger.log("✅ Budget China angepasst: " + budgetItems.length + " Positionen, " + (budgetG - restBudget)/1000 + " kg verbraucht.");
}

// ─── Budget-Liste für Amanda neu berechnen und in Sheet schreiben ───
function applyBudgetAmanda(sheet, budgetG) {
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Vorschlag - Amanda");
  if (!sheet) return;
  if (!budgetG) {
    budgetG = parseInt(PropertiesService.getScriptProperties().getProperty("BUDGET_AMANDA")) || 20000;
  }

  let lastRow = sheet.getLastRow();
  let sepRow = -1;
  for (let r = 1; r <= lastRow; r++) {
    let val = sheet.getRange(r, 1).getValue();
    if (String(val).includes("VOLLSTÄNDIGE LISTE")) { sepRow = r; break; }
  }
  if (sepRow < 0) return;

  let dataStartRow = sepRow + 3;
  let dataEndRow = lastRow;
  if (dataEndRow < dataStartRow) return;

  let rawData = sheet.getRange(dataStartRow, 1, dataEndRow - dataStartRow + 1, 8).getValues();
  let rows = rawData.filter(r => r[0] !== "Subtotal" && typeof r[4] === "number" && r[4] !== "");

  // Quality + Method wiederherstellen
  let lastQuality = "", lastMethod = "";
  let fullRows = rows.map(r => {
    if (r[0] && r[0] !== "") lastQuality = r[0]; else r[0] = lastQuality;
    if (r[1] && r[1] !== "") lastMethod = r[1]; else r[1] = lastMethod;
    return r;
  }).filter(r => typeof r[4] === "number");

  let allCandidates = fullRows.map(r => {
    let quality = r[0], method = r[1], länge = r[2], product = r[3];
    let lager = r[4], unterwegs = r[5], ziel = r[6], bedarf = r[7];
    let isInvisible = method === "Invisible Weft";
    // isTop: Produkte mit Tier TOP7
    let isTop = (ziel >= 1000) && !isInvisible;
    let prio;
    if      (lager === 0 && isTop)  prio = 1;
    else if (lager === 0 && !isTop) prio = 2;
    else if (lager < 300 && isTop)  prio = 3;
    else if (lager < 300 && !isTop) prio = 4;
    else if (lager < 600 && isTop)  prio = 5;
    else if (lager < 600 && !isTop) prio = 6;
    else if (isTop)                 prio = 7;
    else                            prio = 8;
    return { prio, quality, method, länge, product, lager, unterwegs, ziel, bedarf };
  });
  allCandidates.sort((a, b) => a.prio - b.prio || a.lager - b.lager);

  let restBudget = budgetG;
  let budgetItems = [];
  for (let c of allCandidates) {
    if (restBudget <= 0) break;
    let zugeteilt = Math.min(c.bedarf, restBudget);
    zugeteilt = Math.floor(zugeteilt / 25) * 25;
    if (zugeteilt <= 0) continue;
    restBudget -= zugeteilt;
    budgetItems.push([c.quality, c.method, c.länge, c.product, c.lager, c.unterwegs, c.ziel, zugeteilt]);
  }

  let colCount = 8;
  let today = new Date();
  let dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "dd.MM.yyyy");
  let budgetTitle = "AMANDA (Russisch Glatt) – BUDGET-BESTELLUNG " + dateStr + "  |  Budget: " + (budgetG/1000).toFixed(1) + " kg  |  Verbraucht: " + ((budgetG - restBudget)/1000).toFixed(1) + " kg";
  let headerRow = ["Quality", "Method", "Länge/Variante", "Farbcode", "Lager (g)", "Unterwegs (g)", "Ziel (g) Minimum", "Bestellung (g)"];
  let totalBedarf = budgetItems.reduce((s, r) => s + r[7], 0);
  let subtotalRow = ["Subtotal", "", "", "", "", "", "", totalBedarf];

  let lastMethod2 = null;
  let budgetRows = budgetItems.map(r => {
    let row = [...r];
    if (row[1] === lastMethod2) { row[0] = ""; row[1] = ""; }
    else lastMethod2 = row[1];
    return row;
  });

  let newBudgetBlock = [[budgetTitle, "", "", "", "", "", "", ""], headerRow, ...budgetRows, subtotalRow];

  let oldBudgetRows = sepRow - 2;
  if (oldBudgetRows > 0) sheet.deleteRows(1, oldBudgetRows);
  sheet.insertRows(1, newBudgetBlock.length);
  sheet.getRange(1, 1, newBudgetBlock.length, colCount).setValues(newBudgetBlock);

  sheet.getRange(1, 1, 1, colCount).merge()
    .setBackground("#0f9d58").setFontColor("#ffffff").setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center");
  sheet.getRange(2, 1, 1, colCount)
    .setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10)
    .setHorizontalAlignment("center");
  sheet.getRange(newBudgetBlock.length, 1, 1, colCount)
    .setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold").setFontSize(11)
    .setHorizontalAlignment("center");

  sheet.getRange(2, 10).setValue(budgetG).setNumberFormat("#,##0");
  sheet.getRange(3, 10).setValue((budgetG/1000).toFixed(1) + " kg");

  SpreadsheetApp.flush();
  Logger.log("✅ Budget Amanda angepasst: " + budgetItems.length + " Positionen, " + (budgetG - restBudget)/1000 + " kg verbraucht.");
}


// ============================================================
// TOPSELLER – Shopify Orders API Auswertung
// ============================================================

/**
 * Lädt alle Bestellungen der letzten N Tage aus Shopify,
 * berechnet die Topseller-Rangliste pro Produkttyp und Qualität
 * und schreibt sie in den Tab "Topseller".
 *
 * Ausführen: Funktion "refreshTopseller" in Apps Script starten.
 * Dauer: ca. 60–90 Sekunden.
 */
function refreshTopseller() {
  const MIN_GRAMS = 50; // Unter diesem Wert → "kaum verkauft" (grau)

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const DAYS = getTopsellertage_(ss);

  Logger.log("🔄 Topseller-Auswertung startet (aus VA-Cache). Zeitraum: letzte " + DAYS + " Tage");

  // ── Schritt 1: Alle Collections laden (handle → {quality, typ, länge}) ──
  // Collection-Handle -> Klassifizierung (mit festen Gewichten gPerUnit)
  const COLL_MAP = {
    "tapes-45cm":                { quality: "Usbekisch Wellig", typ: "Tapes",          länge: "45cm", gPerUnit: 25 },
    "tapes-55cm":                { quality: "Usbekisch Wellig", typ: "Tapes",          länge: "55cm", gPerUnit: 25 },
    "tapes-65cm":                { quality: "Usbekisch Wellig", typ: "Tapes",          länge: "65cm", gPerUnit: 25 },
    "tapes-85cm":                { quality: "Usbekisch Wellig", typ: "Tapes",          länge: "85cm", gPerUnit: 25 },
    "bondings-65cm":             { quality: "Usbekisch Wellig", typ: "Bondings",       länge: "65cm", gPerUnit: 25 },
    "bondings-85cm":             { quality: "Usbekisch Wellig", typ: "Bondings",       länge: "85cm", gPerUnit: 25 },
    "tressen-usbekisch-classic": { quality: "Usbekisch Wellig", typ: "Classic Weft",   länge: "65cm", gPerUnit: 50 },
    "tressen-usbekisch-genius":  { quality: "Usbekisch Wellig", typ: "Genius Weft",    länge: "65cm", gPerUnit: 50 },
    "ponytail-extensions":       { quality: "Usbekisch Wellig", typ: "Ponytail",       länge: "65cm", gPerUnit: 0   }, // variabel (per Variante)
    "russische-normal-tapes":    { quality: "Russisch Glatt",   typ: "Standard Tapes", länge: "",     gPerUnit: 25 },
    "tapes-glatt":               { quality: "Russisch Glatt",   typ: "Standard Tapes", länge: "",     gPerUnit: 25 },
    "mini-tapes":                { quality: "Russisch Glatt",   typ: "Minitapes",      länge: "",     gPerUnit: 50 },
    "invisible-mini-tapes":      { quality: "Russisch Glatt",   typ: "Minitapes",      länge: "",     gPerUnit: 50 },
    "bondings-glatt":            { quality: "Russisch Glatt",   typ: "Bondings",       länge: "",     gPerUnit: 25 },
    "tressen-russisch-classic":  { quality: "Russisch Glatt",   typ: "Classic Weft",   länge: "",     gPerUnit: 50 },
    "tressen-russisch-genius":   { quality: "Russisch Glatt",   typ: "Genius Weft",    länge: "",     gPerUnit: 50 },
    "tressen-russisch-invisible":{ quality: "Russisch Glatt",   typ: "Invisible Weft", länge: "",     gPerUnit: 50 },
    "clip-extensions":           { quality: "Russisch Glatt",   typ: "Clip-ins",       länge: "",     gPerUnit: 0 } // variabel
  };

  // ── Daten aus Verkaufsanalyse-Cache laden (keine eigenen API-Calls) ──
  const vaProductData_props = PropertiesService.getScriptProperties();
  const vaProductData = loadChunked_(vaProductData_props, "VA_PRODUCT_DATA");
  if (!vaProductData) {
    SpreadsheetApp.getUi().alert("⚠️ Keine Verkaufsanalyse-Daten gefunden!\n\nBitte zuerst \"Verkaufsanalyse aktualisieren\" ausführen (bis zum Ende), dann erneut Topseller aktualisieren.");
    return;
  }

  // ── Schritt 1b: Clip-Ins aus Lagerliste ergänzen ──
  // Produkte die nie verkauft wurden fehlen in vaProductData → aus Lagerliste nachladen
  // Strategie: Lagerliste als Basis, Verkaufsdaten per Produkttitel-Match zusammenführen
  try {
    const allSheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
      const lagerSheet = allSheets.find(s => s.getName().toUpperCase().includes("GLATT")) || null;
    if (lagerSheet) {
      const lagerData = lagerSheet.getDataRange().getValues();

      // Erst: Lookup-Map aus vaProductData aufbauen: normierter Produktname → Key
      // (damit wir Lagerlisten-Produkte mit Verkaufsdaten zusammenführen können)
      const nameToKey = {}; // normierter Name → vaProductData-Key
      for (const key in vaProductData) {
        const p = vaProductData[key];
        if (p.handle !== "clip-extensions") continue;
        // Normierter Name: Farbcode extrahieren + Gewicht
        let farbe2 = "";
        for (const t2 of (p.name || "").split(" ")) {
          if (t2.startsWith("#")) { farbe2 = t2; break; }
        }
        if (farbe2 && p.clipVariant > 0) {
          nameToKey[farbe2 + "|" + p.clipVariant] = key;
        }
      }

      let lagerHits = 0;
      for (const row of lagerData) {
        const kollName = String(row[0] || "").trim();
        if (kollName !== "Clip In Extensions Echthaar") continue;
        const produktTitel = String(row[1] || "").trim();
        if (!produktTitel) continue;
        const variantGewicht = parseInt(row[2]) || 0;
        if (variantGewicht === 0) continue;
        const normGewicht = (variantGewicht === 250) ? 225 : variantGewicht;

        // Farbcode aus Produkttitel extrahieren (#FAWN, #EBONY etc.)
        let farbe = "";
        for (const t of produktTitel.split(" ")) {
          if (t.startsWith("#")) { farbe = t; break; }
        }
        // Fallback: erstes Wort wenn kein # vorhanden
        if (!farbe) farbe = produktTitel.split(" ")[0];
        if (!farbe) continue;

        const lookupKey = farbe + "|" + normGewicht;

        if (nameToKey[lookupKey]) {
          // Bereits in Verkaufsdaten → clipVariant sicherstellen
          const existingKey = nameToKey[lookupKey];
          if (!vaProductData[existingKey].clipVariant) {
            vaProductData[existingKey].clipVariant = normGewicht;
          }
        } else {
          // Nicht in Verkaufsdaten → neu einfügen mit 0g Verkauf
          // Key: eindeutiger String aus Farbcode + Gewicht (kein Shopify-ID-Konflikt)
          const newKey = "lager|" + farbe + "|" + normGewicht;
          if (!vaProductData[newKey]) {
            vaProductData[newKey] = {
              name: produktTitel,  // Voller Produktname aus Inventar (für matchColor in Unterwegs-Lookup)
              handle: "clip-extensions",
              g90d: 0, g30d: 0, qty90d: 0,
              clipVariant: normGewicht
            };
            lagerHits++;
          }
        }
      }
      Logger.log("✅ Clip-Ins aus Lagerliste: " + lagerHits + " neue Produkte ergänzt (nie verkauft)");
    }
  } catch(eLager) {
    Logger.log("⚠️ Clip-Ins aus Lagerliste laden fehlgeschlagen: " + eLager.message);
  }


  // ── Schritt 1c: Inventar-Produkte ergänzen (nur exakter Collection-Name-Match) ──
  // Produkte ohne Verkäufe in 90 Tagen fehlen in VA_PRODUCT_DATA.
  // Das Inventar-Sheet wird durch fetchShopifyInventoryData direkt aus Shopify befüllt
  // → alle Produkte dort SIND echte Shopify-Produkte.
  // WICHTIG: Collection-Name wird EXAKT gematcht (nicht per Keyword), damit z.B.
  // #BERGEN aus "Standard Tapes Russisch" NICHT unter "Russische Bondings (Glatt)" landet.
  try {
    // EXAKTE Collection-Namen aus dem Inventar-Sheet → Handle-Mapping
    const LAGER_EXACT_COLL_MAP = {
      "Standard Tapes Russisch":              "russische-normal-tapes",
      "Mini Tapes Glatt":                     "mini-tapes",
      "Invisible Mini Tapes":                 "invisible-mini-tapes",
      "Russische Bondings (Glatt)":           "bondings-glatt",
      "Russische Classic Tressen (Glatt)":    "tressen-russisch-classic",
      "Russische Genius Tressen (Glatt)":     "tressen-russisch-genius",
      "Russische Invisible Tressen (Glatt) | Butterfly Weft":  "tressen-russisch-invisible",
      "Russische Invisible Tressen (Glatt)":  "tressen-russisch-invisible",  // alter Name (Fallback)
      "Tapes Wellig 45cm":                    "tapes-45cm",
      "Tapes Wellig 55cm":                    "tapes-55cm",
      "Tapes Wellig 65cm":                    "tapes-65cm",
      "Tapes Wellig 85cm":                    "tapes-85cm",
      "Bondings wellig 65cm":                 "bondings-65cm",
      "Bondings wellig 85cm":                 "bondings-85cm",
      "Usbekische Classic Tressen (Wellig)":  "tressen-usbekisch-classic",
      "Usbekische Genius Tressen (Wellig)":   "tressen-usbekisch-genius",
    };
    // Bereits in VA_PRODUCT_DATA vorhandene Farben pro Handle sammeln (vollständiger Farbname)
    const existingByHandle = {};
    for (const key in vaProductData) {
      const p = vaProductData[key];
      if (!p.handle || !p.name) continue;
      if (!existingByHandle[p.handle]) existingByHandle[p.handle] = new Set();
      const fc = extractFullColor_(p.name);
      if (fc) existingByHandle[p.handle].add(fc);
    }
    const LAGER_SHEETS = ["Russisch - GLATT", "Usbekisch - WELLIG"];
    let lagerHitsAll = 0;
    for (const sheetName of LAGER_SHEETS) {
      const lSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
      if (!lSheet) continue;
      const lData = lSheet.getDataRange().getValues();
      let currentColl = "";
      for (const lRow of lData) {
        const c0 = String(lRow[0] || "").trim();
        const c1 = String(lRow[1] || "").trim();
        if (!c0 && !c1) continue;
        if (c0.startsWith("Total") || c0.startsWith("GRAND") || c0 === "Collection Name") continue;
        if (c0.startsWith("Zuletzt")) continue;
        if (c0) currentColl = c0;  // EXAKT, nicht toUpperCase!
        if (!c1 || !c1.includes("#")) continue;
        // EXAKTES Collection-Matching (nicht Keyword-basiert)
        const handle = LAGER_EXACT_COLL_MAP[currentColl];
        if (!handle || handle === "clip-extensions") continue;
        // Farbcode: vollständiger Farbname (z.B. "#LATTE BROWN", nicht nur "#LATTE")
        const farbe = extractFullColor_(c1);
        if (!farbe) continue;
        // Prüfen ob diese Farbe unter diesem Handle BEREITS in VA_PRODUCT_DATA existiert
        if (existingByHandle[handle] && existingByHandle[handle].has(farbe)) continue;
        const newKey = "lager|" + handle + "|" + farbe;
        if (!vaProductData[newKey]) {
          vaProductData[newKey] = { name: c1, handle: handle, g90d: 0, g30d: 0, qty90d: 0 };
          if (!existingByHandle[handle]) existingByHandle[handle] = new Set();
          existingByHandle[handle].add(farbe);
          lagerHitsAll++;
          Logger.log("  + " + farbe + " (" + handle + " / " + currentColl + ") ergänzt");
        }
      }
    }
    Logger.log("✅ Schritt 1c: " + lagerHitsAll + " Produkte aus Lagerliste ergänzt (0 Verkäufe in 90T)");
  } catch(eLagerAll) {
    Logger.log("⚠️ Schritt 1c fehlgeschlagen: " + eLagerAll.message);
  }

  // ── Schritt 2: Produkte aus VA_PRODUCT_DATA klassifizieren ──
  // Alle Daten kommen direkt aus dem Verkaufsanalyse-Cache (identische Datenbasis)
  const classified = [];
  let hits = 0, skipped = 0;
  for (const pid in vaProductData) {
    const p = vaProductData[pid];
    const mapping = COLL_MAP[p.handle];
    if (!mapping) { skipped++; continue; }
    // Farbe aus Produktname extrahieren
    // farbe     = vollständiger Farbname bis Stopword (z.B. "#LATTE BROWN") → Schlüssel für Lager-Lookup
    // fullFarbe = alles ab dem ersten "#" bis Zeilenende (z.B. "#3T Pearl White") → Anzeige im Topseller-Tab
    let farbe = extractFullColor_(p.name || "");
    let fullFarbe = "";
    const hashPosC_ = (p.name || "").indexOf("#");
    if (hashPosC_ >= 0) {
      fullFarbe = (p.name || "").substring(hashPosC_).replace(/♡/g, "").trim();
    }
    // Kein #-Farbcode: Produktname als Fallback verwenden (z.B. Clip-ins, Minitapes ohne Farbcode)
    if (!farbe) { farbe = (p.name || "Unbekannt").split(" - ")[0].trim(); fullFarbe = farbe; }
    if (!fullFarbe) fullFarbe = farbe;
    // Clip-Ins: Variante (100g/150g/225g) als Länge verwenden für separate Ranglisten
    const clipVariantLänge = (mapping.typ === "Clip-ins" && p.clipVariant > 0) ? (p.clipVariant + "g") : (mapping.länge || "");
    // collName: exakter Collection-Name für getOrderedWeightForProduct (Unterwegs-Lookup)
    const HANDLE_TO_COLLNAME_TS = {
      "tapes-45cm":                "Tapes Wellig 45cm",
      "tapes-55cm":                "Tapes Wellig 55cm",
      "tapes-65cm":                "Tapes Wellig 65cm",
      "tapes-85cm":                "Tapes Wellig 85cm",
      "bondings-65cm":             "Bondings wellig 65cm",
      "bondings-85cm":             "Bondings wellig 85cm",
      "tressen-usbekisch-classic": "Usbekische Classic Tressen (Wellig)",
      "tressen-usbekisch-genius":  "Usbekische Genius Tressen (Wellig)",
      "russische-normal-tapes":    "Standard Tapes Russisch",
      "tapes-glatt":               "Standard Tapes Russisch",
      "mini-tapes":                "Mini Tapes Glatt",
      "invisible-mini-tapes":      "Invisible Mini Tapes",
      "bondings-glatt":            "Russische Bondings (Glatt)",
      "tressen-russisch-classic":  "Russische Classic Tressen (Glatt)",
      "tressen-russisch-genius":   "Russische Genius Tressen (Glatt)",
      "tressen-russisch-invisible":"Russische Invisible Tressen (Glatt) | Butterfly Weft",
      "clip-extensions":           "Clip In Extensions Echthaar"
    };
    classified.push({
      name: p.name,
      farbe: farbe,
      fullFarbe: fullFarbe || farbe,
      quality: mapping.quality,
      typ: mapping.typ,
      länge: clipVariantLänge,
      clipVariant: p.clipVariant || 0,
      grams_sold: p.g90d || 0,
      qty_sold: p.qty90d || 0,
      grams_sold_30: p.g30d || 0,
      g60d_alt: (p.g60d_alt != null) ? p.g60d_alt : Math.max(0, (p.g90d || 0) - (p.g30d || 0)),
      collName: HANDLE_TO_COLLNAME_TS[p.handle] || ""
    });
    hits++;
  }
  Logger.log("✅ " + hits + " Produkte aus VA-Cache klassifiziert, " + skipped + " übersprungen");

  // ── Ranglisten erstellen ──
  const TYPE_ORDER_WELLIG    = ["Tapes", "Minitapes", "Bondings", "Classic Weft", "Genius Weft"];
  const TYPE_ORDER_RUSSISCH  = ["Standard Tapes", "Minitapes", "Bondings", "Classic Weft", "Genius Weft", "Invisible Weft", "Clip-ins", "Ponytail"];

  const welligRanking   = buildRankingTS_(classified, "Usbekisch Wellig",  TYPE_ORDER_WELLIG,   MIN_GRAMS);
  const russischRanking = buildRankingTS_(classified, "Russisch Glatt",    TYPE_ORDER_RUSSISCH, MIN_GRAMS);

  // ── Tab erstellen ──
  let sheet = ss.getSheetByName("Topseller");
  if (sheet) { sheet.clearContents(); sheet.clearFormats(); }
  else { sheet = ss.insertSheet("Topseller"); }

  // Tab nach Vorschlag-Amanda positionieren (sicher: Index-Prüfung + try/catch)
  try {
    const amandaSheet = ss.getSheetByName("Vorschlag - Amanda");
    if (amandaSheet) {
      const targetIndex = amandaSheet.getIndex() + 1;
      const totalSheets = ss.getSheets().length;
      if (targetIndex >= 1 && targetIndex <= totalSheets) {
        ss.setActiveSheet(sheet);
        ss.moveActiveSheet(targetIndex);
      }
    }
  } catch(e) {
    Logger.log("⚠️ Tab-Positionierung fehlgeschlagen (ignoriert): " + e.message);
  }

  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");
  let row = 1;

  // ── Zeitraum-Eingabe (Spalte Q = 17, außerhalb der Datentabelle) ──
  sheet.getRange(1, 17).setValue("Zeitraum (Tage)").setFontWeight("bold").setBackground("#eeeeee").setFontSize(10);
  sheet.getRange(2, 17).setValue(DAYS).setBackground("#fff9c4").setFontWeight("bold").setFontSize(14).setHorizontalAlignment("center");
  sheet.getRange(3, 17).setValue("↑ Ändern, dann").setFontSize(9).setFontColor("#888888").setFontStyle("italic");
  sheet.getRange(4, 17).setValue("refreshTopseller() ausführen").setFontSize(9).setFontColor("#888888").setFontStyle("italic");
  sheet.setColumnWidth(17, 160);

  // ── Lagerbestand laden für Topseller-Anzeige ──
  const lagerLookup = {}; // key: "handle|farbe" oder "handle|farbe|variant" → totalWeight
  try {
    const invGlattTS = readInventoryRowsFromSheet("Russisch - GLATT");
    const invWelligTS = readInventoryRowsFromSheet("Usbekisch - WELLIG");
    const allInvTS = invGlattTS.concat(invWelligTS);
    // Mapping: Collection-Name → Handle (für Lookup)
    // EXAKTES Mapping Collection-Name → Handle (kein Keyword-Matching!)
    // Verhindert z.B. dass "Bondings wellig 65cm" als "bondings-glatt" gezählt wird
    const COLL_TO_HANDLE_TS = {
      "Standard Tapes Russisch":             "russische-normal-tapes",
      "Mini Tapes Glatt":                    "mini-tapes",
      "Invisible Mini Tapes":                "invisible-mini-tapes",
      "Russische Bondings (Glatt)":          "bondings-glatt",
      "Russische Classic Tressen (Glatt)":   "tressen-russisch-classic",
      "Russische Genius Tressen (Glatt)":    "tressen-russisch-genius",
      "Russische Invisible Tressen (Glatt) | Butterfly Weft": "tressen-russisch-invisible",
      "Russische Invisible Tressen (Glatt)": "tressen-russisch-invisible",  // alter Name (Fallback)
      "Clip In Extensions Echthaar":         "clip-extensions",
      "Clip Extensions":                     "clip-extensions",
      "Clip-In Extensions":                  "clip-extensions",
      "Ponytail Extensions":                 "ponytail-extensions",
      "Tapes Wellig 45cm":                   "tapes-45cm",
      "Tapes Wellig 55cm":                   "tapes-55cm",
      "Tapes Wellig 65cm":                   "tapes-65cm",
      "Tapes Wellig 85cm":                   "tapes-85cm",
      "Bondings wellig 65cm":                "bondings-65cm",
      "Bondings wellig 85cm":                "bondings-85cm",
      "Usbekische Classic Tressen (Wellig)": "tressen-usbekisch-classic",
      "Usbekische Genius Tressen (Wellig)":  "tressen-usbekisch-genius",
    };
    for (const inv of allInvTS) {
      const coll = inv.collection; // EXAKT, nicht .toUpperCase()
      const handle = COLL_TO_HANDLE_TS[coll] || null;
      if (!handle) continue;
      // Farbcode extrahieren (vollständiger Farbname, z.B. "#LATTE BROWN" statt nur "#LATTE")
      const farbe = extractFullColor_(inv.productUpper || inv.product || "");
      if (!farbe) continue;
      // Clip-ins: mit Variante speichern
      if (handle === "clip-extensions" && inv.unitWeight > 0) {
        const clipKey = handle + "|" + farbe + "|" + inv.unitWeight;
        lagerLookup[clipKey] = (lagerLookup[clipKey] || 0) + inv.totalWeight;
      }
      // Immer auch ohne Variante speichern (für Nicht-Clip-in Lookup)
      const baseKey = handle + "|" + farbe;
      lagerLookup[baseKey] = (lagerLookup[baseKey] || 0) + inv.totalWeight;
    }
    Logger.log("✅ Lager-Lookup für Topseller: " + Object.keys(lagerLookup).length + " Einträge");
  } catch(eLagerTS) {
    Logger.log("⚠️ Lager-Lookup für Topseller fehlgeschlagen: " + eLagerTS.message);
  }

  // ── Aktive Bestellungen für Unterwegs-Spalte laden ──
  let chinaOrdersTS_ = [], amandaOrdersTS_ = [];
  try {
    const allOrdersTS_ = getAllOrders();
    chinaOrdersTS_  = allOrdersTS_.filter(o => o.provider === "China");
    amandaOrdersTS_ = allOrdersTS_.filter(o => o.provider === "Amanda");
    Logger.log("✅ Topseller-Unterwegs: " + chinaOrdersTS_.length + " China, " + amandaOrdersTS_.length + " Amanda Bestellungen");
  } catch(eOTS) {
    Logger.log("⚠️ Bestellungen für Topseller-Unterwegs konnten nicht geladen werden: " + eOTS.message);
  }

  // Detailspalten: Startposition + wie viele Bestellspalten benötigt (Maximum aus beiden Typen)
  const DETAIL_START_COL = 15;
  const maxDetailCols = Math.max(chinaOrdersTS_.length, amandaOrdersTS_.length, 0);

  // ── Usbekisch Wellig Tabelle ──
  const welligResult = writeTopsellertabelleTS_(sheet, row, "USBEKISCH WELLIG – Topseller letzte " + DAYS + " Tage  |  " + dateStr,
    welligRanking, TYPE_ORDER_WELLIG, "#1565c0", "#e3f2fd", "Usbekisch Wellig", lagerLookup, chinaOrdersTS_, 60, DETAIL_START_COL, maxDetailCols);
  row = welligResult.row + 2;

  // ── Russisch Glatt Tabelle ──
  const russischResult = writeTopsellertabelleTS_(sheet, row, "RUSSISCH GLATT – Topseller letzte " + DAYS + " Tage  |  " + dateStr,
    russischRanking, TYPE_ORDER_RUSSISCH, "#1b5e20", "#e8f5e9", "Russisch Glatt", lagerLookup, amandaOrdersTS_, 45, DETAIL_START_COL, maxDetailCols);

  // Spaltenbreiten
  sheet.setColumnWidth(1, 45);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 75);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 110);
  sheet.setColumnWidth(6, 90);
  sheet.setColumnWidth(7, 110);  // Prognose Verbrauch
  sheet.setColumnWidth(8, 65);   // Tier
  sheet.setColumnWidth(9, 75);   // Ziel
  sheet.setColumnWidth(10, 80);  // Lager (g)
  sheet.setColumnWidth(11, 90);  // Rang-Klasse
  sheet.setColumnWidth(12, 12);  // Trenner
  sheet.setColumnWidth(13, 95);  // Unterwegs (g)
  sheet.setColumnWidth(14, 30);  // Toggle-Spalte (schmal)

  // ── Detailspalten: Breite + standardmäßig SICHTBAR ──
  for (let i = 0; i < Math.max(maxDetailCols, 1); i++) {
    sheet.setColumnWidth(DETAIL_START_COL + i, 90);
  }
  // Spalten standardmäßig sichtbar (Toggle-Checkbox ist true)
  if (maxDetailCols > 0) {
    sheet.showColumns(DETAIL_START_COL, maxDetailCols);
  }

  // ── Toggle-Checkbox: col 14, row 2 (außerhalb der Haupttabellen-Merge) ──
  // Zeile 1 = Topseller-Haupttitel (merged 1–13). Col 14 ist frei.
  sheet.getRange(1, 14)
    .setValue("▶ Details")
    .setFontWeight("bold").setFontSize(9).setFontColor("#ffffff")
    .setBackground("#555555").setHorizontalAlignment("center");
  const toggleCell = sheet.getRange(2, 14);
  const checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  toggleCell.setDataValidation(checkboxRule).setValue(true)
    .setBackground("#f5f5f5").setHorizontalAlignment("center");
  // Metadaten: Anzahl Detailspalten für onEdit (als Notiz in col 14, row 1)
  sheet.getRange(1, 14).setNote("detailCols:" + maxDetailCols + ";startCol:" + DETAIL_START_COL);

  // ── Übersichts-Daten für Kreisdiagramm (in versteckten Hilfszellen Spalte K) ──
  const welligG   = welligResult.totalGrams;
  const russischG = russischResult.totalGrams;
  const welligG30   = welligResult.totalGrams30;
  const russischG30 = russischResult.totalGrams30;
  const totalG30 = welligG30 + russischG30;

  // Kreisdiagramm erstellen
  const existingCharts = sheet.getCharts();
  for (const c of existingCharts) { sheet.removeChart(c); }

  // Chart + Übersicht NACH den Detailspalten platzieren (damit sie nicht überlappen)
  const INFO_COL = DETAIL_START_COL + Math.max(maxDetailCols, 0) + 1; // Erste freie Spalte nach Details

  // Hilfsdaten für Chart in INFO_COL schreiben (weiße Schrift = unsichtbar)
  sheet.getRange(1, INFO_COL).setValue("Qualität").setFontColor("#ffffff");
  sheet.getRange(2, INFO_COL).setValue("Usbekisch Wellig").setFontColor("#ffffff");
  sheet.getRange(3, INFO_COL).setValue("Russisch Glatt").setFontColor("#ffffff");
  sheet.getRange(1, INFO_COL + 1).setValue("Verkauf 30 Tage (g)").setFontColor("#ffffff");
  sheet.getRange(2, INFO_COL + 1).setValue(welligG30).setFontColor("#ffffff");
  sheet.getRange(3, INFO_COL + 1).setValue(russischG30).setFontColor("#ffffff");

  const chartBuilder = sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange(1, INFO_COL, 3, 2))
    .setPosition(1, INFO_COL, 0, 0)
    .setOption("title", "Verkauf letzte 30 Tage: " + Math.round(totalG30 / 1000) + " kg gesamt")
    .setOption("pieSliceText", "percentage")
    .setOption("legend", { position: "right" })
    .setOption("colors", ["#1565c0", "#1b5e20"])
    .setOption("width", 380)
    .setOption("height", 240)
    .build();
  sheet.insertChart(chartBuilder);

  // Übersichts-Textbox direkt unterhalb Diagramm
  const OV_COL = INFO_COL;
  const OV_ROW = 14; // Zeile 14 (direkt unterhalb Diagramm)
  sheet.getRange(OV_ROW, OV_COL, 1, 2).merge()
    .setValue("📊 Übersicht letzte 30 Tage")
    .setFontWeight("bold").setFontSize(10).setBackground("#eeeeee");
  sheet.getRange(OV_ROW + 1, OV_COL).setValue("Usbekisch Wellig:").setFontSize(9);
  sheet.getRange(OV_ROW + 1, OV_COL + 1).setValue(Math.round(welligG30 / 1000 * 10) / 10 + " kg").setFontSize(9).setFontWeight("bold").setFontColor("#1565c0");
  sheet.getRange(OV_ROW + 2, OV_COL).setValue("Russisch Glatt:").setFontSize(9);
  sheet.getRange(OV_ROW + 2, OV_COL + 1).setValue(Math.round(russischG30 / 1000 * 10) / 10 + " kg").setFontSize(9).setFontWeight("bold").setFontColor("#1b5e20");
  sheet.getRange(OV_ROW + 3, OV_COL).setValue("Gesamt:").setFontSize(9).setFontWeight("bold");
  sheet.getRange(OV_ROW + 3, OV_COL + 1).setValue(Math.round(totalG30 / 1000 * 10) / 10 + " kg").setFontSize(9).setFontWeight("bold");
  sheet.getRange(OV_ROW + 4, OV_COL, 1, 2).merge().setValue("");
  sheet.getRange(OV_ROW + 5, OV_COL).setValue("Budget (2 Wochen):").setFontSize(9);
  sheet.getRange(OV_ROW + 5, OV_COL + 1).setValue("40 kg").setFontSize(9).setFontColor("#888888");
  sheet.getRange(OV_ROW + 6, OV_COL).setValue("Bedarf (2 Wochen):").setFontSize(9);
  sheet.getRange(OV_ROW + 6, OV_COL + 1).setValue(Math.round(totalG30 / 2 / 1000 * 10) / 10 + " kg").setFontSize(9).setFontWeight("bold").setFontColor(totalG30 / 2 > 40000 ? "#c62828" : "#2e7d32");
  sheet.setColumnWidth(INFO_COL, 130);
  sheet.setColumnWidth(INFO_COL + 1, 80);

  // ── Farblegende (Topseller-Tab) ──
  const LEG_ROW = OV_ROW + 8;
  sheet.getRange(LEG_ROW, OV_COL, 1, 2).merge()
    .setValue("🎨 Farblegende")
    .setFontWeight("bold").setFontSize(10).setBackground("#eeeeee");
  sheet.getRange(LEG_ROW + 1, OV_COL).setValue("TOP7 – Bestseller").setFontSize(9).setBackground("#fff9c4").setFontWeight("bold");
  sheet.getRange(LEG_ROW + 1, OV_COL + 1).setValue("Rang 1–7").setFontSize(9).setBackground("#fff9c4").setFontColor("#888888");
  sheet.getRange(LEG_ROW + 2, OV_COL).setValue("MID – Mittelfeld").setFontSize(9).setBackground("#e3f2fd");
  sheet.getRange(LEG_ROW + 2, OV_COL + 1).setValue("Rang 8–14").setFontSize(9).setBackground("#e3f2fd").setFontColor("#888888");
  sheet.getRange(LEG_ROW + 3, OV_COL).setValue("REST – Sonstige").setFontSize(9).setBackground("#ffffff");
  sheet.getRange(LEG_ROW + 3, OV_COL + 1).setValue("Rang 15+").setFontSize(9).setBackground("#ffffff").setFontColor("#888888");
  sheet.getRange(LEG_ROW + 4, OV_COL).setValue("KAUM – Kaum verkauft").setFontSize(9).setBackground("#eeeeee").setFontColor("#aaaaaa");
  sheet.getRange(LEG_ROW + 4, OV_COL + 1).setValue("< 50g").setFontSize(9).setBackground("#eeeeee").setFontColor("#aaaaaa");

  // Topseller-Daten in Script Properties speichern
  saveTopsellerdatenTS_(welligRanking, russischRanking);

  // ─── PRODUKT_G30D: Produktspezifische 30-Tage-Verkaufsdaten speichern ───
  // Hier im Scope von refreshTopseller(), wo vaProductData definiert ist
  try {
    const produktG30d = {};
    for (const pid in vaProductData) {
      const p = vaProductData[pid];
      if (!p.handle || !p.g30d) continue;
      const m = COLL_MAP[p.handle];
      if (!m) continue;
      produktG30d[p.handle] = {
        g30d:    p.g30d,
        name:    p.name || "",
        quality: m.quality || "",
        typ:     m.typ || ""
      };
    }
    saveChunked_(PropertiesService.getScriptProperties(), "PRODUKT_G30D", produktG30d);
    Logger.log("✅ Produktspezifische g30d-Daten gespeichert: " + Object.keys(produktG30d).length + " Produkte");
  } catch(e) {
    Logger.log("⚠️ PRODUKT_G30D konnte nicht gespeichert werden: " + e.message);
  }
  // ─────────────────────────────────────────────────────────────────────────

  Logger.log("✅ Topseller-Tab erstellt.");
  SpreadsheetApp.getUi().alert("✅ Topseller aktualisiert!\n\nLetzte " + DAYS + " Tage ausgewertet.\n\nBitte jetzt createDashboard() ausführen, damit die Bestellvorschläge die neuen Topseller-Daten verwenden.");
}

function getTopsellertage_(ss) {
  const sheet = (ss || SpreadsheetApp.getActiveSpreadsheet()).getSheetByName("Topseller");
  if (sheet) {
    const val = sheet.getRange(2, 9).getValue();
    if (val && !isNaN(val) && Number(val) > 0) return parseInt(val);
  }
  return 90;
}

function classifyProductTS_(name) {
  const n = name.toUpperCase();

  // ── Qualität erkennen ──
  let quality = "Unbekannt";
  if (n.indexOf("WELLIG") !== -1 || n.indexOf("US WELLIG") !== -1) {
    quality = "Usbekisch Wellig";
  } else if (n.indexOf("RUSSISCH") !== -1 || n.indexOf("GLATT") !== -1 || n.indexOf("RUSSIAN") !== -1) {
    quality = "Russisch Glatt";
  }

  // ── Typ erkennen ──
  let typ = "Sonstiges";
  if (n.indexOf("CLIP-IN") !== -1 || n.indexOf("CLIP IN") !== -1) {
    typ = "Clip-ins";
    // Clip-Ins sind immer Amanda / Russisch Glatt, auch wenn kein RUSSISCH/GLATT im Namen
    if (quality === "Unbekannt") quality = "Russisch Glatt";
  } else if (n.indexOf("PONYTAIL") !== -1) {
    typ = "Ponytail";
  } else if (n.indexOf("GENIUS WEFT") !== -1 || n.indexOf("GENIUS TRESSE") !== -1) {
    typ = "Genius Weft";
  } else if (n.indexOf("INVISIBLE") !== -1 && (n.indexOf("WEFT") !== -1 || n.indexOf("TRESSE") !== -1)) {
    typ = "Invisible Weft";
  } else if (n.indexOf("CLASSIC WEFT") !== -1 || n.indexOf("CLASSIC TRESSE") !== -1 ||
             (n.indexOf("TRESSE") !== -1 && n.indexOf("GENIUS") === -1 && n.indexOf("INVISIBLE") === -1) ||
             n.indexOf("TRESSEN") !== -1) {
    typ = "Classic Weft";
  } else if (n.indexOf("BONDING") !== -1 || n.indexOf("KERATIN") !== -1) {
    typ = "Bondings";
  } else if (n.indexOf("MINI TAPE") !== -1 || n.indexOf("MINITAPE") !== -1) {
    typ = "Minitapes";
  } else if (n.indexOf("TAPE") !== -1) {
    // Standard Tapes (Amanda/Russisch) vs. Wellig Tapes (China)
    if (n.indexOf("STANDARD") !== -1 || quality === "Russisch Glatt") {
      typ = "Standard Tapes";
    } else {
      typ = "Tapes";
    }
  }

  // ── Länge erkennen ──
  let länge = "";
  for (const t of name.split(" ")) {
    // Sonderzeichen am Ende entfernen (z.B. '45CM♡' -> '45CM')
    const tu = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (tu.endsWith("CM") && !isNaN(tu.slice(0, -2)) && tu.slice(0, -2).length > 0) {
      länge = tu.toLowerCase(); break;
    }
  }

  // ── Qualität aus Typ+Länge ableiten wenn nicht explizit angegeben ──
  // Viele ältere Produkte haben kein 'WELLIG'/'RUSSISCH' im Namen.
  // Heuristik: Tapes/Bondings/Classic Weft MIT Länge = Usbekisch Wellig
  //            Tapes/Bondings OHNE Länge = Russisch Glatt
  //            Ponytail = immer Usbekisch Wellig
  //            Minitapes = Russisch Glatt (Amanda-Sortiment)
  if (quality === "Unbekannt") {
    if (typ === "Ponytail") {
      quality = "Usbekisch Wellig";
    } else if (typ === "Minitapes") {
      quality = "Russisch Glatt";
    } else if ((typ === "Tapes" || typ === "Bondings" || typ === "Classic Weft" || typ === "Genius Weft") && länge) {
      quality = "Usbekisch Wellig";
    } else if (typ === "Tapes" && !länge) {
      // Tapes ohne Länge: Standard Tapes (Russisch)
      typ = "Standard Tapes";
      quality = "Russisch Glatt";
    } else if (typ === "Bondings" && !länge) {
      quality = "Russisch Glatt";
    } else if (typ === "Invisible Weft" || typ === "Clip-ins") {
      quality = "Russisch Glatt";
    }
  }

  // ── Farbe erkennen ──
  let farbe = "";
  for (const t of name.split(" ")) {
    if (t.startsWith("#")) { farbe = t; break; }
  }

  return { quality, typ, länge, farbe };
}

function buildRankingTS_(classified, qualityFilter, typeOrder, minGrams) {
  // Gruppierung nach typ+länge (jede Länge ist eine eigene Kategorie)
  const byKey = {}; // key: "typ|länge"
  const keyOrder = []; // Reihenfolge der Keys

  // Erst alle möglichen Keys in typeOrder-Reihenfolge sammeln
  for (const p of classified) {
    if (p.quality !== qualityFilter) continue;
    if (!typeOrder.includes(p.typ)) continue;
    const key = p.typ + "|" + (p.länge || "");
    if (!byKey[key]) {
      byKey[key] = { typ: p.typ, länge: p.länge || "", items: [] };
    }
    byKey[key].items.push(p);
  }

  // Keys in typeOrder-Reihenfolge sortieren, dann nach Länge aufsteigend
  const sortedKeys = Object.keys(byKey).sort((a, b) => {
    const [typA, lenA] = a.split("|");
    const [typB, lenB] = b.split("|");
    const typIdxA = typeOrder.indexOf(typA);
    const typIdxB = typeOrder.indexOf(typB);
    if (typIdxA !== typIdxB) return typIdxA - typIdxB;
    return lenA.localeCompare(lenB);
  });

  // Prio-Kategorien: TOP10 statt TOP7, MID20 statt MID14
  // Usbekisch: Tapes 55cm, Tapes 65cm, Bondings 65cm, Genius Weft 65cm
  // Russisch:  Standard Tapes, Bondings, Minitapes
  const PREMIUM_KEYS = ["Tapes|55cm", "Tapes|65cm", "Bondings|65cm", "Genius Weft|65cm", "Standard Tapes|", "Bondings|", "Minitapes|"];

  // Rangliste pro Gruppe berechnen
  const result = {}; // key: "typ|länge" -> items[]
  for (const key of sortedKeys) {
    const { typ, länge, items } = byKey[key];
    const isPremium = PREMIUM_KEYS.includes(key);
    const topLimit = isPremium ? 10 : 7;
    const midLimit = isPremium ? 20 : 14;
    items.sort((a, b) => b.grams_sold - a.grams_sold);
    for (let i = 0; i < items.length; i++) {
      items[i].rang = i + 1;
      items[i].isPremium = isPremium;
      if      (i < topLimit)                        items[i].tier = "TOP7";
      else if (i < midLimit)                        items[i].tier = "MID";
      else if (items[i].grams_sold >= minGrams)     items[i].tier = "REST";
      else                                          items[i].tier = "KAUM";
    }
    result[key] = items;
  }
  // Reihenfolge der Keys merken
  result.__keyOrder__ = sortedKeys;
  return result;
}

/**
 * Schreibt eine Topseller-Tabelle (Usbekisch oder Russisch) in den Topseller-Tab.
 *
 * Spalten-Layout (fest, cols 1–13):
 *   1 Rang | 2 Farbcode | 3 Länge | 4 Verkauft(g) | 5 30T(g) | 6 Stk
 *   7 {forecastDays} Tage Verbrauch  ← ausverkauf-korrigierte Prognose
 *   8 Tier | 9 Ziel(g) | 10 Lager(g) | 11 Rang-Klasse
 *   12 [Trenner] | 13 Unterwegs(g) gesamt
 *
 * Detailspalten (cols DETAIL_START_COL+, standardmäßig versteckt):
 *   Je eine Spalte pro aktiver Bestellung, mit Bestellname als Header.
 *   Toggle via Checkbox in Zeile 2, Spalte TOGGLE_COL (col 14).
 *
 * @param {number} detailStartCol  Erste Spalte für Bestellungsdetails (Standard 15)
 * @param {number} maxDetailCols   Max. Anzahl Detailspalten (über beide Tabellen koordiniert)
 */
function writeTopsellertabelleTS_(sheet, startRow, title, ranking, typeOrder, headerColor, sectionBg, qualityLabel, lagerLookup, orders, forecastDays, detailStartCol, maxDetailCols) {
  const COL_COUNT    = 13;
  const COL_SEP      = 12;
  const COL_UW_TOTAL = 13;
  const SEP_BG       = "#e0e0e0";
  const DETAIL_START = detailStartCol || 15;
  const fDays        = forecastDays   || 30;
  const forecastLabel = fDays + " Tage Verbrauch";

  let row = startRow;
  let totalGrams = 0;
  let totalGrams30 = 0;

  // Haupt-Titel (merged über fixe Spalten 1–13)
  sheet.getRange(row, 1, 1, COL_COUNT).merge()
    .setValue(title)
    .setBackground(headerColor).setFontColor("#ffffff")
    .setFontWeight("bold").setFontSize(13).setHorizontalAlignment("center");
  row++;

  const keyOrder = ranking.__keyOrder__ || Object.keys(ranking).filter(k => k !== "__keyOrder__");

  for (const key of keyOrder) {
    const items = ranking[key];
    if (!items || items.length === 0) continue;

    const pipeIdx  = key.indexOf("|");
    const typ      = pipeIdx >= 0 ? key.substring(0, pipeIdx) : key;
    const länge    = pipeIdx >= 0 ? key.substring(pipeIdx + 1) : "";
    const lenLabel = länge  ? " " + länge.toUpperCase() : "";
    const qualLabel = qualityLabel ? " (" + qualityLabel + ")" : "";
    const sectionLabel = typ + lenLabel + qualLabel;

    // ── Sektion-Header ──
    sheet.getRange(row, 1, 1, COL_COUNT).merge()
      .setValue("── " + sectionLabel + " ──")
      .setBackground(sectionBg).setFontWeight("bold").setFontSize(11).setFontColor(headerColor);
    // Bestellnamen als Header für Detailspalten (gleiche Zeile)
    if (orders && orders.length > 0) {
      for (let oi = 0; oi < orders.length; oi++) {
        const ankunft = calcAnkunft_(orders[oi]);
        const label   = orders[oi].name + (ankunft ? "\n" + ankunft : "");
        sheet.getRange(row, DETAIL_START + oi)
          .setValue(label)
          .setBackground(headerColor).setFontColor("#ffffff")
          .setFontWeight("bold").setFontSize(8).setWrap(true);
      }
    }
    row++;

    // ── Spalten-Header ──
    const headerVals = ["Rang", "Farbcode", "Länge", "Verkauft (g)", "30 Tage (g)", "Verkauft (Stk)", forecastLabel, "Tier", "Ziel (g)", "Lager (g)", "Rang-Klasse", "", "Unterwegs (g)"];
    sheet.getRange(row, 1, 1, COL_COUNT)
      .setValues([headerVals])
      .setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold").setFontSize(9);
    sheet.getRange(row, COL_SEP).setBackground(SEP_BG).setValue("");
    // Header für Detailspalten: Bestelldatum
    if (orders && orders.length > 0) {
      for (let oi = 0; oi < orders.length; oi++) {
        sheet.getRange(row, DETAIL_START + oi)
          .setValue(orders[oi].date)
          .setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold").setFontSize(9);
      }
    }
    row++;

    // ── Datenzeilen ──
    let sectionGrams = 0;
    let sectionGrams30 = 0;
    const sectionIsPremium = items.length > 0 && items[0].isPremium;

    for (const p of items) {
      const ziel      = p.tier === "TOP7" ? (sectionIsPremium ? 2000 : 1000) : p.tier === "MID" ? 500 : p.tier === "REST" ? 300 : 0;
      const rangKlasse = p.tier === "TOP7" ? (sectionIsPremium ? "Top 1–10" : "Top 1–7") : p.tier === "MID" ? (sectionIsPremium ? "Rang 11–20" : "Rang 8–14") : p.tier === "REST" ? "Rest" : "Kaum verkauft";
      const g30 = p.grams_sold_30 || 0;

      // Lagerbestand
      let lagerWert = "";
      if (lagerLookup) {
        if (p.clipVariant > 0) {
          lagerWert = lagerLookup["clip-extensions|" + p.farbe.toUpperCase() + "|" + p.clipVariant] || 0;
        } else {
          const HANDLE_REVERSE = {
            "Russisch Glatt|Standard Tapes":  "russische-normal-tapes",
            "Russisch Glatt|Minitapes":        "mini-tapes",
            "Russisch Glatt|Bondings":         "bondings-glatt",
            "Russisch Glatt|Classic Weft":     "tressen-russisch-classic",
            "Russisch Glatt|Genius Weft":      "tressen-russisch-genius",
            "Russisch Glatt|Invisible Weft":   "tressen-russisch-invisible",
            "Russisch Glatt|Clip-ins":         "clip-extensions",
            "Russisch Glatt|Ponytail":         "ponytail-extensions",
            "Usbekisch Wellig|Classic Weft":   "tressen-usbekisch-classic",
            "Usbekisch Wellig|Genius Weft":    "tressen-usbekisch-genius",
          };
          let handle = HANDLE_REVERSE[p.quality + "|" + p.typ] || null;
          if (!handle && p.quality === "Usbekisch Wellig") {
            if      (p.typ === "Tapes")    handle = "tapes-"    + p.länge;
            else if (p.typ === "Bondings") handle = "bondings-" + p.länge;
          }
          if (handle) lagerWert = lagerLookup[handle + "|" + p.farbe.toUpperCase()] || 0;
        }
      }

      // Prognose: ausverkauf-korrigierte Velocity × forecastDays
      const g60alt      = p.g60d_alt || 0;
      const rateAlt     = g60alt / 60;
      const rateNeu     = g30 / 30;
      let   rateEffektiv = rateNeu;
      if (rateAlt > 0.5 && rateNeu < rateAlt * 0.6) rateEffektiv = rateAlt;
      const prognose = rateEffektiv > 0 ? Math.round(rateEffektiv * fDays) : "";

      // Unterwegs gesamt + pro Bestellung
      let unterwegsGrams = 0;
      const perOrderGrams = []; // für Detailspalten
      if (orders && orders.length > 0 && p.name && p.collName) {
        for (const ord of orders) {
          const w = getOrderedWeightForProduct(p.name, p.collName, ord, p.clipVariant || null);
          perOrderGrams.push(w);
          unterwegsGrams += w;
        }
      }

      // Hauptzeile schreiben
      const displayFarbe = p.fullFarbe || p.farbe;
      sheet.getRange(row, 1, 1, COL_COUNT).setValues([[
        p.rang, displayFarbe, p.länge, p.grams_sold, g30, p.qty_sold,
        prognose, p.tier, ziel, lagerWert, rangKlasse, "", unterwegsGrams > 0 ? unterwegsGrams : ""
      ]]);

      let bg = "#ffffff";
      if      (p.tier === "TOP7") bg = "#fff9c4";
      else if (p.tier === "MID")  bg = "#e3f2fd";
      else if (p.tier === "KAUM") bg = "#eeeeee";
      const fontColor = p.tier === "KAUM" ? "#aaaaaa" : "#000000";
      sheet.getRange(row, 1, 1, COL_COUNT).setBackground(bg).setFontColor(fontColor).setFontSize(10);
      sheet.getRange(row, COL_SEP).setBackground(SEP_BG);

      const lagerKritisch = (lagerWert === 0 || lagerWert === "" || (typeof lagerWert === "number" && lagerWert < 100));
      const keinUnterwegs = unterwegsGrams === 0;

      if (lagerKritisch && keinUnterwegs) {
        // Kritischer Zustand: ausverkauft/unter 100g UND nichts bestellt → Spalten J–M rötlich
        sheet.getRange(row, 10, 1, 4).setBackground("#fde8e8");
        sheet.getRange(row, 10).setFontColor("#c62828").setFontWeight("bold"); // Lager-Wert auffällig
        sheet.getRange(row, COL_SEP).setBackground("#f5c6c6"); // Trenner auch rötlich
      } else if (lagerWert === 0 || lagerWert === "") {
        // Nur ausverkauft, aber Bestellung unterwegs → nur Lager-Zelle rötlich
        sheet.getRange(row, 10).setBackground("#fde8e8").setFontColor("#c62828").setFontWeight("bold");
      }
      if (unterwegsGrams > 0) {
        sheet.getRange(row, COL_UW_TOTAL).setBackground("#e8f5e9").setFontColor("#2e7d32").setFontWeight("bold");
      }
      if (p.tier === "TOP7") {
        sheet.getRange(row, 1).setFontWeight("bold");
        sheet.getRange(row, 2).setFontWeight("bold");
      }

      // Detailspalten: pro Bestellung
      for (let oi = 0; oi < perOrderGrams.length; oi++) {
        const w = perOrderGrams[oi];
        const dc = sheet.getRange(row, DETAIL_START + oi);
        if (w > 0) {
          dc.setValue(w).setBackground("#ceead6").setFontColor("#0d6e27").setFontWeight("bold").setFontSize(10);
        } else {
          dc.setValue("–").setBackground(bg).setFontColor("#cccccc").setFontSize(9);
        }
      }

      sectionGrams  += p.grams_sold;
      sectionGrams30 += g30;
      row++;
    }

    // Summen-Zeile
    const sumRow = ["", "GESAMT", "", sectionGrams, sectionGrams30, "", "", "", "", "", "", "", ""];
    sheet.getRange(row, 1, 1, COL_COUNT)
      .setValues([sumRow])
      .setBackground(sectionBg).setFontWeight("bold").setFontSize(9).setFontColor(headerColor);
    sheet.getRange(row, COL_SEP).setBackground(SEP_BG);
    row++;

    totalGrams  += sectionGrams;
    totalGrams30 += sectionGrams30;
    row++; // Leerzeile
  }
  return { row: row, totalGrams: totalGrams, totalGrams30: totalGrams30 };
}

function saveTopsellerdatenTS_(welligRanking, russischRanking) {
  const data = {};
  function processRanking(ranking, qualityKey) {
    data[qualityKey] = {};
    const keys = ranking.__keyOrder__ || Object.keys(ranking).filter(k => k !== "__keyOrder__");
    for (const key of keys) {
      const items = ranking[key];
      if (!items || !Array.isArray(items)) continue;
      // Key aufteilen: "Tapes|65cm" -> typ="Tapes", länge="65cm"
      const pipeIdx = key.indexOf("|");
      const typ = pipeIdx >= 0 ? key.substring(0, pipeIdx) : key;
      const länge = pipeIdx >= 0 ? key.substring(pipeIdx + 1) : "";
      // Clip-Ins: Schlüssel mit Variante, z.B. "Clip-ins 100g"
      // Andere Typen: nur typ (ohne Länge) – Länge ist für Amanda immer 60cm
      const typKey = (typ === "Clip-ins" && länge) ? (typ + " " + länge) : typ;
      if (!data[qualityKey][typKey]) data[qualityKey][typKey] = {};
      for (const p of items) {
        if (p.farbe) {
          // Nur überschreiben wenn neues Tier besser ist (TOP7 > MID > REST > KAUM)
          const tierRank = { "TOP7": 4, "MID": 3, "REST": 2, "KAUM": 1 };
          const existing = data[qualityKey][typKey][p.farbe];
          const existingTier = existing && typeof existing === "object" ? existing.tier : existing;
          if (!existing || (tierRank[p.tier] || 0) > (tierRank[existingTier] || 0)) {
            data[qualityKey][typKey][p.farbe] = { tier: p.tier, rang: p.rang };
          }
        }
      }
    }
  }
  processRanking(welligRanking, "Usbekisch Wellig");
  processRanking(russischRanking, "Russisch Glatt");
  saveChunked_(PropertiesService.getScriptProperties(), "TOPSELLER_DATA", data);
  Logger.log("✅ Topseller-Daten gespeichert");

}

// Gecachte Varianten von getRangTS_ und getTopsellertierTS_ für Performance-kritische Schleifen
// (kein wiederholter PropertiesService-Aufruf, data wird einmal übergeben)
function getRangTS_cached_(data, quality, typ, farbe, clipVariant) {
  if (!data) return 999;
  try {
    function extractRang(val) { return val && typeof val === "object" ? (val.rang || 999) : 999; }
    if (typ === "Clip-ins" && clipVariant > 0) {
      const typKey = "Clip-ins " + clipVariant + "g";
      if (data[quality] && data[quality][typKey] && data[quality][typKey][farbe]) {
        return extractRang(data[quality][typKey][farbe]);
      }
      return 999;
    }
    if (data[quality] && data[quality][typ] && data[quality][typ][farbe]) {
      return extractRang(data[quality][typ][farbe]);
    }
    const altTyp = (typ === "Standard Tapes") ? "Tapes" : (typ === "Tapes" ? "Standard Tapes" : null);
    if (altTyp && data[quality] && data[quality][altTyp] && data[quality][altTyp][farbe]) {
      return extractRang(data[quality][altTyp][farbe]);
    }
    return 999;
  } catch(e) { return 999; }
}
function getTopsellertierTS_cached_(data, quality, typ, farbe, clipVariant) {
  if (!data) return "REST";
  try {
    function extractTier(val) { return val && typeof val === "object" ? val.tier : val; }
    if (typ === "Clip-ins" && clipVariant > 0) {
      const typKey = "Clip-ins " + clipVariant + "g";
      if (data[quality] && data[quality][typKey] && data[quality][typKey][farbe]) {
        return extractTier(data[quality][typKey][farbe]);
      }
      if (data[quality] && data[quality]["Clip-ins"] && data[quality]["Clip-ins"][farbe]) {
        return extractTier(data[quality]["Clip-ins"][farbe]);
      }
      return "REST";
    }
    if (data[quality] && data[quality][typ] && data[quality][typ][farbe]) {
      return extractTier(data[quality][typ][farbe]);
    }
    const altTyp = (typ === "Standard Tapes") ? "Tapes" : (typ === "Tapes" ? "Standard Tapes" : null);
    if (altTyp && data[quality] && data[quality][altTyp] && data[quality][altTyp][farbe]) {
      return extractTier(data[quality][altTyp][farbe]);
    }
    return "REST";
  } catch(e) { return "REST"; }
}
function getRangTS_(quality, typ, farbe, clipVariant) {
  const raw_ts = PropertiesService.getScriptProperties();
  const rawTsData = loadChunked_(raw_ts, "TOPSELLER_DATA");
  const raw = rawTsData ? JSON.stringify(rawTsData) : null;
  if (!raw) return 999;
  try {
    const data = JSON.parse(raw);
    function extractRang(val) { return val && typeof val === "object" ? (val.rang || 999) : 999; }
    if (typ === "Clip-ins" && clipVariant > 0) {
      const typKey = "Clip-ins " + clipVariant + "g";
      if (data[quality] && data[quality][typKey] && data[quality][typKey][farbe]) {
        return extractRang(data[quality][typKey][farbe]);
      }
      return 999;
    }
    if (data[quality] && data[quality][typ] && data[quality][typ][farbe]) {
      return extractRang(data[quality][typ][farbe]);
    }
    const altTyp = (typ === "Standard Tapes") ? "Tapes" : (typ === "Tapes" ? "Standard Tapes" : null);
    if (altTyp && data[quality] && data[quality][altTyp] && data[quality][altTyp][farbe]) {
      return extractRang(data[quality][altTyp][farbe]);
    }
    return 999;
  } catch(e) { return 999; }
}
function getTopsellertierTS_(quality, typ, farbe, clipVariant) {
  const raw_ts = PropertiesService.getScriptProperties();
  const rawTsData = loadChunked_(raw_ts, "TOPSELLER_DATA");
  const raw = rawTsData ? JSON.stringify(rawTsData) : null;
  if (!raw) return "REST";
  try {
    const data = JSON.parse(raw);
    function extractTier(val) { return val && typeof val === "object" ? val.tier : val; }
    // Clip-Ins: Lookup mit Variante (z.B. "Clip-ins 100g")
    if (typ === "Clip-ins" && clipVariant > 0) {
      const typKey = "Clip-ins " + clipVariant + "g";
      if (data[quality] && data[quality][typKey] && data[quality][typKey][farbe]) {
        return extractTier(data[quality][typKey][farbe]);
      }
      // Fallback: ohne Variante (alte Daten)
      if (data[quality] && data[quality]["Clip-ins"] && data[quality]["Clip-ins"][farbe]) {
        return extractTier(data[quality]["Clip-ins"][farbe]);
      }
      return "REST";
    }
    // Hilfsfunktion: Wert aus TOPSELLER_DATA lesen (unterstützt altes string und neues {tier,rang})
    function extractTier(val) { return val && typeof val === "object" ? val.tier : val; }
    // Direkter Lookup
    if (data[quality] && data[quality][typ] && data[quality][typ][farbe]) {
      return extractTier(data[quality][typ][farbe]);
    }
    // Fallback: Standard Tapes <-> Tapes (Amanda vs. China Benennung)
    const altTyp = (typ === "Standard Tapes") ? "Tapes" : (typ === "Tapes" ? "Standard Tapes" : null);
    if (altTyp && data[quality] && data[quality][altTyp] && data[quality][altTyp][farbe]) {
      return extractTier(data[quality][altTyp][farbe]);
    }
    return "REST";
  } catch(e) { return "REST"; }
}

// Prio-Kategorien mit Mindestziel 1000g:
// Usbekisch: Tapes 55cm, Tapes 65cm, Bondings 65cm, Genius Weft 65cm
// Russisch:  Standard Tapes, Bondings, Mini Tapes
const PREMIUM_COLL_LABELS_ = ["Tapes wellig 55cm", "Tapes wellig 65cm", "Bondings wellig 65cm", "Genius Tressen"];
const PREMIUM_COLL_LABELS_RU_ = ["standard tapes", "bondings", "minitapes", "mini tapes"];
function getZielGramsTS_(quality, typ, farbe, collLabel) {
  const tier = getTopsellertierTS_(quality, typ, farbe);
  const collLower = (collLabel || "").toLowerCase();
  const isPremiumUz = quality === "Usbekisch Wellig" && PREMIUM_COLL_LABELS_.some(l => collLower.includes(l.toLowerCase().split(" ")[0]) && collLower.includes(l.toLowerCase().split(" ").pop()));
  const isPremiumRu = quality === "Russisch Glatt" && PREMIUM_COLL_LABELS_RU_.some(p => collLower.replace(" ", "").includes(p.replace(" ", "")));
  const isPremium = isPremiumUz || isPremiumRu;
  if (tier === "TOP7") return isPremium ? 2000 : 500;  // Premium: 2000g (Topseller-Tab), sonst 500g Minimum
  if (tier === "MID")  return 300;
  if (tier === "REST") return 300;
  return 0; // KAUM → nicht bestellen
}

function shouldOrderTS_(quality, typ, farbe) {
  return getTopsellertierTS_(quality, typ, farbe) !== "KAUM";
}


// ==========================================
// VERKAUFSANALYSE – Zeitreihen-Tab
// ==========================================

function refreshVerkaufsanalyse() {
  // ── Auto-Trigger: Sicherstellen dass die Funktion weiterläuft bis alles fertig ist ──
  // Beim ersten Aufruf (oder wenn noch nicht fertig) wird ein Trigger registriert,
  // der die Funktion nach 30 Sekunden erneut startet. Wenn alles fertig ist, wird
  // der Trigger gelöscht und eine Erfolgsmeldung angezeigt.
  const VA_TRIGGER_KEY = "VA_TRIGGER_ID";
  const props_ = PropertiesService.getScriptProperties();
  const existingCheckpoint_ = (() => { try { return JSON.parse(props_.getProperty("VA_CHECKPOINT") || "null"); } catch(e) { return null; } })();
  const isAlreadyDone = existingCheckpoint_ && existingCheckpoint_.status === "done";

  if (!isAlreadyDone) {
    // Alten Trigger löschen und neuen setzen (läuft in 5 Minuten erneut)
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === "refreshVerkaufsanalyse") ScriptApp.deleteTrigger(t);
    });
    const newTrigger = ScriptApp.newTrigger("refreshVerkaufsanalyse").timeBased().after(5 * 60 * 1000).create();
    props_.setProperty(VA_TRIGGER_KEY, newTrigger.getUniqueId());
    Logger.log("🔄 Auto-Trigger gesetzt (läuft in 5 Min. erneut falls nötig)");
  }

  const SHOP_NAME_VA    = "339520-3";
  const ACCESS_TOKEN_VA = "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";
  const BASE_URL_VA     = "https://" + SHOP_NAME_VA + ".myshopify.com/admin/api/2025-01";

  // ── Konfiguration: Collections ──
  const COLL_MAP_VA = {
    "tapes-45cm":                { quality: "Usbekisch Wellig", label: "Tapes 45cm",         gPerUnit: 25 },
    "tapes-55cm":                { quality: "Usbekisch Wellig", label: "Tapes 55cm",         gPerUnit: 25 },
    "tapes-65cm":                { quality: "Usbekisch Wellig", label: "Tapes 65cm",         gPerUnit: 25 },
    "tapes-85cm":                { quality: "Usbekisch Wellig", label: "Tapes 85cm",         gPerUnit: 25 },
    "bondings-65cm":             { quality: "Usbekisch Wellig", label: "Bondings 65cm",      gPerUnit: 25 },
    "bondings-85cm":             { quality: "Usbekisch Wellig", label: "Bondings 85cm",      gPerUnit: 25 },
    "tressen-usbekisch-classic": { quality: "Usbekisch Wellig", label: "Classic Weft",       gPerUnit: 50 },
    "tressen-usbekisch-genius":  { quality: "Usbekisch Wellig", label: "Genius Weft",        gPerUnit: 50 },
    "ponytail-extensions":       { quality: "Usbekisch Wellig", label: "Ponytail",           gPerUnit: 0   },  // variabel (per Variante, Shopify-Fehler 200g/0g → 130g korrigiert)
    "russische-normal-tapes":    { quality: "Russisch Glatt",   label: "Standard Tapes",    gPerUnit: 25 },
    "tapes-glatt":               { quality: "Russisch Glatt",   label: "Standard Tapes",    gPerUnit: 25 },
    "mini-tapes":                { quality: "Russisch Glatt",   label: "Minitapes",          gPerUnit: 50 },
    "invisible-mini-tapes":      { quality: "Russisch Glatt",   label: "Minitapes",          gPerUnit: 50 },
    "bondings-glatt":            { quality: "Russisch Glatt",   label: "Bondings",           gPerUnit: 25 },
    "tressen-russisch-classic":  { quality: "Russisch Glatt",   label: "Classic Weft",       gPerUnit: 50 },
    "tressen-russisch-genius":   { quality: "Russisch Glatt",   label: "Genius Weft",        gPerUnit: 50 },
    "tressen-russisch-invisible":{ quality: "Russisch Glatt",   label: "Invisible Weft",     gPerUnit: 50 },
    "clip-extensions":           { quality: "Russisch Glatt",   label: "Clip-ins",           gPerUnit: 0  }  // variabel
  };

  // Reihenfolge der Collections pro Qualität (nach Umsatz-Relevanz)
  const ORDER_WELLIG   = ["tapes-55cm","tapes-65cm","bondings-65cm","tressen-usbekisch-genius","tapes-45cm","tapes-85cm","bondings-85cm","tressen-usbekisch-classic","ponytail-extensions"];
  const ORDER_RUSSISCH = ["russische-normal-tapes","bondings-glatt","clip-extensions","mini-tapes","tressen-russisch-genius","tressen-russisch-invisible","tressen-russisch-classic","tapes-glatt","invisible-mini-tapes"];

  // ── Zeitgrenzen ──
  const now       = new Date();
  const nowTs     = now.getTime();
  const msDay     = 24 * 3600 * 1000;
  const ts12M     = nowTs - 365 * msDay;
  const ts3M      = nowTs - 90  * msDay;
  const ts60d     = nowTs - 60  * msDay;  // Für Ausverkauf-Erkennung: Tag 31–90 = "alter" Zeitraum
  const ts30d     = nowTs - 30  * msDay;
  const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const since12M  = new Date(ts12M).toISOString();

  // Tage im aktuellen Monat bis heute
  const daysInCurMonth = (nowTs - curMonthStart) / msDay;
  // Tage in den letzten 12 Monaten
  const days12M = 365;
  const days3M  = 90;

  const props = PropertiesService.getScriptProperties();

  // ── CHECKPOINT-SYSTEM: Daten werden über mehrere Ausführungen hinweg aufgebaut ──
  // Beim ersten Aufruf: Collections + Collects laden, Bestellungen seitenweise laden
  // Bei Folgeaufrufen: weiter ab gespeichertem Cursor laden
  // Wenn fertig: Tab schreiben

  const CHECKPOINT_KEY = "VA_CHECKPOINT";
  const SALES_KEY      = "VA_SALES";
  const COLLMAP_KEY    = "VA_COLLMAP";

  let checkpoint = null;
  try { checkpoint = JSON.parse(props.getProperty(CHECKPOINT_KEY) || "null"); } catch(e) {}

  let collHandleToId, prodToCollIds, sales, productData, variantWeightsVA;

  // Globales Zeitlimit für alle Phasen (4 Min. = 2 Min. Puffer vor GAS 6-Min.-Limit)
  const globalStart = Date.now();
  const GLOBAL_MAX_MS = 4 * 60 * 1000;

  if (!checkpoint || checkpoint.status === "start" || checkpoint.status === "preparing") {
    // ── Vorbereitungsphase: Collections + Collects + Varianten-Gewichte laden ──
    // Diese Phase kann mehrere Minuten dauern und wird mit Checkpoint abgesichert.
    Logger.log("🔄 Vorbereitungsphase: Lade Collections, Collects und Varianten-Gewichte...");

    // Gespeicherten Fortschritt laden (falls Wiederaufnahme)
    const prepRaw = props.getProperty("VA_PREP");
    let prep = prepRaw ? JSON.parse(prepRaw) : { collHandleToId: {}, prodToCollIds: {}, variantWeightsVA: {}, collectNextUrl: null, collectionsDone: false, collectsDone: false, variantsDone: false, clipTitleDone: false };

    // Schritt A: Collections laden (einmalig, schnell)
    if (!prep.collectionsDone) {
      prep.collHandleToId = {};
      for (const endpoint of ["custom_collections", "smart_collections"]) {
        const cr = UrlFetchApp.fetch(BASE_URL_VA + "/" + endpoint + ".json?limit=250&fields=id,handle", {
          headers: { "X-Shopify-Access-Token": ACCESS_TOKEN_VA }, muteHttpExceptions: true
        });
        for (const c of (JSON.parse(cr.getContentText())[endpoint] || [])) {
          prep.collHandleToId[c.handle] = String(c.id);
        }
      }
      prep.collectionsDone = true;
      Logger.log("✅ " + Object.keys(prep.collHandleToId).length + " Collections geladen");
    }

    // Schritt B: Collects laden (seitenweise, mit Zeitlimit-Schutz)
    if (!prep.collectsDone) {
      if (!prep.prodToCollIds) prep.prodToCollIds = {};
      let collectUrl = prep.collectNextUrl || (BASE_URL_VA + "/collects.json?limit=250");
      while (collectUrl) {
        if (Date.now() - globalStart > GLOBAL_MAX_MS) {
          prep.collectNextUrl = collectUrl;
          props.setProperty("VA_PREP", JSON.stringify(prep));
          checkpoint = { status: "preparing" };
          props.setProperty(CHECKPOINT_KEY, JSON.stringify(checkpoint));
          Logger.log("⏸️ Zeitlimit in Vorbereitungsphase (Collects). Auto-Trigger läuft in 5 Min. weiter.");
          return;
        }
        Utilities.sleep(200);
        const cr = UrlFetchApp.fetch(collectUrl, {
          headers: { "X-Shopify-Access-Token": ACCESS_TOKEN_VA }, muteHttpExceptions: true
        });
        const cd = JSON.parse(cr.getContentText());
        for (const c of (cd.collects || [])) {
          const pid = String(c.product_id);
          if (!prep.prodToCollIds[pid]) prep.prodToCollIds[pid] = [];
          prep.prodToCollIds[pid].push(String(c.collection_id));
        }
        const lh = cr.getHeaders()["Link"] || "";
        collectUrl = null;
        if (lh.indexOf('rel="next"') !== -1) {
          for (const part of lh.split(",")) {
            if (part.indexOf('rel="next"') !== -1) {
              const m = part.match(/<([^>]+)>/); if (m) { collectUrl = m[1]; break; }
            }
          }
        }
      }
      prep.collectsDone = true;
      prep.collectNextUrl = null;
      Logger.log("✅ " + Object.keys(prep.prodToCollIds).length + " Produkte mit Collections geladen");
    }

    // Schritt C: Varianten-Gewichte für Clip-ins UND Ponytails laden
    // Gleichzeitig: Alle Clip-In Produkte zu prodToCollIds hinzufügen (auch wenn nicht in /collects.json)
    if (!prep.variantsDone) {
      if (!prep.variantWeightsVA) prep.variantWeightsVA = {};
      for (const varHandle of ["clip-extensions", "ponytail-extensions"]) {
        const collId = prep.collHandleToId[varHandle];
        if (!collId) continue;
        // Alle Produkte der Collection laden (seitenweise)
        let prodUrl = BASE_URL_VA + "/collections/" + collId + "/products.json?limit=250&fields=id,title";
        while (prodUrl) {
          Utilities.sleep(300);
          const cpr = UrlFetchApp.fetch(prodUrl, {
            headers: { "X-Shopify-Access-Token": ACCESS_TOKEN_VA }, muteHttpExceptions: true
          });
          const cprData = JSON.parse(cpr.getContentText());
          for (const prod of (cprData.products || [])) {
            if (Date.now() - globalStart > GLOBAL_MAX_MS) {
              props.setProperty("VA_PREP", JSON.stringify(prep));
              checkpoint = { status: "preparing" };
              props.setProperty(CHECKPOINT_KEY, JSON.stringify(checkpoint));
              Logger.log("⏸️ Zeitlimit in Vorbereitungsphase (Varianten). Auto-Trigger läuft in 5 Min. weiter.");
              return;
            }
            const pid = String(prod.id);
            // Sicherstellen dass dieses Produkt in prodToCollIds als clip-extensions bekannt ist
            // (manche Produkte fehlen in /collects.json wenn sie nur in Smart Collections sind)
            if (varHandle === "clip-extensions") {
              if (!prep.prodToCollIds[pid]) prep.prodToCollIds[pid] = [];
              if (!prep.prodToCollIds[pid].includes(collId)) prep.prodToCollIds[pid].push(collId);
            }
            Utilities.sleep(100);
            const vr = UrlFetchApp.fetch(BASE_URL_VA + "/products/" + prod.id + "/variants.json", {
              headers: { "X-Shopify-Access-Token": ACCESS_TOKEN_VA }, muteHttpExceptions: true
            });
            for (const v of (JSON.parse(vr.getContentText()).variants || [])) {
              let g = v.grams || 0;
              // Ponytail: Shopify hat oft 0g oder 200g als Fehler → korrekt: 130g
              if (varHandle === "ponytail-extensions" && (g === 0 || g === 200)) g = 130;
              // Clip-Ins: Variantentitel HAT IMMER VORRANG vor grams
              // (Shopify speichert grams oft falsch, z.B. alle Varianten mit 150g)
              if (varHandle === "clip-extensions") {
                const titleMatch = (v.title || "").match(/(\d+)\s*g/i);
                if (titleMatch) g = parseInt(titleMatch[1], 10);
                // 250g ist ein Shopify-Fehler → korrigieren auf 225g
                if (g === 250) g = 225;
              }
              prep.variantWeightsVA[String(v.id)] = g;
            }
          }
          // Nächste Seite?
          const lhC = cpr.getHeaders()["Link"] || "";
          prodUrl = null;
          if (lhC.indexOf('rel="next"') !== -1) {
            for (const part of lhC.split(",")) {
              if (part.indexOf('rel="next"') !== -1) {
                const m = part.match(/<([^>]+)>/); if (m) { prodUrl = m[1]; break; }
              }
            }
          }
        }
      }
      prep.variantsDone = true;
      Logger.log("✅ Varianten-Gewichte geladen (Clip-ins + Ponytails): " + Object.keys(prep.variantWeightsVA).length + " Varianten");
    }
    // Schritt D: Clip-Ins über Produkttitel erkennen (Fallback für Produkte nicht in Collection)
    // Sucht alle Produkte mit "CLIP" im Titel und ordnet sie clip-extensions zu
    if (!prep.clipTitleDone) {
      const clipCollId = prep.collHandleToId["clip-extensions"];
      if (clipCollId) {
        let clipProdUrl = BASE_URL_VA + "/products.json?limit=250&fields=id,title";
        while (clipProdUrl) {
          Utilities.sleep(300);
          const cpr2 = UrlFetchApp.fetch(clipProdUrl, {
            headers: { "X-Shopify-Access-Token": ACCESS_TOKEN_VA }, muteHttpExceptions: true
          });
          const cprData2 = JSON.parse(cpr2.getContentText());
          let newClipCount = 0;
          for (const prod of (cprData2.products || [])) {
            // Nur Produkte mit "CLIP" im Titel verarbeiten
            if (!(prod.title || "").toUpperCase().includes("CLIP")) continue;
            const pid = String(prod.id);
            if (!prep.prodToCollIds[pid]) prep.prodToCollIds[pid] = [];
            if (!prep.prodToCollIds[pid].includes(clipCollId)) {
              prep.prodToCollIds[pid].push(clipCollId);
              newClipCount++;
            }
            // Varianten-Gewichte laden falls noch nicht vorhanden
            Utilities.sleep(100);
            const vr2 = UrlFetchApp.fetch(BASE_URL_VA + "/products/" + prod.id + "/variants.json", {
              headers: { "X-Shopify-Access-Token": ACCESS_TOKEN_VA }, muteHttpExceptions: true
            });
            for (const v of (JSON.parse(vr2.getContentText()).variants || [])) {
              if (prep.variantWeightsVA[String(v.id)] !== undefined) continue; // bereits geladen
              // Clip-Ins: Variantentitel HAT IMMER VORRANG vor grams
              let g = 0;
              const titleMatchD = (v.title || "").match(/(\d+)\s*g/i);
              if (titleMatchD) {
                g = parseInt(titleMatchD[1], 10);
              } else {
                g = v.grams || 0;
              }
              if (g === 250) g = 225;
              prep.variantWeightsVA[String(v.id)] = g;
            }
          }
          Logger.log("📎 Clip-Titel-Suche: " + (cprData2.products || []).length + " Produkte, " + newClipCount + " neu zugeordnet");
          // Nächste Seite?
          const lhD = cpr2.getHeaders()["Link"] || "";
          clipProdUrl = null;
          if (lhD.indexOf('rel="next"') !== -1) {
            for (const part of lhD.split(",")) {
              if (part.indexOf('rel="next"') !== -1) {
                const m = part.match(/<([^>]+)>/); if (m) { clipProdUrl = m[1]; break; }
              }
            }
          }
        }
      }
      prep.clipTitleDone = true;
    }

    // Vorbereitungsphase abgeschlossen → in COLLMAP speichern
    saveChunked_(props, COLLMAP_KEY, { collHandleToId: prep.collHandleToId, prodToCollIds: prep.prodToCollIds, variantWeightsVA: prep.variantWeightsVA });
    props.deleteProperty("VA_PREP"); // Zwischenspeicher löschen
    // Variablen für nachfolgende Loading-Phase setzen
    collHandleToId   = prep.collHandleToId;
    prodToCollIds    = prep.prodToCollIds;
    variantWeightsVA = prep.variantWeightsVA || {};

    // Sales und pro-Produkt-Daten initialisieren
    sales = {};
    for (const handle of Object.keys(COLL_MAP_VA)) {
      sales[handle] = { stk12M:0, g12M:0, umsatz12M:0, stk3M:0, g3M:0, umsatz3M:0, stk30d:0, g30d:0, umsatz30d:0, stkCurM:0, gCurM:0, umsatzCurM:0 };
    }
    productData = {};
    props.setProperty(SALES_KEY, JSON.stringify(sales));
    saveChunked_(props, "VA_PRODUCT_DATA", productData);

    // Checkpoint auf "loading" setzen
    const firstUrl = BASE_URL_VA + "/orders.json"
      + "?status=any&created_at_min=" + since12M
      + "&financial_status=paid&limit=250&fields=id,created_at,line_items";
    checkpoint = { status: "loading", nextUrl: firstUrl, page: 0 };
    props.setProperty(CHECKPOINT_KEY, JSON.stringify(checkpoint));
    Logger.log("✅ Vorbereitungsphase abgeschlossen. Starte Bestellungen laden...");
  } else {
    // Gespeicherte Daten laden
    const cm = loadChunked_(props, COLLMAP_KEY);
    if (!cm) {
      // Kein Mapping mehr → von vorne
      props.deleteProperty(CHECKPOINT_KEY);
      SpreadsheetApp.getUi().alert("⚠️ Checkpoint-Daten fehlen. Bitte refreshVerkaufsanalyse() erneut ausführen.");
      return;
    }
    collHandleToId = cm.collHandleToId;
    prodToCollIds  = cm.prodToCollIds;
    variantWeightsVA = cm.variantWeightsVA || {};
    const salesRaw = props.getProperty(SALES_KEY);
    sales = salesRaw ? JSON.parse(salesRaw) : {};
    productData = loadChunked_(props, "VA_PRODUCT_DATA") || {};
    // Fehlende Handles initialisieren
    for (const handle of Object.keys(COLL_MAP_VA)) {
      if (!sales[handle]) sales[handle] = { stk12M:0, g12M:0, umsatz12M:0, stk3M:0, g3M:0, umsatz3M:0, stk30d:0, g30d:0, umsatz30d:0, stkCurM:0, gCurM:0, umsatzCurM:0 };
    }
  }

  // Hilfsfunktion: product_id → COLL_MAP_VA-Eintrag (spezifischste Collection gewinnt)
  function getCollMapping(pid) {
    const cids = prodToCollIds[String(pid)] || [];
    let best = null, bestScore = -1;
    for (const cid of cids) {
      for (const handle in collHandleToId) {
        if (collHandleToId[handle] === cid) {
          const m = COLL_MAP_VA[handle];
          if (!m) continue;
          // Spezifischster Handle gewinnt: längerer Handle = mehr Kontext = spezifischer
          // z.B. "tapes-85cm" (10 Zeichen) > "tapes" (5 Zeichen) > "tapes-wellig" (12 Zeichen, aber kein COLL_MAP_VA Eintrag)
          const score = handle.length;
          if (score > bestScore) { best = { handle: handle, ...m }; bestScore = score; }
        }
      }
    }
    return best;
  }

  // ── Bestellungen laden (seitenweise, mit Zeitlimit-Schutz) ──
  if (checkpoint.status === "loading") {
    let orderUrl = checkpoint.nextUrl;
    let page = checkpoint.page || 0;

    while (orderUrl) {
      // Zeitlimit prüfen (globalStart gilt für die gesamte Ausführung inkl. Vorbereitungsphase)
      if (Date.now() - globalStart > GLOBAL_MAX_MS) {
        // Zwischenspeichern und abbrechen
        props.setProperty(SALES_KEY, JSON.stringify(sales));
        saveChunked_(props, "VA_PRODUCT_DATA", productData);
        checkpoint.nextUrl = orderUrl;
        checkpoint.page = page;
        props.setProperty(CHECKPOINT_KEY, JSON.stringify(checkpoint));
        Logger.log("⏸️ Zeitlimit erreicht nach Seite " + page + ". Auto-Trigger läuft in 5 Min. weiter.");
        return;
      }

      const resp = UrlFetchApp.fetch(orderUrl, {
        headers: { "X-Shopify-Access-Token": ACCESS_TOKEN_VA }, muteHttpExceptions: true
      });
      const data = JSON.parse(resp.getContentText());
      const orders = data.orders || [];
      page++;

      for (const order of orders) {
        const orderTs = order.created_at ? new Date(order.created_at).getTime() : 0;
        const in12M   = orderTs >= ts12M;
        const in3M    = orderTs >= ts3M;
        const in30d   = orderTs >= ts30d;
        const inCurM  = orderTs >= curMonthStart;

        for (const item of (order.line_items || [])) {
          const pid = String(item.product_id || "");
          if (!pid) continue;
          const m = getCollMapping(pid);
          if (!m) continue;
          const handle = m.handle;
          const qty = item.quantity || 0;
          const price = parseFloat(item.price || 0) * qty;
          let gPerUnit;
          if (m.gPerUnit > 0) {
            gPerUnit = m.gPerUnit; // Festes Gewicht
          } else {
            // Variantes Gewicht (Clip-ins): aus vorab geladenen Varianten-Gewichten
            const vid = String(item.variant_id || "");
            gPerUnit = variantWeightsVA[vid] || item.grams || 0;
            // Fallback: Gewicht aus Variantentitel extrahieren wenn noch 0
            if (gPerUnit === 0) {
              const varTitle = item.variant_title || item.name || "";
              const wm = varTitle.match(/(\d+)\s*g/i);
              if (wm) gPerUnit = parseInt(wm[1], 10);
            }
            // 250g ist ein Shopify-Fehler → korrigieren auf 225g
            if (gPerUnit === 250) gPerUnit = 225;
          }
          const g = qty * gPerUnit;

          if (in12M)  { sales[handle].stk12M  += qty; sales[handle].g12M  += g; sales[handle].umsatz12M  += price; }
          if (in3M)   { sales[handle].stk3M   += qty; sales[handle].g3M   += g; sales[handle].umsatz3M   += price; }
          if (in30d)  { sales[handle].stk30d  += qty; sales[handle].g30d  += g; sales[handle].umsatz30d  += price; }
          if (inCurM) { sales[handle].stkCurM += qty; sales[handle].gCurM += g; sales[handle].umsatzCurM += price; }

          // Pro-Produkt-Tracking für Topseller (90 Tage + 30 Tage + 60d_alt für Ausverkauf-Erkennung)
          const in90d   = orderTs >= (nowTs - 90 * msDay);
          const in60d   = orderTs >= ts60d;  // innerhalb der letzten 60 Tage
          const in60alt = in90d && !in60d;   // Tag 31–90 = "alter" Zeitraum (vor den letzten 30 Tagen)
          if (in90d || in30d) {
            const name90 = (item.name || "").split(" - ")[0].trim();
            // Clip-Ins: Key mit Varianten-Gewicht, damit 100g/150g/225g separat gerankt werden
            const trackKey = (m.gPerUnit === 0 && gPerUnit > 0) ? (pid + "|" + gPerUnit) : pid;
            const trackName = (m.gPerUnit === 0 && gPerUnit > 0) ? (name90 + " [" + gPerUnit + "g]") : name90;
            if (!productData[trackKey]) productData[trackKey] = { name: trackName, handle: handle, g90d: 0, g30d: 0, g60d_alt: 0, qty90d: 0, clipVariant: (m.gPerUnit === 0 ? gPerUnit : 0) };
            if (in90d)   { productData[trackKey].g90d += g; productData[trackKey].qty90d += qty; }
            if (in30d)     productData[trackKey].g30d += g;
            if (in60alt)   productData[trackKey].g60d_alt += g;  // Tag 31–90: "alter" Zeitraum für Ausverkauf-Erkennung
          }
        }
      }

      Logger.log("Seite " + page + ": " + orders.length + " Bestellungen");

      const lh = resp.getHeaders()["Link"] || "";
      orderUrl = null;
      if (lh.indexOf('rel="next"') !== -1) {
        for (const part of lh.split(",")) {
          if (part.indexOf('rel="next"') !== -1) {
            const m = part.match(/<([^>]+)>/); if (m) { orderUrl = m[1]; break; }
          }
        }
      }
    }

    // Alle Seiten geladen
    checkpoint.status = "done";
    props.setProperty(CHECKPOINT_KEY, JSON.stringify(checkpoint));
    props.setProperty(SALES_KEY, JSON.stringify(sales));
    saveChunked_(props, "VA_PRODUCT_DATA", productData);
    Logger.log("✅ Alle Bestellungen geladen (" + page + " Seiten) | " + Object.keys(productData).length + " Produkte getrackt");
  } else if (checkpoint.status === "done") {
    // Bereits fertig geladen → nur Tab neu schreiben
    Logger.log("✅ Verwende gecachte Bestelldaten (status=done)");
    productData = loadChunked_(props, "VA_PRODUCT_DATA") || {};
  }

  // Checkpoint nach erfolgreichem Laden löschen (Speicherplatz freigeben)
  if (checkpoint && checkpoint.status === "done") {
    // Checkpoint bleibt für nächste Ausführung erhalten (Tab-Neuschreiben ohne Reload)
    // props.deleteProperty(CHECKPOINT_KEY); // Nur löschen wenn Neustart gewünscht
  }

  // ── Aggregation: Duplikate zusammenfassen (z.B. russische-normal-tapes + tapes-glatt → Standard Tapes) ──
  // Wir fassen nach label+quality zusammen
  const agg = {}; // key = quality + "|" + label
  for (const handle of Object.keys(COLL_MAP_VA)) {
    const m = COLL_MAP_VA[handle];
    const key = m.quality + "|" + m.label;
    if (!agg[key]) {
      agg[key] = { quality: m.quality, label: m.label, gPerUnit: m.gPerUnit,
        stk12M:0, g12M:0, umsatz12M:0, stk3M:0, g3M:0, umsatz3M:0,
        stk30d:0, g30d:0, umsatz30d:0, stkCurM:0, gCurM:0, umsatzCurM:0 };
    }
    const s = sales[handle];
    agg[key].stk12M  += s.stk12M;  agg[key].g12M  += s.g12M;  agg[key].umsatz12M  += s.umsatz12M;
    agg[key].stk3M   += s.stk3M;   agg[key].g3M   += s.g3M;   agg[key].umsatz3M   += s.umsatz3M;
    agg[key].stk30d  += s.stk30d;  agg[key].g30d  += s.g30d;  agg[key].umsatz30d  += s.umsatz30d;
    agg[key].stkCurM += s.stkCurM; agg[key].gCurM += s.gCurM; agg[key].umsatzCurM += s.umsatzCurM;
  }

  // Durchschnittswerte berechnen (pro Monat)
  for (const key in agg) {
    const a = agg[key];
    a.avgG12M  = a.g12M  / 12;
    a.avgG3M   = a.g3M   / 3;
    a.avgU12M  = a.umsatz12M  / 12;
    a.avgU3M   = a.umsatz3M   / 3;
    // Trend: letzte 30 Tage vs. Ø3M-Monatsdurchschnitt
    const trend = a.avgG3M > 0 ? ((a.g30d - a.avgG3M) / a.avgG3M * 100) : 0;
    a.trend = trend;
    a.trendStr = (trend > 10 ? "↑ +" : (trend < -10 ? "↓ " : "→ ")) + Math.round(trend) + "%";
  }

  // ── Tab erstellen ──
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Verkaufsanalyse");
  if (!sheet) {
    sheet = ss.insertSheet("Verkaufsanalyse");
    // Tab nach Topseller einsortieren
    const tsSheet = ss.getSheetByName("Topseller");
    if (tsSheet) ss.setActiveSheet(tsSheet);
  }
  sheet.clear();
  sheet.clearFormats();

  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");

  // ── Farben ──
  const C_HEADER_WELLIG  = "#1565C0"; // dunkelblau
  const C_HEADER_RUSSISCH= "#2E7D32"; // dunkelgrün
  const C_SUBHEADER      = "#E3F2FD"; // hellblau
  const C_SUBHEADER_RU   = "#E8F5E9"; // hellgrün
  const C_SUM_WELLIG     = "#BBDEFB";
  const C_SUM_RUSSISCH   = "#C8E6C9";
  const C_TOTAL          = "#37474F"; // dunkelgrau
  const C_TREND_UP       = "#1B5E20"; // dunkelgrün Text
  const C_TREND_DOWN     = "#B71C1C"; // dunkelrot Text
  const C_TREND_NEUTRAL  = "#37474F";

  // Spaltenbreiten
  sheet.setColumnWidth(1, 30);   // Leer
  sheet.setColumnWidth(2, 200);  // Collection
  sheet.setColumnWidth(3, 80);   // g/Stk
  sheet.setColumnWidth(4, 90);   // Ø12M kg
  sheet.setColumnWidth(5, 90);   // Ø12M €
  sheet.setColumnWidth(6, 90);   // Ø3M kg
  sheet.setColumnWidth(7, 90);   // Ø3M €
  sheet.setColumnWidth(8, 90);   // 30 Tage kg
  sheet.setColumnWidth(9, 90);   // 30 Tage €
  sheet.setColumnWidth(10, 100); // Akt. Monat kg
  sheet.setColumnWidth(11, 100); // Akt. Monat €
  sheet.setColumnWidth(12, 90);  // Trend
  sheet.setColumnWidth(13, 30);  // Leer
  sheet.setColumnWidth(14, 160); // Diagramm-Bereich
  sheet.setColumnWidth(15, 160);

  let row = 1;

  // ── Titel ──
  const titleRange = sheet.getRange(row, 1, 1, 12);
  titleRange.merge();
  titleRange.setValue("VERKAUFSANALYSE – Letzte 12 Monate  |  " + dateStr);
  titleRange.setBackground(C_TOTAL).setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(13).setHorizontalAlignment("center");
  row++;

  // ── Hinweis-Zeile ──
  sheet.getRange(row, 2, 1, 11).merge()
    .setValue("Gewichte: Tapes/Bondings = 25g/Stk · Minitapes = 50g/Stk · Classic/Genius/Invisible Weft = 50g/Stk · Ponytail = variabel (Shopify-Gewicht, korrigiert) · Clip-ins = variabel")
    .setFontSize(9).setFontColor("#666666").setFontStyle("italic");
  row += 2;

  // ── Spalten-Header ──
  function writeColHeader(r) {
    const headers = ["", "Collection", "g/Stk", "Ø 12M (kg)", "Ø 12M (€)", "Ø 3M (kg)", "Ø 3M (€)", "30 Tage (kg)", "30 Tage (€)", "Akt. Monat (kg)", "Akt. Monat (€)", "Trend"];
    sheet.getRange(r, 1, 1, 12).setValues([headers])
      .setBackground("#455A64").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(10)
      .setHorizontalAlignment("center");
    sheet.getRange(r, 2).setHorizontalAlignment("left");
  }

  // ── Hilfsfunktion: Zeile schreiben ──
  function writeDataRow(r, label, gPerUnit, a, bgColor, bold) {
    const gStr = gPerUnit === 0 ? "var." : gPerUnit + "g";
    const vals = [
      "", label, gStr,
      a.avgG12M > 0 ? Math.round(a.avgG12M / 1000 * 100) / 100 : 0,
      a.avgU12M > 0 ? Math.round(a.avgU12M) : 0,
      a.avgG3M  > 0 ? Math.round(a.avgG3M  / 1000 * 100) / 100 : 0,
      a.avgU3M  > 0 ? Math.round(a.avgU3M)  : 0,
      a.g30d    > 0 ? Math.round(a.g30d     / 1000 * 100) / 100 : 0,
      a.umsatz30d > 0 ? Math.round(a.umsatz30d) : 0,
      a.gCurM   > 0 ? Math.round(a.gCurM    / 1000 * 100) / 100 : 0,
      a.umsatzCurM > 0 ? Math.round(a.umsatzCurM) : 0,
      a.trendStr
    ];
    const range = sheet.getRange(r, 1, 1, 12);
    range.setValues([vals]);
    if (bgColor) range.setBackground(bgColor);
    if (bold) range.setFontWeight("bold");
    // Trend-Farbe
    const trendCell = sheet.getRange(r, 12);
    if (a.trend > 10)       trendCell.setFontColor(C_TREND_UP).setFontWeight("bold");
    else if (a.trend < -10) trendCell.setFontColor(C_TREND_DOWN).setFontWeight("bold");
    else                    trendCell.setFontColor(C_TREND_NEUTRAL);
    // Zahlenformat für kg-Spalten
    sheet.getRange(r, 4).setNumberFormat("0.00");
    sheet.getRange(r, 6).setNumberFormat("0.00");
    sheet.getRange(r, 8).setNumberFormat("0.00");
    sheet.getRange(r, 10).setNumberFormat("0.00");
    // Zahlenformat für €-Spalten
    sheet.getRange(r, 5).setNumberFormat("#,##0 €");
    sheet.getRange(r, 7).setNumberFormat("#,##0 €");
    sheet.getRange(r, 9).setNumberFormat("#,##0 €");
    sheet.getRange(r, 11).setNumberFormat("#,##0 €");
  }

  // ── Summenzeile schreiben ──
  function writeSumRow(r, label, rows, bgColor, fontColor) {
    const sum = { avgG12M:0, avgU12M:0, avgG3M:0, avgU3M:0, g30d:0, umsatz30d:0, gCurM:0, umsatzCurM:0, trend:0 };
    for (const a of rows) {
      sum.avgG12M  += a.avgG12M;  sum.avgU12M  += a.avgU12M;
      sum.avgG3M   += a.avgG3M;   sum.avgU3M   += a.avgU3M;
      sum.g30d     += a.g30d;     sum.umsatz30d+= a.umsatz30d;
      sum.gCurM    += a.gCurM;    sum.umsatzCurM += a.umsatzCurM;
    }
    // Trend der Summe
    sum.trend = sum.avgG3M > 0 ? ((sum.g30d - sum.avgG3M) / sum.avgG3M * 100) : 0;
    sum.trendStr = (sum.trend > 10 ? "↑ +" : (sum.trend < -10 ? "↓ " : "→ ")) + Math.round(sum.trend) + "%";
    writeDataRow(r, label, -1, sum, bgColor, true);
    if (fontColor) sheet.getRange(r, 1, 1, 12).setFontColor(fontColor);
  }

  // ── USBEKISCH WELLIG ──
  const welligHeaderRange = sheet.getRange(row, 1, 1, 12);
  welligHeaderRange.merge();
  welligHeaderRange.setValue("USBEKISCH WELLIG");
  welligHeaderRange.setBackground(C_HEADER_WELLIG).setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(12).setHorizontalAlignment("center");
  row++;

  writeColHeader(row);
  row++;

  const welligRows = [];
  const welligHandlesDone = new Set();
  for (const handle of ORDER_WELLIG) {
    const m = COLL_MAP_VA[handle];
    if (!m) continue;
    const key = m.quality + "|" + m.label;
    if (welligHandlesDone.has(key)) continue;
    welligHandlesDone.add(key);
    const a = agg[key];
    if (!a) continue;
    writeDataRow(row, m.label, m.gPerUnit, a, null, false);
    welligRows.push(a);
    row++;
  }
  // Summe Usbekisch
  writeSumRow(row, "SUMME USBEKISCH WELLIG", welligRows, C_SUM_WELLIG, "#0D47A1");
  const welligSumRow = row;
  row += 2;

  // ── RUSSISCH GLATT ──
  const russischHeaderRange = sheet.getRange(row, 1, 1, 12);
  russischHeaderRange.merge();
  russischHeaderRange.setValue("RUSSISCH GLATT");
  russischHeaderRange.setBackground(C_HEADER_RUSSISCH).setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(12).setHorizontalAlignment("center");
  row++;

  writeColHeader(row);
  row++;

  const russischRows = [];
  const russischHandlesDone = new Set();
  for (const handle of ORDER_RUSSISCH) {
    const m = COLL_MAP_VA[handle];
    if (!m) continue;
    const key = m.quality + "|" + m.label;
    if (russischHandlesDone.has(key)) continue;
    russischHandlesDone.add(key);
    const a = agg[key];
    if (!a) continue;
    writeDataRow(row, m.label, m.gPerUnit, a, null, false);
    russischRows.push(a);
    row++;
  }
  // Summe Russisch
  writeSumRow(row, "SUMME RUSSISCH GLATT", russischRows, C_SUM_RUSSISCH, "#1B5E20");
  const russischSumRow = row;
  row += 2;

  // ── GESAMT ──
  const allRows = [...welligRows, ...russischRows];
  writeSumRow(row, "GESAMT", allRows, C_TOTAL, "#FFFFFF");
  const gesamtRow = row;
  row += 2;

  // ── Legende / Erklärung ──
  sheet.getRange(row, 2, 1, 11).merge()
    .setValue("Trend = Vergleich der letzten 30 Tage mit dem Ø3-Monats-Monatsdurchschnitt. ↑ > +10% · → ±10% · ↓ < -10%")
    .setFontSize(9).setFontColor("#666666").setFontStyle("italic");
  row += 2;

  // ── Kreisdiagramm: Usbekisch vs. Russisch (Ø3M kg) ──
  // Daten für Diagramm in Hilfsspalten schreiben (Spalte 14-15)
  const chartDataRow = row;
  sheet.getRange(chartDataRow,     14).setValue("Usbekisch Wellig");
  sheet.getRange(chartDataRow,     15).setValue(Math.round(agg["Usbekisch Wellig|Tapes 55cm"] ? 0 : 0)); // Platzhalter
  sheet.getRange(chartDataRow + 1, 14).setValue("Russisch Glatt");
  sheet.getRange(chartDataRow + 1, 15).setValue(0);

  // Summen für Diagramm berechnen
  let welligG3M = 0, russischG3M = 0;
  for (const a of welligRows)   welligG3M   += a.g3M;
  for (const a of russischRows) russischG3M += a.g3M;
  sheet.getRange(chartDataRow,     15).setValue(Math.round(welligG3M   / 1000 * 100) / 100);
  sheet.getRange(chartDataRow + 1, 15).setValue(Math.round(russischG3M / 1000 * 100) / 100);

  // Kreisdiagramm einfügen
  const chartRange = sheet.getRange(chartDataRow, 14, 2, 2);
  const chartBuilder = sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(chartRange)
    .setPosition(3, 14, 0, 0)
    .setOption("title", "Anteil Ø3M (kg)")
    .setOption("pieSliceText", "percentage")
    .setOption("legend", { position: "bottom" })
    .setOption("colors", [C_HEADER_WELLIG, C_HEADER_RUSSISCH])
    .setOption("width", 320)
    .setOption("height", 280);
  sheet.insertChart(chartBuilder.build());

  // Zweites Kreisdiagramm: letzte 30 Tage
  let welligG30 = 0, russischG30 = 0;
  for (const a of welligRows)   welligG30   += a.g30d;
  for (const a of russischRows) russischG30 += a.g30d;
  sheet.getRange(chartDataRow + 3, 14).setValue("Usbekisch Wellig");
  sheet.getRange(chartDataRow + 3, 15).setValue(Math.round(welligG30   / 1000 * 100) / 100);
  sheet.getRange(chartDataRow + 4, 14).setValue("Russisch Glatt");
  sheet.getRange(chartDataRow + 4, 15).setValue(Math.round(russischG30 / 1000 * 100) / 100);

  const chartRange2 = sheet.getRange(chartDataRow + 3, 14, 2, 2);
  const chartBuilder2 = sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(chartRange2)
    .setPosition(3, 16, 0, 0)
    .setOption("title", "Anteil letzte 30 Tage (kg)")
    .setOption("pieSliceText", "percentage")
    .setOption("legend", { position: "bottom" })
    .setOption("colors", [C_HEADER_WELLIG, C_HEADER_RUSSISCH])
    .setOption("width", 320)
    .setOption("height", 280);
  sheet.insertChart(chartBuilder2.build());

  // Diagramm-Hilfsdaten ausblenden
  sheet.hideColumns(14, 2);

  // ── Verkaufsdaten für Bestellvorschläge in Script Properties speichern ──
  // Format: { "Usbekisch Wellig|Tapes 45cm": { avgG3M: 7500, g30d: 7470 }, ... }
  const verkaufsData = {};
  for (const key in agg) {
    const a = agg[key];
    verkaufsData[key] = {
      avgG3M:  Math.round(a.avgG3M),
      g30d:    Math.round(a.g30d),
      avgG12M: Math.round(a.avgG12M)
    };
  }
  PropertiesService.getScriptProperties().setProperty("VERKAUFS_DATA", JSON.stringify(verkaufsData));
  Logger.log("✅ Verkaufsdaten für Bestellvorschläge gespeichert (" + Object.keys(verkaufsData).length + " Collections)");

  Logger.log("✅ Verkaufsanalyse-Tab erstellt");

  // ── Auto-Trigger löschen (Aufgabe erledigt) ──
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "refreshVerkaufsanalyse") ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().deleteProperty("VA_TRIGGER_ID");
  Logger.log("✅ Auto-Trigger gelöscht");

  SpreadsheetApp.getUi().alert("✅ Verkaufsanalyse aktualisiert!\n\nUsbekisch Wellig Ø3M: " + Math.round(welligG3M/1000*10)/10 + " kg/Monat\nRussisch Glatt Ø3M: " + Math.round(russischG3M/1000*10)/10 + " kg/Monat\nGesamt Ø3M: " + Math.round((welligG3M+russischG3M)/1000*10)/10 + " kg/Monat");
}

// ==========================================
// VERKAUFSBASIERTE ZIELMENGEN-BERECHNUNG
// ==========================================

/**
 * Berechnet die Ziel-Gramm für ein Produkt basierend auf Verkaufsdaten.
 *
 * Methode: Gewichteter Durchschnitt (70% Ø3M + 30% letzter Monat) × Sicherheitsfaktor
 * Die Collection-Gesamtmenge wird proportional nach Topseller-Tier auf Farben verteilt:
 *   TOP7: 7 Anteile, MID: 4 Anteile, REST: 1 Anteil
 *
 * @param {string} quality    "Usbekisch Wellig" oder "Russisch Glatt"
 * @param {string} collLabel  Collection-Label aus VERKAUFS_DATA, z.B. "Tapes 55cm"
 * @param {string} tier       Topseller-Tier: "TOP7", "MID", "REST", "KAUM"
 * @param {Object} tierCounts Anzahl Produkte pro Tier in dieser Collection: { TOP7, MID, REST }
 * @returns {number} Ziel-Gramm (auf 25g gerundet), 0 wenn KAUM
 */
function getVerkaufsZielGrams_(quality, collLabel, tier, tierCounts, lieferzeitWochen, colorOneWord, lagerG) {
  if (tier === "KAUM") return 0;

  // ─── Prio-Kategorien: festes Mindestziel 1000g (unabhängig von Verkaufsdaten) ───
  // Usbekisch: Tapes 55cm, Tapes 65cm, Bondings 65cm, Genius Weft 65cm
  // Russisch:  Standard Tapes, Bondings, Mini Tapes
  const PREMIUM_COLLS_UZ = ["tapes wellig 55cm", "tapes wellig 65cm", "bondings wellig 65cm", "genius tressen"];
  const PREMIUM_COLLS_RU = ["standard tapes", "bondings", "minitapes", "mini tapes"];
  const collLower = (collLabel || "").toLowerCase();
  const isPremium = (quality === "Usbekisch Wellig")
    ? PREMIUM_COLLS_UZ.some(p => collLower.includes(p.split(" ")[0]) && collLower.includes(p.split(" ").pop()))
    : PREMIUM_COLLS_RU.some(p => collLower.includes(p));

  // Mindest-Ziel je Tier:
  // Premium-Kategorien TOP7: 1000g | sonst TOP7: 500g | MID: 300g | REST: 300g
  const minZielTop7 = isPremium ? 1000 : 500;
  const minZiel = (tier === "TOP7") ? minZielTop7 : 300;

  // ─── Produktspezifische Verkaufsdaten laden ──────────────────────────────────────────────────
  // Bevorzuge VA_PRODUCT_DATA (produktspezifisch) gegenüber VERKAUFS_DATA (Collection-Aggregat)
  let g30dProdukt = 0;
  let g60dAltProdukt = 0;  // Tag 31–90: "alter" Zeitraum für Ausverkauf-Erkennung
  let produktDatenVerfügbar = false;
  if (colorOneWord) {
    try {
      const vaProductData = loadChunked_(PropertiesService.getScriptProperties(), "VA_PRODUCT_DATA");
      if (vaProductData) {
        // Suche nach Produkt anhand Farbcode + Quality/Handle + Collection
        // WICHTIG: collLabel-Filter verhindert Cross-Collection-Matches
        // (z.B. #CARAMEL Standard Tapes darf NICHT für Classic Weft #CARAMEL verwendet werden)
        const HANDLE_QUALITY = {
          "russische-normal-tapes":"Russisch Glatt","tapes-glatt":"Russisch Glatt",
          "mini-tapes":"Russisch Glatt","invisible-mini-tapes":"Russisch Glatt",
          "bondings-glatt":"Russisch Glatt","tressen-russisch-classic":"Russisch Glatt",
          "tressen-russisch-genius":"Russisch Glatt","tressen-russisch-invisible":"Russisch Glatt",
          "clip-extensions":"Russisch Glatt","tapes-45cm":"Usbekisch Wellig",
          "tapes-55cm":"Usbekisch Wellig","tapes-65cm":"Usbekisch Wellig",
          "tapes-85cm":"Usbekisch Wellig","bondings-65cm":"Usbekisch Wellig",
          "bondings-85cm":"Usbekisch Wellig","tressen-usbekisch-classic":"Usbekisch Wellig",
          "tressen-usbekisch-genius":"Usbekisch Wellig"
        };
        // Erlaubte Handles für diese Collection – verhindert Verwechslung gleichnamiger Farben
        // Keys müssen exakt mit collName aus collMappingAmanda/China übereinstimmen
        const COLL_HANDLES = {
          // Amanda (Russisch Glatt)
          "Standard Tapes Russisch":              ["russische-normal-tapes","tapes-glatt"],
          "Mini Tapes Glatt":                     ["mini-tapes","invisible-mini-tapes"],
          "Russische Bondings (Glatt)":            ["bondings-glatt"],
          "Russische Classic Tressen (Glatt)":     ["tressen-russisch-classic"],
          "Russische Genius Tressen (Glatt)":      ["tressen-russisch-genius"],
          "Russische Invisible Tressen (Glatt) | Butterfly Weft":   ["tressen-russisch-invisible"],
          "Russische Invisible Tressen (Glatt)":   ["tressen-russisch-invisible"],  // alter Name
          // China (Usbekisch Wellig)
          "Tapes Wellig 45cm":                    ["tapes-45cm"],
          "Tapes Wellig 55cm":                    ["tapes-55cm"],
          "Tapes Wellig 65cm":                    ["tapes-65cm"],
          "Tapes Wellig 85cm":                    ["tapes-85cm"],
          "Bondings wellig 65cm":                 ["bondings-65cm"],
          "Bondings wellig 85cm":                 ["bondings-85cm"],
          "Usbekische Classic Tressen (Wellig)":  ["tressen-usbekisch-classic"],
          "Usbekische Genius Tressen (Wellig)":   ["tressen-usbekisch-genius"],
        };
        const allowedHandles = COLL_HANDLES[collLabel] || [];
        for (const key in vaProductData) {
          const pd = vaProductData[key];
          if (!pd.name) continue;
          // Quality prüfen über handle
          const pdQuality = HANDLE_QUALITY[pd.handle] || "";
          if (pdQuality !== quality) continue;
          // Collection-Filter: nur Handles dieser Collection erlaubt
          if (allowedHandles.length > 0 && !allowedHandles.includes(pd.handle)) continue;
          // Farbcode im Produktnamen suchen – exaktes Wort-Matching:
          // "#SMOKY" darf NICHT auf "#SMOKY BROWN" matchen und umgekehrt.
          // Prüfung: Farbcode muss als ganzes Wort im Namen vorkommen
          // (gefolgt von Leerzeichen, Bindestrich oder Stringende)
          const nameUpper = pd.name.toUpperCase();
          const colorUpper = colorOneWord.toUpperCase();
          // Wortgrenze-Check: Zeichen nach dem Farbcode muss Leerzeichen, Bindestrich oder Ende sein
          const idx = nameUpper.indexOf(colorUpper);
          if (idx !== -1) {
            const charAfter = nameUpper[idx + colorUpper.length];
            const isWordBoundary = (charAfter === undefined || charAfter === ' ' || charAfter === '-' || charAfter === '_');
            if (isWordBoundary) {
              g30dProdukt    = pd.g30d    || 0;
              // g60d_alt: Tag 31–90 Verkauf.
              // Falls vorhanden (neuer Cache): direkt verwenden.
              // Fallback (alter Cache ohne g60d_alt): g90d - g30d.
              // Dieser Fallback ist für Ausverkauf-Erkennung korrekt:
              // Wenn g30d << g90d (z.B. 25g vs. 2850g), ist der Einbruch eindeutig.
              g60dAltProdukt = (pd.g60d_alt != null) ? pd.g60d_alt : Math.max(0, (pd.g90d || 0) - (pd.g30d || 0));
              produktDatenVerfügbar = true;
              break;
            }
          }
        }
      }
    } catch(eProd) { /* Fallback auf Collection-Daten */ }
  }

  // ─── Ausverkauf-Erkennung ────────────────────────────────────────────────────────────────────────────────────
  // Zwei Wege um Ausverkauf zu erkennen:
  //
  // Weg 1 – Velocity-Einbruch (auch bei Lager > 0):
  //   Rate_alt (Tag 31–90) vs. Rate_neu (letzte 30T):
  //   Threshold 0.6 statt 0.4 → bereits 40% Rückgang reicht (früher: 60% nötig).
  //   Verhindert Knapp-Verpasser wie #1A (4,17 vs. 10 g/Tag).
  //
  // Weg 2 – Lager = 0 + historische Rate besser (neu):
  //   Wenn Lager leer UND g60d_alt höher als g30d → historische Rate direkt verwenden,
  //   unabhängig vom Threshold. Ausverkauf ist bei 0-Lager die wahrscheinlichste Erklärung
  //   für eine niedrigere aktuelle Rate.
  //
  // Signifikanz: Rate_alt > 0.5g/Tag (= mind. 15g/Monat, kein Nischenprodukt)
  let g30dEffektiv = g30dProdukt;
  let ausverkaufErkannt = false;
  if (produktDatenVerfügbar) {
    const rateAlt = g60dAltProdukt / 60;  // g/Tag in Zeitraum Tag 31–90
    const rateNeu = g30dProdukt    / 30;  // g/Tag in letzten 30 Tagen
    const schwellwert = 0.5;              // mind. 0.5g/Tag (= 15g/Monat) damit relevant

    // Weg 1: Velocity-Einbruch (Threshold 0.6 = 40% Rückgang genügt)
    if (rateAlt > schwellwert && rateNeu < rateAlt * 0.6) {
      g30dEffektiv = g60dAltProdukt / 2;  // 60 Tage ÷ 2 = 30-Tage-Äquivalent
      ausverkaufErkannt = true;
      Logger.log("[Ausverkauf Weg1] " + colorOneWord + " (" + quality + "/" + collLabel + "): " +
        "Rate_alt=" + rateAlt.toFixed(2) + "g/Tag, Rate_neu=" + rateNeu.toFixed(2) + "g/Tag " +
        "→ Velocity korrigiert auf " + g30dEffektiv.toFixed(0) + "g/30T");
    }
    // Weg 2: Lager = 0 + historische Rate höher als aktuelle → historische Rate direkt verwenden
    else if (lagerG === 0 && rateAlt > schwellwert && g60dAltProdukt / 2 > g30dProdukt) {
      g30dEffektiv = g60dAltProdukt / 2;
      ausverkaufErkannt = true;
      Logger.log("[Ausverkauf Weg2 Lager=0] " + colorOneWord + " (" + quality + "/" + collLabel + "): " +
        "Lager leer, historische Rate " + rateAlt.toFixed(2) + "g/Tag > aktuelle " + rateNeu.toFixed(2) + "g/Tag " +
        "→ Velocity korrigiert auf " + g30dEffektiv.toFixed(0) + "g/30T");
    }
  }

  // ─── Fallback: Collection-Aggregat proportional aufteilen ──────────────────────────────────────
  if (!produktDatenVerfügbar || (g30dEffektiv === 0 && !ausverkaufErkannt)) {
    const raw = PropertiesService.getScriptProperties().getProperty("VERKAUFS_DATA");
    if (!raw) return minZiel;
    let vd;
    try { vd = JSON.parse(raw); } catch(e) { return minZiel; }
    // collLabel (collMapping.collName, z.B. "Tapes Wellig 45cm") → VERKAUFS_DATA-Label (z.B. "Tapes 45cm")
    const COLLNAME_TO_VDLABEL = {
      "Tapes Wellig 45cm": "Tapes 45cm", "Tapes Wellig 55cm": "Tapes 55cm",
      "Tapes Wellig 65cm": "Tapes 65cm", "Tapes Wellig 85cm": "Tapes 85cm",
      "Bondings wellig 65cm": "Bondings 65cm", "Bondings wellig 85cm": "Bondings 85cm",
      "Usbekische Classic Tressen (Wellig)": "Classic Weft",
      "Usbekische Genius Tressen (Wellig)": "Genius Weft",
      "Standard Tapes Russisch": "Standard Tapes",
      "Mini Tapes Glatt": "Minitapes",
      "Russische Bondings (Glatt)": "Bondings",
      "Russische Classic Tressen (Glatt)": "Classic Weft",
      "Russische Genius Tressen (Glatt)": "Genius Weft",
      "Russische Invisible Tressen (Glatt) | Butterfly Weft": "Invisible Weft",
      "Russische Invisible Tressen (Glatt)": "Invisible Weft"  // alter Name
    };
    const vdLabel = COLLNAME_TO_VDLABEL[collLabel] || collLabel;
    const key = quality + "|" + vdLabel;
    const entry = vd[key];
    if (!entry || (!entry.avgG3M && !entry.g30d)) return minZiel;
    const avgG3M = entry.avgG3M || 0;
    const g30dColl = entry.g30d || 0;
    const monatsBasis = avgG3M * 0.5 + g30dColl * 0.5;
    // Proportional nach Tier-Gewichtung auf Farbe herunterbrechen
    const TIER_WEIGHT = { "TOP7": 7, "MID": 4, "REST": 1 };
    const nTop7 = tierCounts.TOP7 || 0;
    const nMid  = tierCounts.MID  || 0;
    const nRest = tierCounts.REST || 0;
    const totalAnteile = nTop7 * 7 + nMid * 4 + nRest * 1 || 1;
    const anteil = TIER_WEIGHT[tier] || 1;
    g30dEffektiv = monatsBasis * anteil / totalAnteile;
  }

  // ─── Zielberechnung: Wochenbedarf × Gesamtpuffer ──────────────────────────────────────────────
  // China: 10 Wochen (8W Lieferzeit + 2W Puffer)
  // Amanda: 6 Wochen Lieferzeit (Nachbestellungen decken Pipeline über Budget-Runden ab)
  // lieferzeitWochen enthält bereits den gewünschten Gesamtpuffer
  const wochenBedarf = g30dEffektiv / 4.33;
  const pufferWochen = lieferzeitWochen;
  const zielFarbe = wochenBedarf * pufferWochen;
  const zielRaw = Math.max(minZiel, Math.round(zielFarbe / 25) * 25);

  // ─── Ziel-Cap nach Tier: MID darf nie mehr Ziel haben als TOP7 ───────────────────────────────────
  // Premium-Kategorien (Standard Tapes, Bondings, Mini Tapes):
  //   TOP7: max 1500g | MID: max 1500g (kein künstlicher Cap – Budget-Runden regeln Priorität) | REST: max 400g
  // Andere Kategorien:
  //   TOP7: max 1000g | MID: max 500g | REST: max 300g
  let maxZiel;
  // Kein künstlicher Cap – Ziel soll den echten Bedarf zeigen (Lieferzeit × Velocity).
  // Die Budget-Runden in createBestellungAmanda/China regeln wie viel tatsächlich bestellt wird.
  const zielRounded = zielRaw;
  return zielRounded;
}

/**
 * Zählt die Anzahl Produkte pro Tier in einer Collection.
 * Wird von createBestellungChina/Amanda aufgerufen um tierCounts zu befüllen.
 * @param {Array} invRows       Alle Inventar-Zeilen
 * @param {string} quality      "Usbekisch Wellig" oder "Russisch Glatt"
 * @param {string} collLabel    z.B. "Tapes 55cm"
 * @param {string} typ          z.B. "Tapes"
 * @param {Function} getTierFn  Funktion(colorOneWord, typ) → tier
 * @param {Function} extractColorFn  Funktion(produktUpper) → colorOneWord
 * @param {string} collKeyword  Keyword zum Filtern der invRows
 * @returns {{ TOP7: number, MID: number, REST: number }}
 */
function countTiersForCollection_(invRows, quality, collLabel, typ, getTierFn, extractColorFn, collKeyword) {
  const counts = { TOP7: 0, MID: 0, REST: 0 };
  const seen = new Set();
  for (const invRow of invRows) {
    const cUpper = invRow.collection.toUpperCase();
    if (!cUpper.includes(collKeyword.toUpperCase())) continue;
    const colorRaw = invRow.productUpper.substring(invRow.productUpper.indexOf("#"));
    if (!colorRaw) continue;
    const colorOneWord = extractFullColor_(invRow.productUpper) || colorRaw.split(" ")[0];
    if (seen.has(colorOneWord)) continue;
    seen.add(colorOneWord);
    const tier = getTierFn(colorOneWord, typ);
    if (tier === "TOP7" || tier === "MID" || tier === "REST") counts[tier]++;
  }
  return counts;
}

/**
 * Setzt den Verkaufsanalyse-Checkpoint zurück, damit refreshVerkaufsanalyse()
 * beim nächsten Aufruf neu startet (frische 12-Monats-Daten).
 * Im Menü "Tools & Haarpflege" als "Verkaufsanalyse zurücksetzen" eintragen.
 */
function resetVerkaufsanalyse() {
  // Laufenden Auto-Trigger stoppen
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "refreshVerkaufsanalyse") ScriptApp.deleteTrigger(t);
  });
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("VA_CHECKPOINT");
  props.deleteProperty("VA_SALES");
  saveChunked_(props, "VA_COLLMAP", {}); // Alle Chunks löschen
  saveChunked_(props, "VA_PRODUCT_DATA", {}); // Alle Chunks löschen
  props.deleteProperty("VA_PREP");
  props.deleteProperty("VA_TRIGGER_ID");
  Logger.log("✅ Verkaufsanalyse zurückgesetzt (inkl. Trigger).");
  SpreadsheetApp.getUi().alert("✅ Zurückgesetzt!\n\nBitte jetzt einmal auf \"Verkaufsanalyse aktualisieren\" klicken.\nDer Rest läuft automatisch.");
}

// ==========================================
// DEBUG: VA_PRODUCT_DATA analysieren
// ==========================================

function debugVAProductData() {
  const raw_props = PropertiesService.getScriptProperties();
  const rawData = loadChunked_(raw_props, "VA_PRODUCT_DATA");
  if (!rawData) { SpreadsheetApp.getUi().alert("Keine VA_PRODUCT_DATA gefunden. Bitte zuerst Verkaufsanalyse aktualisieren."); return; }
  const data = rawData;

  const COLL_MAP_DEBUG = {
    "tapes-45cm":"Usbekisch Wellig","tapes-55cm":"Usbekisch Wellig","tapes-65cm":"Usbekisch Wellig","tapes-85cm":"Usbekisch Wellig",
    "bondings-65cm":"Usbekisch Wellig","bondings-85cm":"Usbekisch Wellig","tressen-usbekisch-classic":"Usbekisch Wellig",
    "tressen-usbekisch-genius":"Usbekisch Wellig","ponytail-extensions":"Usbekisch Wellig",
    "russische-normal-tapes":"Russisch Glatt","tapes-glatt":"Russisch Glatt","mini-tapes":"Russisch Glatt",
    "invisible-mini-tapes":"Russisch Glatt","bondings-glatt":"Russisch Glatt","tressen-russisch-classic":"Russisch Glatt",
    "tressen-russisch-genius":"Russisch Glatt","tressen-russisch-invisible":"Russisch Glatt","clip-extensions":"Russisch Glatt"
  };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("DEBUG_VA");
  if (sheet) sheet.clearContents(); else sheet = ss.insertSheet("DEBUG_VA");

  // Kopfzeile
  sheet.getRange(1,1,1,7).setValues([["PID","Name","Handle","Qualität","g90d","g30d","qty90d"]]);
  sheet.getRange(1,1,1,7).setFontWeight("bold").setBackground("#eeeeee");

  // Summierung
  let totalWellig30 = 0, totalRussisch30 = 0, totalUnbekannt30 = 0;
  const rows = [];
  for (const pid in data) {
    const p = data[pid];
    const qual = COLL_MAP_DEBUG[p.handle] || "UNBEKANNT";
    if (qual === "Usbekisch Wellig") totalWellig30 += (p.g30d || 0);
    else if (qual === "Russisch Glatt") totalRussisch30 += (p.g30d || 0);
    else totalUnbekannt30 += (p.g30d || 0);
    rows.push([pid, p.name || "", p.handle || "", qual, Math.round((p.g90d||0)/100)/10, Math.round((p.g30d||0)/100)/10, p.qty90d||0]);
  }
  rows.sort((a,b) => b[5]-a[5]); // nach g30d absteigend
  if (rows.length > 0) sheet.getRange(2,1,rows.length,7).setValues(rows);

  // Zusammenfassung
  const sumRow = rows.length + 3;
  sheet.getRange(sumRow,1,1,7).setValues([["SUMME 30d (kg)","Wellig:",Math.round(totalWellig30/100)/10,"Russisch:",Math.round(totalRussisch30/100)/10,"Unbekannt:",Math.round(totalUnbekannt30/100)/10]]);
  sheet.getRange(sumRow,1,1,7).setFontWeight("bold").setBackground("#fff9c4");

  SpreadsheetApp.getUi().alert("✅ Debug-Tab 'DEBUG_VA' erstellt!\n\n" +
    "Wellig 30d: " + Math.round(totalWellig30/100)/10 + " kg\n" +
    "Russisch 30d: " + Math.round(totalRussisch30/100)/10 + " kg\n" +
    "Unbekannt 30d: " + Math.round(totalUnbekannt30/100)/10 + " kg\n" +
    "Gesamt Produkte: " + rows.length);
}

// ==========================================
// SIMPLE TRIGGERS
// ==========================================

/**
 * onEdit: Checkbox-Toggle im Topseller-Tab für Unterwegs-Detailspalten.
 * Toggle-Zelle: col 14, row 2 im "Topseller"-Tab.
 * Wenn angehakt → Detailspalten einblenden. Wenn abgehakt → ausblenden.
 * Anzahl + Startposition der Detailspalten stehen als Notiz in (1, 14).
 */
function onEdit(e) {
  try {
    if (!e) return;
    const range = e.range;
    const sheet = range.getSheet();
    if (sheet.getName() !== "Topseller") return;
    if (range.getRow() !== 2 || range.getColumn() !== 14) return;

    // Metadaten aus Notiz lesen: "detailCols:3;startCol:15"
    const note = sheet.getRange(1, 14).getNote() || "";
    const mCols  = note.match(/detailCols:(\d+)/);
    const mStart = note.match(/startCol:(\d+)/);
    const numCols  = mCols  ? parseInt(mCols[1])  : 0;
    const startCol = mStart ? parseInt(mStart[1]) : 15;
    if (numCols <= 0) return;

    const isChecked = (e.value === "TRUE" || e.value === true);
    if (isChecked) {
      sheet.showColumns(startCol, numCols);
    } else {
      sheet.hideColumns(startCol, numCols);
    }
  } catch(eOnEdit) {
    // Simple Trigger darf keinen Fehler werfen
  }
}

// ==========================================
// MENÜ-INTEGRATION
// ==========================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Hairvenly Tools')
    .addItem('🔄 Alles aktualisieren (Komplett-Update)', 'allesAktualisieren')
    .addSeparator()
    .addItem('1. Topseller aktualisieren', 'refreshTopseller')
    .addItem('2. Verkaufsanalyse aktualisieren', 'refreshVerkaufsanalyse')
    .addItem('2b. Verkaufsanalyse zurücksetzen', 'resetVerkaufsanalyse')
    .addSeparator()
    .addItem('3. Dashboard (Bestellvorschläge) erstellen', 'createDashboard')
    .addSeparator()
    .addItem('4. Bestellung China (Usbekisch) generieren', 'createBestellungChina')
    .addItem('5. Bestellung Amanda (Russisch) generieren', 'createBestellungAmanda')
    .addSeparator()
    .addItem('Lagerbestand abrufen (Shopify)', 'fetchShopifyInventoryData')
    .addSeparator()
    .addItem('🔍 Debug: VA-Produktdaten analysieren', 'debugVAProductData')
    .addItem('🔍 Debug: Order Tabs analysieren', 'debugOrderTabs')
    .addToUi();
}

/**
 * 🔄 Komplett-Update: Führt alle Aktualisierungen der Reihe nach aus.
 * Reihenfolge: Shopify-Bestand → Topseller → Verkaufsanalyse → Dashboard → Bestellung China → Bestellung Amanda
 */
function allesAktualisieren() {
  const ui = SpreadsheetApp.getUi();
  const start = new Date();
  Logger.log('🔄 Starte Komplett-Update...');

  try {
    Logger.log('1/6 Shopify-Lagerbestand abrufen...');
    fetchShopifyInventoryData();

    Logger.log('2/6 Verkaufsanalyse aktualisieren...');
    refreshVerkaufsanalyse();

    Logger.log('3/6 Topseller aktualisieren...');
    refreshTopseller();

    Logger.log('4/6 Dashboard erstellen...');
    createDashboard();

    Logger.log('5/6 Bestellung China generieren...');
    createBestellungChina();

    Logger.log('6/6 Bestellung Amanda generieren...');
    createBestellungAmanda();

    const dauer = Math.round((new Date() - start) / 1000);
    Logger.log('✅ Komplett-Update abgeschlossen in ' + dauer + ' Sekunden.');
    ui.alert('✅ Komplett-Update abgeschlossen', 'Alle Tabs wurden erfolgreich aktualisiert.\nDauer: ' + dauer + ' Sekunden.', ui.ButtonSet.OK);
  } catch (e) {
    Logger.log('❌ Fehler beim Komplett-Update: ' + e.message);
    ui.alert('❌ Fehler beim Komplett-Update', 'Fehler: ' + e.message + '\n\nBitte prüfe die Logs unter Ausführungen.', ui.ButtonSet.OK);
  }
}


// ==========================================
// DEBUG: Shopify Collection-Handles prüfen
// ==========================================
function debugCollectionHandles() {
  const SHOP_NAME    = "339520-3";
  const ACCESS_TOKEN = "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";
  const BASE_URL     = "https://" + SHOP_NAME + ".myshopify.com/admin/api/2025-01";
  
  let page = 1;
  let url = BASE_URL + "/custom_collections.json?limit=250&fields=id,handle,title";
  const results = [];
  
  while (url) {
    const resp = UrlFetchApp.fetch(url, {
      headers: { "X-Shopify-Access-Token": ACCESS_TOKEN }, muteHttpExceptions: true
    });
    const data = JSON.parse(resp.getContentText());
    const colls = data.custom_collections || [];
    for (const c of colls) {
      results.push(c.handle + " → " + c.title);
      Logger.log(c.handle + " → " + c.title);
    }
    const lh = resp.getHeaders()["Link"] || "";
    url = null;
    if (lh.indexOf('rel="next"') !== -1) {
      for (const part of lh.split(",")) {
        if (part.indexOf('rel="next"') !== -1) {
          const m = part.match(/<([^>]+)>/); if (m) { url = m[1]; break; }
        }
      }
    }
    page++;
    if (page > 10) break;
  }
  
  // Auch Smart Collections
  let url2 = BASE_URL + "/smart_collections.json?limit=250&fields=id,handle,title";
  while (url2) {
    const resp2 = UrlFetchApp.fetch(url2, {
      headers: { "X-Shopify-Access-Token": ACCESS_TOKEN }, muteHttpExceptions: true
    });
    const data2 = JSON.parse(resp2.getContentText());
    const colls2 = data2.smart_collections || [];
    for (const c of colls2) {
      results.push("[SMART] " + c.handle + " → " + c.title);
      Logger.log("[SMART] " + c.handle + " → " + c.title);
    }
    const lh2 = resp2.getHeaders()["Link"] || "";
    url2 = null;
    if (lh2.indexOf('rel="next"') !== -1) {
      for (const part2 of lh2.split(",")) {
        if (part2.indexOf('rel="next"') !== -1) {
          const m2 = part2.match(/<([^>]+)>/); if (m2) { url2 = m2[1]; break; }
        }
      }
    }
  }
  
  SpreadsheetApp.getUi().alert("Collection-Handles (auch in Logger):\n\n" + results.filter(r => r.toLowerCase().includes("85") || r.toLowerCase().includes("tape") || r.toLowerCase().includes("clip")).join("\n"));
}

// ==============================================================
// WEB APP ENDPOINT — Called from Hairvenly Dashboard
// ==============================================================

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var supplier = String(params.supplier || "").toLowerCase();
    var budgetG = Number(params.budgetG) || 20000;

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (supplier === "amanda") {
      PropertiesService.getScriptProperties().setProperty("BUDGET_AMANDA", String(budgetG));
      createBestellungAmanda();
      var sheet = ss.getSheetByName("Vorschlag - Amanda");
      var title = sheet ? String(sheet.getRange("A1").getValue()) : "";
      return ContentService.createTextOutput(JSON.stringify({ ok: true, title: title }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (supplier === "china") {
      PropertiesService.getScriptProperties().setProperty("BUDGET_CHINA", String(budgetG));
      createBestellungChina();
      var sheet = ss.getSheetByName("Vorschlag - China");
      var title = sheet ? String(sheet.getRange("A1").getValue()) : "";
      return ContentService.createTextOutput(JSON.stringify({ ok: true, title: title }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ error: "Unknown supplier: " + supplier }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: "ok", message: "Hairvenly Stock Calculation API" }))
    .setMimeType(ContentService.MimeType.JSON);
}
