/* ==========================================================================
   MADOLLAR LIQUOR PUB - MANAGEMENT SYSTEM CORE ENGINE (main.js)
   ==========================================================================
   TABLE OF CONTENTS:
   SECTION 1  : FIREBASE INITIALIZATION & CORE CONFIG
   SECTION 2  : GLOBAL APPLICATION STATE & DOM REFERENCES
   SECTION 3  : UTILITY, FORMATTING & TARGET HELPERS
   SECTION 4  : AUTHENTICATION & PORTAL ACCESS MANAGEMENT
   SECTION 5  : ATTENDANCE & GEOLOCATION TRACKING
   SECTION 6  : PRODUCT & INVENTORY MANAGEMENT
   SECTION 7  : RESTOCK & NEW PRODUCT ACTIVITY LOGS & NOTIFICATIONS
   SECTION 8  : POS & CART SYSTEM
   SECTION 9  : CHECKOUT & PAYMENT PROCESSING
   SECTION 10 : SALES ANALYTICS, DYNAMIC TARGETS & PDF REPORTING
   SECTION 11 : STOCK REQUISITION SYSTEM
   SECTION 12 : ADMIN STAFF MANAGEMENT MODULE
   SECTION 12B: INSIGHTS (CHARTS), PROFIT & LOSS AND DAY CLOSING
   SECTION 12E: CATEGORIES, BUSY TIMES AND SMART WARNINGS
   SECTION 12F: ROLES & PERMISSIONS EDITOR (permission list and can() are near the top)
   SECTION 12G: SUPPLIERS & DELIVERIES, DEBT REMINDERS, BARCODE SCANNING
   SECTION 12H: TILL PRICE CHANGES & DISCOUNTS, REFUNDS AND THE AUDIT TRAIL
   SECTION 12I: WORK LOCATION (where staff may clock in from)
   SECTION 13 : UI NAVIGATION & SCROLL HELPERS
   ========================================================================== */

/* ==========================================================================
   SECTION 1: FIREBASE INITIALIZATION & CORE CONFIG
   ========================================================================== */
const firebaseConfig = {
    apiKey: "AIzaSyDS83HjWpOSH6BCd3_0w8Lv7_3MgQzw_h0",
    authDomain: "liquor-b1ef2.firebaseapp.com",
    projectId: "liquor-b1ef2",
    storageBucket: "liquor-b1ef2.appspot.com",
    messagingSenderId: "6903039541",
    appId: "1:6903039541:web:d552a2b11b6aca8ff8937c",
    measurementId: "G-F1M9JJT5B4"
};

// Initialize Firebase App instance
firebase.initializeApp(firebaseConfig);

window.auth = firebase.auth();
window.db = firebase.firestore();

// Keep a local copy of the data so the app still opens and records sales when the internet drops.
// Writes made offline are saved on the device and sent automatically when the connection returns.
window.db.enablePersistence({ synchronizeTabs: true }).catch(err => console.warn("Offline storage not enabled:", err.code));


/* ==========================================================================
   SECTION 2: GLOBAL APPLICATION STATE & DOM REFERENCES
   ========================================================================== */
// Core Data Caches
window.productsCache = [];
window.requisitionItems = window.requisitionItems || [];
window.allSales = [];
window.notificationsList = [];
window.currentExpectedSales = 0;
window.targetConfig = { mode: "percentage", value: 50 };

// Role & Session Control Flags
window.currentRole = "staff";
window.activePortalMode = "admin";
window.customSessionActive = false;
window.activeAttendanceListener = null;

// Product Edit Tracking
let editProductId = null;

// DOM Element References (Safe Handles)
const loginSection = document.getElementById("loginSection");
const dashboard = document.getElementById("dashboard");
const loginBtn = document.getElementById("loginBtn");
const loginEmail = document.getElementById("loginEmail");
const loginPass = document.getElementById("loginPass");
const loginMsg = document.getElementById("loginMsg");
const logoutBtn = document.getElementById("logoutBtn");
const roleBadge = document.getElementById("roleBadge");


/* ==========================================================================
   SECTION 2B: OFFLINE SUPPORT (saved writes, connection badge, install as app)
   ========================================================================== */

/**
 * Waits for the server to confirm a write, but stops waiting after a few seconds.
 * Offline, the write is already saved on the device and syncs later, so the promise would never finish.
 * Resolves true when confirmed, false when it is still waiting (saved locally).
 */
function writeWithGrace(promise, ms = 4000) {
    promise.catch(err => console.warn("Write failed:", err));
    return Promise.race([promise.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), ms))]);
}

// Read options: use the device's saved copy straight away when offline instead of waiting for a timeout
const readOpts = () => ({ source: navigator.onLine ? "default" : "cache" });

async function safeGet(ref) {
    try { return await ref.get(readOpts()); } catch (e) { return null; }
}

(function setupConnectionStatus() {
    const badge = document.getElementById("offlineBadge");
    const text = document.getElementById("offlineBadgeText");
    if (!badge || !text) return;
    let wasOffline = false;

    const goOffline = () => {
        wasOffline = true;
        badge.className = "offline-badge";
        text.textContent = "Offline - sales are saved on this device";
    };
    const goOnline = async () => {
        badge.className = "offline-badge syncing";
        text.textContent = "Syncing...";
        try { await window.db.waitForPendingWrites(); } catch (e) { }
        badge.className = "offline-badge d-none";
        if (wasOffline && typeof Swal !== "undefined") {
            Swal.fire({ toast: true, position: "top", icon: "success", title: "Back online. Everything is synced.", timer: 2500, showConfirmButton: false });
        }
        wasOffline = false;
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    if (!navigator.onLine) goOffline();
})();

// "Install app" button (shown by the browser when the app can be installed)
window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.deferredInstallPrompt = e;
    const btn = document.getElementById("installBtn");
    if (btn) btn.classList.remove("d-none");
});
window.addEventListener("appinstalled", () => {
    window.deferredInstallPrompt = null;
    const btn = document.getElementById("installBtn");
    if (btn) btn.classList.add("d-none");
});
window.installApp = async () => {
    const prompt = window.deferredInstallPrompt;
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    window.deferredInstallPrompt = null;
    const btn = document.getElementById("installBtn");
    if (btn) btn.classList.add("d-none");
};

// Service worker: lets the page itself open offline (scoped to this page only)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("liquor-sw.js", { scope: "./liquor.html" })
            .catch(err => console.warn("Offline page cache not available:", err));
    });
}


/* ==========================================================================
   SECTION 3: UTILITY, FORMATTING & TARGET HELPERS
   ========================================================================== */

/**
 * Checks if the active user role is administrator
 */
function isAdmin() {
    const role = (window.currentRole || localStorage.getItem("currentRole") || "").toString().toLowerCase().trim();
    return role === 'admin';
}

/**
 * Manager: sits between admin and staff. Can restock, count stock and close days,
 * but cannot see profit/cost figures or delete records.
 */
function isManager() {
    const role = (window.currentRole || localStorage.getItem("currentRole") || "").toString().toLowerCase().trim();
    return role === 'manager';
}

function isManagerOrAdmin() {
    return isAdmin() || isManager();
}

/**
 * Quantity of stock (in bottles) a sale line uses. A tot sale stores how many bottles it represents.
 */
function itemStockQty(item) {
    const v = item.stockQty !== undefined ? parseFloat(item.stockQty) : parseFloat(item.qty);
    return v || 0;
}

/**
 * Product name as shown on sales (tot sales are labelled so they are not mixed up with whole bottles)
 */
function itemLabel(item) {
    return item.unit === "tot" ? `${item.name} (tot)` : item.name;
}

const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

/**
 * Writes one line to the audit trail (who did what, and when). Never blocks or breaks the action it records.
 * category: price | refund | delete | stock | money | people.  opts: { amount, flag, ref, alert }
 */
function logAudit(category, action, title, detail, opts) {
    try {
        const o = opts || {};
        const entry = {
            category, action, title,
            detail: detail || "",
            by: (window.auth && window.auth.currentUser && window.auth.currentUser.email) || window.loggedStaffEmail || window.currentUserEmail || "unknown",
            role: (window.currentRole || "staff").toString().toLowerCase(),
            at: new Date()
        };
        if (o.amount !== undefined) entry.amount = round2(o.amount);
        if (o.flag) entry.flag = true;
        if (o.ref) entry.ref = o.ref;
        const p = window.db.collection("audit").add(entry);
        if (p && p.catch) p.catch(e => console.warn("Audit log not saved:", e && e.message));
        if (o.alert && typeof window.notifyAudit === "function") window.notifyAudit(title, detail, entry.by);
    } catch (e) {
        console.warn("Audit log failed:", e);
    }
}


/* ==========================================================================
   PERMISSIONS
   What each role may do is ticked by the admin in the Staff tab and saved in Firebase.
   An admin can always do everything. Staff and Manager follow the ticks; anything the
   admin has not ticked yet falls back to the defaults below (which match how the
   system behaved before permissions became adjustable).
   staff / manager = default for that role.  risk = worth a second thought before ticking.
   ========================================================================== */
const PERMISSION_GROUPS = [
    {
        id: "see", title: "Dashboard & reports", icon: "fa-chart-pie", items: [
            { key: "view.monthlySales", label: "See the monthly sales total", hint: "Dashboard card", staff: false, manager: false },
            { key: "view.stockValue", label: "See the total stock value", hint: "Cost and expected value of all stock", staff: false, manager: false },
            { key: "view.target", label: "See the monthly target", hint: "Target progress bar on the dashboard", staff: false, manager: false },
            { key: "target.set", label: "Set the monthly target", hint: "Change the target amount", staff: false, manager: false },
            { key: "view.buyPrices", label: "See buy (cost) prices", hint: "The Buy column in Products", staff: false, manager: false },
            { key: "view.profit", label: "See profit", hint: "Profit section, profit cards, profit per product and the Profit & Loss table", staff: false, manager: false },
            { key: "view.insights", label: "Open the Insights tab", hint: "Charts, busy times and smart warnings", staff: false, manager: false },
            { key: "reports.download", label: "Download PDF reports and receipts", hint: "Sales reports, receipts and restock reports", staff: true, manager: true },
            { key: "view.restockLogs", label: "See the Restock Logs tab", hint: "History of stock added or adjusted", staff: true, manager: true }
        ]
    },
    {
        id: "stock", title: "Products & stock", icon: "fa-boxes-stacked", items: [
            { key: "products.add", label: "Add products", hint: "Register a new product", staff: false, manager: false },
            { key: "products.edit", label: "Edit products", hint: "Change names, prices and minimum stock", staff: false, manager: false, risk: true },
            { key: "products.delete", label: "Delete products", hint: "Remove a product completely", staff: false, manager: false, risk: true },
            { key: "categories.manage", label: "Manage categories", hint: "Sort products into categories", staff: false, manager: false },
            { key: "stock.add", label: "Add stock (restock)", hint: "Record bottles received", staff: false, manager: true },
            { key: "stock.reduce", label: "Reduce stock", hint: "Record losses and corrections", staff: false, manager: false, risk: true },
            { key: "stocktake.count", label: "Do a stock take", hint: "Count the shelf and submit the numbers", staff: true, manager: true },
            { key: "stocktake.seeSystem", label: "See system stock while counting", hint: "Off means they count blind", staff: false, manager: true },
            { key: "stocktake.history", label: "See stock count results", hint: "Short and over items with their value", staff: false, manager: false },
            { key: "stocktake.apply", label: "Apply or delete stock counts", hint: "Change stock to match a count", staff: false, manager: false, risk: true },
            { key: "requisition.use", label: "Use Requisition and reorder suggestions", hint: "Order lists use buy prices", staff: false, manager: false }
        ]
    },
    {
        id: "suppliers", title: "Suppliers & deliveries", icon: "fa-truck", items: [
            { key: "suppliers.view", label: "See the Suppliers tab", hint: "Suppliers, deliveries, what you owe and cost changes", staff: false, manager: false },
            { key: "suppliers.manage", label: "Add and edit suppliers", hint: "Names, phone numbers and notes", staff: false, manager: false },
            { key: "deliveries.record", label: "Record deliveries", hint: "Adds stock and updates product cost prices", staff: false, manager: false, risk: true },
            { key: "suppliers.pay", label: "Record payments to suppliers", hint: "Reduces what you owe them", staff: false, manager: false, risk: true },
            { key: "suppliers.delete", label: "Delete suppliers or void deliveries", hint: "Voiding a delivery takes its stock off again", staff: false, manager: false, risk: true }
        ]
    },
    {
        id: "sales", title: "Sales & POS", icon: "fa-cash-register", items: [
            { key: "pos.sell", label: "Make sales (POS)", hint: "Open the POS tab and check out", staff: true, manager: true },
            { key: "pos.credit", label: "Sell on credit", hint: "Put a sale on a customer's tab", staff: true, manager: true },
            { key: "pos.discount", label: "Give discounts at the till", hint: "Take an amount or a percentage off a sale. The reason and who did it are always recorded.", staff: false, manager: true, risk: true },
            { key: "pos.priceoverride", label: "Change an item's price at the till", hint: "Sell an item above or below its listed price. The reason and who did it are always recorded.", staff: false, manager: true, risk: true },
            { key: "pos.refund", label: "Refund or take back items", hint: "Reverse part or all of a sale. Stock can go back on the shelf.", staff: false, manager: true, risk: true },
            { key: "sales.view", label: "See the Sales tab", hint: "Sales list and daily products sold", staff: true, manager: true },
            { key: "sales.delete", label: "Delete a sale or an item in a sale", hint: "Can also put the stock back", staff: false, manager: false, risk: true },
            { key: "sales.deleteBulk", label: "Delete a whole day or month of sales", hint: "Removes many sales at once", staff: false, manager: false, risk: true }
        ]
    },
    {
        id: "close", title: "Closing the day", icon: "fa-calendar-check", items: [
            { key: "closeday.do", label: "Close the day", hint: "Count the cash in the till", staff: true, manager: true },
            { key: "closeday.seeResult", label: "See expected cash and the result", hint: "Off means they count blind", staff: false, manager: true },
            { key: "closeday.replace", label: "Replace a day that is already closed", hint: "Overwrites an earlier closing", staff: false, manager: false, risk: true },
            { key: "closeday.history", label: "See the Closing Day history", hint: "Every closing with short or over amounts", staff: false, manager: false },
            { key: "closeday.delete", label: "Delete a closing", hint: "Opens that day again", staff: false, manager: false, risk: true }
        ]
    },
    {
        id: "customers", title: "Customers", icon: "fa-address-book", items: [
            { key: "customers.view", label: "See the Customers tab", hint: "Customers, balances and statements", staff: true, manager: true },
            { key: "customers.add", label: "Add customers", hint: "Also the quick add button in POS", staff: true, manager: true },
            { key: "customers.payment", label: "Record customer payments", hint: "Money received against a tab", staff: true, manager: true },
            { key: "customers.remind", label: "Send debt reminders", hint: "WhatsApp or SMS to customers who owe money", staff: false, manager: true },
            { key: "customers.delete", label: "Delete customers", hint: "Customers who owe money cannot be deleted", staff: false, manager: false, risk: true }
        ]
    },
    {
        id: "attendance", title: "Attendance", icon: "fa-user-clock", items: [
            { key: "attendance.clock", label: "Use Clock In & Out", hint: "Clock in and out and see their own records", staff: true, manager: true },
            { key: "attendance.viewAll", label: "See everyone's attendance", hint: "All staff records, not just their own", staff: false, manager: false },
            { key: "attendance.location", label: "Set the work location", hint: "Choose where staff are allowed to clock in from (Google Maps pin) and how close they must be", staff: false, manager: false, risk: true },
            { key: "attendance.anywhere", label: "Clock in from anywhere", hint: "Skips the location check. The clock in is marked 'off-site' so you can see it.", staff: false, manager: false, risk: true },
            { key: "attendance.export", label: "Download the attendance report", hint: "PDF of the records they can see", staff: false, manager: false },
            { key: "attendance.delete", label: "Delete attendance records", hint: "Remove a clock in or out", staff: false, manager: false, risk: true }
        ]
    },
    {
        id: "logs", title: "Notifications & logs", icon: "fa-bell", items: [
            { key: "notifications.delete", label: "Delete notifications", hint: "Remove one or clear them all", staff: false, manager: false },
            { key: "logs.delete", label: "Delete restock log entries", hint: "Remove entries or whole days from the logs", staff: false, manager: false, risk: true }
        ]
    },
    {
        id: "admin", title: "Administration", icon: "fa-user-shield", items: [
            { key: "staff.manage", label: "Manage staff accounts", hint: "Add, edit, block or delete staff and managers. They can never create or change an admin, or change permissions.", staff: false, manager: false, risk: true },
            { key: "audit.delete", label: "Delete audit trail entries", hint: "Remove single entries or clear old ones. A note that it was done is always kept.", staff: false, manager: false, risk: true },
            { key: "audit.view", label: "See the Audit trail", hint: "Who changed prices, gave discounts, refunded or deleted records, and when", staff: false, manager: false },
            { key: "alerts.manage", label: "Change phone alert settings", hint: "Telegram, WhatsApp and email alerts (holds secret keys)", staff: false, manager: false, risk: true }
        ]
    }
];

const PERMISSION_DEFAULTS = (() => {
    const d = { staff: {}, manager: {} };
    PERMISSION_GROUPS.forEach(g => g.items.forEach(i => { d.staff[i.key] = !!i.staff; d.manager[i.key] = !!i.manager; }));
    return d;
})();

window.permissions = { staff: {}, manager: {} };

/**
 * Can the person who is logged in do this? Admin: always. Anyone else follows the ticks.
 * Unknown roles are treated like staff.
 */
function can(key) {
    const role = (window.currentRole || localStorage.getItem("currentRole") || "").toString().toLowerCase().trim();
    if (role === "admin") return true;
    const r = role === "manager" ? "manager" : "staff";
    const custom = (window.permissions && window.permissions[r]) || {};
    return custom[key] !== undefined ? !!custom[key] : !!PERMISSION_DEFAULTS[r][key];
}

function denyAccess(action) {
    return Swal.fire("Access Denied", action ? `You do not have permission to ${action}. Ask an admin.` : "You do not have permission for this. Ask an admin.", "error");
}

/**
 * Shows or hides every element tagged data-perm="some.key" (or "a.key|b.key" = either one is enough)
 */
window.applyPermissionUI = () => {
    document.querySelectorAll("[data-perm]").forEach(el => {
        const keys = String(el.dataset.perm).split("|");
        el.classList.toggle("d-none", !keys.some(k => can(k)));
    });
};

/**
 * Redraws everything whose content depends on permissions
 */
function refreshForPermissions() {
    window.applyPermissionUI();
    if (typeof window.renderProductsFiltered === "function" && (window.productsCache || []).length) window.renderProductsFiltered();
    if (typeof window.filterSalesTable === "function") window.filterSalesTable();
    if (typeof renderGroupedSales === "function" && window.allSales) renderGroupedSales(window.allSales);
    if (typeof window.renderProfitCardBreakdown === "function") window.renderProfitCardBreakdown();
    if (typeof window.refreshRestockLogTables === "function") window.refreshRestockLogTables();
    if (typeof window.renderDayClosings === "function") window.renderDayClosings();
    if (typeof window.renderSuppliers === "function") window.renderSuppliers();
    if (typeof window.startAuditListener === "function") { window.startAuditListener(); window.renderAudit(); }
    if (typeof renderCart === "function") renderCart();
    if (typeof window.renderInsights === "function") window.renderInsights();
    if (typeof window.refreshNotificationUI === "function") window.refreshNotificationUI();
    if (window.lastCustomersSnap && typeof renderCustomersFromSnap === "function") renderCustomersFromSnap(window.lastCustomersSnap);
    if (window.activeAttendanceListener && typeof startAttendanceRealtimeListener === "function") startAttendanceRealtimeListener();
}

// The admin's ticks, live: a change applies straight away to everyone who is logged in
window.db.collection("settings").doc("permissions").onSnapshot(doc => {
    const data = doc.exists ? doc.data() : {};
    window.permissions = { staff: data.staff || {}, manager: data.manager || {} };
    refreshForPermissions();
    if (typeof window.onPermissionsChanged === "function") window.onPermissionsChanged();
}, err => console.warn("Permissions listener:", err));


/**
 * Converts decimal numerical values into human-readable mixed fraction strings (e.g. 5.5 -> "5 ½", 0.25 -> "¼", 5 -> "5")
 */
window.toMixedFraction = function (val) {
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return "0";

    const isNegative = num < 0;
    const absNum = Math.abs(num);

    const whole = Math.floor(absNum);
    const decimal = Math.round((absNum - whole) * 1000) / 1000;

    let fracStr = "";
    if (decimal === 0) {
        fracStr = whole.toString();
    } else {
        if (Math.abs(decimal - 0.5) < 0.01) fracStr = "½";
        else if (Math.abs(decimal - 0.25) < 0.01) fracStr = "¼";
        else if (Math.abs(decimal - 0.75) < 0.01) fracStr = "¾";
        else if (Math.abs(decimal - 0.333) < 0.02) fracStr = "⅓";
        else if (Math.abs(decimal - 0.667) < 0.02) fracStr = "⅔";
        else if (Math.abs(decimal - 0.2) < 0.01) fracStr = "1/5";
        else if (Math.abs(decimal - 0.4) < 0.01) fracStr = "2/5";
        else if (Math.abs(decimal - 0.6) < 0.01) fracStr = "3/5";
        else if (Math.abs(decimal - 0.8) < 0.01) fracStr = "4/5";
        else {
            const gcd = (a, b) => (b ? gcd(b, a % b) : a);
            const denominator = 100;
            const numerator = Math.round(decimal * denominator);
            const divisor = gcd(numerator, denominator);
            fracStr = `${numerator / divisor}/${denominator / divisor}`;
        }
        if (whole > 0) fracStr = `${whole} ${fracStr}`;
    }

    return isNegative ? `-${fracStr}` : fracStr;
};

/**
 * Converts decimal numerical values into standard fraction strings or mixed fractions
 */
window.toFraction = function (val) {
    return window.toMixedFraction(val);
};

/**
 * Displays user dashboard view
 */
function showDashboard() {
    if (!loginSection || !dashboard) return;
    loginSection.classList.add("d-none");
    dashboard.classList.remove("d-none");

    if (typeof initDashboard === "function") {
        initDashboard();
    }

    if (typeof window.refreshNotificationUI === "function") {
        window.refreshNotificationUI();
    }

    if (typeof window.checkAndShowUnreadNotificationPopup === "function") {
        setTimeout(() => {
            window.checkAndShowUnreadNotificationPopup();
        }, 800);
    }

    if (typeof window.showWhatsNewWhenReady === "function") {
        setTimeout(() => window.showWhatsNewWhenReady(), 2200);
    }
    if (typeof window.startSmartWarningTimer === "function") window.startSmartWarningTimer();
}

/**
 * Displays login authentication view
 */
function showLogin() {
    if (!loginSection || !dashboard) return;
    dashboard.classList.add("d-none");
    loginSection.classList.remove("d-none");
}

/**
 * Custom animated Toast notification handler
 */
function showToast(title, message, type = 'loading') {
    const toastTitle = document.getElementById("toastTitle");
    const body = document.getElementById("toastBody");
    const toastEl = document.getElementById('liveToast');
    if (!toastTitle || !body || !toastEl) return;

    toastTitle.textContent = title;

    if (type === 'loading') {
        body.innerHTML = `<div class="spinner-loader"></div><div>${message}</div>`;
    } else if (type === 'success') {
        body.innerHTML = `
            <svg class="checkmark-circle" viewBox="0 0 52 52">
                <circle cx="26" cy="26" r="25" fill="none"/>
                <path class="checkmark" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
            <div>${message}</div>`;
    } else {
        body.innerHTML = `<div style="font-size:40px; color:#e74c3c;">✕</div><div>${message}</div>`;
    }

    const toast = new bootstrap.Toast(toastEl, { autohide: type !== 'loading' });
    toast.show();
}

function hideToast() {
    const toastEl = document.getElementById('liveToast');
    if (toastEl) {
        const inst = bootstrap.Toast.getInstance(toastEl);
        if (inst) inst.hide();
    }
}

/**
 * Real-time listener for Admin Target Settings
 */
window.db.collection("settings").doc("sales_target").onSnapshot(doc => {
    if (doc.exists) {
        window.targetConfig = doc.data();
    }
    if (typeof window.updateSalesProgress === "function") {
        window.updateSalesProgress();
    }
}, err => console.warn("Settings listener:", err));

/**
 * Opens Admin Monthly Sales Target modal
 */
window.openTargetModal = () => {
    if (!can("target.set")) return denyAccess("set the monthly target");
    const modeSelect = document.getElementById("targetModeSelect");
    const pctInput = document.getElementById("targetPercentageInput");
    const fixedInput = document.getElementById("targetFixedInput");

    const cfg = window.targetConfig || { mode: "percentage", value: 50 };
    if (modeSelect) modeSelect.value = cfg.mode || "percentage";
    if (cfg.mode === "fixed") {
        if (fixedInput) fixedInput.value = cfg.value || 0;
    } else {
        if (pctInput) pctInput.value = cfg.value || 50;
    }

    window.toggleTargetInputMode();
    const modalEl = document.getElementById("targetModal");
    if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
};

/**
 * Toggles dynamic target input fields between percentage and fixed KSh
 */
window.toggleTargetInputMode = () => {
    const modeSelect = document.getElementById("targetModeSelect");
    const pctGrp = document.getElementById("targetPercentageGroup");
    const fixedGrp = document.getElementById("targetFixedGroup");
    if (!modeSelect) return;

    if (modeSelect.value === "fixed") {
        if (pctGrp) pctGrp.classList.add("d-none");
        if (fixedGrp) fixedGrp.classList.remove("d-none");
    } else {
        if (pctGrp) pctGrp.classList.remove("d-none");
        if (fixedGrp) fixedGrp.classList.add("d-none");
    }
};

/**
 * Saves Admin Target Configuration to Firestore
 */
window.saveTargetSettings = async () => {
    if (!can("target.set")) return denyAccess("set the monthly target");
    const modeSelect = document.getElementById("targetModeSelect");
    const pctInput = document.getElementById("targetPercentageInput");
    const fixedInput = document.getElementById("targetFixedInput");

    const mode = modeSelect ? modeSelect.value : "percentage";
    let val = 50;
    if (mode === "fixed") {
        val = parseFloat(fixedInput.value) || 0;
        if (val <= 0) return Swal.fire("Invalid Target", "Enter a valid KSh target amount", "warning");
    } else {
        val = parseFloat(pctInput.value) || 50;
        if (val <= 0) return Swal.fire("Invalid Target", "Enter a valid percentage value", "warning");
    }

    try {
        await window.db.collection("settings").doc("sales_target").set({
            mode: mode,
            value: val,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const modalEl = document.getElementById("targetModal");
        if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
        Swal.fire("Target Saved", `Monthly sales target updated successfully.`, "success");
    } catch (e) {
        Swal.fire("Error", "Could not save target: " + e.message, "error");
    }
};

/**
 * Deletes a single log document entry from a Firestore collection
 */
window.deleteLogEntry = async (collectionName, logId) => {
    if (!can("logs.delete")) {
        return denyAccess("delete log entries");
    }

    const result = await Swal.fire({
        title: "Are you sure?",
        text: "This log entry will be permanently removed from history.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Yes, delete entry"
    });

    if (result.isConfirmed) {
        try {
            await window.db.collection(collectionName).doc(logId).delete();
            Swal.fire("Deleted!", "Log entry removed successfully.", "success");
        } catch (error) {
            Swal.fire("Error", "Could not remove log: " + error.message, "error");
        }
    }
};

/**
 * Bulk deletes an entire date group of logs from Firestore using WriteBatch
 */
window.deleteDateGroupLogs = async function (collectionName, idsJsonString, dateTitle) {
    if (!can("logs.delete")) {
        return denyAccess("delete log entries");
    }

    let logIds = [];
    try {
        logIds = JSON.parse(decodeURIComponent(idsJsonString));
    } catch (e) {
        console.error("Failed to parse log IDs array", e);
        return;
    }

    if (!logIds || logIds.length === 0) return;

    const result = await Swal.fire({
        title: "Delete Log Group?",
        text: `Are you sure you want to delete all ${logIds.length} record(s) for "${dateTitle}"? This action cannot be undone.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#6c757d",
        confirmButtonText: "Yes, delete logs"
    });

    if (!result.isConfirmed) return;

    try {
        const batch = window.db.batch();
        logIds.forEach(id => {
            const docRef = window.db.collection(collectionName).doc(id);
            batch.delete(docRef);
        });

        await batch.commit();
        Swal.fire("Deleted!", `Successfully removed ${logIds.length} records for ${dateTitle}.`, "success");
    } catch (error) {
        console.error("Bulk deletion failed:", error);
        Swal.fire("Error", "Failed to delete date group logs: " + error.message, "error");
    }
};


/* ==========================================================================
   SECTION 4: AUTHENTICATION & PORTAL ACCESS MANAGEMENT
   ========================================================================== */

/**
 * Toggles UI portal selection between Admin and Staff logins
 */
window.setPortalMode = (mode) => {
    window.activePortalMode = mode;
    const adminBtn = document.getElementById("switchToAdminBtn");
    const staffBtn = document.getElementById("switchToStaffBtn");

    if (loginMsg) loginMsg.textContent = "";

    if (adminBtn && staffBtn) {
        adminBtn.classList.toggle("active", mode === "admin");
        staffBtn.classList.toggle("active", mode !== "admin");
        if (loginBtn) loginBtn.textContent = mode === "admin" ? "Login as Admin" : "Login as Staff";
    }
};

/**
 * Updates UI layout elements according to authenticated user role
 */
function updateUIByRole(role) {
    window.currentRole = (role || "admin").toString().toLowerCase().trim();
    localStorage.setItem("currentRole", window.currentRole);

    if (roleBadge) {
        roleBadge.textContent = window.currentRole.toUpperCase();
    }

    document.querySelectorAll(".admin-only").forEach(el => {
        el.classList.toggle("d-none", window.currentRole !== "admin");
    });
    // Show or hide everything that depends on what this role is allowed to do
    if (typeof window.applyPermissionUI === "function") window.applyPermissionUI();

    // Re-render products table so Admin / Manager buttons appear immediately
    if (typeof window.renderProductsFiltered === "function" && window.productsCache && window.productsCache.length > 0) {
        window.renderProductsFiltered();
    }
    // Re-render sales table so Admin Delete buttons appear immediately
    if (typeof window.filterSalesTable === "function") {
        window.filterSalesTable();
    }
    // Re-render daily sales summary so Admin Delete buttons appear immediately
    if (typeof renderGroupedSales === "function" && window.allSales) {
        renderGroupedSales(window.allSales);
    }
    // Re-render Net Profit Card Breakdown so Admin Month Delete buttons appear immediately
    if (typeof window.renderProfitCardBreakdown === "function") {
        window.renderProfitCardBreakdown();
    }
    // Re-render Restock Log Tables so Admin Delete buttons appear immediately
    if (typeof window.refreshRestockLogTables === "function") {
        window.refreshRestockLogTables();
    }
    // Re-render insights (profit is admin-only) and the day closing history
    if (typeof window.renderInsights === "function") window.renderInsights();
    if (typeof window.renderDayClosings === "function") window.renderDayClosings();
}

/**
 * Helper to extract current active user email across session types
 */
function getCurrentUserEmail() {
    return window.auth?.currentUser?.email || window.loggedStaffEmail || window.currentUserEmail || "";
}

// User Login Submission Handler
if (loginBtn) {
    loginBtn.onclick = async () => {
        if (loginMsg) loginMsg.textContent = "";

        const emailVal = loginEmail ? loginEmail.value.trim().toLowerCase() : "";
        const passVal = loginPass ? loginPass.value : "";

        if (!emailVal || !passVal) {
            if (loginMsg) loginMsg.textContent = "Please fill in all fields.";
            return;
        }

        try {
            // Staff Portal Login Flow
            if (window.activePortalMode === "staff") {
                const userDoc = await window.db.collection("users").doc(emailVal).get(readOpts());

                if (!userDoc.exists) {
                    if (loginMsg) loginMsg.textContent = "No registered staff profile found.";
                    return;
                }

                const userData = userDoc.data();

                if (userData.status === "blocked") {
                    if (loginMsg) loginMsg.textContent = "Account blocked by admin.";
                    return;
                }

                if (userData.password !== passVal) {
                    if (loginMsg) loginMsg.textContent = "Incorrect password.";
                    return;
                }

                // Staff must close any earlier unfinished shift before logging in again
                if ((userData.role || "staff") !== "admin") {
                    const cleared = await resolvePendingClockOuts(emailVal);
                    if (!cleared) {
                        if (loginMsg) loginMsg.textContent = "Login cancelled: enter the time you left work on your previous shift.";
                        return;
                    }
                }

                window.customSessionActive = true;
                window.loggedStaffEmail = emailVal;
                window.currentUserEmail = emailVal;
                window.currentRole = userData.role || "staff";

                updateUIByRole(window.currentRole);
                startAttendanceRealtimeListener();

                // Attendance Location Check
                const today = new Date().toLocaleDateString();
                const check = await window.db.collection("attendance")
                    .where("staffEmail", "==", emailVal)
                    .where("date", "==", today)
                    .get(readOpts());

                if (check.empty) {
                    Swal.fire({
                        title: "Attendance Check-In Required",
                        confirmButtonColor: "#a86d27",
                        text: "You must check in with your location to access your staff dashboard.",
                        icon: "warning",
                        confirmButtonText: "Clock In Now",
                        allowOutsideClick: false,
                        allowEscapeKey: false,
                        showLoaderOnConfirm: true,
                        preConfirm: async () => {
                            // The admin can switch the location check off, or add several workplaces
                            const cfg = await loadWorkplaceConfig();
                            let coords = null;
                            let verdict = { ok: true };
                            if (cfg.enabled) {
                                const position = await getPositionOnce();
                                if (!position.success) {
                                    Swal.showValidationMessage("Location Required: Please enable GPS/location services.");
                                    return false;
                                }
                                coords = position.coords;
                                verdict = await checkWorkplace(coords);
                                if (!verdict.ok) {
                                    Swal.showValidationMessage("Access Denied: " + verdict.message);
                                    return false;
                                }
                            }

                            try {
                                await writeWithGrace(window.db.collection("attendance").add(Object.assign({
                                    staffEmail: emailVal,
                                    date: today,
                                    clockIn: firebase.firestore.FieldValue.serverTimestamp(),
                                    clockOut: null,
                                    location: coords ? { lat: coords.latitude, lon: coords.longitude } : null
                                }, attendanceExtras(verdict))));
                                return true;
                            } catch (err) {
                                Swal.showValidationMessage(`Database error: ${err.message}`);
                                return false;
                            }
                        }
                    }).then((result) => {
                        if (result.isConfirmed && result.value) {
                            Swal.fire("Clocked In", "Welcome to work! Dashboard unlocked.", "success");
                            if (loginEmail) loginEmail.value = "";
                            if (loginPass) loginPass.value = "";
                            showDashboard();
                        }
                    });
                } else {
                    if (loginEmail) loginEmail.value = "";
                    if (loginPass) loginPass.value = "";
                    showDashboard();
                }
                return;
            }

            // Admin Firebase Auth Login Flow
            const userCredential = await window.auth.signInWithEmailAndPassword(emailVal, passVal);
            const token = await userCredential.user.getIdTokenResult(true);

            window.customSessionActive = false;
            window.currentRole = token.claims.role || "staff";

            updateUIByRole(window.currentRole);
            startAttendanceRealtimeListener();

            if (loginEmail) loginEmail.value = "";
            if (loginPass) loginPass.value = "";
            showDashboard();

        } catch (e) {
            if (loginMsg) loginMsg.textContent = e.message;
        }
    };
}

// User Logout Handler
if (logoutBtn) {
    logoutBtn.onclick = () => {
        window.customSessionActive = false;
        window.auth.signOut().then(() => {
            showLogin();
            location.reload();
        });
    };
}

// Global Auth State Observer
window.auth.onAuthStateChanged(async (user) => {
    if (window.customSessionActive) return;

    if (!user) {
        showLogin();
        return;
    }

    try {
        const userDoc = await window.db.collection("users")
            .doc(user.email.toLowerCase()).get();

        if (userDoc.exists) {
            const userData = userDoc.data();

            if (userData.status === "blocked") {
                Swal.fire("Access Revoked", "Account blocked.", "error");
                window.auth.signOut();
                return;
            }

            window.currentRole = userData.role || "staff";
            updateUIByRole(window.currentRole);
        } else {
            const token = await user.getIdTokenResult(true);
            window.currentRole = token.claims.role || "staff";
            updateUIByRole(window.currentRole);
        }

        startAttendanceRealtimeListener();
        showDashboard();

    } catch (err) {
        console.error("Auth error:", err);
        if (!navigator.onLine) {
            // Offline: keep the signed-in admin inside the app using the role remembered on this device
            window.currentRole = localStorage.getItem("currentRole") || "staff";
            updateUIByRole(window.currentRole);
            startAttendanceRealtimeListener();
            showDashboard();
            return;
        }
        window.auth.signOut();
    }
});


/* ==========================================================================
   SECTION 5: ATTENDANCE & GEOLOCATION TRACKING
   ========================================================================== */

// The built-in workplace. It is used until the admin saves their own in the "Work location" window.
const OFFICE_LAT = -1.533134;
const OFFICE_LON = 37.131476;
const DEFAULT_RADIUS_M = 10000;     // the old fixed limit (0.09 degrees) works out to about 10 km

const DEFAULT_WORKPLACE = () => ({ enabled: true, locations: [{ name: "Workplace", lat: OFFICE_LAT, lon: OFFICE_LON, radius: DEFAULT_RADIUS_M, active: true }] });

// The admin's saved setting (settings/workplace). null until it has loaded.
window.workplaceConfig = null;

function normalizeWorkplace(d) {
    const data = d || {};
    const locations = (Array.isArray(data.locations) ? data.locations : [])
        .map(l => ({ name: String((l && l.name) || "Workplace"), lat: Number(l && l.lat), lon: Number(l && l.lon), radius: Math.max(10, Number(l && l.radius) || 100), active: !(l && l.active === false) }))
        .filter(l => isFinite(l.lat) && isFinite(l.lon) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180);
    const enabled = data.enabled !== false;
    // With the check on, at least one place must be ticked, otherwise the built-in one is used
    const fixed = locations.some(l => l.active) || !enabled ? locations : (locations.length ? locations.map(l => Object.assign(l, { active: true })) : DEFAULT_WORKPLACE().locations);
    return { enabled, locations: fixed };
}

window.db.collection("settings").doc("workplace").onSnapshot(doc => {
    window.workplaceConfig = doc.exists ? normalizeWorkplace(doc.data()) : DEFAULT_WORKPLACE();
    if (typeof window.onWorkplaceChanged === "function") window.onWorkplaceChanged();
}, err => console.warn("Workplace listener:", err));

async function loadWorkplaceConfig() {
    if (window.workplaceConfig) return window.workplaceConfig;
    const snap = await safeGet(window.db.collection("settings").doc("workplace"));
    window.workplaceConfig = snap && snap.exists ? normalizeWorkplace(snap.data()) : DEFAULT_WORKPLACE();
    return window.workplaceConfig;
}

/** Straight-line distance between two GPS points, in metres */
function distanceMeters(lat1, lon1, lat2, lon2) {
    const rad = (d) => d * Math.PI / 180;
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m) {
    return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

function getPositionOnce() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve({ success: false, error: { message: "no GPS" } });
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ success: true, coords: pos.coords }),
            (err) => resolve({ success: false, error: err }),
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );
    });
}

/**
 * Is this GPS position at the workplace? Uses the admin's saved locations (any one of them is enough).
 * A weak GPS signal gets up to 50 m of benefit of the doubt.
 * People with the "clock in from anywhere" permission are let in but marked as off-site.
 * Returns { ok, required, offSite, distance, place, message }
 */
async function checkWorkplace(coords) {
    const cfg = await loadWorkplaceConfig();
    const places = cfg.locations.filter(l => l.active !== false);
    if (!cfg.enabled || !places.length) return { ok: true, required: false };

    let best = null;
    places.forEach(l => {
        const d = distanceMeters(coords.latitude, coords.longitude, l.lat, l.lon);
        if (!best || d - l.radius < best.d - best.l.radius) best = { l, d };
    });
    const credit = Math.min(Math.max(parseFloat(coords.accuracy) || 0, 0), 50);
    const result = { required: true, distance: Math.round(best.d), place: best.l.name };
    if (best.d - credit <= best.l.radius) return Object.assign({ ok: true }, result);
    if (can("attendance.anywhere")) return Object.assign({ ok: true, offSite: true }, result);
    return Object.assign({
        ok: false,
        message: `You are about ${formatDistance(best.d)} from ${best.l.name}. You must be within ${formatDistance(best.l.radius)} to clock in.`
    }, result);
}

/** Extra details saved with a clock in */
function attendanceExtras(verdict) {
    return Object.assign({},
        verdict && verdict.place ? { workplace: verdict.place, distanceM: verdict.distance } : {},
        verdict && verdict.offSite ? { offSite: true } : {});
}

/**
 * Checks the staff member's latest shift; if it was on an earlier day and never clocked out,
 * asks for the time they left. Resolves true when everything is closed, false if they cancel.
 */
async function resolvePendingClockOuts(email) {
    const todayKey = new Date().toDateString();

    const snap = await window.db.collection("attendance")
        .where("staffEmail", "==", email)
        .get();

    // Only the staff member's most recent shift matters; older unclosed days are ignored
    const latest = snap.docs
        .filter(d => d.data().clockIn)
        .sort((a, b) => b.data().clockIn.toMillis() - a.data().clockIn.toMillis())[0];

    const pending = (latest && !latest.data().clockOut && latest.data().clockIn.toDate().toDateString() !== todayKey)
        ? [latest]
        : [];

    for (const doc of pending) {
        const a = doc.data();
        const clockIn = a.clockIn.toDate();

        const res = await Swal.fire({
            title: "Previous shift not closed",
            html: `You clocked in on <b>${a.date}</b> at <b>${clockIn.toLocaleTimeString()}</b> but never clocked out.<br>Enter the time you left work to continue.`,
            icon: "warning",
            input: "time",
            inputLabel: "Time you left work",
            showCancelButton: true,
            confirmButtonText: "Save & Continue",
            cancelButtonText: "Cancel Login",
            allowOutsideClick: false,
            allowEscapeKey: false,
            preConfirm: (val) => {
                if (!val) {
                    Swal.showValidationMessage("Please enter the time you left work.");
                    return false;
                }
                const [h, m] = val.split(":").map(Number);
                const out = new Date(clockIn);
                out.setHours(h, m, 0, 0);
                // A leaving time earlier than the clock-in time means the shift ended after midnight
                if (out <= clockIn) out.setDate(out.getDate() + 1);
                if (out > new Date()) {
                    Swal.showValidationMessage("The leaving time cannot be in the future.");
                    return false;
                }
                return out;
            }
        });

        if (!res.isConfirmed) return false;

        await doc.ref.update({
            clockOut: firebase.firestore.Timestamp.fromDate(res.value),
            clockOutManual: true,
            clockOutEnteredAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
    return true;
}

/**
 * Realtime listener for active attendance logs
 */
function startAttendanceRealtimeListener() {
    if (typeof window.activeAttendanceListener === "function") {
        window.activeAttendanceListener();
    }

    const attendanceTable = document.getElementById("attendanceTable");
    if (!attendanceTable) return;

    window.activeAttendanceListener = window.db.collection("attendance")
        .orderBy("clockIn", "desc")
        .onSnapshot(snap => {
            let rowsHTML = "";

            snap.forEach(doc => {
                const a = doc.data();
                if (!a.clockIn) return;

                const email = getCurrentUserEmail();
                const seeAll = can("attendance.viewAll");
                const canDelete = can("attendance.delete");

                if (!seeAll && a.staffEmail !== email) return;

                rowsHTML += `
                    <tr>
                        <td data-label="Date">${a.date}</td>
                        ${seeAll ? `<td data-label="Staff">${a.staffEmail}</td>` : ""}
                        <td data-label="In">${a.clockIn.toDate().toLocaleTimeString()}${a.offSite ? ` <span class="badge text-bg-warning" title="Clocked in away from the workplace${a.distanceM ? " (" + formatDistance(a.distanceM) + " from " + escHtml(a.workplace || "it") + ")" : ""}">off-site</span>` : ""}</td>
                        <td data-label="Out">${a.clockOut ? a.clockOut.toDate().toLocaleTimeString() + (a.clockOutManual ? ' <span class="badge text-bg-light border" title="Entered manually by staff on next login">manual</span>' : '') : "Ongoing"}</td>
                        ${canDelete ? `
                            <td class="text-end">
                                <button class="btn btn-sm btn-outline-danger"
                                    title="Delete Attendance Record"
                                    onclick="window.deleteAttendanceRecord('${doc.id}')">
                                    <i class="fas fa-trash-alt me-1"></i>Delete
                                </button>
                            </td>
                        ` : ""}
                    </tr>
                `;
            });

            if (!rowsHTML) {
                rowsHTML = `<tr><td colspan="${3 + (can("attendance.viewAll") ? 1 : 0) + (can("attendance.delete") ? 1 : 0)}" class="text-center text-muted py-3">No attendance records found.</td></tr>`;
            }

            attendanceTable.innerHTML = rowsHTML;
        }, error => {
            console.error("Realtime attendance error:", error);
        });
}

/**
 * Manual Clock In function
 */
window.clockIn = async () => {
    const email = getCurrentUserEmail();
    if (!email) return Swal.fire("Error", "No user detected", "error");

    const cfg = await loadWorkplaceConfig();
    let coords = null;
    let verdict = { ok: true };
    if (cfg.enabled) {
        const position = await getPositionOnce();
        if (!position.success) {
            return Swal.fire("Location Required", "Please allow GPS and location access parameters to clock in.", "warning");
        }
        coords = position.coords;
        verdict = await checkWorkplace(coords);
        if (!verdict.ok) return Swal.fire("Access Denied", verdict.message, "error");
    }

    const today = new Date().toLocaleDateString();

    const check = await window.db.collection("attendance")
        .where("staffEmail", "==", email)
        .where("date", "==", today)
        .get();

    if (!check.empty) {
        return Swal.fire("Already Checked In", "You have already completed check-in for today.", "warning");
    }

    await window.db.collection("attendance").add(Object.assign({
        staffEmail: email,
        date: today,
        clockIn: firebase.firestore.FieldValue.serverTimestamp(),
        clockOut: null,
        location: coords ? { lat: coords.latitude, lon: coords.longitude } : null
    }, attendanceExtras(verdict)));

    await Swal.fire("Clocked In", verdict.offSite ? "You are clocked in. This was recorded as off-site." : "Success! Your dashboard access is fully active.", "success");
    showDashboard();
};

/**
 * Manual Clock Out function
 */
window.clockOut = async () => {
    const email = getCurrentUserEmail();
    if (!email) return;

    const today = new Date().toLocaleDateString();

    const query = await window.db.collection("attendance")
        .where("staffEmail", "==", email)
        .where("date", "==", today)
        .where("clockOut", "==", null)
        .get();

    if (query.empty) {
        return Swal.fire("Error", "No active shift found or you have already clocked out today.", "error");
    }

    await query.docs[0].ref.update({
        clockOut: firebase.firestore.FieldValue.serverTimestamp()
    });

    Swal.fire("Clocked Out", "Shift ended successfully.", "info");
};

/**
 * Deletes attendance record (Admin only)
 */
window.deleteAttendanceRecord = async (id) => {
    if (!can("attendance.delete")) return denyAccess("delete attendance records");

    const result = await Swal.fire({
        title: "Delete this record?",
        text: "You won't be able to revert this action!",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Yes, delete it!"
    });

    if (result.isConfirmed) {
        await window.db.collection("attendance").doc(id).delete();
        Swal.fire("Deleted!", "The record has been cleared.", "success");
    }
};

/**
 * Exports Attendance Report to PDF
 */
window.exportAttendance = async () => {
    if (!can("attendance.export")) return denyAccess("download the attendance report");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const email = getCurrentUserEmail();
    const role = window.currentRole || "staff";

    let query = window.db.collection("attendance").orderBy("clockIn", "desc");
    if (!can("attendance.viewAll")) {
        query = query.where("staffEmail", "==", email);
    }

    const snap = await query.get();
    const tableData = snap.docs.map(d => {
        const a = d.data();
        return [
            a.date,
            a.staffEmail,
            a.clockIn?.toDate().toLocaleTimeString(),
            a.clockOut?.toDate().toLocaleTimeString() || "Ongoing"
        ];
    });

    doc.text("Staff Attendance Report", 14, 10);
    doc.autoTable({
        head: [["Date", "Staff", "Clock In", "Clock Out"]],
        body: tableData
    });

    doc.save(`Attendance_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
};


/* ==========================================================================
   SECTION 6: PRODUCT & INVENTORY MANAGEMENT
   ========================================================================== */

/**
 * Quick Restock Handler: Fetches current stock, increments value, logs previousStock & afterStock snapshots, and notifies staff.
 */
/**
 * Opens the Update Stock modal for a product (Admin only)
 */
window.openStockModal = (productId, productName) => {
    if (!(can("stock.add") || can("stock.reduce"))) return denyAccess("change stock");

    const prodDoc = (window.productsCache || []).find(d => d.id === productId);
    window.stockModalProduct = { id: productId, name: productName };

    document.getElementById("stockModalProductName").textContent = productName;
    document.getElementById("stockModalCurrent").textContent = prodDoc ? window.toMixedFraction(prodDoc.data().stock) : "0";
    document.getElementById("stockQtyInput").value = "";
    document.getElementById("stockReasonInput").value = "";

    bootstrap.Modal.getOrCreateInstance(document.getElementById("stockModal")).show();
};

/**
 * Closes the Update Stock modal after a successful change
 */
function closeStockModal() {
    const modalEl = document.getElementById("stockModal");
    const inst = modalEl && bootstrap.Modal.getInstance(modalEl);
    if (inst) inst.hide();
}

window.quickRestock = async (productId, productName) => {
    if (!can("stock.add")) return denyAccess("add stock");

    const inputEl = document.getElementById("stockQtyInput");
    if (!inputEl) return;
    const amountToAdd = parseFloat(inputEl.value);

    if (isNaN(amountToAdd) || amountToAdd <= 0) {
        return Swal.fire("Invalid", "Enter a valid restock quantity", "warning");
    }

    try {
        const prodRef = window.db.collection("products").doc(productId);
        const prodSnap = await prodRef.get();
        if (!prodSnap.exists) {
            return Swal.fire("Error", "Product record not found", "error");
        }

        const currentStock = parseFloat(prodSnap.data().stock || 0);
        const afterStock = currentStock + amountToAdd;
        const timestamp = firebase.firestore.FieldValue.serverTimestamp();

        // 1. Update product stock counter
        await prodRef.update({
            stock: afterStock
        });

        // 2. Log transaction with snapshot tracking
        await window.db.collection("restock_logs").add({
            productId: productId,
            name: productName,
            quantityAdded: amountToAdd,
            previousStock: currentStock,
            afterStock: afterStock,
            restockedAt: timestamp
        });

        // 3. Dispatch real-time system notification for staff & admin
        const notifRef = await window.db.collection("notifications").add({
            type: "restock",
            title: `📦 Product Restocked: ${productName}`,
            message: `Admin restocked +${window.toMixedFraction(amountToAdd)} of ${productName}. Stock before: ${window.toMixedFraction(currentStock)} ➔ Total stock after: ${window.toMixedFraction(afterStock)}.`,
            productName: productName,
            quantityAdded: amountToAdd,
            previousStock: currentStock,
            afterStock: afterStock,
            timestamp: timestamp
        });
        if (notifRef && notifRef.id) {
            window.markNotifAsRead(notifRef.id);
        }

        inputEl.value = "";
        closeStockModal();
        Swal.fire("Restocked!",`Added ${amountToAdd} to ${productName}. Stock is now ${window.toMixedFraction(afterStock)}.`, "success");
    } catch (err) {
        console.error("Quick restock error:", err);
        Swal.fire("Error", "Failed to process restock: " + err.message, "error");
    }
};

/**
 * Dynamic Inventory Adjustments (+ / - buttons with reason, snapshot tracking & real-time notification)
 */
window.adjustStock = async (productId, productName, operationalMode) => {
    if (operationalMode === "add" ? !can("stock.add") : !can("stock.reduce")) {
        return denyAccess(operationalMode === "add" ? "add stock" : "reduce stock");
    }

    const qtyEl = document.getElementById("stockQtyInput");
    const reasonEl = document.getElementById("stockReasonInput");
    if (!qtyEl || !reasonEl) return;

    const quantity = parseFloat(qtyEl.value);
    const reason = reasonEl.value.trim();

    if (isNaN(quantity) || quantity <= 0) {
        return Swal.fire("Invalid Quantity", "Please enter a positive value.", "warning");
    }
    if (!reason) {
        return Swal.fire("Reason Required", "Please specify a reason for adjustment.", "warning");
    }

    try {
        const prodRef = window.db.collection("products").doc(productId);
        const prodSnap = await prodRef.get();
        if (!prodSnap.exists) {
            return Swal.fire("Error", "Product record not found", "error");
        }

        const currentStock = parseFloat(prodSnap.data().stock || 0);
        const targetValue = operationalMode === "add" ? quantity : -quantity;
        const afterStock = Math.max(0, currentStock + targetValue);
        const timestamp = firebase.firestore.FieldValue.serverTimestamp();

        // 1. Update product stock counter
        await prodRef.update({
            stock: afterStock
        });

        // 2. Log transaction details with snapshots & reason
        await window.db.collection("restock_logs").add({
            productId: productId,
            name: productName,
            quantityAdded: targetValue,
            previousStock: currentStock,
            afterStock: afterStock,
            reason: reason,
            restockedAt: timestamp
        });

        // 3. Dispatch system notification
        const notifRef = await window.db.collection("notifications").add({
            type: "stock_adjustment",
            title: `🔄 Stock Adjusted: ${productName}`,
            message: `Admin updated ${productName} (${operationalMode === 'add' ? '+' : ''}${window.toMixedFraction(targetValue)}). Reason: ${reason}. Stock before: ${window.toMixedFraction(currentStock)} ➔ Total stock after: ${window.toMixedFraction(afterStock)}.`,
            productName: productName,
            quantityAdded: targetValue,
            previousStock: currentStock,
            afterStock: afterStock,
            reason: reason,
            timestamp: timestamp
        });
        if (notifRef && notifRef.id) {
            window.markNotifAsRead(notifRef.id);
        }

        if (operationalMode !== "add") {
            logAudit("stock", "stock_reduce", `Stock reduced: ${productName}`,
                `${window.toMixedFraction(currentStock)} → ${window.toMixedFraction(afterStock)} (−${window.toMixedFraction(quantity)}). Reason: ${reason}`, { flag: true });
        }

        qtyEl.value = "";
        reasonEl.value = "";
        closeStockModal();
        Swal.fire("Stock Adjusted", `Updated ${productName}. New stock: ${window.toMixedFraction(afterStock)}.`, "success");
    } catch (err) {
        console.error("Stock adjustment error:", err);
        Swal.fire("Error", "Failed to adjust stock: " + err.message, "error");
    }
};

// Update Stock modal actions: "Add Stock" logs a plain restock unless a reason is given; "Reduce" always needs a reason
(function bindStockModalButtons() {
    const addBtn = document.getElementById("stockAddBtn");
    const removeBtn = document.getElementById("stockRemoveBtn");
    const reasonEl = document.getElementById("stockReasonInput");

    if (addBtn) {
        addBtn.onclick = () => {
            const p = window.stockModalProduct;
            if (!p) return;
            if (reasonEl && reasonEl.value.trim()) window.adjustStock(p.id, p.name, "add");
            else window.quickRestock(p.id, p.name);
        };
    }
    if (removeBtn) {
        removeBtn.onclick = () => {
            const p = window.stockModalProduct;
            if (p) window.adjustStock(p.id, p.name, "remove");
        };
    }
})();

/**
 * Single Consolidated Product Renderer for Admin & Staff Views
 */
window.renderProducts = function (docs) {
    const productsHead = document.getElementById("productsHead");
    const productsTable = document.getElementById("productsTable");
    const lowStockBadge = document.getElementById("lowStockBadge");
    const lowStockWrapper = document.getElementById("lowStockWrapper");

    if (!productsTable) return;

    productsTable.innerHTML = "";
    let lowStockItems = [];

    const showBuy = can("view.buyPrices");
    const canEdit = can("products.edit");
    const canDelete = can("products.delete");
    const canStock = can("stock.add") || can("stock.reduce");
    const showActions = canEdit || canDelete || canStock;

    // Low stock always looks at every product, not just the ones currently filtered on screen
    (window.productsCache || docs).forEach(d => {
        const p = d.data();
        if (parseFloat(p.stock || 0) <= parseFloat(p.min || 0)) lowStockItems.push(p);
    });

    // 1. Build Table Headers Dynamically
    let headerHTML = `<tr><th>Name</th><th>Category</th>`;
    if (showBuy) headerHTML += `<th>Buy</th>`;
    headerHTML += `<th>Sell</th><th>Stock</th><th>Min</th>`;
    if (showActions) headerHTML += `<th class="text-end">Actions</th>`;
    headerHTML += `</tr>`;

    if (productsHead) productsHead.innerHTML = headerHTML;

    // 2. Sort and Build Rows
    const sortedDocs = [...docs].sort((a, b) => a.data().name.localeCompare(b.data().name));
    let rowsHTML = "";

    sortedDocs.forEach(doc => {
        const p = doc.data();
        const id = doc.id;
        const isLow = parseFloat(p.stock || 0) <= parseFloat(p.min || 0);
        const tots = parseFloat(p.totsPerBottle) || 0;
        const totPrice = parseFloat(p.totPrice) || 0;
        const category = (p.category || "").trim();

        let rowHTML = `<tr class="${isLow ? 'table-danger' : ''}"><td data-label="Product" class="fw-semibold">${p.name}${isLow ? ' <span class="low-stock ms-1">Low</span>' : ''}${tots > 0 ? ` <span class="tot-tag" title="${tots} tots per bottle">tots</span>` : ''}</td>
            <td data-label="Category" class="text-muted">${category ? escHtml(category) : '<span class="opacity-50">-</span>'}</td>`;
        if (showBuy) {
            rowHTML += `<td data-label="Buy">KSh ${parseFloat(p.buyPrice || 0).toFixed(2)}</td>`;
        }
        rowHTML += `<td data-label="Sell">KSh ${parseFloat(p.price || 0).toFixed(2)}${tots > 0 && totPrice > 0 ? `<small class="text-muted d-block">KSh ${totPrice.toFixed(2)} / tot</small>` : ''}</td>
                   <td data-label="Stock"><span class="stock-pill">${window.toMixedFraction(p.stock)}</span>${tots > 0 ? `<small class="text-muted d-block">about ${Math.floor((parseFloat(p.stock) || 0) * tots + 1e-6)} tots</small>` : ''}</td>
                   <td data-label="Min" class="text-muted">${window.toMixedFraction(p.min)}</td>`;

        if (showActions) {
            rowHTML += `
            <td class="text-end text-nowrap">
                ${canStock ? `<button class="btn btn-sm btn-soft stockBtn" data-id="${id}" title="${can("stock.reduce") ? 'Add or reduce stock' : 'Add stock'}"><i class="fas fa-boxes-packing me-1 text-success"></i>Stock</button>` : ''}
                ${canEdit ? `<button class="btn btn-sm btn-soft editBtn" data-id="${id}" title="Edit product"><i class="fas fa-pen text-primary"></i></button>` : ''}
                ${canDelete ? `<button class="btn btn-sm btn-soft delBtn" data-id="${id}" title="Delete product"><i class="fas fa-trash-can text-danger"></i></button>` : ''}
            </td>`;
        }
        rowHTML += `</tr>`;
        rowsHTML += rowHTML;
    });

    if (!rowsHTML) {
        const cols = 5 + (showBuy ? 1 : 0) + (showActions ? 1 : 0);
        rowsHTML = `<tr><td colspan="${cols}"><div class="empty-state"><i class="fas fa-wine-bottle"></i>No products found.</div></td></tr>`;
    }

    productsTable.innerHTML = rowsHTML;

    // 3. Update Low Stock Badge & Modal Trigger
    if (lowStockBadge) lowStockBadge.textContent = lowStockItems.length;

    if (lowStockWrapper) {
        lowStockWrapper.style.display = lowStockItems.length > 0 ? "" : "none";
        lowStockWrapper.style.cursor = "pointer";
        lowStockWrapper.onclick = () => {
            const modalBody = document.querySelector("#lowStockModal .modal-body");
            if (modalBody) {
                modalBody.innerHTML = lowStockItems.length > 0
                    ? lowStockItems.map(p => `
                        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                            <strong>${p.name}</strong>
                            <span class="text-end">
                                <span class="low-stock">${window.toMixedFraction(p.stock)} left</span>
                                <small class="text-muted d-block">Min: ${window.toMixedFraction(p.min)}</small>
                            </span>
                        </div>`).join('')
                    : `<div class="empty-state"><i class="fas fa-circle-check"></i>All stock levels are healthy.</div>`;
                const modalEl = document.getElementById("lowStockModal");
                if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            }
        };
    }

    // 4. Attach Stock + Edit Listeners
    document.querySelectorAll(".stockBtn").forEach(btn => {
        btn.onclick = () => {
            const targetDoc = docs.find(d => d.id === btn.dataset.id);
            if (targetDoc) window.openStockModal(targetDoc.id, targetDoc.data().name);
        };
    });

    document.querySelectorAll(".editBtn").forEach(btn => {
        btn.onclick = () => {
            if (!can("products.edit")) return denyAccess("edit products");
            editProductId = btn.dataset.id;
            const targetDoc = docs.find(d => d.id === editProductId);
            if (!targetDoc) return;
            const p = targetDoc.data();

            const editName = document.getElementById("editProdName");
            const editBuy = document.getElementById("editProdBuyingPrice");
            const editPrice = document.getElementById("editProdPrice");
            const editStock = document.getElementById("editProdStock");
            const editMin = document.getElementById("editProdMin");

            if (editName) editName.value = p.name || "";
            if (editBuy) editBuy.value = p.buyPrice || 0;
            if (editPrice) editPrice.value = p.price || 0;
            if (editStock) editStock.value = p.stock || 0;
            if (editMin) editMin.value = p.min || 0;
            const editCat = document.getElementById("editProdCategory");
            const editTots = document.getElementById("editProdTots");
            const editTotPrice = document.getElementById("editProdTotPrice");
            if (editCat) editCat.value = p.category || "";
            if (editTots) editTots.value = p.totsPerBottle || "";
            if (editTotPrice) editTotPrice.value = p.totPrice || "";
            const editBarcode = document.getElementById("editProdBarcode");
            if (editBarcode) editBarcode.value = p.barcode || "";

            const editModalEl = document.getElementById("editProductModal");
            if (editModalEl) bootstrap.Modal.getOrCreateInstance(editModalEl).show();
        };
    });

    // 5. Attach Delete Listeners (with Undo functionality)
    document.querySelectorAll(".delBtn").forEach(btn => {
        btn.onclick = async () => {
            if (!can("products.delete")) return denyAccess("delete products");
            const id = btn.dataset.id;
            const targetDoc = docs.find(d => d.id === id);
            if (!targetDoc) return;
            const productData = targetDoc.data();
            const productName = productData.name || "this product";

            const result = await Swal.fire({
                title: 'Are you sure?',
                text: `You are about to delete "${productName}". This cannot be undone!`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                confirmButtonText: 'Yes, delete it!'
            });

            if (result.isConfirmed) {
                try {
                    const docRef = window.db.collection("products").doc(id);
                    await docRef.delete();
                    logAudit("delete", "product_delete", `Product deleted: ${productName}`,
                        `Price KSh ${parseFloat(productData.price) || 0}, stock ${window.toMixedFraction(parseFloat(productData.stock) || 0)} at the time`, { flag: true });

                    const toast = await Swal.fire({
                        title: 'Deleted!',
                        text: `"${productName}" has been deleted.`,
                        icon: 'success',
                        showCancelButton: true,
                        cancelButtonText: 'Undo',
                        confirmButtonText: 'OK'
                    });

                    if (toast.dismiss === Swal.DismissReason.cancel) {
                        await docRef.set(productData);
                        Swal.fire('Restored!', `"${productName}" has been restored.`, 'success');
                    }
                } catch (err) {
                    Swal.fire('Error', 'Could not delete product: ' + err.message, 'error');
                }
            }
        };
    });
};

/**
 * Initializes Products Dashboard & Management Listeners
 */
window.openAddProductModal = () => {
    if (!can("products.add")) return denyAccess("add products");
    ["prodName", "prodBuyPrice", "prodPrice", "prodStock", "prodMin", "prodCategory", "prodTots", "prodTotPrice", "prodBarcode"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    bootstrap.Modal.getOrCreateInstance(document.getElementById("addProductModal")).show();
};

function hideModalById(id) {
    const el = document.getElementById(id);
    const inst = el && bootstrap.Modal.getInstance(el);
    if (inst) inst.hide();
}

function initDashboard() {
    const addProductBtn = document.getElementById("addProductBtn");
    const saveEditBtn = document.getElementById("saveEditBtn");

    // Add Product Handler
    if (addProductBtn) {
        addProductBtn.onclick = async () => {
            if (!can("products.add")) {
                return denyAccess("add products");
            }
            const prodName = document.getElementById("prodName");
            const prodBuyPrice = document.getElementById("prodBuyPrice");
            const prodPrice = document.getElementById("prodPrice");
            const prodStock = document.getElementById("prodStock");
            const prodMin = document.getElementById("prodMin");

            if (!prodName || !prodPrice || !prodStock || !prodName.value || !prodPrice.value || !prodStock.value) {
                return Swal.fire("Missing Info", "Please fill out the required product fields.", "warning");
            }

            const timestamp = firebase.firestore.FieldValue.serverTimestamp();
            const parsedStock = parseFloat(prodStock.value) || 0;
            const pName = prodName.value.trim();

            const totsPerBottle = parseFloat(document.getElementById("prodTots").value) || 0;
            const totPrice = parseFloat(document.getElementById("prodTotPrice").value) || 0;
            if (totsPerBottle > 0 && totPrice <= 0) {
                return Swal.fire("Price per tot needed", "You entered how many tots a bottle holds. Enter the price of one tot too.", "warning");
            }
            const barcode = (document.getElementById("prodBarcode").value || "").trim();
            if (barcode && barcodeInUse(barcode, null)) {
                return Swal.fire("Barcode already used", "Another product already has this barcode.", "warning");
            }

            try {
                // Save main product record
                const docRef = await window.db.collection("products").add({
                    name: pName,
                    buyPrice: parseFloat(prodBuyPrice.value) || 0,
                    price: parseFloat(prodPrice.value) || 0,
                    stock: parsedStock,
                    min: parseFloat(prodMin.value) || 0,
                    category: document.getElementById("prodCategory").value.trim(),
                    totsPerBottle,
                    totPrice,
                    barcode
                });

                // Log to new products history collection
                await window.db.collection("new_products_logs").add({
                    productId: docRef.id,
                    name: pName,
                    initialStock: parsedStock,
                    previousStock: 0,
                    afterStock: parsedStock,
                    createdAt: timestamp
                });

                // Dispatch system notification
                await window.db.collection("notifications").add({
                    type: "new_product",
                    title: `✨ New Product Registered: ${pName}`,
                    message: `Admin added a new product "${pName}" to inventory with initial stock of ${window.toMixedFraction(parsedStock)}.`,
                    productName: pName,
                    quantityAdded: parsedStock,
                    previousStock: 0,
                    afterStock: parsedStock,
                    timestamp: timestamp
                });

                hideModalById("addProductModal");
                Swal.fire("Success!", `Product "${pName}" added to inventory`, "success");
                prodName.value = prodPrice.value = prodBuyPrice.value = prodStock.value = prodMin.value = "";
                ["prodCategory", "prodTots", "prodTotPrice", "prodBarcode"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
                const bcNote = document.getElementById("prodBarcodeNote"); if (bcNote) bcNote.textContent = "";
            } catch (err) {
                Swal.fire("Error", "Failed to add product: " + err.message, "error");
            }
        };
    }

    // Save Edit Product Handler
    if (saveEditBtn) {
        saveEditBtn.onclick = async () => {
            if (!editProductId) return;
            if (!can("products.edit")) return denyAccess("edit products");
            const editTots = parseFloat(document.getElementById("editProdTots").value) || 0;
            const editTotPrice = parseFloat(document.getElementById("editProdTotPrice").value) || 0;
            if (editTots > 0 && editTotPrice <= 0) {
                return Swal.fire("Price per tot needed", "You entered how many tots a bottle holds. Enter the price of one tot too.", "warning");
            }
            const editBarcodeValue = (document.getElementById("editProdBarcode").value || "").trim();
            if (editBarcodeValue && barcodeInUse(editBarcodeValue, editProductId)) {
                return Swal.fire("Barcode already used", "Another product already has this barcode.", "warning");
            }
            try {
                const before = (window.productsCache || []).find(d => d.id === editProductId);
                const was = before ? before.data() : null;
                const next = {
                    name: document.getElementById("editProdName").value,
                    buyPrice: parseFloat(document.getElementById("editProdBuyingPrice").value) || 0,
                    price: parseFloat(document.getElementById("editProdPrice").value) || 0,
                    stock: parseFloat(document.getElementById("editProdStock").value) || 0,
                    min: parseFloat(document.getElementById("editProdMin").value) || 0,
                    category: document.getElementById("editProdCategory").value.trim(),
                    totsPerBottle: editTots,
                    totPrice: editTotPrice,
                    barcode: editBarcodeValue
                };
                await window.db.collection("products").doc(editProductId).update(next);
                if (was) {
                    const changes = [];
                    if ((was.name || "") !== next.name) changes.push(`Name: ${was.name} → ${next.name}`);
                    if ((parseFloat(was.price) || 0) !== next.price) changes.push(`Selling price: KSh ${parseFloat(was.price) || 0} → KSh ${next.price}`);
                    if ((parseFloat(was.buyPrice) || 0) !== next.buyPrice) changes.push(`Buying price: KSh ${parseFloat(was.buyPrice) || 0} → KSh ${next.buyPrice}`);
                    if ((parseFloat(was.totPrice) || 0) !== next.totPrice) changes.push(`Tot price: KSh ${parseFloat(was.totPrice) || 0} → KSh ${next.totPrice}`);
                    if ((parseFloat(was.stock) || 0) !== next.stock) changes.push(`Stock: ${window.toMixedFraction(parseFloat(was.stock) || 0)} → ${window.toMixedFraction(next.stock)}`);
                    if (changes.length) {
                        const priceMoved = changes.some(c => /price/i.test(c));
                        logAudit(priceMoved ? "price" : "stock", priceMoved ? "product_price" : "product_edit", `Product edited: ${next.name}`, changes.join("\n"),
                            { flag: (parseFloat(was.stock) || 0) > next.stock });
                    }
                }
                hideModalById("editProductModal");
                Swal.fire("Updated!", "Product details saved.", "success");
            } catch (err) {
                Swal.fire("Error", "Failed to update product: " + err.message, "error");
            }
        };
    }
}

// Master Products Stream Listener
window.db.collection("products").onSnapshot(snap => {
    window.productsCache = snap.docs;
    window.renderProductsFiltered();

    const countEl = document.getElementById("productCount");
    if (countEl) countEl.textContent = snap.size;

    // Inventory Valuation Metrics
    let totalCost = 0;
    let totalExpected = 0;

    snap.docs.forEach(doc => {
        const p = doc.data();
        const stock = parseFloat(p.stock) || 0;
        totalCost += (parseFloat(p.buyPrice) || 0) * stock;
        totalExpected += (parseFloat(p.price) || 0) * stock;
    });

    const buyValEl = document.getElementById("totalBuyValue");
    const sellValEl = document.getElementById("totalSellValue");
    if (buyValEl) buyValEl.textContent = `KSh ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    if (sellValEl) sellValEl.textContent = `KSh ${totalExpected.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

    window.totalExpectedInventoryValue = totalExpected;

    if (typeof window.updateSalesProgress === "function") {
        window.updateSalesProgress();
    }

    // Update POS Dropdown
    const posProduct = document.getElementById("posProduct");
    if (posProduct) {
        posProduct.innerHTML = "";
        snap.docs.forEach(doc => {
            const p = doc.data();
            const option = document.createElement("option");
            option.value = doc.id;
            option.textContent = `${p.name} - KSh ${p.price}`;
            option.dataset.price = p.price;
            posProduct.appendChild(option);
        });
    }

    // Update Requisition Dropdown
    const stockProductSelect = document.getElementById("stockProductSelect");
    if (stockProductSelect) {
        stockProductSelect.innerHTML = snap.docs.map(doc =>
            `<option value="${doc.id}">${doc.data().name}</option>`
        ).join('');
    }
});

// Bind Inventory Search Filter Once
const searchInput = document.getElementById("searchInput");
if (searchInput) {
    searchInput.oninput = () => window.renderProductsFiltered();
}


/* ==========================================================================
   SECTION 7: RESTOCK & NEW PRODUCT ACTIVITY LOGS & NOTIFICATIONS
   ========================================================================== */

/**
 * Gets array of read notification IDs from localStorage per user profile
 */
window.getReadNotifIds = function () {
    try {
        const userEmail = (getCurrentUserEmail() || "global").toLowerCase().trim();
        const stored = localStorage.getItem(`madollar_read_notifs_${userEmail}`);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
};

/**
 * Gets array of deleted notification IDs from localStorage
 */
window.getDeletedNotifIds = function () {
    try {
        const stored = localStorage.getItem("madollar_deleted_notifs");
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
};

/**
 * Adds a notification ID to deleted notifications persistent tracking
 */
window.addDeletedNotifId = function (id) {
    if (!id) return;
    try {
        const deletedIds = window.getDeletedNotifIds();
        if (!deletedIds.includes(id)) {
            deletedIds.push(id);
            localStorage.setItem("madollar_deleted_notifs", JSON.stringify(deletedIds));
        }
    } catch (e) {
        console.warn("Error adding deleted notification ID:", e);
    }
};

/**
 * Marks a single notification ID as read for current logged-in staff/admin
 */
window.markNotifAsRead = function (id) {
    if (!id) return;
    try {
        const userEmail = (getCurrentUserEmail() || "global").toLowerCase().trim();
        const readIds = window.getReadNotifIds();
        if (!readIds.includes(id)) {
            readIds.push(id);
            localStorage.setItem(`madollar_read_notifs_${userEmail}`, JSON.stringify(readIds));
        }
    } catch (e) {
        console.warn("Error marking notification read:", e);
    }
    window.refreshNotificationUI();
};

/**
 * Marks all current notifications in window.notificationsList as read for current user
 */
window.markAllNotifsAsRead = function () {
    try {
        const userEmail = (getCurrentUserEmail() || "global").toLowerCase().trim();
        const readIds = window.getReadNotifIds();
        (window.notificationsList || []).forEach(n => {
            if (n.id && !readIds.includes(n.id)) {
                readIds.push(n.id);
            }
        });
        localStorage.setItem(`madollar_read_notifs_${userEmail}`, JSON.stringify(readIds));
        Swal.fire({
            icon: 'success',
            title: 'All Notifications Read',
            text: 'Notifications marked as viewed.',
            timer: 1200,
            showConfirmButton: false
        });
    } catch (e) {
        console.warn("Error marking all read:", e);
    }
    window.refreshNotificationUI();
};

/**
 * Refreshes badge count and notification list UI based on current read state & user role
 */
window.refreshNotificationUI = function () {
    const deletedIds = window.getDeletedNotifIds();
    const validNotifs = (window.notificationsList || []).filter(n => !deletedIds.includes(n.id));
    const readIds = window.getReadNotifIds();
    const unreadNotifs = validNotifs.filter(n => !readIds.includes(n.id));

    // Update Badge Count
    const badge = document.getElementById("notifBadge");
    if (badge) {
        badge.textContent = unreadNotifs.length;
        badge.classList.toggle("d-none", unreadNotifs.length === 0);
    }

    // Render Modal Container List
    const container = document.getElementById("notificationsList");
    if (container) {
        if (validNotifs.length === 0) {
            container.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i>No notifications in the last 24 hours.</div>`;
        } else {
            container.innerHTML = validNotifs.map(n => {
                const isUnread = !readIds.includes(n.id);
                const dateObj = n.dateObj || (n.timestamp?.toDate ? n.timestamp.toDate() : (n.timestamp ? new Date(n.timestamp) : new Date()));
                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + dateObj.toLocaleDateString('en-GB');
                const prevStock = n.previousStock !== undefined ? n.previousStock : 0;
                const qtyAdded = n.quantityAdded !== undefined ? n.quantityAdded : 0;
                const aftStock = n.afterStock !== undefined ? n.afterStock : 0;
                const qtyClass = parseFloat(qtyAdded) < 0 ? 'text-danger' : 'text-success';
                const qtySign = parseFloat(qtyAdded) < 0 ? '' : '+';

                const deleteBtn = can("notifications.delete") ? `
                    <button class="btn btn-soft btn-sm" onclick="window.deleteNotification('${n.id}', '${n.type || 'restock'}')">
                        <i class="fas fa-trash-can text-danger me-1"></i>Delete
                    </button>` : '';

                const markReadBtn = isUnread ? `
                    <button class="btn btn-soft btn-sm" onclick="window.markNotifAsRead('${n.id}')">
                        <i class="fas fa-check text-success me-1"></i>Mark read
                    </button>` : '';

                return `
                    <div class="notif-item ${isUnread ? 'unread' : ''}">
                        <div class="d-flex justify-content-between align-items-start flex-wrap gap-1">
                            <div class="d-flex align-items-center gap-2">
                                ${isUnread ? '<span class="badge" style="background:var(--brand)">NEW</span>' : ''}
                                <h6 class="notif-title">${n.title || 'System Notification'}</h6>
                            </div>
                            <span class="notif-time">${timeStr}</span>
                        </div>
                        <p class="mb-0 mt-2 small text-secondary">${n.message || ''}</p>
                        <div class="notif-stats">
                            <div><span>Before</span><strong>${window.toMixedFraction(prevStock)}</strong></div>
                            <div><span>Change</span><strong class="${qtyClass}">${qtySign}${window.toMixedFraction(qtyAdded)}</strong></div>
                            <div><span>After</span><strong>${window.toMixedFraction(aftStock)}</strong></div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                            <span class="badge text-bg-light border">${n.productName || 'N/A'}</span>
                            <div class="d-flex align-items-center gap-1">
                                ${markReadBtn}
                                ${deleteBtn}
                                <button class="btn btn-soft btn-sm" onclick="window.markNotifAsRead('${n.id}'); if(typeof downloadRestocksPdfBtn !== 'undefined' && downloadRestocksPdfBtn) downloadRestocksPdfBtn.click(); else window.downloadSingleTablePdf('restock_table_1', 'Restock History', 'Restock_Report');">
                                    <i class="fas fa-file-pdf text-danger me-1"></i>PDF
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
};

/**
 * Checks for unread notifications and pops them up when Staff or Admin logs in / opens dashboard
 */
window.checkAndShowUnreadNotificationPopup = function (force = false) {
    const deletedIds = window.getDeletedNotifIds();
    const validNotifs = (window.notificationsList || []).filter(n => !deletedIds.includes(n.id));
    const readIds = window.getReadNotifIds();
    const unread = validNotifs.filter(n => !readIds.includes(n.id));

    if (unread.length === 0) return;

    // If an alert/dialog is currently visible (e.g. Clocked In alert), retry after a short delay
    if (typeof Swal !== "undefined" && Swal.isVisible() && !force) {
        setTimeout(() => {
            window.checkAndShowUnreadNotificationPopup();
        }, 1500);
        return;
    }

    // Show popup for latest unread notification
    const notif = unread[0];
    const prevStock = notif.previousStock !== undefined ? notif.previousStock : 0;
    const qtyAdded = notif.quantityAdded !== undefined ? notif.quantityAdded : 0;
    const aftStock = notif.afterStock !== undefined ? notif.afterStock : 0;

    Swal.fire({
        title: notif.title || "📦 Inventory Restock Alert",
        html: `
            <div class="text-start">
                <p class="mb-2"><strong>${notif.message || ''}</strong></p>
                <div class="card bg-light border p-3 mb-2 font-monospace">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span>Stock Before Restock:</span>
                        <strong class="text-dark">${window.toMixedFraction(prevStock)} units</strong>
                    </div>
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span>Quantity Added:</span>
                        <strong class="text-success">+${window.toMixedFraction(qtyAdded)} units</strong>
                    </div>
                    <hr class="my-1">
                    <div class="d-flex justify-content-between align-items-center">
                        <span>Total Stock After Restock:</span>
                        <strong class="text-primary fs-6">${window.toMixedFraction(aftStock)} units</strong>
                    </div>
                </div>
                ${unread.length > 1 ? `<small class="text-warning fw-bold">You have ${unread.length} unread notification(s).</small><br>` : ''}
                <small class="text-muted">Notification received in real-time by Staff & Admin.</small>
            </div>
        `,
        icon: "info",
        showCancelButton: true,
        confirmButtonText: "📄 Download Restock PDF",
        cancelButtonText: "Dismiss",
        confirmButtonColor: "#28a745"
    }).then((result) => {
        window.markNotifAsRead(notif.id);
        if (result.isConfirmed) {
            const dlBtn = document.getElementById("downloadRestocksPdfBtn");
            if (dlBtn) dlBtn.click();
            else window.downloadSingleTablePdf('restock_table_1', 'Restock History', 'Restock_Report');
        }
    });
};

/**
 * Deletes a single notification (Admin only)
 */
window.deleteNotification = async function (notifId, type) {
    if (!can("notifications.delete")) return denyAccess("delete notifications");

    const result = await Swal.fire({
        title: "Delete Notification?",
        text: "Are you sure you want to remove this notification entry?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#6c757d",
        confirmButtonText: "Yes, delete it"
    });

    if (!result.isConfirmed) return;

    try {
        // Track as deleted so it never re-appears from restock_logs or cache
        window.addDeletedNotifId(notifId);

        // Delete from notifications collection in Firestore
        await window.db.collection("notifications").doc(notifId).delete().catch(() => { });

        // If restock log, also attempt deletion from restock_logs
        if (type === 'restock') {
            await window.db.collection("restock_logs").doc(notifId).delete().catch(() => { });
        }

        // Update local cache
        window.notificationsList = (window.notificationsList || []).filter(n => n.id !== notifId);
        window.refreshNotificationUI();

        Swal.fire({
            icon: "success",
            title: "Deleted!",
            text: "Notification removed successfully.",
            timer: 1200,
            showConfirmButton: false
        });
    } catch (e) {
        Swal.fire("Error", "Could not delete notification: " + e.message, "error");
    }
};

/**
 * Clears all notifications (Admin only)
 */
window.clearAllNotifications = async function () {
    if (!can("notifications.delete")) return denyAccess("clear notifications");

    const result = await Swal.fire({
        title: "Clear All Notifications?",
        text: "This will remove all notification records from the system.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#6c757d",
        confirmButtonText: "Yes, clear all"
    });

    if (!result.isConfirmed) return;

    try {
        (window.notificationsList || []).forEach(n => {
            if (n.id) window.addDeletedNotifId(n.id);
        });

        const snap = await window.db.collection("notifications").get();
        const batch = window.db.batch();
        snap.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        window.notificationsList = [];
        window.refreshNotificationUI();

        Swal.fire({
            icon: "success",
            title: "Cleared!",
            text: "All notifications removed successfully.",
            timer: 1200,
            showConfirmButton: false
        });
    } catch (e) {
        Swal.fire("Error", "Could not clear notifications: " + e.message, "error");
    }
};

/**
 * Realtime Stream Listener for System Activity Notifications (Staff Alerts)
 */
let initialNotifLoad = true;
window.db.collection("notifications").orderBy("timestamp", "desc").limit(50).onSnapshot(snap => {
    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const deletedIds = window.getDeletedNotifIds();

    let items = snap.docs
        .filter(doc => !deletedIds.includes(doc.id))
        .map(doc => ({ id: doc.id, ...doc.data() }));

    // Filter notifications to active entries created within the last 24 hours and not deleted
    const validNotifs = items.filter(n => {
        if (deletedIds.includes(n.id)) return false;
        if (!n.timestamp && !n.dateObj) return true;
        const notifTime = n.dateObj ? n.dateObj.getTime() : (n.timestamp?.toDate ? n.timestamp.toDate().getTime() : new Date(n.timestamp).getTime());
        return (now - notifTime) <= twentyFourHoursMs;
    });

    validNotifs.sort((a, b) => {
        const timeA = a.dateObj ? a.dateObj.getTime() : (a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 0);
        const timeB = b.dateObj ? b.dateObj.getTime() : (b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 0);
        return timeB - timeA;
    });

    window.notificationsList = validNotifs;
    window.refreshNotificationUI();

    // Trigger Popup for newly added Restock notification in real time if not initial load and no active Swal dialog
    if (!initialNotifLoad) {
        snap.docChanges().forEach(change => {
            if (change.type === "added") {
                if (typeof Swal === "undefined" || !Swal.isVisible()) {
                    window.checkAndShowUnreadNotificationPopup();
                }
            }
        });
    } else {
        if (dashboard && !dashboard.classList.contains("d-none")) {
            if (typeof Swal === "undefined" || !Swal.isVisible()) {
                window.checkAndShowUnreadNotificationPopup();
            }
        }
    }
    initialNotifLoad = false;
}, err => console.warn("Notifications listener error:", err));

/**
 * Opens Notifications Modal and marks unread notifications
 */
window.openNotificationsModal = () => {
    window.refreshNotificationUI();
    const modalEl = document.getElementById("notificationsModal");
    if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
};

/**
 * Initializes Restock & New Product real-time activity log listeners
 */
function initLogsListeners() {
    const restockContainer = document.getElementById("restockDateTablesContainer");
    const newProductsContainer = document.getElementById("newProductsDateTablesContainer");
    const downloadRestocksBtn = document.getElementById("downloadRestocksPdfBtn");
    const downloadNewProdsBtn = document.getElementById("downloadNewProdsPdfBtn");

    if (!restockContainer || !newProductsContainer) return;

    const getJsDate = (timestamp) => {
        if (!timestamp) return null;
        try {
            return timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        } catch (e) {
            return null;
        }
    };

    const formatTimeOnly = (dateObj) => {
        if (!dateObj) return '<span class="text-muted italic">Past Entry</span>';
        return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatDateHeader = (dateObj) => {
        if (!dateObj) return "Past Entries / Undated";
        return dateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const hideBtnClass = can("logs.delete") ? '' : 'd-none';
    const currentStockMap = {};
    window.historicalStockLogCache = window.historicalStockLogCache || {};

    window.db.collection("products").onSnapshot(snapshot => {
        snapshot.forEach(doc => {
            const data = doc.data();
            const currentStock = parseFloat(data.stock || 0);
            currentStockMap[doc.id] = currentStock;
            if (data.name) {
                currentStockMap[data.name.trim()] = currentStock;
            }
        });
    }, err => console.warn("Error listening to products stock:", err));

    window.downloadSingleTablePdf = (tableId, dateTitle, reportType) => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const tableEl = document.getElementById(tableId);

        if (!tableEl) return;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text(`${reportType} - ${dateTitle}`, 14, 18);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(`Generated On: ${new Date().toLocaleString()}`, 14, 25);

        doc.autoTable({
            html: `#${tableId}`,
            startY: 30,
            columnsOverride: { 5: { display: false } },
            styles: { fontSize: 10, cellPadding: 3 },
            headStyles: { fillColor: reportType.includes("Restock") ? [40, 167, 69] : [0, 123, 255] }
        });

        const safeFilename = `${reportType.replace(/\s+/g, '_')}_${dateTitle.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        doc.save(safeFilename);
    };

    const deleteDateGroupLogs = async (collection, idsJson, dateKey) => {
        if (!can("logs.delete")) return denyAccess("delete log entries");

        const ids = JSON.parse(decodeURIComponent(idsJson));
        const result = await Swal.fire({
            title: `Delete all ${dateKey} records?`,
            text: `You are deleting ${ids.length} entries. This cannot be undone.`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#d33"
        });

        if (result.isConfirmed) {
            const batch = window.db.batch();
            ids.forEach(id => batch.delete(window.db.collection(collection).doc(id)));
            await batch.commit();
            Swal.fire("Deleted!", "Entries removed.", "success");
        }
    };

    const renderDateGroupedTables = (snapshot, parentContainer, isNewProducts = false) => {
        if (!parentContainer) return;
        parentContainer.innerHTML = "";

        if (!snapshot || snapshot.empty) {
            parentContainer.innerHTML = `<div class="text-muted text-center py-4 border rounded bg-light">No log entries found.</div>`;
            return;
        }

        const isAdminRole = can("logs.delete");
        const dateGroups = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            const rawTimestamp = isNewProducts
                ? (data.createdAt || data.timestamp || data.restockedAt)
                : (data.restockedAt || data.timestamp || data.createdAt);

            const dateObj = getJsDate(rawTimestamp);
            const dateKey = formatDateHeader(dateObj);
            const itemName = data.name || data.productName || 'Unknown Item';

            if (!dateGroups[dateKey]) dateGroups[dateKey] = {};
            if (!dateGroups[dateKey][itemName]) dateGroups[dateKey][itemName] = [];

            dateGroups[dateKey][itemName].push({
                id: doc.id,
                data: data,
                dateObj: dateObj
            });
        });

        const todayStr = formatDateHeader(new Date());
        let tableCounter = 0;

        // Sort date groups chronologically (newest date first)
        const sortedDateKeys = Object.keys(dateGroups).sort((a, b) => {
            const firstEntryA = Object.values(dateGroups[a])[0]?.[0]?.dateObj;
            const firstEntryB = Object.values(dateGroups[b])[0]?.[0]?.dateObj;
            const timeA = firstEntryA ? firstEntryA.getTime() : 0;
            const timeB = firstEntryB ? firstEntryB.getTime() : 0;
            return timeB - timeA;
        });

        for (const dateKey of sortedDateKeys) {
            tableCounter++;
            const isToday = (dateKey === todayStr);
            const itemGroups = dateGroups[dateKey];
            const prefix = isNewProducts ? 'newprod' : 'restock';
            const tableId = `${prefix}_table_${tableCounter}_${Date.now()}`;
            const reportTitle = isNewProducts ? "New Products Log" : "Restock Log";
            const targetCollection = isNewProducts ? "new_products_logs" : "restock_logs";

            const allDateGroupIds = [];
            Object.values(itemGroups).forEach(groupEntries => {
                groupEntries.forEach(entry => allDateGroupIds.push(entry.id));
            });

            const encodedIdsJson = encodeURIComponent(JSON.stringify(allDateGroupIds));

            const dateCard = document.createElement("div");
            dateCard.className = "mb-4 border rounded p-3 bg-white shadow-sm";

            const deleteGroupBtnHTML = isAdminRole
                ? `<button class="btn btn-sm btn-outline-danger shadow-sm" onclick="window.deleteDateGroupLogs('${targetCollection}', '${encodedIdsJson}', '${dateKey}')"><i class="fas fa-trash me-1"></i> Delete Date Group</button>`
                : ``;

            const headerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
                    <h5 class="${isToday ? 'text-primary fw-bold' : 'text-secondary'} mb-0">
                        <i class="fas ${isToday ? 'fa-calendar-day' : 'fa-calendar-alt'} me-2"></i>
                        ${isToday ? `Today (${dateKey})` : dateKey}
                        <span class="badge ${isToday ? 'bg-primary' : 'bg-secondary'} ms-2">
                            ${allDateGroupIds.length} Record(s)
                        </span>
                    </h5>
                    <div class="d-flex gap-2">
                        <button class="btn btn-sm btn-outline-secondary" onclick="window.downloadSingleTablePdf('${tableId}', '${dateKey}', '${reportTitle}')">
                            <i class="fas fa-file-pdf me-1"></i> PDF for this Date
                        </button>
                        ${deleteGroupBtnHTML}
                    </div>
                </div>
            `;

            const tableHTML = `
                <div class="table-responsive">
                    <table class="table table-striped table-hover align-middle mb-0" id="${tableId}">
                        <thead class="${isToday ? (isNewProducts ? 'table-info' : 'table-primary') : 'table-light'}">
                            <tr>
                                <th>Product Name</th>
                                <th>Stock Before Addition</th>
                                <th>${isNewProducts ? 'Initial Added' : 'Quantity Added'}</th>
                                <th>Total Stock After</th>
                                <th>Time Logged</th>
                                <th class="text-end">Action</th>
                            </tr>
                        </thead>
                        <tbody class="dateTableBody"></tbody>
                    </table>
                </div>
            `;

            dateCard.innerHTML = headerHTML + tableHTML;
            const tbody = dateCard.querySelector(".dateTableBody");

            const totalItemGroups = Object.keys(itemGroups).length;
            let currentGroupIndex = 0;

            for (const itemName in itemGroups) {
                currentGroupIndex++;
                const entries = itemGroups[itemName];

                entries.forEach((entry, index) => {
                    const row = document.createElement("tr");
                    const data = entry.data;
                    const id = entry.id;

                    if (index === entries.length - 1 && currentGroupIndex < totalItemGroups) {
                        row.style.borderBottom = "3px solid #b2bec3";
                    }

                    const deleteBtnHTML = isAdminRole
                        ? `<button class="btn btn-sm btn-outline-danger shadow-sm" title="Delete log entry" onclick="window.deleteLogEntry('${targetCollection}', '${id}')"><i class="fas fa-trash-alt me-1"></i>Delete</button>`
                        : `<span class="text-muted small">N/A</span>`;

                    if (!isNewProducts) {
                        const qtyVal = parseFloat(data.quantityAdded) || 0;
                        const signClass = qtyVal >= 0 ? "text-success" : "text-danger";
                        const prefixSign = qtyVal >= 0 ? "+" : "";

                        let prevStockNum = null;
                        let afterStockNum = null;

                        if (data.previousStock !== undefined && data.afterStock !== undefined) {
                            prevStockNum = parseFloat(data.previousStock);
                            afterStockNum = parseFloat(data.afterStock);
                        } else if (data.afterStock !== undefined) {
                            afterStockNum = parseFloat(data.afterStock);
                            prevStockNum = parseFloat(data.previousStock !== undefined ? data.previousStock : Math.max(0, afterStockNum - qtyVal));
                        } else if (data.previousStock !== undefined) {
                            prevStockNum = parseFloat(data.previousStock);
                            afterStockNum = prevStockNum + qtyVal;
                        } else if (window.historicalStockLogCache[id]) {
                            prevStockNum = window.historicalStockLogCache[id].prevStockNum;
                            afterStockNum = window.historicalStockLogCache[id].afterStockNum;
                        } else {
                            const matchedStock = currentStockMap[id] ?? currentStockMap[itemName] ?? currentStockMap[data.productId];
                            if (matchedStock !== undefined) {
                                afterStockNum = parseFloat(matchedStock);
                                prevStockNum = Math.max(0, afterStockNum - qtyVal);
                            } else {
                                prevStockNum = 0;
                                afterStockNum = qtyVal;
                            }
                            window.historicalStockLogCache[id] = { prevStockNum, afterStockNum };
                        }

                        const stockBeforeValStr = window.toMixedFraction(prevStockNum);
                        const totalStockValStr = window.toMixedFraction(afterStockNum);
                        const formattedQty = window.toMixedFraction(qtyVal);

                        row.innerHTML = `
                            <td>${itemName}${data.reason ? ` <small class="text-muted">(${data.reason})</small>` : ''}</td>
                            <td><span class="text-dark fw-bold">${stockBeforeValStr}</span></td>
                            <td><span class="${signClass} fw-bold">${qtyVal >= 0 ? prefixSign : ''}${formattedQty}</span></td>
                            <td><span class="text-primary fw-bold">${totalStockValStr}</span></td>
                            <td>${formatTimeOnly(entry.dateObj)}</td>
                            <td class="text-end">${deleteBtnHTML}</td>
                        `;
                    } else {
                        const initialStockVal = parseFloat(data.initialStock !== undefined ? data.initialStock : (data.quantity || 0)) || 0;
                        const stockBeforeVal = data.previousStock !== undefined ? parseFloat(data.previousStock) : 0;
                        const totalStockVal = data.afterStock !== undefined ? parseFloat(data.afterStock) : initialStockVal;

                        const formattedBefore = window.toMixedFraction(stockBeforeVal);
                        const formattedAdded = window.toMixedFraction(initialStockVal);
                        const formattedTotal = window.toMixedFraction(totalStockVal);

                        row.innerHTML = `
                            <td>${itemName}</td>
                            <td><span class="text-dark fw-bold">${formattedBefore}</span></td>
                            <td><span class="text-success fw-bold">+${formattedAdded}</span></td>
                            <td><span class="text-primary fw-bold">${formattedTotal}</span></td>
                            <td>${formatTimeOnly(entry.dateObj)}</td>
                            <td class="text-end">${deleteBtnHTML}</td>
                        `;
                    }

                    tbody.appendChild(row);
                });
            }

            parentContainer.appendChild(dateCard);
        }
    };

    window.refreshRestockLogTables = function () {
        if (window.lastRestockSnapshot && restockContainer) {
            renderDateGroupedTables(window.lastRestockSnapshot, restockContainer, false);
        }
        if (window.lastNewProdSnapshot && newProductsContainer) {
            renderDateGroupedTables(window.lastNewProdSnapshot, newProductsContainer, true);
        }
    };

    window.db.collection("restock_logs")
        .orderBy("restockedAt", "desc")
        .onSnapshot(snapshot => {
            window.lastRestockSnapshot = snapshot;
            renderDateGroupedTables(snapshot, restockContainer, false);
        }, error => {
            console.warn("Restock logs listener error, retrying fallback...", error);
            window.db.collection("restock_logs").get().then(snap => {
                window.lastRestockSnapshot = snap;
                renderDateGroupedTables(snap, restockContainer, false);
            });
        });

    window.db.collection("new_products_logs")
        .orderBy("createdAt", "desc")
        .onSnapshot(snapshot => {
            window.lastNewProdSnapshot = snapshot;
            renderDateGroupedTables(snapshot, newProductsContainer, true);
        }, error => {
            console.warn("New products logs listener error, retrying fallback...", error);
            window.db.collection("new_products_logs").get().then(snap => {
                window.lastNewProdSnapshot = snap;
                renderDateGroupedTables(snap, newProductsContainer, true);
            });
        });

    const exportContainerToPdf = (containerEl, title, filenamePrefix, headerBgColor) => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.text(title, 14, 20);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(`Generated On: ${new Date().toLocaleString()}`, 14, 27);

        let currentY = 35;
        const pageHeight = doc.internal.pageSize.height;
        const tables = containerEl.querySelectorAll("table");

        if (tables.length === 0) {
            doc.text("No log records available to export.", 14, currentY);
        } else {
            tables.forEach((tableEl) => {
                if (currentY + 45 > pageHeight) {
                    doc.addPage();
                    currentY = 20;
                }

                doc.autoTable({
                    html: `#${tableEl.id}`,
                    startY: currentY,
                    columnsOverride: { 5: { display: false } },
                    styles: { fontSize: 10, cellPadding: 3 },
                    headStyles: { fillColor: headerBgColor },
                    margin: { bottom: 20 }
                });
                currentY = doc.lastAutoTable.finalY + 12;
            });
        }

        doc.save(`${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.pdf`);
    };

    if (downloadRestocksBtn) {
        downloadRestocksBtn.onclick = () => {
            exportContainerToPdf(restockContainer, "Restocked Products History Report", "Restock_Report", [40, 167, 69]);
        };
    }

    if (downloadNewProdsBtn) {
        downloadNewProdsBtn.onclick = () => {
            exportContainerToPdf(newProductsContainer, "Newly Registered Products Report", "New_Products_Report", [0, 123, 255]);
        };
    }
}

initLogsListeners();


/* ==========================================================================
   SECTION 8: POS & CART SYSTEM
   ========================================================================== */

const custName = document.getElementById("custName");
const custPhone = document.getElementById("custPhone");
const addCustomerBtn = document.getElementById("addCustomerBtn");
const customersTable = document.getElementById("customersTable");
const posCustomer = document.getElementById("posCustomer");

const posProductEl = document.getElementById("posProduct");
const posQty = document.getElementById("posQty");
const addToCartBtn = document.getElementById("addToCartBtn");
const cartList = document.getElementById("cartList");
const checkoutBtn = document.getElementById("checkoutBtn");
const clearCartBtn = document.getElementById("clearCartBtn");
const paymentSection = document.getElementById("paymentSection");
const paymentCompleteBtn = document.getElementById("paymentCompleteBtn");
const cancelPaymentBtn = document.getElementById("cancelPaymentBtn");
const transCode = document.getElementById("transCode");
const paymentMethod = document.getElementById("paymentMethod");

const productSearch = document.getElementById("productSearch");
const productResults = document.getElementById("productResults");
const cartTotalDisplay = document.getElementById("cartTotalDisplay");
const saveCustomerBtn = document.getElementById("saveCustomerBtn");

let selectedProduct = null;
let cart = [];
// A discount taken off the whole cart: { kind: "amount" | "percent", value, reason }
let cartDiscount = null;

function cartSubtotal() {
    return cart.reduce((sum, c) => sum + c.price * c.qty, 0);
}

function discountAmountFor(kind, value, subtotal) {
    const v = parseFloat(value) || 0;
    const amt = kind === "percent" ? subtotal * v / 100 : v;
    return Math.max(0, Math.min(round2(amt), round2(subtotal)));
}

function cartDiscountAmount() {
    return cartDiscount ? discountAmountFor(cartDiscount.kind, cartDiscount.value, cartSubtotal()) : 0;
}

window.openCustomerModal = () => {
    if (custName) custName.value = "";
    if (custPhone) custPhone.value = "";
    bootstrap.Modal.getOrCreateInstance(document.getElementById("customerModal")).show();
};

window.customersCache = {};
window.creditPayments = [];

if (addCustomerBtn) {
    addCustomerBtn.onclick = async () => {
        if (!can("customers.add")) return denyAccess("add customers");
        if (!custName || !custPhone || !custName.value.trim() || !custPhone.value.trim()) {
            return Swal.fire("Missing Info", "Enter both the customer's name and phone number.", "warning");
        }
        try {
            const confirmed = await writeWithGrace(window.db.collection("customers").add({ name: custName.value.trim(), phone: custPhone.value.trim(), balance: 0 }));
            custName.value = custPhone.value = "";
            hideModalById("customerModal");
            Swal.fire({ icon: "success", title: confirmed ? "Customer saved" : "Saved on this device", timer: 1400, showConfirmButton: false });
        } catch (e) {
            Swal.fire("Error", "Could not save customer: " + e.message, "error");
        }
    };
}

function renderCustomersFromSnap(snap) {
    if (!customersTable || !posCustomer) return;
    const keepSelected = posCustomer.value;
    const canDeleteCust = can("customers.delete"), canPay = can("customers.payment"), canRemind = can("customers.remind");
    let rowsHTML = "";
    let totalOwed = 0, debtors = 0;
    window.customersCache = {};
    posCustomer.innerHTML = '<option value="">Guest</option>';

    const docs = snap.docs.slice().sort((a, b) => (a.data().name || "").localeCompare(b.data().name || ""));
    docs.forEach(doc => {
        const c = doc.data();
        const bal = Math.round((parseFloat(c.balance) || 0) * 100) / 100;
        window.customersCache[doc.id] = { id: doc.id, name: c.name, phone: c.phone, balance: bal, lastReminderAt: toDate(c.lastReminderAt), reminderCount: c.reminderCount || 0 };
        if (bal > 0) { totalOwed += bal; debtors++; }

        const actions = `
            ${bal > 0 && canPay ? `<button class="btn btn-sm btn-custom" onclick="window.openCreditPayment('${doc.id}')" title="Record a payment"><i class="fas fa-hand-holding-dollar me-1"></i>Payment</button>` : ""}
            ${bal > 0 && canRemind ? `<button class="btn btn-sm btn-soft" onclick="window.openReminders('${doc.id}')" title="Send a reminder"><i class="fas fa-bell text-warning"></i></button>` : ""}
            <button class="btn btn-sm btn-soft" onclick="window.openCreditStatement('${doc.id}')" title="Statement"><i class="fas fa-file-lines"></i></button>
            ${canDeleteCust ? `<button class="btn btn-sm btn-soft delCustBtn" data-id="${doc.id}" title="Delete customer"><i class="fas fa-trash-can text-danger"></i></button>` : ""}`;

        rowsHTML += `<tr>
            <td data-label="Name" class="fw-semibold">${c.name}</td>
            <td data-label="Phone">${c.phone || ''}</td>
            <td data-label="Balance" class="text-end fw-bold ${bal > 0 ? 'text-danger' : 'text-muted'}">${bal > 0 ? "KSh " + bal.toLocaleString(undefined, { minimumFractionDigits: 2 }) + (canRemind ? `<small class="text-muted d-block fw-normal">${reminderAgo(toDate(c.lastReminderAt))}</small>` : "") : "-"}</td>
            <td class="text-end text-nowrap">${actions}</td>
        </tr>`;

        const option = document.createElement("option");
        option.value = doc.id;
        option.textContent = c.name;
        posCustomer.appendChild(option);
    });
    if (keepSelected && window.customersCache[keepSelected]) posCustomer.value = keepSelected;

    customersTable.innerHTML = rowsHTML || `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-users"></i>No customers registered yet.</div></td></tr>`;

    const summary = document.getElementById("creditSummary");
    if (summary) {
        summary.innerHTML = totalOwed > 0
            ? `<i class="fas fa-book me-2"></i><b>KSh ${totalOwed.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b> owed by ${debtors} customer${debtors === 1 ? "" : "s"}`
            : `<i class="fas fa-circle-check me-2"></i>No customer owes money`;
        summary.classList.toggle("owing", totalOwed > 0);
    }

    if (canDeleteCust) {
        document.querySelectorAll(".delCustBtn").forEach(btn => {
            btn.onclick = async () => {
                const id = btn.dataset.id;
                const cust = window.customersCache[id];
                if (cust && cust.balance > 0) {
                    return Swal.fire("Customer owes money", `${cust.name} still owes KSh ${cust.balance.toLocaleString()}. Record their payment before deleting them.`, "warning");
                }
                const result = await Swal.fire({
                    title: "Delete Customer?",
                    text: "Are you sure you want to delete this customer record?",
                    icon: "warning",
                    showCancelButton: true,
                    confirmButtonColor: "#d33",
                    cancelButtonColor: "#6c757d",
                    confirmButtonText: "Yes, delete customer"
                });
                if (result.isConfirmed) {
                    await window.db.collection("customers").doc(id).delete();
                    logAudit("delete", "customer_delete", `Customer deleted: ${cust ? cust.name : id}`, "");
                    Swal.fire("Deleted!", "Customer record removed.", "success");
                }
            };
        });
    }
    const custCountEl = document.getElementById("customerCount");
    if (custCountEl) custCountEl.textContent = snap.size;
}

if (customersTable && posCustomer) {
    window.db.collection("customers").onSnapshot(snap => {
        window.lastCustomersSnap = snap;
        renderCustomersFromSnap(snap);
    });
}

/* ---- Customer tabs (credit): payments and statements ---- */
window.db.collection("credit_payments").orderBy("at", "desc").limit(300).onSnapshot(snap => {
    window.creditPayments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const modalEl = document.getElementById("closeDayModal");
    if (modalEl && modalEl.classList.contains("show") && typeof window.updateCloseDaySummary === "function") window.updateCloseDaySummary();
}, err => console.warn("Credit payments listener:", err));

const creditMoney = (n) => "KSh " + (parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

window.openCreditPayment = (id) => {
    if (!can("customers.payment")) return denyAccess("record customer payments");
    const c = window.customersCache[id];
    if (!c) return;
    window.creditPayCustomerId = id;
    document.getElementById("cpName").textContent = c.name;
    document.getElementById("cpBalance").textContent = creditMoney(c.balance);
    document.getElementById("cpAmount").value = "";
    document.getElementById("cpMethod").value = "Cash";
    document.getElementById("cpCode").value = "";
    document.getElementById("cpNote").value = "";
    bootstrap.Modal.getOrCreateInstance(document.getElementById("creditPaymentModal")).show();
};

window.fillCreditPaymentFull = () => {
    const c = window.customersCache[window.creditPayCustomerId];
    if (c) document.getElementById("cpAmount").value = c.balance;
};

window.saveCreditPayment = async () => {
    if (!can("customers.payment")) return denyAccess("record customer payments");
    const id = window.creditPayCustomerId;
    const c = window.customersCache[id];
    if (!c) return;

    const amount = Math.round((parseFloat(document.getElementById("cpAmount").value) || 0) * 100) / 100;
    if (amount <= 0) return Swal.fire("Enter an amount", "Type how much the customer paid.", "warning");
    if (amount > c.balance + 0.005) {
        return Swal.fire("Too much", `${c.name} only owes ${creditMoney(c.balance)}.`, "warning");
    }

    const method = document.getElementById("cpMethod").value;
    const note = document.getElementById("cpNote").value.trim();
    const code = document.getElementById("cpCode").value.trim();

    try {
        const batch = window.db.batch();
        batch.set(window.db.collection("credit_payments").doc(), {
            customerId: id,
            customerName: c.name,
            amount,
            method,
            code,
            note,
            receivedBy: getCurrentUserEmail() || "unknown",
            dateKey: new Date().toLocaleDateString("en-CA"),
            at: new Date()
        });
        batch.update(window.db.collection("customers").doc(id), { balance: firebase.firestore.FieldValue.increment(-amount) });
        const confirmed = await writeWithGrace(batch.commit());

        hideModalById("creditPaymentModal");
        const remaining = Math.max(0, c.balance - amount);
        Swal.fire({
            icon: "success",
            title: confirmed ? "Payment recorded" : "Saved on this device",
            text: `${creditMoney(amount)} received from ${c.name}. ${remaining > 0 ? "Remaining balance: " + creditMoney(remaining) : "Their tab is fully paid."}`
        });

        try {
            window.sendAlert(
                `💰 *Credit payment* - ${creditMoney(amount)}\n` +
                `Customer: ${c.name}\nMethod: ${method}${code ? " (" + code + ")" : ""}\n` +
                `Balance now: ${creditMoney(remaining)}\nReceived by: ${getCurrentUserEmail() || "unknown"}`,
                "onSale"
            );
        } catch (alertErr) { console.warn("Payment alert failed:", alertErr); }
    } catch (err) {
        Swal.fire("Could not save payment", err.message, "error");
    }
};

window.openCreditStatement = (id) => {
    const c = window.customersCache[id];
    if (!c) return;

    const sales = (window.allSales || [])
        .filter(s => s.payment === "Credit" && s.customerId === id)
        .map(s => ({
            date: s.date.toDate(),
            desc: (s.items || []).map(i => `${window.toMixedFraction(i.qty)} x ${i.name}`).join(", "),
            debit: parseFloat(s.total) || 0,
            credit: 0
        }));
    const pays = (window.creditPayments || [])
        .filter(p => p.customerId === id)
        .map(p => ({
            date: p.at && p.at.toDate ? p.at.toDate() : new Date(p.at),
            desc: `Payment received (${p.method})${p.note ? " - " + p.note : ""}`,
            debit: 0,
            credit: parseFloat(p.amount) || 0
        }));
    const entries = sales.concat(pays).sort((a, b) => b.date - a.date);

    const totalDebit = entries.reduce((n, e) => n + e.debit, 0);
    const totalCredit = entries.reduce((n, e) => n + e.credit, 0);
    window.currentStatement = { customer: c, entries, totalDebit, totalCredit };

    document.getElementById("csName").textContent = c.name + (c.phone ? " · " + c.phone : "");
    document.getElementById("csBalance").textContent = creditMoney(c.balance);
    document.getElementById("csBalance").className = "fw-bold fs-5 " + (c.balance > 0 ? "text-danger" : "text-success");
    document.getElementById("csBody").innerHTML = entries.length
        ? entries.map(e => `
            <tr>
                <td class="text-nowrap">${e.date.toLocaleDateString("en-GB")}<small class="text-muted d-block">${e.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></td>
                <td>${e.desc}</td>
                <td class="text-end">${e.debit ? creditMoney(e.debit) : ""}</td>
                <td class="text-end text-success">${e.credit ? creditMoney(e.credit) : ""}</td>
            </tr>`).join("")
        : `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-file-lines"></i>No credit activity yet.</div></td></tr>`;
    document.getElementById("csTotals").innerHTML = entries.length
        ? `<tr><th colspan="2">Totals</th><th class="text-end">${creditMoney(totalDebit)}</th><th class="text-end">${creditMoney(totalCredit)}</th></tr>`
        : "";

    bootstrap.Modal.getOrCreateInstance(document.getElementById("creditStatementModal")).show();
};

window.downloadCreditStatement = () => {
    const st = window.currentStatement;
    if (!st) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.setTextColor(41, 128, 185);
    doc.text("MADOLLAR LIQUOR PUB", 105, 15, null, null, "center");
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text("Customer Statement", 105, 24, null, null, "center");
    doc.setFontSize(11);
    doc.text(`Customer: ${st.customer.name}${st.customer.phone ? " (" + st.customer.phone + ")" : ""}`, 14, 36);
    doc.text(`Date: ${new Date().toLocaleDateString("en-GB")}`, 14, 43);
    doc.text(`Balance owed: ${creditMoney(st.customer.balance)}`, 14, 50);

    doc.autoTable({
        startY: 58,
        head: [["Date", "Details", "On credit (KSh)", "Paid (KSh)"]],
        body: st.entries.map(e => [
            e.date.toLocaleDateString("en-GB") + " " + e.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            e.desc,
            e.debit ? e.debit.toLocaleString() : "",
            e.credit ? e.credit.toLocaleString() : ""
        ]),
        foot: [["", "Totals", st.totalDebit.toLocaleString(), st.totalCredit.toLocaleString()]],
        theme: "striped",
        headStyles: { fillColor: [41, 128, 185] },
        styles: { fontSize: 9, cellPadding: 3 }
    });
    doc.save(`Statement_${st.customer.name.replace(/\s+/g, "_")}.pdf`);
};

function renderCart() {
    if (!cartList) return;
    cartList.innerHTML = "";
    let runningTotal = 0;

    if (cart.length === 0) {
        cartList.innerHTML = `<li class="empty-state list-unstyled"><i class="fas fa-basket-shopping"></i>Your cart is empty. Search a product above to add it.</li>`;
    }

    if (cart.length === 0) cartDiscount = null;

    cart.forEach((c, i) => {
        runningTotal += (c.price * c.qty);
        const changed = c.listPrice !== undefined && c.listPrice !== c.price;
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between align-items-center gap-3";
        li.innerHTML = `
            <div class="me-auto">
                <div class="cart-line-name"></div>
                <div class="cart-line-meta">${window.toMixedFraction(c.qty)} × ${changed ? `<s class="opacity-75">KSh ${Number(c.listPrice).toLocaleString()}</s> ` : ""}KSh ${Number(c.price).toLocaleString()}${changed ? ` <span class="sale-chip price-chip">price changed</span>` : ""}</div>
            </div>
            <div class="cart-line-total">KSh ${(c.price * c.qty).toFixed(2)}</div>`;
        li.querySelector(".cart-line-name").textContent = itemLabel(c);
        if (can("pos.priceoverride")) {
            const tagBtn = document.createElement("button");
            tagBtn.className = "btn btn-soft btn-sm btn-icon";
            tagBtn.title = "Change the price";
            tagBtn.innerHTML = `<i class="fas fa-tag"></i>`;
            tagBtn.onclick = () => window.openPriceModal(i);
            li.appendChild(tagBtn);
        }
        const rmBtn = document.createElement("button");
        rmBtn.className = "btn btn-soft btn-sm btn-icon";
        rmBtn.title = "Remove item";
        rmBtn.innerHTML = `<i class="fas fa-xmark text-danger"></i>`;
        rmBtn.onclick = () => { cart.splice(i, 1); renderCart(); };
        li.appendChild(rmBtn);
        cartList.appendChild(li);
    });

    const discount = cartDiscountAmount();
    if (cartTotalDisplay) cartTotalDisplay.textContent = `KSh ${(runningTotal - discount).toFixed(2)}`;

    const info = document.getElementById("cartDiscountInfo");
    if (info) {
        if (discount > 0) {
            const label = cartDiscount.kind === "percent" ? `${cartDiscount.value}% off` : "Discount";
            info.classList.remove("d-none");
            info.innerHTML = `<div class="d-flex justify-content-between"><span>Subtotal</span><span>KSh ${runningTotal.toFixed(2)}</span></div>
                <div class="d-flex justify-content-between"><span>${escHtml(label)}</span><span>− KSh ${discount.toFixed(2)}</span></div>
                <div class="cart-discount-reason">${escHtml(cartDiscount.reason)} <a href="#" onclick="event.preventDefault(); window.removeDiscount()">remove</a></div>`;
        } else {
            info.classList.add("d-none");
            info.innerHTML = "";
        }
    }
    const dBtn = document.getElementById("cartDiscountBtn");
    if (dBtn) dBtn.innerHTML = `<i class="fas fa-percent me-2"></i>${discount > 0 ? "Change discount" : "Give discount"}`;
}

if (productSearch && productResults) {
    productSearch.oninput = (e) => {
        const val = e.target.value.toLowerCase();
        if (!val) { productResults.style.display = "none"; return; }

        const matches = window.productsCache.filter(p => p.data().name.toLowerCase().includes(val));
        productResults.innerHTML = matches.map(m => {
            const p = m.data();
            const isOutOfStock = parseFloat(p.stock) <= 0;
            return `
                <a class="dropdown-item ${isOutOfStock ? 'text-muted' : ''}" href="#" 
                   onclick="event.preventDefault(); ${isOutOfStock ? "Swal.fire('Out of Stock', 'This item is out of stock.', 'warning')" : `window.selectProd('${m.id}', '${p.name.replace(/'/g, "\\'")}', ${p.price})`}">
                    ${p.name} - <strong>KSh ${p.price}</strong> ${parseFloat(p.totsPerBottle) > 0 ? '<span class="tot-tag">tots</span>' : ""} ${isOutOfStock ? '<span class="low-stock ms-1">Out of Stock</span>' : ""}
                </a>
            `;
        }).join('');
        productResults.style.display = matches.length ? "block" : "none";
    };
}

/**
 * Shows the Bottle / Tot choice only for products that are set up to be sold by the tot
 */
function updatePosUnitOptions() {
    const unitEl = document.getElementById("posUnit");
    if (!unitEl) return;
    const doc = selectedProduct && window.productsCache.find(d => d.id === selectedProduct.id);
    const p = doc && doc.data();
    const hasTots = !!(p && parseFloat(p.totsPerBottle) > 0 && parseFloat(p.totPrice) > 0);
    unitEl.classList.toggle("d-none", !hasTots);
    unitEl.value = "bottle";
}

window.selectProd = (id, name, price) => {
    if (productSearch) productSearch.value = name;
    selectedProduct = { id, name, price };
    if (productResults) productResults.style.display = "none";
    updatePosUnitOptions();
};

/**
 * Puts a product in the cart. Used by the Add button, the camera scanner and barcode readers.
 * merge = add to an existing whole-bottle line instead of making a second line.
 * Returns true when it was added.
 */
function addProductToCart(targetDoc, requestedQty, sellingTots, merge) {
    const prodData = targetDoc.data();
    const prodId = targetDoc.id;
    const currentStock = parseFloat(prodData.stock) || 0;
    const totsPerBottle = parseFloat(prodData.totsPerBottle) || 0;
    // How much of a bottle this sale uses up (a tot is 1 / totsPerBottle of a bottle)
    const stockNeeded = sellingTots && totsPerBottle > 0 ? Math.round((requestedQty / totsPerBottle) * 1e6) / 1e6 : requestedQty;
    // Stock already reserved by earlier lines of this same cart
    const inCart = cart.filter(c => c.id === prodId).reduce((n, c) => n + itemStockQty(c), 0);

    if (isNaN(requestedQty) || requestedQty <= 0) {
        Swal.fire("Invalid Quantity", sellingTots ? "Enter how many tots, for example 2." : "Enter a quantity such as 1 or 1/2.", "warning");
        return false;
    }
    if (currentStock <= 0) {
        Swal.fire("Out of Stock", `Sorry, ${prodData.name} is out of stock.`, "warning");
        return false;
    }
    if (stockNeeded + inCart > currentStock + 1e-9) {
        const left = currentStock - inCart;
        Swal.fire("Insufficient Stock", sellingTots
            ? `Only about ${Math.max(0, Math.floor(left * totsPerBottle + 1e-6))} tots available.`
            : `Only ${window.toMixedFraction(Math.max(0, left))} available.`, "warning");
        return false;
    }

    const existing = merge && !sellingTots ? cart.find(c => c.id === prodId && !c.unit && c.listPrice === undefined) : null;
    if (existing) {
        existing.qty += requestedQty;
    } else {
        cart.push(sellingTots ? {
            id: prodId,
            name: prodData.name,
            price: parseFloat(prodData.totPrice),
            qty: requestedQty,
            unit: "tot",
            stockQty: stockNeeded,
            totsPerBottle
        } : {
            id: prodId,
            name: prodData.name,
            price: parseFloat(prodData.price),
            qty: requestedQty
        });
    }

    try {
        new Audio("https://actions.google.com/sounds/v1/ui/beep_short.ogg").play();
    } catch (e) { }

    renderCart();
    return true;
}

if (addToCartBtn) {
    addToCartBtn.onclick = () => {
        let targetDoc = null;
        if (selectedProduct && selectedProduct.id) {
            targetDoc = window.productsCache.find(p => p.id === selectedProduct.id);
        } else if (posProductEl && posProductEl.value) {
            targetDoc = window.productsCache.find(p => p.id === posProductEl.value);
        }

        if (!targetDoc) return Swal.fire("No Product Selected", "Search and pick a product first.", "warning");

        const parseQty = (val) => {
            if (typeof val === 'string' && val.includes('/')) {
                const parts = val.split('/');
                if (parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1])) && parseFloat(parts[1]) !== 0) {
                    return parseFloat(parts[0]) / parseFloat(parts[1]);
                }
            }
            return parseFloat(val);
        };

        const requestedQty = parseQty(posQty.value);
        const unitEl = document.getElementById("posUnit");
        const sellingTots = !!(unitEl && !unitEl.classList.contains("d-none") && unitEl.value === "tot");

        if (!addProductToCart(targetDoc, requestedQty, sellingTots, false)) return;

        selectedProduct = null;
        updatePosUnitOptions();
        if (productSearch) productSearch.value = "";
        if (posQty) posQty.value = "1";
        if (productSearch) productSearch.focus();
    };
}

if (saveCustomerBtn) {
    saveCustomerBtn.onclick = async () => {
        if (!can("customers.add")) return denyAccess("add customers");
        const name = document.getElementById("newCustName")?.value;
        const phone = document.getElementById("newCustPhone")?.value;
        if (!name) return Swal.fire("Missing Name", "Enter a customer name.", "warning");
        try {
            const docRef = await window.db.collection("customers").add({ name, phone });
            const select = document.getElementById("posCustomer");
            if (select) {
                const opt = document.createElement("option");
                opt.value = docRef.id;
                opt.textContent = name;
                select.appendChild(opt);
                select.value = docRef.id;
            }
            const modalEl = document.getElementById('addCustomerModal');
            if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
            document.getElementById("newCustName").value = "";
            document.getElementById("newCustPhone").value = "";
            Swal.fire({ icon: "success", title: "Customer saved", timer: 1200, showConfirmButton: false });
        } catch (e) { Swal.fire("Error", "Error saving customer: " + e.message, "error"); }
    };
}

if (clearCartBtn) clearCartBtn.onclick = () => { cart = []; cartDiscount = null; renderCart(); };
renderCart();

if (checkoutBtn) {
    checkoutBtn.onclick = () => {
        if (cart.length === 0) return Swal.fire("Cart Empty", "Please add items to cart before proceeding to checkout.", "warning");

        const posCustEl = document.getElementById("posCustomer");
        const customerName = (posCustEl && posCustEl.value && posCustEl.value !== "")
            ? posCustEl.selectedOptions[0].text
            : "Guest";

        const cartDisc = cartDiscountAmount();
        const runningTotal = cartSubtotal() - cartDisc;

        const modalCustEl = document.getElementById("modalCustomerName");
        const modalTotalEl = document.getElementById("modalTotalAmount");
        const modalCartSummary = document.getElementById("modalCartSummary");

        if (modalCustEl) modalCustEl.textContent = customerName;
        if (modalTotalEl) modalTotalEl.textContent = `KSh ${runningTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        if (modalCartSummary) {
            modalCartSummary.innerHTML = cart.map(i => `
                <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                    <div>
                        <strong>${itemLabel(i)}</strong>
                        <span class="badge text-bg-light border ms-1">× ${window.toMixedFraction(i.qty)}</span>
                    </div>
                    <span class="fw-bold">KSh ${(i.price * i.qty).toFixed(2)}</span>
                </div>
            `).join('') + (cartDisc > 0 ? `
                <div class="d-flex justify-content-between align-items-center py-2 text-success">
                    <span><i class="fas fa-percent me-1"></i>Discount <small class="text-muted">(${escHtml(cartDiscount.reason)})</small></span>
                    <span class="fw-bold">− KSh ${cartDisc.toFixed(2)}</span>
                </div>` : "");
        }

        const methodEl = document.getElementById("paymentMethod");
        if (methodEl) methodEl.value = "Cash";
        const creditOpt = methodEl && methodEl.querySelector('option[value="Credit"]');
        if (creditOpt) {
            const registered = !!(posCustEl && posCustEl.value && window.customersCache[posCustEl.value]);
            const allowed = can("pos.credit");
            creditOpt.disabled = !registered || !allowed;
            creditOpt.textContent = !allowed ? "Credit (not allowed for your role)" : (registered ? "Credit (customer tab)" : "Credit (register the customer first)");
        }
        const creditHintEl = document.getElementById("creditHint");
        if (creditHintEl) creditHintEl.classList.add("d-none");

        const paymentModalEl = document.getElementById("paymentModal");
        if (paymentModalEl) {
            const modal = bootstrap.Modal.getInstance(paymentModalEl) || new bootstrap.Modal(paymentModalEl);
            modal.show();
        }
    };
}


/* ==========================================================================
   SECTION 9: CHECKOUT & PAYMENT PROCESSING
   ========================================================================== */

if (paymentCompleteBtn) {
    paymentCompleteBtn.onclick = async () => {
        if (cart.length === 0) return Swal.fire("Warning", "Cart is empty", "error");
        if (paymentCompleteBtn.disabled) return;

        // A sale on credit must be linked to a registered customer, so their balance can be tracked
        const isCreditSale = document.getElementById("paymentMethod").value === "Credit";
        const creditCustomerId = document.getElementById("posCustomer").value;
        if (isCreditSale && !can("pos.credit")) {
            return denyAccess("sell on credit");
        }
        if (isCreditSale && (!creditCustomerId || !window.customersCache[creditCustomerId])) {
            return Swal.fire("Choose a customer", "A sale on credit needs a registered customer. Close this window, pick the customer (or add them with +), then try again.", "warning");
        }

        paymentCompleteBtn.disabled = true;
        const originalText = paymentCompleteBtn.innerHTML;
        paymentCompleteBtn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> Processing...`;

        const posCustEl = document.getElementById("posCustomer");
        const customerName = (posCustEl && posCustEl.value && posCustEl.value !== "")
            ? posCustEl.selectedOptions[0].text
            : "Guest";

        const paymentMethodEl = document.getElementById("paymentMethod");
        const transCodeEl = document.getElementById("transCode");
        const saleCustomerId = posCustEl && posCustEl.value ? posCustEl.value : null;

        // Close payment modal during processing attempt
        const paymentModalEl = document.getElementById("paymentModal");
        if (paymentModalEl) {
            const inst = bootstrap.Modal.getInstance(paymentModalEl);
            if (inst) inst.hide();
        }

        if (typeof hideToast === 'function') hideToast();

        const processCheckout = async () => {
            const processedItems = [];
            const lowStock = [];
            const priceChanges = [];
            let totalAmount = 0;
            const batch = window.db.batch();

            // 1. Fetch current product data & validate stock levels
            for (const c of cart) {
                const prodRef = window.db.collection("products").doc(c.id);
                const snap = await prodRef.get(readOpts());

                if (!snap.exists) throw new Error(`Product "${c.name}" not found in inventory.`);
                const pData = snap.data();

                const currentStock = parseFloat(pData.stock) || 0;
                const requestedQty = parseFloat(c.qty) || 0;               // how many were sold (bottles or tots)
                const stockNeeded = itemStockQty(c);                       // how much of the bottle stock that uses
                const isTot = c.unit === "tot";

                if (currentStock < stockNeeded - 1e-9) {
                    throw new Error(`Insufficient stock for "${c.name}". Available: ${window.toMixedFraction(currentStock)}, Requested: ${window.toMixedFraction(stockNeeded)}`);
                }

                const sellPrice = parseFloat(c.price) || 0;
                totalAmount += (sellPrice * requestedQty);

                // Cost per unit sold: for a tot, the bottle's buy price shared across its tots
                const bottleCost = parseFloat(pData.buyPrice) || 0;
                const totsInBottle = parseFloat(pData.totsPerBottle) || parseFloat(c.totsPerBottle) || 0;
                const unitCost = isTot && totsInBottle > 0 ? bottleCost / totsInBottle : bottleCost;

                processedItems.push(Object.assign({
                    id: c.id,
                    name: c.name,
                    price: sellPrice,
                    qty: requestedQty,
                    cost: unitCost
                }, isTot ? { unit: "tot", stockQty: stockNeeded } : {},
                    c.listPrice !== undefined && c.listPrice !== c.price ? { listPrice: c.listPrice, priceReason: c.priceReason || "" } : {}));
                if (c.listPrice !== undefined && c.listPrice !== c.price) {
                    priceChanges.push({ name: itemLabel(c), from: c.listPrice, to: sellPrice, reason: c.priceReason || "" });
                }

                // Batch stock reduction
                const newStock = Math.max(currentStock - stockNeeded, 0);
                batch.update(prodRef, { stock: firebase.firestore.FieldValue.increment(-stockNeeded) });

                // Only flag items that just crossed their minimum level, so a repeat sale doesn't re-alert
                const minLevel = parseFloat(pData.min) || 0;
                if (currentStock > minLevel && newStock <= minLevel) {
                    lowStock.push({ name: c.name, stock: newStock, min: minLevel });
                }
            }

            // A discount on the whole cart is shared across the lines, so every report still adds up to the money taken
            let discountRecord = null;
            const cartDisc = cartDiscountAmount();
            if (cartDisc > 0 && totalAmount > 0) {
                const subtotal = totalAmount;
                const factor = (subtotal - cartDisc) / subtotal;
                processedItems.forEach(it => {
                    if (it.listPrice === undefined) it.listPrice = it.price;
                    it.price = round2(it.price * factor);
                });
                totalAmount = round2(processedItems.reduce((s, i) => s + i.price * i.qty, 0));
                discountRecord = {
                    amount: round2(subtotal - totalAmount),
                    kind: cartDiscount.kind,
                    value: cartDiscount.value,
                    reason: cartDiscount.reason,
                    by: getCurrentUserEmail() || "unknown"
                };
            }
            const hasChanges = !!discountRecord || priceChanges.length > 0;
            const giveaway = round2(processedItems.reduce((s, i) => s + Math.max(0, (i.listPrice !== undefined ? i.listPrice : i.price) - i.price) * i.qty, 0));
            const belowCost = hasChanges && processedItems.some(i => i.cost > 0 && i.price < i.cost);

            // 2. Add Sale transaction record to batch
            const saleRef = window.db.collection("sales").doc();
            const paymentValue = paymentMethodEl ? paymentMethodEl.value : "Cash";
            batch.set(saleRef, Object.assign({
                customer: customerName,
                customerId: saleCustomerId,
                items: processedItems,
                total: totalAmount,
                payment: paymentValue,
                transaction: transCodeEl ? transCodeEl.value : "",
                soldBy: getCurrentUserEmail() || "unknown",
                date: new Date()
            }, discountRecord ? { discount: discountRecord } : {},
               priceChanges.length ? { priceChanges } : {},
               belowCost ? { belowCost: true } : {}));

            // A sale on credit adds to the customer's balance in the same all-or-nothing write
            if (paymentValue === "Credit" && saleCustomerId) {
                batch.update(window.db.collection("customers").doc(saleCustomerId), {
                    balance: firebase.firestore.FieldValue.increment(totalAmount)
                });
            }

            // 3. Execute atomic batch write (all or nothing). Offline, it is saved on the device and syncs later,
            //    so we stop waiting after a few seconds instead of reporting a false failure.
            const confirmed = await writeWithGrace(batch.commit());
            return { items: processedItems, total: totalAmount, lowStock, queued: !confirmed, saleId: saleRef.id, discount: discountRecord, priceChanges, giveaway, belowCost };
        };

        // 10-Second Timeout Race Controller
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("NETWORK_TIMEOUT")), 10000);
        });

        try {
            const saleResult = await Promise.race([processCheckout(), timeoutPromise]);

            if (!(saleResult.queued && !navigator.onLine)) {
                try {
                    window.notifySale({
                        customer: customerName,
                        payment: paymentMethodEl ? paymentMethodEl.value : "Cash",
                        transaction: transCodeEl ? transCodeEl.value : "",
                        ...saleResult
                    });
                } catch (alertErr) {
                    console.warn("Sale alert failed:", alertErr);
                }
            }

            // Discounts and price changes are always written to the audit trail
            if (saleResult.discount || (saleResult.priceChanges && saleResult.priceChanges.length)) {
                const parts = [];
                if (saleResult.discount) {
                    const d = saleResult.discount;
                    parts.push(`Discount ${creditMoney(d.amount)}${d.kind === "percent" ? ` (${d.value}%)` : ""}: ${d.reason}`);
                }
                (saleResult.priceChanges || []).forEach(p => parts.push(`${p.name}: KSh ${p.from} → KSh ${p.to} (${p.reason || "no reason"})`));
                if (saleResult.belowCost) parts.push("Sold BELOW the buying price");
                logAudit("price", saleResult.discount ? "discount" : "price_change",
                    `${saleResult.discount ? "Discount" : "Price changed"} on a sale of ${creditMoney(saleResult.total)} (${customerName})`,
                    parts.join("\n"),
                    { amount: saleResult.giveaway, flag: saleResult.belowCost, ref: saleResult.saleId, alert: true });
            }

            // Clear cart & reset inputs
            cart = [];
            cartDiscount = null;
            renderCart();
            if (transCodeEl) transCodeEl.value = "";
            if (posCustEl) posCustEl.value = "";

            if (typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) Swal.close();

            const soldOnCredit = paymentMethodEl && paymentMethodEl.value === "Credit";
            if (saleResult.queued) {
                Swal.fire({
                    title: "Saved on this device",
                    html: "The sale is saved and will be sent automatically when the internet is back.<br><b>Do not enter it again.</b>",
                    icon: "info",
                    confirmButtonColor: "#a86d27"
                });
            } else {
                Swal.fire({
                    title: soldOnCredit ? "Added to customer's tab" : "Payment Completed!",
                    text: soldOnCredit
                        ? `${creditMoney(saleResult.total)} added to ${customerName}'s tab and stock updated.`
                        : "Sale recorded successfully and inventory stock updated.",
                    icon: "success",
                    confirmButtonColor: "#198754"
                });
            }

        } catch (e) {
            console.error("Checkout processing error:", e);
            if (typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) Swal.close();

            if (e.message === "NETWORK_TIMEOUT" || e.name === "FirebaseError" || (e.message && (e.message.includes("offline") || e.message.includes("network")))) {
                Swal.fire({
                    title: "Network Connection Timeout",
                    html: `
                        <div class="text-start">
                            <p class="text-danger fw-bold"><i class="fas fa-wifi me-2"></i>Network is slow or disconnected.</p>
                            <p>No payment or stock reduction was recorded for this transaction.</p>
                            <p class="mb-0 text-muted"><strong>Action Required:</strong> Please check your internet connection and click <strong>'Complete Payment'</strong> again to retry cleanly.</p>
                        </div>
                    `,
                    icon: "warning",
                    confirmButtonText: "Retry Payment",
                    confirmButtonColor: "#ffc107"
                }).then(() => {
                    if (paymentModalEl) {
                        const modal = bootstrap.Modal.getInstance(paymentModalEl) || new bootstrap.Modal(paymentModalEl);
                        modal.show();
                    }
                });
            } else {
                Swal.fire("Checkout Failed", e.message, "error").then(() => {
                    if (paymentModalEl) {
                        const modal = bootstrap.Modal.getInstance(paymentModalEl) || new bootstrap.Modal(paymentModalEl);
                        modal.show();
                    }
                });
            }
        } finally {
            paymentCompleteBtn.disabled = false;
            paymentCompleteBtn.innerHTML = originalText;
        }
    };
}


/* ==========================================================================
   SECTION 10: SALES ANALYTICS, DYNAMIC TARGETS & PDF REPORTING
   ========================================================================== */

/**
 * Updates Monthly Progress Bar based on Admin Dynamic Target Settings
 */
window.updateSalesProgress = function () {
    const progressBar = document.getElementById("salesProgressBar");
    const targetLabel = document.getElementById("targetLabel");
    if (!progressBar || !targetLabel) return;

    const monthlySalesVal = window.currentMonthlySalesTotal || 0;
    const totalExpectedVal = window.totalExpectedInventoryValue || 0;
    const cfg = window.targetConfig || { mode: "percentage", value: 50 };

    let targetAmount = 0;
    if (cfg.mode === "fixed") {
        targetAmount = parseFloat(cfg.value) || 0;
    } else {
        const pct = parseFloat(cfg.value) || 50;
        targetAmount = totalExpectedVal * (pct / 100);
    }

    const percentage = targetAmount > 0 ? Math.min((monthlySalesVal / targetAmount) * 100, 100) : 0;
    progressBar.style.width = percentage.toFixed(1) + "%";
    progressBar.textContent = Math.round(percentage) + "%";
    targetLabel.textContent = `KSh ${monthlySalesVal.toLocaleString()} / KSh ${Math.round(targetAmount).toLocaleString()} (${cfg.mode === 'fixed' ? 'Fixed Target' : cfg.value + '% Target'})`;
    progressBar.className = percentage >= 100 ? "progress-bar bg-warning" : "progress-bar bg-success";
};

/**
 * Filters Sales Table by Search Term (e.g. Product Name) & Date Range
 */
window.filterSalesTable = () => {
    const searchInput = document.getElementById("salesSearchInput");
    const dateFromEl = document.getElementById("dateFrom");
    const dateToEl = document.getElementById("dateTo");
    const summaryBanner = document.getElementById("salesSearchSummary");
    const tableBody = document.getElementById("salesTable");
    if (!tableBody) return;

    // Skip the heavy render until the Sales tab is actually opened
    const salesPane = document.getElementById("salesTab");
    if (salesPane && !salesPane.classList.contains("active")) {
        window.salesNeedsRender = true;
        return;
    }
    window.salesNeedsRender = false;

    const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
    const fromDateStr = dateFromEl ? dateFromEl.value : "";
    const toDateStr = dateToEl ? dateToEl.value : "";

    const fromDate = fromDateStr ? new Date(fromDateStr + "T00:00:00") : null;
    const toDate = toDateStr ? new Date(toDateStr + "T23:59:59") : null;

    let totalMatchedQty = 0;
    let totalMatchedRevenue = 0;
    let isSpecificProductSearch = false;

    const filtered = (window.allSales || []).filter(s => {
        const saleDate = s.date.toDate();
        if (fromDate && saleDate < fromDate) return false;
        if (toDate && saleDate > toDate) return false;

        if (!query) return true;

        const customerMatch = (s.customer || "").toLowerCase().includes(query);
        const transMatch = (s.transaction || "").toLowerCase().includes(query);
        const itemMatch = s.items.some(i => i.name.toLowerCase().includes(query));

        return customerMatch || transMatch || itemMatch;
    });

    if (query) {
        (window.allSales || []).forEach(s => {
            const saleDate = s.date.toDate();
            if (fromDate && saleDate < fromDate) return;
            if (toDate && saleDate > toDate) return;

            s.items.forEach(item => {
                if (item.name.toLowerCase().includes(query)) {
                    isSpecificProductSearch = true;
                    const qty = parseFloat(item.qty) || 0;
                    totalMatchedQty += qty;
                    totalMatchedRevenue += (parseFloat(item.price) || 0) * qty;
                }
            });
        });
    }

    if (summaryBanner) {
        if (isSpecificProductSearch && query.length >= 2) {
            summaryBanner.classList.remove("d-none");
            summaryBanner.innerHTML = `
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div>
                        <i class="fas fa-search me-1 text-primary"></i> <strong>Product Analytics Search:</strong> "${query}" 
                        <span class="badge bg-primary ms-2">${filtered.length} Sales Match</span>
                    </div>
                    <div>
                        <span class="me-3">Total Sold: <strong class="text-dark">${window.toMixedFraction(totalMatchedQty)} units</strong></span>
                        <span>Revenue: <strong class="text-success">KSh ${totalMatchedRevenue.toLocaleString()}</strong></span>
                    </div>
                </div>
            `;
        } else {
            summaryBanner.classList.add("d-none");
        }
    }

    if (filtered.length === 0) {
        tableBody.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-receipt"></i>No matching sales records found.</div>`;
        renderGroupedSales(filtered, query);
        return;
    }

    const limit = window.salesLimit || 25;
    const visible = filtered.slice(0, limit);
    const canRemove = can("sales.delete");
    const canReceipt = can("reports.download");
    const money = (n) => (parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Day totals are computed over ALL filtered sales so partially shown days still show the real total
    const dayTotals = {};
    filtered.forEach(s => {
        const key = s.date.toDate().toDateString();
        if (!dayTotals[key]) dayTotals[key] = { count: 0, total: 0 };
        dayTotals[key].count += 1;
        dayTotals[key].total += parseFloat(s.total) || 0;
    });

    const todayKey = new Date().toDateString();
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const yesterdayKey = yest.toDateString();

    const dayLabel = (d) => {
        const key = d.toDateString();
        const full = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        if (key === todayKey) return `Today <span class="day-date">${full}</span>`;
        if (key === yesterdayKey) return `Yesterday <span class="day-date">${full}</span>`;
        return full;
    };

    const rowHTML = (s) => {
        const saleDate = s.date.toDate();
        const timeStr = saleDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const totalQty = s.items.reduce((sum, item) => sum + (parseFloat(item.qty) || 0), 0);

        // Summary line: show the searched item first if there is one
        const lead = (query && s.items.find(i => i.name.toLowerCase().includes(query))) || s.items[0];
        const more = s.items.length - 1;
        const refundedAmt = parseFloat(s.refundedAmount) || 0;
        const fullyRefunded = s.items.length === 0;
        const discAmt = s.discount ? parseFloat(s.discount.amount) || 0 : 0;

        const itemsHTML = s.items.map((i, idx) => {
            const isMatch = query && i.name.toLowerCase().includes(query);
            const qtyVal = parseFloat(i.qty) || 0;
            const subtotal = (parseFloat(i.price) || 0) * qtyVal;
            const listed = i.listPrice !== undefined && parseFloat(i.listPrice) !== parseFloat(i.price);
            return `
                <li class="${isMatch ? 'match' : ''}">
                    <span class="sale-qty">${window.toMixedFraction(qtyVal)}</span>
                    <span class="name">${itemLabel(i)}<small class="text-muted d-block">@ ${listed ? `<s>KSh ${(parseFloat(i.listPrice) || 0).toLocaleString()}</s> ` : ""}KSh ${(parseFloat(i.price) || 0).toLocaleString()}</small></span>
                    <strong>KSh ${money(subtotal)}</strong>
                    ${canRemove ? `<button class="btn btn-link p-0 border-0" title="Remove this item" onclick="window.deleteItemFromSale('${s.id}', ${idx})"><i class="fas fa-circle-xmark text-danger"></i></button>` : ''}
                </li>`;
        }).join('');

        return `
            <details class="sale-row">
                <summary>
                    <span class="sr-time">${timeStr}</span>
                    <span class="sr-cust"><i class="fas fa-user"></i>${s.customer || 'Guest'}</span>
                    <span class="sr-items">${lead ? `${itemLabel(lead)} <b>× ${window.toMixedFraction(lead.qty)}</b>${more > 0 ? ` <span class="sr-more">+${more} more</span>` : ''}` : '<span class="text-muted">All items refunded</span>'}</span>
                    <span class="sr-pay">${s._pending ? '<span class="sale-chip pending" title="Saved on this device, waiting to sync">Not synced</span> ' : ''}${s.payment ? `<span class="sale-chip ${s.payment === 'Credit' ? 'credit' : ''}">${s.payment}</span>` : ''}${discAmt > 0 ? ' <span class="sale-chip price-chip">Discount</span>' : ''}${refundedAmt > 0 ? ' <span class="sale-chip refund-chip">Refunded</span>' : ''}</span>
                    <span class="sr-total">KSh ${money(s.total)}</span>
                    <span class="sr-chev"><i class="fas fa-chevron-down"></i></span>
                </summary>
                <div class="sale-detail">
                    <div class="sale-detail-meta">
                        <span><i class="far fa-clock me-1"></i>${saleDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        <span>${s.items.length} item${s.items.length > 1 ? 's' : ''} · ${window.toMixedFraction(totalQty)} units</span>
                        ${s.transaction ? `<span class="sale-chip font-monospace">${s.transaction}</span>` : ''}
                        ${s.soldBy ? `<span><i class="fas fa-user-check me-1"></i>${escHtml(s.soldBy)}</span>` : ''}
                    </div>
                    <ul class="sale-items">${itemsHTML || (s.originalItems || []).map(i => `<li class="text-muted"><span class="sale-qty">${window.toMixedFraction(parseFloat(i.qty) || 0)}</span><span class="name"><s>${escHtml(itemLabel(i))}</s><small class="d-block">refunded</small></span></li>`).join('')}</ul>
                    ${discAmt > 0 ? `<div class="sale-note price-note"><i class="fas fa-percent"></i><span><b>Discount KSh ${money(discAmt)}</b>${s.discount.kind === "percent" ? ` (${escHtml(s.discount.value)}%)` : ""} · ${escHtml(s.discount.reason || "no reason")}${s.discount.by ? ` · by ${escHtml(s.discount.by)}` : ""}</span></div>` : ''}
                    ${(s.priceChanges || []).map(p => `<div class="sale-note price-note"><i class="fas fa-tag"></i><span><b>${escHtml(p.name)}</b> sold at KSh ${money(p.to)} instead of KSh ${money(p.from)} · ${escHtml(p.reason || "no reason")}</span></div>`).join('')}
                    ${refundedAmt > 0 ? `<div class="sale-note refund-note"><i class="fas fa-rotate-left"></i><span><b>Refunded KSh ${money(refundedAmt)}</b>${s.lastRefund ? ` · ${escHtml(s.lastRefund.reason || "")}${s.lastRefund.by ? ` · by ${escHtml(s.lastRefund.by)}` : ""}` : ""}${s.originalTotal !== undefined ? ` · the sale was KSh ${money(s.originalTotal)}` : ""}</span></div>` : ''}
                    <div class="sale-actions">
                        ${can("pos.refund") && !fullyRefunded ? `<button class="btn btn-soft btn-sm" onclick="window.openRefundModal('${s.id}')"><i class="fas fa-rotate-left text-warning me-1"></i>Refund</button>` : ''}
                        ${canReceipt && !fullyRefunded ? `<button class="btn btn-soft btn-sm" onclick="window.downloadSale('${s.id}')"><i class="fas fa-file-pdf text-danger me-1"></i>Receipt</button>` : ''}
                        ${canRemove ? `<button class="btn btn-soft btn-sm" onclick="window.deleteSale('${s.id}')"><i class="fas fa-trash-can text-danger me-1"></i>Delete</button>` : ''}
                    </div>
                </div>
            </details>`;
    };

    // Group the visible sales under day headers (they are already newest first)
    let cardsHTML = "";
    let currentKey = null;
    visible.forEach(s => {
        const d = s.date.toDate();
        const key = d.toDateString();
        if (key !== currentKey) {
            if (currentKey !== null) cardsHTML += `</div></section>`;
            const t = dayTotals[key];
            cardsHTML += `
                <section class="sales-day">
                    <header class="sales-day-head">
                        <span class="day-title">${dayLabel(d)}</span>
                        <span class="day-sum"><b>KSh ${money(t.total)}</b> · ${t.count} sale${t.count > 1 ? 's' : ''}</span>
                    </header>
                    <div class="sales-day-body">`;
            currentKey = key;
        }
        cardsHTML += rowHTML(s);
    });
    if (currentKey !== null) cardsHTML += `</div></section>`;

    const remaining = filtered.length - visible.length;
    const footerHTML = `
        <div class="sales-list-footer">
            <span class="text-muted small">Showing ${visible.length} of ${filtered.length} sales</span>
            ${remaining > 0 ? `<button class="btn btn-custom btn-sm" onclick="window.showMoreSales()">Show ${Math.min(25, remaining)} more</button>` : ''}
        </div>`;

    tableBody.innerHTML = cardsHTML + footerHTML;

    // Synchronize Daily Product Sales Summary list to match search query across all dates sold
    renderGroupedSales(filtered, query);
};

window.showMoreSales = () => {
    window.salesLimit = (window.salesLimit || 25) + 25;
    window.filterSalesTable();
};

window.showMoreDays = () => {
    window.dailyLimit = (window.dailyLimit || 7) + 7;
    window.filterSalesTable();
};

/**
 * Quick date-range chips for the sales list
 */
window.setSalesRange = (range) => {
    const ymd = (d) => d.toLocaleDateString('en-CA');
    const now = new Date();
    let from = "", to = "";

    if (range === "today") { from = to = ymd(now); }
    else if (range === "yesterday") { const y = new Date(now); y.setDate(y.getDate() - 1); from = to = ymd(y); }
    else if (range === "week") { const w = new Date(now); w.setDate(w.getDate() - 6); from = ymd(w); to = ymd(now); }
    else if (range === "month") { from = ymd(new Date(now.getFullYear(), now.getMonth(), 1)); to = ymd(now); }

    const f = document.getElementById("dateFrom");
    const t = document.getElementById("dateTo");
    if (f) f.value = from;
    if (t) t.value = to;

    document.querySelectorAll("#salesRangeChips .btn").forEach(b => b.classList.toggle("active", b.dataset.range === range));
    window.salesLimit = 25;
    window.dailyLimit = 7;
    window.filterSalesTable();
};

// Sales Snapshot Listener
window.db.collection("sales").orderBy("date", "desc").onSnapshot({ includeMetadataChanges: true }, snap => {
    let allSales = [];
    let todayTotal = 0;
    let yesterdayTotal = 0;
    let monthlyTotal = 0;
    let dailyProfit = 0;
    let yesterdayProfit = 0;
    let todayOrders = 0;
    let totalProfit = 0;

    const monthlyProfits = {};
    const itemCounts = {};
    const now = new Date();
    const today = now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDateStr = yesterday.toDateString();

    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const costMap = {};
    window.productsCache.forEach(doc => {
        const p = doc.data();
        costMap[p.name.trim().toLowerCase()] = parseFloat(p.buyPrice) || 0;
    });

    snap.docs.forEach(doc => {
        const s = doc.data();
        allSales.push({ id: doc.id, _pending: doc.metadata.hasPendingWrites, ...s });
        const saleDate = s.date.toDate();
        let saleCost = 0;

        s.items.forEach(item => {
            const normalizedItemName = item.name.trim().toLowerCase();
            const qty = parseFloat(item.qty) || 0;
            const costPerItem = (item.cost !== undefined) ? parseFloat(item.cost) : (costMap[normalizedItemName] || 0);
            saleCost += (costPerItem * qty);
            itemCounts[item.name] = (itemCounts[item.name] || 0) + qty;
        });

        const profit = parseFloat(s.total) - saleCost;
        totalProfit += profit;

        const monthKey = saleDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        if (!monthlyProfits[monthKey]) {
            monthlyProfits[monthKey] = { revenue: 0, cost: 0, profit: 0 };
        }
        monthlyProfits[monthKey].revenue += parseFloat(s.total);
        monthlyProfits[monthKey].cost += saleCost;
        monthlyProfits[monthKey].profit += profit;

        const sDateStr = saleDate.toDateString();
        if (sDateStr === today) { todayTotal += parseFloat(s.total); dailyProfit += profit; todayOrders++; }
        if (sDateStr === yesterdayDateStr) { yesterdayTotal += parseFloat(s.total); yesterdayProfit += profit; }
        if (saleDate.getMonth() === currentMonth && saleDate.getFullYear() === currentYear) { monthlyTotal += parseFloat(s.total); }
    });

    window.allSales = allSales;
    window.currentMonthlySalesTotal = monthlyTotal;
    window.monthlyProfitsCache = monthlyProfits;

    // Render Historical Net Profits Breakdown Container
    if (typeof window.renderProfitCardBreakdown === "function") {
        window.renderProfitCardBreakdown();
    }

    const tSales = document.getElementById("todaysSales");
    const ySales = document.getElementById("yesterdaysSales");
    const mSales = document.getElementById("monthlySales");
    const dProfit = document.getElementById("dailyProfit");
    const tProfit = document.getElementById("totalProfit");

    if (tSales) tSales.textContent = "KSh " + todayTotal.toLocaleString();
    if (ySales) ySales.textContent = "KSh " + yesterdayTotal.toLocaleString();
    if (mSales) mSales.textContent = "KSh " + monthlyTotal.toLocaleString();
    if (dProfit) dProfit.textContent = "KSh " + dailyProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (tProfit) tProfit.textContent = "KSh " + totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const money2 = (n) => "KSh " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt("dailyRevenue", money2(todayTotal));
    setTxt("dailyOrders", todayOrders.toLocaleString());
    setTxt("yesterdayProfit", money2(yesterdayProfit));

    const cmpEl = document.getElementById("dailyProfitCompare");
    if (cmpEl) {
        if (yesterdayProfit > 0) {
            const pct = ((dailyProfit - yesterdayProfit) / yesterdayProfit) * 100;
            const up = pct >= 0;
            cmpEl.innerHTML = `<span class="pc-badge ${up ? 'up' : 'down'}"><i class="fas fa-arrow-${up ? 'up' : 'down'}"></i> ${Math.abs(pct).toFixed(1)}%</span> vs yesterday`;
        } else if (dailyProfit > 0) {
            cmpEl.innerHTML = `<span class="pc-badge up"><i class="fas fa-arrow-up"></i> New</span> no profit recorded yesterday`;
        } else {
            cmpEl.textContent = "No profit recorded yet today";
        }
    }

    const topItemsList = document.getElementById("topItemsList");
    if (topItemsList) {
        const sortedItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]);
        topItemsList.innerHTML = sortedItems.map(item => `
            <div class="d-flex justify-content-between mb-2">
                <span>${item[0]}</span>
                <span class="fw-bold text-primary">${window.toFraction(item[1])} sold</span>
            </div>`).join("");
    }

    window.updateSalesProgress();
    window.filterSalesTable();
    if (typeof window.renderInsights === "function") window.renderInsights();
});

/**
 * Helper to prompt admin with choice to either Restock Items OR Delete Record Only
 */
async function promptDeletionOptions(title, text) {
    return await Swal.fire({
        title: title,
        html: `
            <div class="text-start">
                <p class="mb-3">${text}</p>
                <div class="card p-2 bg-light border text-dark font-sans small mb-1">
                    <div class="fw-bold mb-1 text-primary"><i class="fas fa-question-circle me-1"></i>Choose Deletion Action:</div>
                    <div class="mb-1"><strong>1. Delete & Restock Items:</strong> Deletes transaction AND returns sold quantities back to inventory stock.</div>
                    <div><strong>2. Delete Record Only:</strong> Permanently deletes record to free space without altering inventory stock.</div>
                </div>
            </div>
        `,
        icon: "warning",
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '<i class="fas fa-boxes me-1"></i> Delete & Restock Items',
        confirmButtonColor: '#198754',
        denyButtonText: '<i class="fas fa-trash-alt me-1"></i> Delete Record Only',
        denyButtonColor: '#6c757d',
        cancelButtonText: 'Cancel',
        cancelButtonColor: '#3085d6'
    });
}

/**
 * Helper to display SweetAlert popup showing exact restocked items and new stock counts
 */
function showRestockedAlert(restockedItems, titleText = "Transaction Deleted & Stock Restored") {
    if (!restockedItems || restockedItems.length === 0) {
        return Swal.fire("Deleted!", titleText, "success");
    }

    const itemsHtml = restockedItems.map(item => `
        <div class="d-flex justify-content-between align-items-center py-2 px-3 border-bottom text-dark">
            <div class="text-start">
                <strong class="d-block text-dark">${item.name}</strong>
                <small class="text-muted">Restocked: <span class="badge bg-success">+${window.toMixedFraction(item.qtyRestocked)}</span></small>
            </div>
            <div class="text-end">
                <small class="text-secondary d-block">New Inventory Stock:</small>
                <strong class="text-primary fs-6">${window.toMixedFraction(item.newStock)}</strong>
            </div>
        </div>
    `).join('');

    Swal.fire({
        title: titleText,
        html: `
            <div class="text-start mb-2 text-secondary">
                <i class="fas fa-boxes me-1 text-success"></i> The following items have been added back into inventory:
            </div>
            <div class="border rounded bg-light" style="max-height: 220px; overflow-y: auto;">
                ${itemsHtml}
            </div>
        `,
        icon: "success",
        confirmButtonColor: "#198754"
    });
}

/**
 * Deletes all sales for a specific historical month (Admin only)
 */
window.deleteMonthProfit = async (monthKey) => {
    if (!can("sales.deleteBulk")) return denyAccess("delete a whole month of sales");

    const salesToDelete = (window.allSales || []).filter(s => {
        const mKey = s.date.toDate().toLocaleString('default', { month: 'long', year: 'numeric' });
        return mKey === monthKey;
    });

    if (salesToDelete.length === 0) {
        return Swal.fire("Notice", "No records found for this month.", "info");
    }

    const typed = await Swal.fire({
        title: `Delete ${monthKey}?`,
        html: `This will remove <b>${salesToDelete.length} sales records</b>.<br>Type <b>${monthKey}</b> below to continue.`,
        icon: "warning",
        input: "text",
        inputPlaceholder: monthKey,
        showCancelButton: true,
        confirmButtonColor: "#d33",
        confirmButtonText: "Continue",
        preConfirm: (v) => {
            if ((v || "").trim().toLowerCase() !== monthKey.toLowerCase()) {
                Swal.showValidationMessage(`Please type "${monthKey}" exactly`);
                return false;
            }
            return true;
        }
    });
    if (!typed.isConfirmed) return;

    const result = await promptDeletionOptions(
        `Delete All Sales for ${monthKey}?`,
        `You are about to delete <strong>${salesToDelete.length} sales records</strong> for ${monthKey}.`
    );

    if (!result.isConfirmed && !result.isDenied) return;
    const shouldRestock = result.isConfirmed;

    try {
        const batch = window.db.batch();
        const restockMap = {};

        salesToDelete.forEach(s => {
            const docRef = window.db.collection("sales").doc(s.id);
            batch.delete(docRef);
            reverseCreditForSale(batch, s, parseFloat(s.total) || 0);

            if (shouldRestock && Array.isArray(s.items)) {
                s.items.forEach(item => {
                    const qty = itemStockQty(item);
                    if (qty <= 0) return;

                    let prodDoc = null;
                    if (item.id) {
                        prodDoc = window.productsCache.find(p => p.id === item.id);
                    }
                    if (!prodDoc && window.productsCache) {
                        prodDoc = window.productsCache.find(p => p.data().name.trim().toLowerCase() === (item.name || "").trim().toLowerCase());
                    }

                    if (prodDoc) {
                        if (!restockMap[prodDoc.id]) {
                            restockMap[prodDoc.id] = {
                                docId: prodDoc.id,
                                name: item.name,
                                currentStock: parseFloat(prodDoc.data().stock) || 0,
                                qtyRestocked: 0
                            };
                        }
                        restockMap[prodDoc.id].qtyRestocked += qty;
                    }
                });
            }
        });

        const restockedItems = [];
        if (shouldRestock) {
            Object.values(restockMap).forEach(info => {
                const newStock = info.currentStock + info.qtyRestocked;
                const prodRef = window.db.collection("products").doc(info.docId);
                batch.update(prodRef, { stock: newStock });

                restockedItems.push({
                    name: info.name,
                    qtyRestocked: info.qtyRestocked,
                    newStock: newStock
                });
            });
        }

        await batch.commit();
        logAudit("delete", "month_delete", `A whole month of sales deleted: ${monthKey}`,
            `${salesToDelete.length} sales, KSh ${salesToDelete.reduce((n, s) => n + (parseFloat(s.total) || 0), 0).toLocaleString()}. ${shouldRestock ? "Stock put back." : "Stock NOT put back."}`,
            { amount: salesToDelete.reduce((n, s) => n + (parseFloat(s.total) || 0), 0), flag: true, alert: true });

        if (shouldRestock) {
            showRestockedAlert(restockedItems, `${monthKey} Sales Deleted & Stock Restored`);
        } else {
            Swal.fire("Monthly Records Deleted", `Successfully deleted ${salesToDelete.length} sales records for ${monthKey} (inventory stock remains unchanged).`, "success");
        }
    } catch (err) {
        console.error("Error deleting monthly profit records:", err);
        Swal.fire("Error", "Could not delete month records: " + err.message, "error");
    }
};

// Bind sales search & date filters with input debouncing
const salesSearchInput = document.getElementById("salesSearchInput");
const dateFromEl = document.getElementById("dateFrom");
const dateToEl = document.getElementById("dateTo");

let searchDebounceTimer = null;
if (salesSearchInput) {
    salesSearchInput.oninput = () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            window.salesLimit = 25;
            window.dailyLimit = 7;
            window.filterSalesTable();
        }, 150);
    };
}
const resetAndFilterSales = () => {
    window.salesLimit = 25;
    window.dailyLimit = 7;
    document.querySelectorAll("#salesRangeChips .btn").forEach(b => b.classList.remove("active"));
    window.filterSalesTable();
};
if (dateFromEl) dateFromEl.onchange = resetAndFilterSales;
if (dateToEl) dateToEl.onchange = resetAndFilterSales;

const downloadFilteredBtn = document.getElementById("downloadFilteredPDF");
if (downloadFilteredBtn) {
    downloadFilteredBtn.onclick = () => {
        const query = salesSearchInput ? salesSearchInput.value.trim().toLowerCase() : "";
        const fromDateStr = dateFromEl ? dateFromEl.value : "";
        const toDateStr = dateToEl ? dateToEl.value : "";

        const fromDate = fromDateStr ? new Date(fromDateStr + "T00:00:00") : null;
        const toDate = toDateStr ? new Date(toDateStr + "T23:59:59") : null;

        const filtered = (window.allSales || []).filter(s => {
            const saleDate = s.date.toDate();
            if (fromDate && saleDate < fromDate) return false;
            if (toDate && saleDate > toDate) return false;
            if (!query) return true;
            return (s.customer || "").toLowerCase().includes(query) ||
                (s.transaction || "").toLowerCase().includes(query) ||
                s.items.some(i => i.name.toLowerCase().includes(query));
        });

        if (filtered.length === 0) return Swal.fire("No Data", "No sales records match your current filter parameters.", "warning");

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(20);
        doc.setTextColor(41, 128, 185);
        doc.text("MADOLLAR LIQUOR PUB", 105, 15, null, null, "center");
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text("Filtered Sales History Report", 105, 24, null, null, "center");

        const filterSummary = `Filter: ${query ? `Search: "${query}" | ` : ''}${fromDateStr ? `From ${fromDateStr} ` : ''}${toDateStr ? `To ${toDateStr}` : ''}`;
        doc.setFontSize(10);
        doc.text(filterSummary, 105, 30, null, null, "center");

        const grandTotal = filtered.reduce((sum, s) => sum + s.total, 0);

        doc.autoTable({
            startY: 36,
            head: [['Date', 'Customer', 'Items Sold (Qty x Price)', 'Total (KSh)']],
            body: filtered.map(s => [
                s.date.toDate().toLocaleDateString('en-GB') + ' ' + s.date.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                s.customer,
                s.items.map(i => `${itemLabel(i)} (${window.toMixedFraction(i.qty)} x KSh ${i.price})`).join("\n"),
                s.total.toLocaleString()
            ]),
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] }
        });

        doc.setFontSize(11);
        doc.text(`TOTAL REVENUE: KSh ${grandTotal.toLocaleString()}`, 196, doc.lastAutoTable.finalY + 10, null, null, "right");
        doc.save(`Filtered_Sales_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
    };
}

/**
 * Renders daily grouped sales list matching optional search query across all dates sold
 */
function renderGroupedSales(sales, searchFilter = "") {
    const container = document.getElementById("dailySalesContainer");
    if (!container) return;

    const salesPane = document.getElementById("salesTab");
    if (salesPane && !salesPane.classList.contains("active")) {
        window.salesNeedsRender = true;
        return;
    }
    container.innerHTML = "";

    const query = (searchFilter || "").trim().toLowerCase();

    const grouped = (sales || []).reduce((acc, sale) => {
        const dateKey = sale.date.toDate().toLocaleDateString('en-GB');
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(sale);
        return acc;
    }, {});

    const sortedDates = Object.keys(grouped).sort((a, b) => {
        const [dayA, monthA, yearA] = a.split('/');
        const [dayB, monthB, yearB] = b.split('/');
        return new Date(`${yearB}-${monthB}-${dayB}`) - new Date(`${yearA}-${monthA}-${dayA}`);
    });

    if (sortedDates.length === 0) {
        container.innerHTML = `<div class="text-center text-muted py-4">No daily sales summary available.</div>`;
        return;
    }

    let cardsHTML = "";
    const dayLimit = window.dailyLimit || 7;

    sortedDates.slice(0, dayLimit).forEach(date => {
        const dailySales = grouped[date];
        let dayTotal = 0;
        let productSummary = {};

        dailySales.forEach(s => {
            s.items.forEach(item => {
                const itemMatches = !query || item.name.toLowerCase().includes(query);
                if (itemMatches) {
                    const label = itemLabel(item);
                    if (!productSummary[label]) productSummary[label] = { qty: 0, total: 0 };
                    const qtyVal = parseFloat(item.qty) || 0;
                    const priceVal = parseFloat(item.price) || 0;
                    const subtotal = priceVal * qtyVal;
                    productSummary[label].qty += qtyVal;
                    productSummary[label].total += subtotal;
                    dayTotal += subtotal;
                }
            });
        });

        const matchedProducts = Object.keys(productSummary);
        if (matchedProducts.length === 0) return;

        let tableRows = matchedProducts.map(name => {
            const qtyVal = productSummary[name].qty;
            const isFraction = (qtyVal % 1 !== 0);
            const isMatch = query && name.toLowerCase().includes(query);
            return `
                <tr class="${isMatch ? 'table-warning fw-bold' : ''}">
                    <td class="fw-semibold text-dark">${name}</td>
                    <td>
                        <span class="badge ${isFraction ? 'bg-primary-subtle text-primary border border-primary-subtle' : 'bg-light text-dark border'} font-monospace px-2">
                            ${window.toMixedFraction(qtyVal)}
                        </span>
                    </td>
                    <td class="fw-bold text-success text-end">KSh ${productSummary[name].total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
            `;
        }).join('');

        const adminDeleteDayBtn = can("sales.deleteBulk")
            ? `<button class="btn btn-sm btn-outline-danger" title="Delete All Sales for ${date}" onclick="window.deleteDay('${date}')"><i class="fas fa-trash-alt me-1"></i>Delete Day</button>`
            : '';

        const headerLabel = query ? `Daily Sales Breakdown for ${date}` : `Date: ${date}`;

        cardsHTML += `
            <div class="card mb-3 shadow-sm border">
                <div class="card-header bg-light d-flex justify-content-between align-items-center py-2 px-3 flex-wrap gap-2">
                    <h6 class="mb-0 fw-bold text-dark">
                        <i class="fas fa-calendar-day me-2 text-primary"></i>${headerLabel} 
                        <span class="badge bg-success ms-2 fs-6">Total: KSh ${dayTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </h6>
                    <div class="d-flex gap-2 align-items-center">
                        ${can("reports.download") ? `<button class="btn btn-sm btn-outline-primary" onclick="window.downloadDailyReport('${date}')">
                            <i class="fas fa-file-pdf me-1"></i>PDF Report
                        </button>` : ''}
                        ${adminDeleteDayBtn}
                    </div>
                </div>
                <div class="card-body p-0">
                    <div class="table-responsive">
                        <table class="table table-sm table-striped table-hover align-middle mb-0">
                            <thead class="table-light">
                                <tr><th>Product</th><th>Qty Sold</th><th class="text-end">Subtotal</th></tr>
                            </thead>
                            <tbody>${tableRows}</tbody>
                        </table>
                    </div>
                </div>
            </div>`;
    });

    if (!cardsHTML) {
        cardsHTML = `<div class="text-center text-muted py-4">No sales found for "${query}" across any date.</div>`;
    }

    if (sortedDates.length > dayLimit) {
        cardsHTML += `<div class="text-center mt-2"><button class="btn btn-soft btn-sm" onclick="window.showMoreDays()">Show 7 more days (${sortedDates.length - dayLimit} remaining)</button></div>`;
    }

    container.innerHTML = cardsHTML;
}

// Delete Specific Item from a Sale Transaction
window.deleteItemFromSale = async (saleId, itemIndex) => {
    if (!can("sales.delete")) return denyAccess("delete sales");

    const sale = (window.allSales || []).find(s => s.id === saleId);
    if (!sale || !sale.items || !sale.items[itemIndex]) {
        return Swal.fire("Error", "Item not found in sale record.", "error");
    }

    const itemToDelete = sale.items[itemIndex];
    const result = await promptDeletionOptions(
        "Remove Item from Sale?",
        `You are about to remove <strong>"${itemToDelete.name}"</strong> (${window.toMixedFraction(itemToDelete.qty)} units) from this transaction.`
    );

    if (!result.isConfirmed && !result.isDenied) return;
    const shouldRestock = result.isConfirmed;

    try {
        const batch = window.db.batch();
        const saleRef = window.db.collection("sales").doc(saleId);
        const updatedItems = sale.items.filter((_, idx) => idx !== itemIndex);
        reverseCreditForSale(batch, sale, (parseFloat(itemToDelete.price) || 0) * (parseFloat(itemToDelete.qty) || 0));

        if (updatedItems.length === 0) {
            batch.delete(saleRef);
        } else {
            const newTotal = updatedItems.reduce((sum, i) => sum + (parseFloat(i.price) || 0) * (parseFloat(i.qty) || 0), 0);
            batch.update(saleRef, {
                items: updatedItems,
                total: newTotal
            });
        }

        const restockedItems = [];
        const qty = itemStockQty(itemToDelete);

        if (shouldRestock && qty > 0) {
            let prodDoc = null;
            if (itemToDelete.id) {
                prodDoc = window.productsCache.find(p => p.id === itemToDelete.id);
            }
            if (!prodDoc && window.productsCache) {
                prodDoc = window.productsCache.find(p => p.data().name.trim().toLowerCase() === (itemToDelete.name || "").trim().toLowerCase());
            }

            if (prodDoc) {
                const currentStock = parseFloat(prodDoc.data().stock) || 0;
                const newStock = currentStock + qty;
                const prodRef = window.db.collection("products").doc(prodDoc.id);

                batch.update(prodRef, { stock: newStock });

                restockedItems.push({
                    name: itemToDelete.name,
                    qtyRestocked: qty,
                    newStock: newStock
                });
            }
        }

        await batch.commit();
        logAudit("delete", "sale_item_delete", `Item removed from a sale: ${itemLabel(itemToDelete)}`,
            `${window.toMixedFraction(itemToDelete.qty)} × KSh ${parseFloat(itemToDelete.price) || 0} (sale to ${sale.customer || "Guest"}). ${shouldRestock ? "Stock put back." : "Stock NOT put back."}`,
            { amount: (parseFloat(itemToDelete.price) || 0) * (parseFloat(itemToDelete.qty) || 0), flag: !shouldRestock, ref: saleId, alert: true });

        if (shouldRestock) {
            showRestockedAlert(restockedItems, "Item Removed & Stock Restored");
        } else {
            Swal.fire("Item Removed", `"${itemToDelete.name}" removed from sale record (inventory stock remains unchanged).`, "success");
        }
    } catch (err) {
        console.error("Error removing item: ", err);
        Swal.fire("Error", "Failed to remove item: " + err.message, "error");
    }
};

// Delete Single Sale Transaction
window.deleteSale = async (id) => {
    if (!can("sales.delete")) return denyAccess("delete sales");

    const sale = (window.allSales || []).find(s => s.id === id);
    if (!sale) return Swal.fire("Error", "Sale transaction not found.", "error");

    const result = await promptDeletionOptions(
        "Delete Sale Transaction?",
        `You are about to delete transaction recorded for <strong>${sale.customer || 'Guest'}</strong> (Total: KSh ${(sale.total || 0).toLocaleString()}).`
    );

    if (!result.isConfirmed && !result.isDenied) return;
    const shouldRestock = result.isConfirmed;

    try {
        const batch = window.db.batch();
        const saleRef = window.db.collection("sales").doc(id);
        batch.delete(saleRef);
        reverseCreditForSale(batch, sale, parseFloat(sale.total) || 0);

        const restockedItems = [];

        if (shouldRestock && sale && Array.isArray(sale.items)) {
            for (const item of sale.items) {
                const qty = itemStockQty(item);
                if (qty <= 0) continue;

                let prodDoc = null;
                if (item.id) {
                    prodDoc = window.productsCache.find(p => p.id === item.id);
                }
                if (!prodDoc && window.productsCache) {
                    prodDoc = window.productsCache.find(p => p.data().name.trim().toLowerCase() === (item.name || "").trim().toLowerCase());
                }

                if (prodDoc) {
                    const currentStock = parseFloat(prodDoc.data().stock) || 0;
                    const newStock = currentStock + qty;
                    const prodRef = window.db.collection("products").doc(prodDoc.id);

                    batch.update(prodRef, { stock: newStock });

                    restockedItems.push({
                        name: item.name,
                        qtyRestocked: qty,
                        newStock: newStock
                    });
                }
            }
        }

        await batch.commit();
        logAudit("delete", "sale_delete", `Sale deleted: ${sale.customer || "Guest"}, KSh ${(parseFloat(sale.total) || 0).toLocaleString()}`,
            `${(sale.items || []).map(i => `${window.toMixedFraction(i.qty)} × ${itemLabel(i)}`).join(", ") || "no items left"}. Paid by ${sale.payment || "Cash"}. ${shouldRestock ? "Stock put back." : "Stock NOT put back."}`,
            { amount: parseFloat(sale.total) || 0, flag: !shouldRestock, ref: id, alert: true });

        if (shouldRestock) {
            showRestockedAlert(restockedItems, "Transaction Deleted & Stock Restored");
        } else {
            Swal.fire("Deleted", "Sale record permanently deleted (inventory stock remains unchanged).", "success");
        }
    } catch (error) {
        console.error("Error deleting sale: ", error);
        Swal.fire("Error", "Failed to delete transaction: " + error.message, "error");
    }
};

// Delete Entire Day Sales Records
/**
 * When a credit sale (or part of it) is deleted, the customer no longer owes that amount
 */
function reverseCreditForSale(batch, sale, amount) {
    if (sale && sale.payment === "Credit" && sale.customerId && amount && window.customersCache[sale.customerId]) {
        batch.update(window.db.collection("customers").doc(sale.customerId), {
            balance: firebase.firestore.FieldValue.increment(-amount)
        });
    }
}

window.deleteDay = async (dateStr) => {
    if (!can("sales.deleteBulk")) return denyAccess("delete a whole day of sales");

    const salesToDelete = (window.allSales || []).filter(s => s.date.toDate().toLocaleDateString('en-GB') === dateStr);

    if (salesToDelete.length === 0) {
        return Swal.fire("Notice", "No sales records found for this date.", "info");
    }

    const result = await promptDeletionOptions(
        `Delete All Sales for ${dateStr}?`,
        `You are about to delete <strong>${salesToDelete.length} sales transaction records</strong> for ${dateStr}.`
    );

    if (!result.isConfirmed && !result.isDenied) return;
    const shouldRestock = result.isConfirmed;

    try {
        const batch = window.db.batch();
        const restockMap = {};

        salesToDelete.forEach(s => {
            const docRef = window.db.collection("sales").doc(s.id);
            batch.delete(docRef);
            reverseCreditForSale(batch, s, parseFloat(s.total) || 0);

            if (shouldRestock && Array.isArray(s.items)) {
                s.items.forEach(item => {
                    const qty = itemStockQty(item);
                    if (qty <= 0) return;

                    let prodDoc = null;
                    if (item.id) {
                        prodDoc = window.productsCache.find(p => p.id === item.id);
                    }
                    if (!prodDoc && window.productsCache) {
                        prodDoc = window.productsCache.find(p => p.data().name.trim().toLowerCase() === (item.name || "").trim().toLowerCase());
                    }

                    if (prodDoc) {
                        if (!restockMap[prodDoc.id]) {
                            restockMap[prodDoc.id] = {
                                docId: prodDoc.id,
                                name: item.name,
                                currentStock: parseFloat(prodDoc.data().stock) || 0,
                                qtyRestocked: 0
                            };
                        }
                        restockMap[prodDoc.id].qtyRestocked += qty;
                    }
                });
            }
        });

        const restockedItems = [];
        if (shouldRestock) {
            Object.values(restockMap).forEach(info => {
                const newStock = info.currentStock + info.qtyRestocked;
                const prodRef = window.db.collection("products").doc(info.docId);
                batch.update(prodRef, { stock: newStock });

                restockedItems.push({
                    name: info.name,
                    qtyRestocked: info.qtyRestocked,
                    newStock: newStock
                });
            });
        }

        await batch.commit();
        logAudit("delete", "day_delete", `A whole day of sales deleted: ${dateStr}`,
            `${salesToDelete.length} sales, KSh ${salesToDelete.reduce((n, s) => n + (parseFloat(s.total) || 0), 0).toLocaleString()}. ${shouldRestock ? "Stock put back." : "Stock NOT put back."}`,
            { amount: salesToDelete.reduce((n, s) => n + (parseFloat(s.total) || 0), 0), flag: true, alert: true });

        if (shouldRestock) {
            showRestockedAlert(restockedItems, `Daily Sales for ${dateStr} Deleted & Stock Restored`);
        } else {
            Swal.fire("Daily Sales Deleted", `${salesToDelete.length} sales records deleted for ${dateStr} (inventory stock remains unchanged).`, "success");
        }
    } catch (error) {
        console.error("Error deleting daily sales: ", error);
        Swal.fire("Error", "Failed to delete daily records: " + error.message, "error");
    }
};

// Download Daily Summary PDF
window.downloadDailyReport = (dateStr) => {
    const dailySales = (window.allSales || []).filter(s => s.date.toDate().toLocaleDateString('en-GB') === dateStr);
    if (dailySales.length === 0) return;

    let productSummary = {};
    let grandTotal = 0;

    dailySales.forEach(s => {
        grandTotal += s.total;
        s.items.forEach(item => {
            const label = itemLabel(item);
            if (!productSummary[label]) {
                productSummary[label] = { qty: 0, total: 0 };
            }
            productSummary[label].qty += parseFloat(item.qty) || 0;
            productSummary[label].total += (item.price * item.qty);
        });
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.setTextColor(41, 128, 185);
    doc.text("MADOLLAR LIQUOR PUB", 105, 15, null, null, "center");
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text("Daily Sales Summary Report", 105, 22, null, null, "center");
    doc.setFontSize(12);
    doc.text(`Date: ${dateStr}`, 105, 29, null, null, "center");

    doc.setFontSize(14);
    doc.setFillColor(240, 240, 240);
    doc.rect(14, 35, 182, 10, 'F');
    doc.text(`Total Daily Sales: KSh ${grandTotal.toLocaleString()}`, 20, 42);

    doc.autoTable({
        startY: 50,
        head: [['Product Name', 'Total Quantity Sold', 'Total Sales (KSh)']],
        body: Object.keys(productSummary).map(name => [
            name,
            window.toFraction(productSummary[name].qty),
            productSummary[name].total.toLocaleString()
        ]),
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185] }
    });

    doc.setFontSize(10);
    doc.text("Generated by MADOLLAR System", 105, 285, null, null, "center");
    doc.save(`Daily_Report_${dateStr.replace(/\//g, '-')}.pdf`);
};

// Render Historical Net Profits Breakdown Container Helper
window.renderProfitCardBreakdown = function () {
    const profitCardBreakdown = document.getElementById("profitCardBreakdown");
    if (!profitCardBreakdown) return;

    const monthlyProfits = window.monthlyProfitsCache || {};
    const sortedMonths = Object.keys(monthlyProfits);
    const meta = document.getElementById("totalProfitMeta");

    if (sortedMonths.length === 0) {
        profitCardBreakdown.innerHTML = `<div class="opacity-75">No sales profit history recorded yet.</div>`;
        if (meta) meta.textContent = "";
        return;
    }

    const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const currentKey = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    const admin = can("sales.deleteBulk");

    let allRevenue = 0, allProfit = 0;
    sortedMonths.forEach(k => { allRevenue += monthlyProfits[k].revenue; allProfit += monthlyProfits[k].profit; });
    if (meta) meta.textContent = `${allRevenue ? ((allProfit / allRevenue) * 100).toFixed(1) : "0.0"}% margin on KSh ${fmt(allRevenue)} sales`;

    const rows = sortedMonths.map(mKey => {
        const m = monthlyProfits[mKey];
        const margin = m.revenue ? (m.profit / m.revenue) * 100 : 0;
        const safeKey = mKey.replace(/'/g, "\\'");
        return `
            <div class="pm-row">
                <div class="pm-month">
                    ${mKey}
                    ${mKey === currentKey ? '<span class="pm-tag">this month</span>' : ''}
                </div>
                <div class="pm-nums">
                    <span class="pm-profit">KSh ${fmt(m.profit)}</span>
                    <span class="pm-meta">Sales ${Math.round(m.revenue).toLocaleString()} · ${margin.toFixed(1)}%</span>
                </div>
                ${admin ? `<button class="pm-del" title="Delete all sales for ${mKey}" onclick="window.deleteMonthProfit('${safeKey}')"><i class="fas fa-ellipsis"></i></button>` : ''}
            </div>`;
    }).join("");

    profitCardBreakdown.innerHTML = `<div class="pm-head"><span>Month</span><span>Profit · Sales · Margin</span></div>${rows}`;
};

// Download Individual Sale Receipt PDF
window.downloadSale = async (id) => {
    const s = (window.allSales || []).find(sale => sale.id === id);
    if (!s) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const dateStr = s.date.toDate().toLocaleString();

    doc.setFontSize(22);
    doc.setTextColor(41, 128, 185);
    doc.text("MADOLLAR LIQUOR PUB", 105, 20, null, null, "center");

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("P.O. Box , Nairobi, Kenya", 105, 26, null, null, "center");
    doc.line(10, 32, 200, 32);

    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(`Customer: ${s.customer || 'Guest'}`, 14, 42);
    doc.text(`Date: ${dateStr}`, 14, 48);
    doc.text(`Transaction: ${s.transaction || 'N/A'}`, 14, 54);

    doc.autoTable({
        startY: 62,
        head: [['Item', 'Qty', 'Unit Price', 'Subtotal']],
        body: s.items.map(i => [
            itemLabel(i),
            window.toMixedFraction(i.qty),
            `KSh ${Number(i.price).toLocaleString()}`,
            `KSh ${(i.price * i.qty).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ]),
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185] },
        styles: { fontSize: 9, cellPadding: 3 },
        margin: { bottom: 40 }
    });

    let currentY = doc.lastAutoTable.finalY + 10;
    const pageHeight = doc.internal.pageSize.height;

    if (currentY + 70 > pageHeight) {
        doc.addPage();
        currentY = 20;
    }

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text(`TOTAL AMOUNT: KSh ${s.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 196, currentY, null, null, "right");

    currentY += 12;
    if (currentY + 40 > pageHeight) {
        doc.addPage();
        currentY = 20;
    }

    doc.setDrawColor(41, 128, 185);
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(14, currentY, 182, 35, 3, 3, 'FD');

    doc.setFontSize(12);
    doc.setTextColor(0, 150, 0);
    doc.text("PAY VIA M-PESA", 105, currentY + 8, null, null, "center");

    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text("Lipa na M-PESA , Buy Goods & Services", 105, currentY + 15, null, null, "center");
    doc.setFontSize(14);
    doc.text(`TILL NUMBER: 3234719`, 105, currentY + 23, null, null, "center");
    doc.setFontSize(10);
    doc.text(`Account Name: MADOLLA`, 105, currentY + 30, null, null, "center");

    currentY += 45;
    if (currentY + 25 > pageHeight) {
        doc.addPage();
        currentY = 20;
    }

    doc.setFontSize(14);
    doc.setTextColor(41, 128, 185);
    doc.text("THANK YOU FOR YOUR PURCHASE!", 105, currentY, null, null, "center");

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("We appreciate your business.", 105, currentY + 7, null, null, "center");

    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text("System Developed by Stones Web & System Solutions", 105, currentY + 15, null, null, "center");
    doc.text("Tel: 0790427109 , Email: livingstoneoduor21@gmail.com", 105, currentY + 20, null, null, "center");

    doc.save(`Receipt_${(s.customer || 'Guest').replace(/\s+/g, '_')}_${id.substring(0, 5)}.pdf`);
};

// Download Complete History PDF
const downloadAllBtn = document.getElementById("downloadAllPDF");
if (downloadAllBtn) {
    downloadAllBtn.onclick = () => {
        const salesList = window.allSales || [];
        if (salesList.length === 0) return Swal.fire("No Data", "No sales data available.", "info");

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(22);
        doc.setTextColor(41, 128, 185);
        doc.text("MADOLLAR LIQUOR PUB", 105, 15, null, null, "center");

        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text("Complete Sales History Report", 105, 25, null, null, "center");

        const grandTotal = salesList.reduce((sum, s) => sum + s.total, 0);

        doc.setFontSize(12);
        doc.setFillColor(240, 240, 240);
        doc.rect(14, 35, 182, 10, 'F');
        doc.text(`Total Revenue to Date: KSh ${grandTotal.toLocaleString()}`, 20, 42);

        doc.autoTable({
            startY: 50,
            head: [['Date', 'Customer', 'Items (Qty x Price = Subtotal)', 'Total (KSh)']],
            body: salesList.map(s => [
                s.date.toDate().toLocaleDateString('en-GB') + ' ' + s.date.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                s.customer,
                s.items.map(i => {
                    const sub = i.qty * i.price;
                    return `${itemLabel(i)} (${window.toMixedFraction(i.qty)} x KSh ${i.price.toLocaleString()} = KSh ${sub.toLocaleString()})`;
                }).join("\n"),
                s.total.toLocaleString()
            ]),
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] },
            styles: { cellPadding: 2, fontSize: 9 }
        });

        doc.setFontSize(10);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 105, 285, null, null, "center");
        doc.save("Full_Sales_History_Report.pdf");
    };
}


/* ==========================================================================
   SECTION 11: STOCK REQUISITION SYSTEM
   ========================================================================== */

window.requisitionItems = window.requisitionItems || [];

window.openProductSelector = () => {
    const list = document.getElementById("modalProductList");
    if (!list) return;

    let rowsHTML = "";
    window.productsCache.forEach(doc => {
        const p = doc.data();
        rowsHTML += `<tr>
            <td><input type="checkbox" class="prod-checkbox" value="${doc.id}"></td>
            <td>${p.name}</td>
            <td>${window.toMixedFraction(p.stock)}</td>
        </tr>`;
    });

    list.innerHTML = rowsHTML || `<tr><td colspan="3" class="text-center text-muted py-3">No products available in stock.</td></tr>`;

    const modalEl = document.getElementById("productSelectorModal");
    if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
};

const selectAllEl = document.getElementById("selectAll");
if (selectAllEl) {
    selectAllEl.onclick = (e) => {
        document.querySelectorAll(".prod-checkbox").forEach(cb => cb.checked = e.target.checked);
    };
}

const searchProdEl = document.getElementById('searchProd');
if (searchProdEl) {
    searchProdEl.oninput = (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll('#modalProductList tr').forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none';
        });
    };
}

window.addSelectedToRequisition = () => {
    const priceTypeEl = document.getElementById("priceTypeSelect");
    const priceType = priceTypeEl ? priceTypeEl.value : "sellPrice";
    const selected = document.querySelectorAll(".prod-checkbox:checked");

    selected.forEach(cb => {
        const prodDoc = window.productsCache.find(p => p.id === cb.value);
        if (prodDoc) {
            const prod = prodDoc.data();
            const defaultQty = (priceType === "sellPrice") ? (parseFloat(prod.stock) || 0) : 1;
            const price = (priceType === "buyPrice") ? (parseFloat(prod.buyPrice) || 0) : (parseFloat(prod.price) || 0);

            if (!window.requisitionItems.find(item => item.id === prodDoc.id)) {
                window.requisitionItems.push({ id: prodDoc.id, name: prod.name, qty: defaultQty, priceType, price });
            }
        }
    });
    window.renderRequisitionTable();
    const modalEl = document.getElementById("productSelectorModal");
    if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
};

window.renderRequisitionTable = () => {
    const tbody = document.getElementById("requisitionTableBody");
    const totalDisplay = document.getElementById("grandTotalValue");
    if (!tbody) return;

    tbody.innerHTML = "";
    let buyPriceTotal = 0;

    window.requisitionItems.sort((a, b) => a.name.localeCompare(b.name));

    window.requisitionItems.forEach((item, index) => {
        const subtotal = item.priceType === 'buyPrice' ? (item.price * item.qty) : 0;
        buyPriceTotal += subtotal;

        const subtotalDisplay = item.priceType === 'buyPrice' ? `KSh ${subtotal.toLocaleString()}` : "-";

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${item.name}</td>
            <td>
                <select class="form-control form-control-sm" onchange="window.updatePriceType(${index}, this.value)" style="width: 100px;">
                    <option value="sellPrice" ${item.priceType === 'sellPrice' ? 'selected' : ''}>Sell</option>
                    <option value="buyPrice" ${item.priceType === 'buyPrice' ? 'selected' : ''}>Buy</option>
                </select>
            </td>
            <td>KSh ${item.price.toLocaleString()}</td>
            <td>
                <div class="d-flex align-items-center">
                    <input type="number" step="any" class="form-control form-control-sm" value="${item.qty}" min="0.1" 
                           onchange="window.updateQty(${index}, this.value)" style="width: 60px;">
                    ${(item.qty % 1 !== 0) ? `<span class="ms-2 badge bg-secondary">${window.toMixedFraction(item.qty)}</span>` : ''}
                </div>
            </td>
            <td class="fw-bold">${subtotalDisplay}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="window.confirmRemove(${index})">Remove</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (totalDisplay) {
        totalDisplay.innerText = buyPriceTotal > 0 ? `KSh ${buyPriceTotal.toLocaleString()}` : "KSh 0";
    }
};

window.updatePriceType = (index, newType) => {
    const item = window.requisitionItems[index];
    const prodDoc = window.productsCache.find(p => p.id === item.id);
    if (!prodDoc) return;
    const prod = prodDoc.data();
    item.priceType = newType;
    item.price = newType === "buyPrice" ? (parseFloat(prod.buyPrice) || 0) : (parseFloat(prod.price) || 0);
    window.renderRequisitionTable();
};

window.updateQty = (index, newQty) => {
    const qty = parseFloat(newQty);
    if (!isNaN(qty) && qty > 0) window.requisitionItems[index].qty = qty;
    window.renderRequisitionTable();
};

window.confirmRemove = async (index) => {
    const result = await Swal.fire({ title: 'Remove item?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33' });
    if (result.isConfirmed) {
        window.requisitionItems.splice(index, 1);
        window.renderRequisitionTable();
    }
};

window.downloadRequisitionPDF = () => {
    if (window.requisitionItems.length === 0) return Swal.fire("Empty", "List is empty", "warning");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("MADOLLAR PUB STOCK REQUISITION", 105, 15, null, null, "center");
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 105, 22, null, null, "center");

    const tableData = window.requisitionItems.map((i, index) => [
        index + 1,
        i.name,
        i.priceType === 'buyPrice' ? 'Buy Price' : 'Sell Price',
        i.price.toLocaleString(),
        window.toMixedFraction(i.qty),
        i.priceType === 'buyPrice' ? (i.price * i.qty).toLocaleString() : '-'
    ]);

    const buyPriceTotal = window.requisitionItems
        .filter(i => i.priceType === 'buyPrice')
        .reduce((sum, i) => sum + (i.price * i.qty), 0);

    if (buyPriceTotal > 0) {
        tableData.push(['', '', '', '', 'TOTAL', buyPriceTotal.toLocaleString()]);
    }

    doc.autoTable({
        startY: 30,
        head: [['No.', 'Product Name', 'Price Type', 'Price (KSh)', 'Qty', 'Subtotal']],
        body: tableData,
        columnStyles: { 0: { cellWidth: 10 } }
    });
    doc.save(`Requisition_${new Date().toLocaleDateString()}.pdf`);
};


/* ==========================================================================
   SECTION 12: ADMIN STAFF MANAGEMENT MODULE
   ========================================================================== */

if (typeof window.editStaffId === 'undefined') {
    window.editStaffId = null;
}

/**
 * Opens the staff modal in "add" mode with a clean form
 */
window.openStaffModal = () => {
    if (!can("staff.manage")) return denyAccess("manage staff");
    window.editStaffId = null;
    ["staffName", "staffEmail", "staffPassword"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    const emailEl = document.getElementById("staffEmail");
    if (emailEl) emailEl.disabled = false;
    const roleEl = document.getElementById("staffRole");
    if (roleEl) roleEl.value = "staff";
    // Only a real admin can create another admin
    const adminOpt = document.querySelector('#staffRole option[value="admin"]');
    if (adminOpt) { adminOpt.disabled = !isAdmin(); adminOpt.hidden = !isAdmin(); }
    document.getElementById("staffModalTitle").textContent = "Add Staff Member";
    document.getElementById("addStaffBtn").textContent = "Save";
    bootstrap.Modal.getOrCreateInstance(document.getElementById("staffModal")).show();
};

window.saveStaffMember = async () => {
    if (!can("staff.manage")) return denyAccess("manage staff");
    const staffEmailInput = document.getElementById("staffEmail");
    const staffPasswordInput = document.getElementById("staffPassword");
    const staffNameInput = document.getElementById("staffName");
    const staffRoleInput = document.getElementById("staffRole");
    const addStaffBtn = document.getElementById("addStaffBtn");

    if (!staffEmailInput || !staffPasswordInput || !staffNameInput) {
        return Swal.fire("System Error", "Could not locate form input elements on the page.", "error");
    }

    const email = staffEmailInput.value.trim();
    const password = staffPasswordInput.value;
    const name = staffNameInput.value.trim();
    const role = staffRoleInput ? staffRoleInput.value : "staff";

    if (!email || !password || !name) {
        return Swal.fire("Missing Details", "Please fill in all staff fields completely.", "warning");
    }
    if (role === "admin" && !isAdmin()) {
        return denyAccess("create or change an administrator");
    }

    try {
        if (window.editStaffId) {
            await window.db.collection("users").doc(window.editStaffId).update({
                name: name,
                email: email,
                password: password,
                role: role
            });
            Swal.fire("Staff Updated", `Successfully modified profile details for ${name}`, "success");
            window.editStaffId = null;
            if (addStaffBtn) addStaffBtn.textContent = "Save";
        } else {
            await window.db.collection("users").doc(email.toLowerCase()).set({
                name: name,
                email: email.toLowerCase(),
                password: password,
                role: role,
                status: "active",
                createdAt: new Date()
            });
            Swal.fire("Staff Registered", `Successfully logged user profile for ${name}`, "success");
        }

        staffEmailInput.value = "";
        staffPasswordInput.value = "";
        staffNameInput.value = "";
        staffEmailInput.disabled = false;
        hideModalById("staffModal");

    } catch (error) {
        console.error("Save Staff Error:", error);
        Swal.fire("Database Error", error.message, "error");
    }
};

window.db.collection("users").onSnapshot(snap => {
    const staffTableBody = document.getElementById("staffTableBody");
    if (!staffTableBody) return;

    if (snap.empty) {
        staffTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No staff user accounts registered yet.</td></tr>`;
        return;
    }

    let rowsHTML = "";
    snap.forEach(doc => {
        const staff = doc.data();
        const isBlocked = staff.status === "blocked";

        const staffName = staff.name || "N/A";
        const staffEmail = staff.email || doc.id;
        const staffRole = staff.role || "staff";
        const staffStatus = staff.status || "active";

        rowsHTML += `
            <tr>
                <td data-label="Employee" class="fw-semibold">${staffName}</td>
                <td data-label="Email" class="text-muted">${staffEmail}</td>
                <td data-label="Role"><span class="badge rounded-pill ${staffRole === 'admin' ? 'text-bg-warning' : (staffRole === 'manager' ? 'text-bg-info' : 'text-bg-primary')}">${staffRole.toUpperCase()}</span></td>
                <td data-label="Status">
                    <span class="badge rounded-pill ${isBlocked ? 'text-bg-dark' : 'text-bg-success'}">
                        ${isBlocked ? 'BLOCKED' : 'ACTIVE'}
                    </span>
                </td>
                <td class="text-end text-nowrap">
                    <button class="btn btn-sm btn-soft" title="Edit" onclick="window.prepareStaffEdit('${doc.id}')"><i class="fas fa-pen text-primary"></i></button>
                    <button class="btn btn-sm btn-soft" title="${isBlocked ? 'Unblock' : 'Block'}" onclick="window.toggleStaffAccess('${doc.id}', '${staffStatus}')">
                        <i class="fas ${isBlocked ? 'fa-lock-open text-success' : 'fa-ban text-secondary'}"></i>
                    </button>
                    <button class="btn btn-sm btn-soft" title="Delete" onclick="window.deleteStaffUser('${doc.id}')"><i class="fas fa-trash-can text-danger"></i></button>
                </td>
            </tr>
        `;
    });
    staffTableBody.innerHTML = rowsHTML;
}, error => {
    console.error("Staff Firestore Error:", error);
    const staffTableBody = document.getElementById("staffTableBody");
    if (staffTableBody) {
        staffTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-3"><strong>Read Access Denied:</strong> ${error.message}</td></tr>`;
    }
});

window.prepareStaffEdit = async (docId) => {
    try {
        const doc = await window.db.collection("users").doc(docId).get();
        if (!doc.exists) return;
        const staff = doc.data();
        if (!can("staff.manage")) return denyAccess("manage staff");
        if ((staff.role || "staff") === "admin" && !isAdmin()) return denyAccess("change an administrator");

        window.editStaffId = docId;
        const sName = document.getElementById("staffName");
        const sEmail = document.getElementById("staffEmail");
        const sPass = document.getElementById("staffPassword");
        const sRole = document.getElementById("staffRole");

        if (sName) sName.value = staff.name || "";
        if (sEmail) { sEmail.value = staff.email || ""; sEmail.disabled = true; }
        if (sPass) sPass.value = staff.password || "";
        if (sRole) sRole.value = staff.role || "staff";

        const addStaffBtn = document.getElementById("addStaffBtn");
        if (addStaffBtn) addStaffBtn.textContent = "Update Details";
        document.getElementById("staffModalTitle").textContent = "Edit Staff Member";
        bootstrap.Modal.getOrCreateInstance(document.getElementById("staffModal")).show();
    } catch (err) {
        console.error("Error preparing staff edit:", err);
    }
};

window.toggleStaffAccess = async (docId, currentStatus) => {
    if (!can("staff.manage")) return denyAccess("manage staff");
    {
        const target = await safeGet(window.db.collection("users").doc(docId));
        if (target && target.exists && (target.data().role || "staff") === "admin" && !isAdmin()) return denyAccess("block or unblock an administrator");
    }
    try {
        const newStatus = currentStatus === "blocked" ? "active" : "blocked";
        await window.db.collection("users").doc(docId).update({ status: newStatus });
        Swal.fire("Status Updated", `Employee profile set to ${newStatus}`, "success");
    } catch (err) {
        Swal.fire("Action Error", err.message, "error");
    }
};

window.deleteStaffUser = async (docId) => {
    if (!can("staff.manage")) return denyAccess("manage staff");
    {
        const target = await safeGet(window.db.collection("users").doc(docId));
        if (target && target.exists && (target.data().role || "staff") === "admin" && !isAdmin()) return denyAccess("delete an administrator");
    }
    try {
        const res = await Swal.fire({
            title: "Remove staff profile?",
            text: "This operation cannot be undone.",
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#d33"
        });
        if (res.isConfirmed) {
            await window.db.collection("users").doc(docId).delete();
            logAudit("people", "staff_delete", `Staff account removed: ${docId}`, "", { flag: true });
            Swal.fire("Deleted", "Profile removed from database", "success");
        }
    } catch (err) {
        Swal.fire("Action Error", err.message, "error");
    }
};


/* ==========================================================================
   SECTION 12B: INSIGHTS (CHARTS), PROFIT & LOSS AND DAY CLOSING
   ========================================================================== */

const insightMoney = (n) => "KSh " + (parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escHtml = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Cost lookup used when an old sale line has no stored cost
 */
function buildCostMap() {
    const costMap = {};
    (window.productsCache || []).forEach(doc => {
        const p = doc.data();
        costMap[(p.name || "").trim().toLowerCase()] = parseFloat(p.buyPrice) || 0;
    });
    return costMap;
}

/**
 * Total cost of goods for a single sale (stored item cost first, current buy price as fallback)
 */
function saleCostOf(sale, costMap) {
    return (sale.items || []).reduce((sum, i) => {
        const unitCost = (i.cost !== undefined) ? (parseFloat(i.cost) || 0) : (costMap[(i.name || "").trim().toLowerCase()] || 0);
        return sum + unitCost * (parseFloat(i.qty) || 0);
    }, 0);
}

/* ---------------------------------------------------------------- Insights */
window.insightsRange = 30;
window.topSellersMode = "revenue";
window.insightCharts = {};

window.setInsightsRange = (days) => {
    window.insightsRange = days;
    document.querySelectorAll("#insightsRangeChips .btn").forEach(b => b.classList.toggle("active", Number(b.dataset.range) === days));
    window.renderInsights();
};

window.setTopSellersMode = (mode) => {
    window.topSellersMode = mode;
    document.querySelectorAll("#topSellersMode .btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    window.renderInsights();
};

function makeInsightChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (window.insightCharts[canvasId]) window.insightCharts[canvasId].destroy();
    window.insightCharts[canvasId] = new Chart(canvas, config);
}

window.renderInsights = () => {
    const pane = document.getElementById("insightsTab");
    if (!pane) return;

    // Charts can't size themselves inside a hidden tab, so wait until it is opened
    if (!pane.classList.contains("active")) {
        window.insightsNeedsRender = true;
        return;
    }
    window.insightsNeedsRender = false;
    if (typeof Chart === "undefined") return;

    const showProfit = can("view.profit");
    const sales = window.allSales || [];
    const costMap = buildCostMap();
    const days = window.insightsRange;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const muted = cssVar("--muted"), grid = cssVar("--line"), brand = cssVar("--brand");
    const green = cssVar("--ic-green"), ink = cssVar("--ink");
    const kFormat = (v) => (Math.abs(v) >= 1000 ? (v / 1000).toLocaleString() + "k" : v);

    Chart.defaults.color = muted;
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";

    // ---- bucket sales per day
    const hourRev = new Array(24).fill(0), hourOrders = new Array(24).fill(0);
    const dowRev = new Array(7).fill(0), dowOrders = new Array(7).fill(0), dowCount = new Array(7).fill(0);
    const labels = [], revenue = [], profit = [], dayIndex = {};
    for (let i = 0; i < days; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dayIndex[d.toLocaleDateString("en-CA")] = i;
        dowCount[d.getDay()]++;
        labels.push(d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
        revenue.push(0);
        profit.push(0);
    }

    let totalRevenue = 0, totalProfit = 0, orders = 0, units = 0;
    const products = {};

    sales.forEach(s => {
        const d = s.date.toDate();
        if (d < start) return;
        const i = dayIndex[d.toLocaleDateString("en-CA")];
        if (i === undefined) return;

        const total = parseFloat(s.total) || 0;
        hourRev[d.getHours()] += total; hourOrders[d.getHours()]++;
        dowRev[d.getDay()] += total; dowOrders[d.getDay()]++;
        const gain = total - saleCostOf(s, costMap);
        revenue[i] += total;
        profit[i] += gain;
        totalRevenue += total;
        totalProfit += gain;
        orders++;

        (s.items || []).forEach(it => {
            const q = parseFloat(it.qty) || 0;          // as sold (bottles or tots): used for money
            const bq = itemStockQty(it);                // in bottles: used for units
            units += bq;
            const p = products[it.name] || (products[it.name] = { qty: 0, revenue: 0, cost: 0 });
            p.qty += bq;
            p.revenue += (parseFloat(it.price) || 0) * q;
            p.cost += ((it.cost !== undefined) ? (parseFloat(it.cost) || 0) : (costMap[(it.name || "").trim().toLowerCase()] || 0)) * q;
        });
    });

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText("kpiRevenue", insightMoney(totalRevenue));
    setText("kpiOrders", orders.toLocaleString());
    setText("kpiAvg", insightMoney(orders ? totalRevenue / orders : 0));
    setText("kpiUnits", window.toMixedFraction(units));
    setText("kpiProfit", insightMoney(totalProfit));
    setText("trendTitle", `Sales trend · last ${days} days`);

    const baseScales = {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, color: muted } },
        y: { beginAtZero: true, grid: { color: grid }, ticks: { color: muted, callback: kFormat } }
    };

    // ---- sales trend (line)
    const datasets = [{
        label: "Sales",
        data: revenue,
        borderColor: brand,
        backgroundColor: brand + "26",
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: days <= 14 ? 3 : 0,
        pointHoverRadius: 5
    }];
    if (showProfit) {
        datasets.push({
            label: "Profit",
            data: profit,
            borderColor: green,
            backgroundColor: "transparent",
            tension: 0.35,
            borderWidth: 2,
            pointRadius: days <= 14 ? 3 : 0,
            pointHoverRadius: 5
        });
    }
    makeInsightChart("salesTrendChart", {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: showProfit, labels: { color: ink, usePointStyle: true, boxWidth: 8 } },
                tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${insightMoney(ctx.parsed.y)}` } }
            },
            scales: baseScales
        }
    });

    // ---- top 10 sellers (horizontal bar)
    const mode = window.topSellersMode;
    const top = Object.entries(products).sort((a, b) => b[1][mode] - a[1][mode]).slice(0, 10);
    makeInsightChart("topSellersChart", {
        type: "bar",
        data: {
            labels: top.map(([n]) => (n.length > 24 ? n.slice(0, 23) + "…" : n)),
            datasets: [{
                label: mode === "qty" ? "Units sold" : "Sales (KSh)",
                data: top.map(([, v]) => v[mode]),
                backgroundColor: brand,
                borderRadius: 6,
                maxBarThickness: 22
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => top[items[0].dataIndex][0],
                        label: (ctx) => {
                            const [, v] = top[ctx.dataIndex];
                            return mode === "qty"
                                ? ` ${window.toMixedFraction(v.qty)} units · ${insightMoney(v.revenue)}`
                                : ` ${insightMoney(v.revenue)} · ${window.toMixedFraction(v.qty)} units`;
                        }
                    }
                }
            },
            scales: {
                x: { beginAtZero: true, grid: { color: grid }, ticks: { color: muted, callback: kFormat } },
                y: { grid: { display: false }, ticks: { color: ink, font: { size: 11 } } }
            }
        }
    });

    if (showProfit) {
        renderProfitAndLoss(sales, costMap, { muted, grid, brand, green, kFormat });
        renderProductProfit(products, days);
    }
    window.renderBusyTimes({ hourRev, hourOrders, dowRev, dowOrders, dowCount, colors: { muted, grid, brand, green, ink }, kFormat, days });
    window.renderSmartWarnings();
};

/* ------------------------------------------------------------ Profit & loss */
function renderProfitAndLoss(sales, costMap, c) {
    const months = {};
    sales.forEach(s => {
        const d = s.date.toDate();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const m = months[key] || (months[key] = {
            key,
            label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
            short: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
            revenue: 0, cost: 0, orders: 0
        });
        m.revenue += parseFloat(s.total) || 0;
        m.cost += saleCostOf(s, costMap);
        m.orders++;
    });

    const list = Object.values(months).sort((a, b) => b.key.localeCompare(a.key));
    const body = document.getElementById("plTableBody");
    const foot = document.getElementById("plTableFoot");
    if (!body || !foot) return;

    if (list.length === 0) {
        body.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-chart-pie"></i>No sales recorded yet.</div></td></tr>`;
        foot.innerHTML = "";
    } else {
        const nowKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
        const best = list.reduce((a, b) => ((b.revenue - b.cost) > (a.revenue - a.cost) ? b : a));
        const tot = { revenue: 0, cost: 0, orders: 0 };

        body.innerHTML = list.map(m => {
            const gain = m.revenue - m.cost;
            const margin = m.revenue ? (gain / m.revenue) * 100 : 0;
            tot.revenue += m.revenue; tot.cost += m.cost; tot.orders += m.orders;
            return `
                <tr>
                    <td class="fw-semibold">${m.label}
                        ${m.key === nowKey ? '<span class="badge text-bg-light border ms-1">in progress</span>' : ''}
                        ${m.key === best.key && list.length > 1 ? '<span class="badge ms-1" style="background:var(--brand);color:var(--brand-ink)">best</span>' : ''}
                    </td>
                    <td class="text-end">${m.orders.toLocaleString()}</td>
                    <td class="text-end">${insightMoney(m.revenue)}</td>
                    <td class="text-end text-muted">${insightMoney(m.cost)}</td>
                    <td class="text-end fw-bold ${gain >= 0 ? 'text-success' : 'text-danger'}">${insightMoney(gain)}</td>
                    <td class="text-end">${margin.toFixed(1)}%</td>
                </tr>`;
        }).join("");

        const totGain = tot.revenue - tot.cost;
        foot.innerHTML = `
            <tr>
                <th>Total</th>
                <th class="text-end">${tot.orders.toLocaleString()}</th>
                <th class="text-end">${insightMoney(tot.revenue)}</th>
                <th class="text-end">${insightMoney(tot.cost)}</th>
                <th class="text-end">${insightMoney(totGain)}</th>
                <th class="text-end">${(tot.revenue ? (totGain / tot.revenue) * 100 : 0).toFixed(1)}%</th>
            </tr>`;
    }

    const recent = list.slice(0, 6).reverse();
    makeInsightChart("plChart", {
        type: "bar",
        data: {
            labels: recent.map(m => m.short),
            datasets: [
                { label: "Sales", data: recent.map(m => m.revenue), backgroundColor: c.brand, borderRadius: 6, maxBarThickness: 28 },
                { label: "Cost of goods", data: recent.map(m => m.cost), backgroundColor: c.muted, borderRadius: 6, maxBarThickness: 28 },
                { label: "Gross profit", data: recent.map(m => m.revenue - m.cost), backgroundColor: c.green, borderRadius: 6, maxBarThickness: 28 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { labels: { color: cssVar("--ink"), usePointStyle: true, boxWidth: 8 } },
                tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${insightMoney(ctx.parsed.y)}` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: c.muted } },
                y: { beginAtZero: true, grid: { color: c.grid }, ticks: { color: c.muted, callback: c.kFormat } }
            }
        }
    });
}

/* --------------------------------------------------------------- Day closing */
window.dayClosings = {};

function paymentBucket(method) {
    const v = (method || "Cash").toString().trim().toLowerCase();
    if (v === "cash") return "cash";
    if (v.includes("mpesa") || v.includes("m-pesa")) return "mpesa";
    if (v === "card") return "card";
    if (v.includes("bank")) return "bank";
    if (v === "credit") return "credit";
    return "other";
}

function computeDaySummary(dateValue) {
    const day = new Date(dateValue + "T00:00:00");
    const dayKey = day.toDateString();
    const buckets = {
        cash: { label: "Cash", amount: 0, count: 0 },
        mpesa: { label: "M-PESA", amount: 0, count: 0 },
        card: { label: "Card", amount: 0, count: 0 },
        bank: { label: "Bank Transfer", amount: 0, count: 0 },
        credit: { label: "On credit (not paid yet)", amount: 0, count: 0 },
        other: { label: "Other", amount: 0, count: 0 }
    };
    let total = 0, count = 0;

    (window.allSales || []).forEach(s => {
        if (s.date.toDate().toDateString() !== dayKey) return;
        const b = buckets[paymentBucket(s.payment)];
        const amt = parseFloat(s.total) || 0;
        b.amount += amt;
        b.count++;
        total += amt;
        count++;
    });

    // Money received that day from customers paying off their tabs
    const creditPaid = { cash: 0, other: 0, total: 0, count: 0 };
    (window.creditPayments || []).forEach(p => {
        if (p.dateKey !== dateValue) return;
        const amt = parseFloat(p.amount) || 0;
        creditPaid.total += amt;
        creditPaid.count++;
        if (paymentBucket(p.method) === "cash") creditPaid.cash += amt; else creditPaid.other += amt;
    });

    // Cash handed back that day for sales made on an earlier day (refunds of today's own sales are already inside today's sales)
    let refundsOut = 0, refundsOutCount = 0;
    (window.refundsList || []).forEach(r => {
        if (r.dateKey !== dateValue || r.saleDateKey === dateValue) return;
        if (paymentBucket(r.method) !== "cash") return;
        refundsOut += parseFloat(r.amount) || 0;
        refundsOutCount++;
    });

    return {
        dateKey: dateValue,
        label: day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
        buckets, total, count, creditPaid, refundsOut: round2(refundsOut), refundsOutCount
    };
}

window.openCloseDayModal = () => {
    if (!can("closeday.do")) return denyAccess("close the day");
    document.getElementById("closeDayDate").value = new Date().toLocaleDateString("en-CA");
    document.getElementById("closeDayFloat").value = "";
    document.getElementById("closeDayCounted").value = "";
    document.getElementById("closeDayNotes").value = "";
    window.updateCloseDaySummary();
    // Cashiers count blind: only admins see the sales breakdown, expected cash and the difference
    document.getElementById("closeDayStaffHint").classList.toggle("d-none", can("closeday.seeResult"));
    bootstrap.Modal.getOrCreateInstance(document.getElementById("closeDayModal")).show();
};

window.updateCloseDaySummary = () => {
    const dateValue = document.getElementById("closeDayDate").value;
    if (!dateValue) return;

    const sum = computeDaySummary(dateValue);
    const openingFloat = parseFloat(document.getElementById("closeDayFloat").value) || 0;
    const countedRaw = document.getElementById("closeDayCounted").value;

    const rows = Object.values(sum.buckets)
        .filter(b => b.count > 0 || ["Cash", "M-PESA", "Card", "Bank Transfer"].includes(b.label))
        .map(b => `
            <div class="cd-row">
                <span>${b.label}<small>${b.count} sale${b.count === 1 ? "" : "s"}</small></span>
                <strong>${insightMoney(b.amount)}</strong>
            </div>`).join("");
    document.getElementById("closeDayBreakdown").innerHTML = rows + `
        <div class="cd-row cd-total">
            <span>Total sales<small>${sum.count} sale${sum.count === 1 ? "" : "s"}</small></span>
            <strong>${insightMoney(sum.total)}</strong>
        </div>` + (sum.creditPaid.count > 0 ? `
        <div class="cd-row">
            <span>Credit repayments received<small>${sum.creditPaid.count} payment${sum.creditPaid.count === 1 ? "" : "s"} · cash ${insightMoney(sum.creditPaid.cash)}</small></span>
            <strong>${insightMoney(sum.creditPaid.total)}</strong>
        </div>` : "") + (sum.refundsOutCount > 0 ? `
        <div class="cd-row">
            <span>Cash refunded for earlier sales<small>${sum.refundsOutCount} refund${sum.refundsOutCount === 1 ? "" : "s"}</small></span>
            <strong>− ${insightMoney(sum.refundsOut)}</strong>
        </div>` : "");

    const expected = openingFloat + sum.buckets.cash.amount + sum.creditPaid.cash - sum.refundsOut;
    document.getElementById("closeDayExpected").textContent = insightMoney(expected);

    const diffEl = document.getElementById("closeDayDiff");
    if (countedRaw === "") {
        diffEl.innerHTML = `<span class="cd-pill">Enter the cash you counted</span>`;
    } else {
        const diff = Math.round(((parseFloat(countedRaw) || 0) - expected) * 100) / 100;
        if (diff === 0) diffEl.innerHTML = `<span class="cd-pill ok"><i class="fas fa-circle-check me-1"></i>Balanced</span>`;
        else if (diff < 0) diffEl.innerHTML = `<span class="cd-pill bad"><i class="fas fa-triangle-exclamation me-1"></i>Short by ${insightMoney(Math.abs(diff))}</span>`;
        else diffEl.innerHTML = `<span class="cd-pill warn"><i class="fas fa-circle-info me-1"></i>Over by ${insightMoney(diff)}</span>`;
    }

    const existing = window.dayClosings[dateValue];
    const notice = document.getElementById("closeDayExisting");
    if (existing) {
        notice.classList.remove("d-none");
        notice.innerHTML = `<i class="fas fa-lock me-1"></i>This day was already closed by <strong>${escHtml(existing.closedBy || "unknown")}</strong>${can("closeday.replace") ? " — saving will replace that record." : ". You are not allowed to change it."}`;
    } else {
        notice.classList.add("d-none");
    }
};

["closeDayDate", "closeDayFloat", "closeDayCounted"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => window.updateCloseDaySummary());
});

window.saveDayClosing = async () => {
    if (!can("closeday.do")) return denyAccess("close the day");
    const dateValue = document.getElementById("closeDayDate").value;
    const countedRaw = document.getElementById("closeDayCounted").value;
    if (!dateValue) return Swal.fire("Pick a date", "Choose the day you are closing.", "warning");
    if (countedRaw === "" || parseFloat(countedRaw) < 0) {
        return Swal.fire("Cash count needed", "Enter the cash you actually counted in the till.", "warning");
    }

    const sum = computeDaySummary(dateValue);
    const openingFloat = parseFloat(document.getElementById("closeDayFloat").value) || 0;
    const counted = parseFloat(countedRaw) || 0;
    const expected = openingFloat + sum.buckets.cash.amount + sum.creditPaid.cash - sum.refundsOut;
    const difference = Math.round((counted - expected) * 100) / 100;
    const ref = window.db.collection("day_closings").doc(dateValue);

    try {
        const existing = await safeGet(ref);
        if (existing && existing.exists) {
            if (!can("closeday.replace")) {
                return Swal.fire("Already closed", `This day was already closed by ${existing.data().closedBy || "someone"}. Ask an admin to change it.`, "info");
            }
            const ok = await Swal.fire({
                title: "Replace existing closing?",
                text: `${sum.label} was already closed by ${existing.data().closedBy || "someone"}. Saving will overwrite it.`,
                icon: "warning",
                showCancelButton: true,
                confirmButtonText: "Yes, replace"
            });
            if (!ok.isConfirmed) return;
        }

        await writeWithGrace(ref.set({
            dateKey: dateValue,
            dateLabel: sum.label,
            openingFloat,
            cashSales: sum.buckets.cash.amount,
            mpesaSales: sum.buckets.mpesa.amount,
            cardSales: sum.buckets.card.amount,
            bankSales: sum.buckets.bank.amount,
            otherSales: sum.buckets.other.amount,
            creditSales: sum.buckets.credit.amount,
            creditRepaymentsCash: sum.creditPaid.cash,
            creditRepaymentsTotal: sum.creditPaid.total,
            totalSales: sum.total,
            salesCount: sum.count,
            expectedCash: expected,
            countedCash: counted,
            difference,
            notes: document.getElementById("closeDayNotes").value.trim(),
            closedBy: getCurrentUserEmail() || "unknown",
            closedAt: firebase.firestore.FieldValue.serverTimestamp()
        }));

        hideModalById("closeDayModal");
        try {
            window.notifyDayClose({
                label: sum.label, total: sum.total, expected, counted, difference,
                closedBy: getCurrentUserEmail() || "unknown"
            });
        } catch (alertErr) {
            console.warn("Day close alert failed:", alertErr);
        }
        const msg = difference === 0 ? "Cash balanced perfectly."
            : difference < 0 ? `Cash is short by ${insightMoney(Math.abs(difference))}.`
            : `Cash is over by ${insightMoney(difference)}.`;
        if (can("closeday.seeResult")) {
            Swal.fire({
                icon: difference === 0 ? "success" : "warning",
                title: "Day closed",
                text: `${sum.label} saved. ${msg}`
            });
        } else {
            Swal.fire({
                icon: "success",
                title: "Day closed",
                text: `Your cash count of ${insightMoney(counted)} for ${sum.label} has been submitted.`
            });
        }
    } catch (err) {
        console.error("Day closing error:", err);
        Swal.fire("Could not save closing", err.message + " (If this says permission denied, allow read/write on the 'day_closings' collection in your Firestore rules.)", "error");
    }
};

window.renderDayClosings = () => {
    const body = document.getElementById("dayClosingsBody");
    if (!body) return;

    const list = Object.values(window.dayClosings).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    if (list.length === 0) {
        body.innerHTML = `<tr><td colspan="9"><div class="empty-state"><i class="fas fa-calendar-check"></i>No days have been closed yet.</div></td></tr>`;
        return;
    }

    const admin = can("closeday.delete");
    body.innerHTML = list.map(c => {
        const diff = Math.round((parseFloat(c.difference) || 0) * 100) / 100;
        const pill = diff === 0 ? `<span class="cd-pill ok">Balanced</span>`
            : diff < 0 ? `<span class="cd-pill bad">Short ${insightMoney(Math.abs(diff))}</span>`
            : `<span class="cd-pill warn">Over ${insightMoney(diff)}</span>`;
        return `
            <tr>
                <td class="fw-semibold text-nowrap">${escHtml(c.dateLabel || c.dateKey)}</td>
                <td class="text-muted">${escHtml(c.closedBy || "")}</td>
                <td class="text-end">${insightMoney(c.totalSales)}</td>
                <td class="text-end">${insightMoney(c.expectedCash)}</td>
                <td class="text-end">${insightMoney(c.countedCash)}</td>
                <td class="text-end">${pill}</td>
                <td class="text-center">${c.notes ? `<i class="fas fa-note-sticky text-muted" title="${escHtml(c.notes)}"></i>` : ""}</td>
                <td class="text-end">${admin ? `<button class="btn btn-soft btn-sm" title="Delete closing" onclick="window.deleteDayClosing('${escHtml(c.id)}')"><i class="fas fa-trash-can text-danger"></i></button>` : ""}</td>
            </tr>`;
    }).join("");
};

window.deleteDayClosing = async (id) => {
    if (!can("closeday.delete")) return denyAccess("delete closings");
    const res = await Swal.fire({
        title: "Delete this closing?",
        text: "The day will be open again and can be closed once more.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        confirmButtonText: "Yes, delete"
    });
    if (!res.isConfirmed) return;
    try {
        const was = window.dayClosings && window.dayClosings[id];
        await window.db.collection("day_closings").doc(id).delete();
        logAudit("money", "closing_delete", `Day closing deleted: ${id}`,
            was ? `It had been closed by ${was.closedBy || "unknown"}: counted ${insightMoney(was.countedCash)}, expected ${insightMoney(was.expectedCash)}` : "", { flag: true });
    } catch (err) {
        Swal.fire("Error", err.message, "error");
    }
};

window.db.collection("day_closings").orderBy("closedAt", "desc").limit(60).onSnapshot(snap => {
    window.dayClosings = {};
    snap.forEach(d => { window.dayClosings[d.id] = { id: d.id, ...d.data() }; });
    window.renderDayClosings();
    const modalEl = document.getElementById("closeDayModal");
    if (modalEl && modalEl.classList.contains("show")) window.updateCloseDaySummary();
}, err => {
    console.warn("Day closings listener:", err);
    const body = document.getElementById("dayClosingsBody");
    if (body) body.innerHTML = `<tr><td colspan="9"><div class="empty-state"><i class="fas fa-lock"></i>Could not load closings (${escHtml(err.message)}).</div></td></tr>`;
});


/* ==========================================================================
   SECTION 12D: PROFIT PER PRODUCT, REORDER SUGGESTIONS AND STOCK TAKE
   ========================================================================== */

/* ------------------------------------------------------- Profit per product */
window.ppSort = { key: "profit", dir: -1 };
window.ppFilter = "all";
window.ppLimit = 30;
window.ppRows = [];

const PP_VERDICTS = {
    star: {
        label: "Star seller", cls: "ok", hint: "Sells well and earns well",
        meaning: "Sells well and earns well.",
        action: "Never run out of it. Keep it in front."
    },
    volume: {
        label: "Busy, low profit", cls: "warn", hint: "Sells a lot but earns little per sale",
        meaning: "Customers buy a lot, but each sale leaves little profit.",
        action: "Try a small price increase, or find a cheaper supplier."
    },
    margin: {
        label: "High margin, slow", cls: "info", hint: "Earns well but sells slowly",
        meaning: "Earns well on each sale, but few are sold.",
        action: "Promote it: display it and suggest it to customers."
    },
    low: {
        label: "Low performer", cls: "bad", hint: "Sells slowly and earns little",
        meaning: "Sells slowly and earns little.",
        action: "Order less of it, or stop stocking it."
    },
    none: {
        label: "No sales", cls: "", hint: "Not sold in this period",
        meaning: "Nothing was sold in this period.",
        action: "Check if it is stuck on the shelf, then discount it or stop ordering."
    }
};

function normName(n) { return String(n || "").trim().toLowerCase(); }

function medianOf(values) {
    const a = values.slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Builds one row per product (including products with no sales) and a verdict for each
 */
function buildProductProfitRows(sold, products) {
    const byNorm = {};
    Object.keys(sold).forEach(name => { byNorm[normName(name)] = sold[name]; });

    const rows = [];
    const used = new Set();

    (products || []).forEach(doc => {
        const p = doc.data();
        const key = normName(p.name);
        used.add(key);
        const s = byNorm[key];
        const price = parseFloat(p.price) || 0;
        const buy = parseFloat(p.buyPrice) || 0;
        const units = s ? s.qty : 0;
        const revenue = s ? s.revenue : 0;
        const cost = s ? s.cost : 0;
        const profit = revenue - cost;
        const margin = revenue > 0 ? (profit / revenue) * 100 : (price > 0 ? ((price - buy) / price) * 100 : 0);
        rows.push({ name: p.name || "", category: (p.category || "").trim(), units, revenue, cost, profit, margin, perUnit: units > 0 ? profit / units : price - buy, stock: parseFloat(p.stock) || 0 });
    });

    // Products that were sold but have since been deleted still count towards the picture
    Object.keys(sold).forEach(name => {
        if (used.has(normName(name))) return;
        const s = sold[name];
        const profit = s.revenue - s.cost;
        rows.push({ name: name + " (removed)", units: s.qty, revenue: s.revenue, cost: s.cost, profit, margin: s.revenue > 0 ? (profit / s.revenue) * 100 : 0, perUnit: s.qty > 0 ? profit / s.qty : 0, stock: 0 });
    });

    const sellers = rows.filter(r => r.units > 0);
    const medUnits = medianOf(sellers.map(r => r.units));
    const medMargin = medianOf(sellers.map(r => r.margin));
    rows.forEach(r => {
        if (r.units === 0) r.verdict = "none";
        else if (r.units >= medUnits) r.verdict = r.margin >= medMargin ? "star" : "volume";
        else r.verdict = r.margin >= medMargin ? "margin" : "low";
    });
    return rows;
}

function renderProductProfit(sold, days) {
    window.ppRows = buildProductProfitRows(sold, window.productsCache);
    window.ppPeriod = days;
    drawProductProfit();
    renderCategoryProfit();
}

function drawProductProfit() {
    const body = document.getElementById("ppBody");
    if (!body) return;

    const rows = window.ppRows || [];
    const search = normName((document.getElementById("ppSearch") || {}).value);
    const counts = { all: rows.length, star: 0, volume: 0, margin: 0, low: 0, none: 0 };
    rows.forEach(r => counts[r.verdict]++);

    const chips = document.getElementById("ppChips");
    if (chips) {
        const defs = [["all", "All"], ["star", PP_VERDICTS.star.label], ["volume", PP_VERDICTS.volume.label], ["margin", PP_VERDICTS.margin.label], ["low", PP_VERDICTS.low.label], ["none", PP_VERDICTS.none.label]];
        chips.innerHTML = defs.map(([k, label]) =>
            `<button class="btn btn-soft btn-sm ${window.ppFilter === k ? "active" : ""}" onclick="window.setProductProfitFilter('${k}')" title="${k === "all" ? "" : PP_VERDICTS[k].hint}">${label} <span class="pp-count">${counts[k]}</span></button>`).join("");
    }

    let list = rows.filter(r => (window.ppFilter === "all" || r.verdict === window.ppFilter) && (!search || normName(r.name).includes(search)));
    const { key, dir } = window.ppSort;
    list.sort((a, b) => key === "name" ? dir * a.name.localeCompare(b.name) : dir * ((a[key] || 0) - (b[key] || 0)));

    const maxProfit = Math.max(1, ...rows.map(r => r.profit));
    const shown = list.slice(0, window.ppLimit);

    body.innerHTML = shown.length ? shown.map(r => {
        const v = PP_VERDICTS[r.verdict];
        const barPct = r.profit > 0 ? Math.max(3, (r.profit / maxProfit) * 100) : 0;
        return `
            <tr>
                <td class="fw-semibold">${r.name}</td>
                <td class="text-end">${window.toMixedFraction(r.units)}</td>
                <td class="text-end">${insightMoney(r.revenue)}</td>
                <td class="text-end text-muted">${insightMoney(r.cost)}</td>
                <td class="text-end">
                    <div class="fw-bold ${r.profit >= 0 ? "text-success" : "text-danger"}">${insightMoney(r.profit)}</div>
                    <div class="pp-bar"><span style="width:${barPct}%"></span></div>
                </td>
                <td class="text-end">${r.margin.toFixed(1)}%</td>
                <td class="text-end text-muted">${r.units > 0 ? insightMoney(r.perUnit) : "-"}</td>
                <td><span class="pp-tag ${v.cls}" title="${v.hint}">${v.label}</span></td>
                <td class="pp-advice">
                    <div class="pp-meaning">${v.meaning}${r.verdict === "none" && r.stock > 0 ? ` <b>${window.toMixedFraction(r.stock)} in stock.</b>` : ""}</div>
                    <div class="pp-action"><i class="fas fa-lightbulb me-1"></i>${v.action}</div>
                </td>
            </tr>`;
    }).join("") : `<tr><td colspan="9"><div class="empty-state"><i class="fas fa-magnifying-glass-chart"></i>No products match.</div></td></tr>`;

    document.querySelectorAll("#ppTable th[data-sort]").forEach(th => {
        th.classList.toggle("sorted", th.dataset.sort === key);
        th.dataset.dir = th.dataset.sort === key ? (dir === 1 ? "asc" : "desc") : "";
    });

    const more = document.getElementById("ppMore");
    if (more) {
        more.innerHTML = `<span class="text-muted small">Showing ${shown.length} of ${list.length} products · last ${window.ppPeriod || 30} days</span>` +
            (list.length > shown.length ? ` <button class="btn btn-custom btn-sm ms-2" onclick="window.showMoreProductProfit()">Show more</button>` : "");
    }
}

window.sortProductProfit = (key) => {
    window.ppSort = window.ppSort.key === key
        ? { key, dir: -window.ppSort.dir }
        : { key, dir: key === "name" ? 1 : -1 };
    drawProductProfit();
};
window.setProductProfitFilter = (f) => { window.ppFilter = f; window.ppLimit = 30; drawProductProfit(); };
window.showMoreProductProfit = () => { window.ppLimit += 30; drawProductProfit(); };

(function bindProductProfitSearch() {
    const el = document.getElementById("ppSearch");
    if (el) el.addEventListener("input", () => { window.ppLimit = 30; drawProductProfit(); });
})();


/* ------------------------------------------------------ Reorder suggestions */
window.reorderList = [];

/**
 * For every product: how fast it sells (last 30 days) -> how many to order to cover N days
 */
function computeReorderList(coverDays) {
    const sold = {};
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    (window.allSales || []).forEach(s => {
        if (s.date.toDate().getTime() < since) return;
        (s.items || []).forEach(i => {
            const k = normName(i.name);
            sold[k] = (sold[k] || 0) + itemStockQty(i);
        });
    });

    const list = [];
    (window.productsCache || []).forEach(doc => {
        const p = doc.data();
        const stock = parseFloat(p.stock) || 0;
        const min = parseFloat(p.min) || 0;
        const buy = parseFloat(p.buyPrice) || 0;
        const qty30 = sold[normName(p.name)] || 0;
        const rate = qty30 / 30;

        let need = rate * coverDays + min - stock;
        if (rate === 0 && stock <= min) need = min * 2 - stock;
        const qty = Math.ceil(need - 1e-9);
        if (qty <= 0) return;

        list.push({ id: doc.id, name: p.name || "", stock, min, qty30, rate, daysLeft: rate > 0 ? stock / rate : null, qty, buy, selected: true });
    });

    list.sort((a, b) => (a.daysLeft === null ? 9999 : a.daysLeft) - (b.daysLeft === null ? 9999 : b.daysLeft));
    return list;
}

window.openReorderModal = () => {
    if (!can("requisition.use")) return denyAccess("use reorder suggestions");
    document.getElementById("reorderDays").value = "14";
    window.renderReorderList();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("reorderModal")).show();
};

window.renderReorderList = () => {
    const cover = parseInt(document.getElementById("reorderDays").value) || 14;
    window.reorderList = computeReorderList(cover);
    const body = document.getElementById("reorderBody");

    body.innerHTML = window.reorderList.length ? window.reorderList.map((r, i) => {
        const urgency = r.daysLeft === null ? "" : (r.daysLeft <= 3 ? "bad" : (r.daysLeft <= 7 ? "warn" : "ok"));
        return `
            <tr>
                <td><input type="checkbox" class="form-check-input" ${r.selected ? "checked" : ""} onchange="window.toggleReorderRow(${i}, this.checked)"></td>
                <td class="fw-semibold">${r.name}</td>
                <td class="text-end">${window.toMixedFraction(r.stock)}</td>
                <td class="text-end">${window.toMixedFraction(r.qty30)}</td>
                <td class="text-end">${r.daysLeft === null ? '<span class="text-muted">-</span>' : `<span class="pp-tag ${urgency}">${r.daysLeft < 1 ? "<1" : Math.round(r.daysLeft)} d</span>`}</td>
                <td class="text-end" style="width:110px"><input type="number" min="0" step="1" class="form-control form-control-sm text-end" value="${r.qty}" onchange="window.updateReorderRow(${i}, this.value)"></td>
                <td class="text-end text-muted" id="reorderCost-${i}">${insightMoney(r.qty * r.buy)}</td>
            </tr>`;
    }).join("") : `<tr><td colspan="7"><div class="empty-state"><i class="fas fa-circle-check"></i>Nothing needs ordering right now.</div></td></tr>`;

    updateReorderTotals();
};

function updateReorderTotals() {
    const chosen = window.reorderList.filter(r => r.selected && r.qty > 0);
    document.getElementById("reorderCount").textContent = `${chosen.length} item${chosen.length === 1 ? "" : "s"} selected`;
    document.getElementById("reorderTotal").textContent = insightMoney(chosen.reduce((n, r) => n + r.qty * r.buy, 0));
}

window.toggleReorderRow = (i, checked) => { window.reorderList[i].selected = checked; updateReorderTotals(); };
window.toggleAllReorder = (checked) => {
    window.reorderList.forEach(r => { r.selected = checked; });
    window.renderReorderListKeep();
};
window.renderReorderListKeep = () => {
    // redraw checkboxes without recomputing (keeps any quantities the admin edited)
    const body = document.getElementById("reorderBody");
    body.querySelectorAll("input[type=checkbox]").forEach((cb, i) => { cb.checked = window.reorderList[i].selected; });
    updateReorderTotals();
};
window.updateReorderRow = (i, value) => {
    const r = window.reorderList[i];
    r.qty = Math.max(0, Math.ceil(parseFloat(value) || 0));
    const cost = document.getElementById(`reorderCost-${i}`);
    if (cost) cost.textContent = insightMoney(r.qty * r.buy);
    updateReorderTotals();
};

window.addReorderToRequisition = () => {
    const chosen = window.reorderList.filter(r => r.selected && r.qty > 0);
    if (!chosen.length) return Swal.fire("Nothing selected", "Tick the products you want to order.", "warning");

    chosen.forEach(r => {
        const existing = window.requisitionItems.find(item => item.id === r.id);
        if (existing) {
            existing.qty = r.qty;
            existing.priceType = "buyPrice";
            existing.price = r.buy;
        } else {
            window.requisitionItems.push({ id: r.id, name: r.name, qty: r.qty, priceType: "buyPrice", price: r.buy });
        }
    });
    window.renderRequisitionTable();
    hideModalById("reorderModal");

    const tabBtn = document.querySelector('[data-bs-target="#requisitionTab"]');
    if (tabBtn) bootstrap.Tab.getOrCreateInstance(tabBtn).show();
    Swal.fire({ toast: true, position: "top", icon: "success", title: `${chosen.length} item${chosen.length === 1 ? "" : "s"} added to the requisition`, timer: 2500, showConfirmButton: false });
};


/* ---------------------------------------------------------------- Stock take */
window.stockTakes = [];

window.openStockTakeModal = () => {
    if (!can("stocktake.count")) return denyAccess("do a stock take");
    const admin = can("stocktake.seeSystem");   // off = they count blind
    const docs = (window.productsCache || []).slice().sort((a, b) => (a.data().name || "").localeCompare(b.data().name || ""));

    document.getElementById("stSystemHead").classList.toggle("d-none", !admin);
    document.getElementById("stBody").innerHTML = docs.map(doc => {
        const p = doc.data();
        return `
            <tr data-name="${normName(p.name)}">
                <td class="fw-semibold">${p.name}</td>
                <td class="text-end text-muted ${admin ? "" : "d-none"}">${window.toMixedFraction(p.stock)}</td>
                <td style="width:130px"><input type="number" step="any" min="0" inputmode="decimal" class="form-control form-control-sm text-end st-input" data-id="${doc.id}" placeholder="-"></td>
            </tr>`;
    }).join("") || `<tr><td colspan="3"><div class="empty-state"><i class="fas fa-boxes-stacked"></i>No products to count.</div></td></tr>`;

    document.getElementById("stSearch").value = "";
    document.getElementById("stNotes").value = "";
    document.getElementById("stHint").classList.toggle("d-none", admin);
    updateStockTakeProgress();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("stockTakeModal")).show();
};

function updateStockTakeProgress() {
    const inputs = document.querySelectorAll("#stBody .st-input");
    const counted = [...inputs].filter(i => i.value !== "").length;
    document.getElementById("stProgress").textContent = `${counted} of ${inputs.length} counted`;
}

(function bindStockTakeInputs() {
    const body = document.getElementById("stBody");
    if (body) body.addEventListener("input", updateStockTakeProgress);
    const search = document.getElementById("stSearch");
    if (search) {
        search.addEventListener("input", () => {
            const term = normName(search.value);
            document.querySelectorAll("#stBody tr").forEach(row => {
                row.style.display = !term || (row.dataset.name || "").includes(term) ? "" : "none";
            });
        });
    }
})();

window.saveStockTake = async () => {
    const inputs = [...document.querySelectorAll("#stBody .st-input")].filter(i => i.value !== "");
    if (!inputs.length) return Swal.fire("Nothing counted", "Enter the counted quantity for at least one product.", "warning");

    const items = inputs.map(inp => {
        const doc = window.productsCache.find(d => d.id === inp.dataset.id);
        const p = doc.data();
        const system = parseFloat(p.stock) || 0;
        const counted = parseFloat(inp.value) || 0;
        const diff = Math.round((counted - system) * 1000) / 1000;
        const unitCost = parseFloat(p.buyPrice) || 0;
        return { id: doc.id, name: p.name, system, counted, diff, unitCost, valueDiff: Math.round(diff * unitCost * 100) / 100 };
    });

    const short = items.filter(i => i.diff < 0);
    const over = items.filter(i => i.diff > 0);
    const valueShort = Math.abs(short.reduce((n, i) => n + i.valueDiff, 0));
    const valueOver = over.reduce((n, i) => n + i.valueDiff, 0);

    const confirm = await Swal.fire({
        title: "Submit stock count?",
        text: `${items.length} product${items.length === 1 ? "" : "s"} counted. Products you left blank are not included.`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Submit count"
    });
    if (!confirm.isConfirmed) return;

    const by = getCurrentUserEmail() || "unknown";
    try {
        const ref = window.db.collection("stock_takes").doc();
        const confirmed = await writeWithGrace(ref.set({
            takenBy: by,
            takenAt: new Date(),
            dateKey: new Date().toLocaleDateString("en-CA"),
            itemsCounted: items.length,
            itemsShort: short.length,
            itemsOver: over.length,
            valueShort,
            valueOver,
            items,
            notes: document.getElementById("stNotes").value.trim(),
            applied: false
        }));
        hideModalById("stockTakeModal");

        try {
            window.sendAlert(
                `📋 *Stock take submitted*\n` +
                `By: ${by}\nProducts counted: ${items.length}\n` +
                (short.length || over.length
                    ? `❌ Short: ${short.length} item(s), worth KSh ${valueShort.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n⚠️ Over: ${over.length} item(s), worth KSh ${valueOver.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                    : `✅ Everything matches the system`),
                "onStockTake"
            );
        } catch (alertErr) { console.warn("Stock take alert failed:", alertErr); }

        if (can("stocktake.history")) {
            const res = await Swal.fire({
                title: "Stock count saved",
                html: short.length || over.length
                    ? `<div class="text-start"><div>Short: <b>${short.length}</b> item(s) · KSh ${valueShort.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div><div>Over: <b>${over.length}</b> item(s) · KSh ${valueOver.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>`
                    : "Everything matches the system.",
                icon: short.length ? "warning" : "success",
                showCancelButton: true,
                confirmButtonText: "Review details",
                cancelButtonText: "Close"
            });
            if (res.isConfirmed) window.openStockTakeHistory();
        } else if (can("stocktake.seeSystem")) {
            Swal.fire({
                icon: short.length || over.length ? "warning" : "success",
                title: "Count submitted",
                text: `${items.length} counted: ${short.length} short, ${over.length} over. An admin can review the details.`
            });
        } else {
            Swal.fire({
                icon: "success",
                title: confirmed ? "Count submitted" : "Saved on this device",
                text: `Your count of ${items.length} product${items.length === 1 ? "" : "s"} has been submitted.`
            });
        }
    } catch (err) {
        Swal.fire("Could not save the count", err.message, "error");
    }
};

window.db.collection("stock_takes").orderBy("takenAt", "desc").limit(30).onSnapshot(snap => {
    window.stockTakes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const modalEl = document.getElementById("stockTakeHistoryModal");
    if (modalEl && modalEl.classList.contains("show")) renderStockTakeHistory();
}, err => console.warn("Stock takes listener:", err));

window.openStockTakeHistory = () => {
    if (!can("stocktake.history")) return denyAccess("see stock count results");
    renderStockTakeHistory();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("stockTakeHistoryModal")).show();
};

function renderStockTakeHistory() {
    const box = document.getElementById("stHistoryBody");
    if (!box) return;
    const money = (n) => insightMoney(n);

    if (!window.stockTakes.length) {
        box.innerHTML = `<div class="empty-state"><i class="fas fa-clipboard-check"></i>No stock counts have been submitted yet.</div>`;
        return;
    }

    box.innerHTML = window.stockTakes.map(t => {
        const when = t.takenAt && t.takenAt.toDate ? t.takenAt.toDate() : new Date(t.takenAt);
        const diffs = (t.items || []).filter(i => i.diff !== 0).sort((a, b) => Math.abs(b.valueDiff) - Math.abs(a.valueDiff));
        const matched = (t.items || []).length - diffs.length;
        const result = diffs.length
            ? `<span class="cd-pill bad">Short ${t.itemsShort} · ${money(t.valueShort)}</span> <span class="cd-pill warn">Over ${t.itemsOver} · ${money(t.valueOver)}</span>`
            : `<span class="cd-pill ok">All match</span>`;

        return `
            <details class="st-take">
                <summary>
                    <span class="st-when">${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}<small>${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span>
                    <span class="st-by">${t.takenBy || ""}<small>${t.itemsCounted} counted</small></span>
                    <span class="st-result">${result}</span>
                    ${t.applied ? '<span class="badge text-bg-success">Applied</span>' : ""}
                    <i class="fas fa-chevron-down st-chev"></i>
                </summary>
                <div class="st-detail">
                    ${t.notes ? `<div class="small text-muted mb-2"><i class="fas fa-note-sticky me-1"></i>${t.notes}</div>` : ""}
                    ${diffs.length ? `
                    <div class="table-wrap"><div class="table-responsive">
                        <table class="table table-sm align-middle table-compact mb-0">
                            <thead><tr><th>Product</th><th class="text-end">System</th><th class="text-end">Counted</th><th class="text-end">Difference</th><th class="text-end">Value</th></tr></thead>
                            <tbody>${diffs.map(i => `
                                <tr>
                                    <td class="fw-semibold">${i.name}</td>
                                    <td class="text-end">${window.toMixedFraction(i.system)}</td>
                                    <td class="text-end">${window.toMixedFraction(i.counted)}</td>
                                    <td class="text-end fw-bold ${i.diff < 0 ? "text-danger" : "text-success"}">${i.diff > 0 ? "+" : ""}${window.toMixedFraction(i.diff)}</td>
                                    <td class="text-end ${i.diff < 0 ? "text-danger" : "text-success"}">${i.valueDiff < 0 ? "-" : ""}${money(Math.abs(i.valueDiff))}</td>
                                </tr>`).join("")}
                            </tbody>
                        </table>
                    </div></div>` : ""}
                    <div class="small text-muted mt-2">${matched} product${matched === 1 ? "" : "s"} matched exactly.</div>
                    <div class="d-flex gap-2 justify-content-end flex-wrap mt-3">
                        ${can("stocktake.apply") && !t.applied && diffs.length ? `<button class="btn btn-custom btn-sm" onclick="window.applyStockTake('${t.id}')"><i class="fas fa-check me-1"></i>Update stock to match this count</button>` : ""}
                        ${can("stocktake.apply") ? `<button class="btn btn-soft btn-sm" onclick="window.deleteStockTake('${t.id}')"><i class="fas fa-trash-can text-danger me-1"></i>Delete</button>` : ""}
                    </div>
                </div>
            </details>`;
    }).join("");
}

window.applyStockTake = async (id) => {
    if (!can("stocktake.apply")) return denyAccess("apply stock counts");
    const t = window.stockTakes.find(x => x.id === id);
    if (!t) return;

    const diffs = (t.items || []).filter(i => i.diff !== 0 && window.productsCache.find(d => d.id === i.id));
    if (!diffs.length) return Swal.fire("Nothing to update", "These products no longer exist or already match.", "info");

    const res = await Swal.fire({
        title: "Update stock?",
        html: `Stock for <b>${diffs.length}</b> product${diffs.length === 1 ? "" : "s"} will change by the difference found in this count. Sales made since the count are kept. Each change is added to the Restock Logs.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Yes, update stock"
    });
    if (!res.isConfirmed) return;

    try {
        for (let start = 0; start < diffs.length; start += 200) {
            const batch = window.db.batch();
            diffs.slice(start, start + 200).forEach(i => {
                const doc = window.productsCache.find(d => d.id === i.id);
                const current = parseFloat(doc.data().stock) || 0;
                const after = Math.max(0, current + i.diff);
                batch.update(window.db.collection("products").doc(i.id), { stock: after });
                batch.set(window.db.collection("restock_logs").doc(), {
                    productId: i.id,
                    name: i.name,
                    quantityAdded: i.diff,
                    previousStock: current,
                    afterStock: after,
                    reason: "Stock take adjustment",
                    restockedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
        }
        await window.db.collection("stock_takes").doc(id).update({
            applied: true,
            appliedBy: getCurrentUserEmail() || "unknown",
            appliedAt: new Date()
        });
        logAudit("stock", "stocktake_apply", `Stock changed to match a count (${diffs.length} product${diffs.length === 1 ? "" : "s"})`,
            diffs.slice(0, 12).map(i => `${i.name}: ${i.diff > 0 ? "+" : ""}${window.toMixedFraction(i.diff)}`).join("\n") + (diffs.length > 12 ? `\n…and ${diffs.length - 12} more` : ""), { flag: diffs.some(i => i.diff < 0) });
        Swal.fire("Stock updated", `${diffs.length} product${diffs.length === 1 ? "" : "s"} now match the count.`, "success");
    } catch (err) {
        Swal.fire("Could not update stock", err.message, "error");
    }
};

window.deleteStockTake = async (id) => {
    if (!can("stocktake.apply")) return denyAccess("delete stock counts");
    const res = await Swal.fire({ title: "Delete this stock count?", text: "Stock levels are not changed.", icon: "warning", showCancelButton: true, confirmButtonColor: "#d33", confirmButtonText: "Yes, delete" });
    if (!res.isConfirmed) return;
    try { await window.db.collection("stock_takes").doc(id).delete(); logAudit("delete", "stocktake_delete", "Stock count deleted", ""); } catch (err) { Swal.fire("Error", err.message, "error"); }
};


/* ==========================================================================
   SECTION 12E: CATEGORIES, BUSY TIMES AND SMART WARNINGS
   ========================================================================== */

/* ---------------------------------------------------------------- Categories */
const DEFAULT_CATEGORIES = ["Beer", "Cider & ready-to-drink", "Wine", "Spirits", "Soft drinks & water", "Cigarettes", "Snacks", "Other"];

// Best-guess keywords used by "Suggest categories". The admin always reviews the result before saving.
const CATEGORY_RULES = [
    ["Cigarettes", ["cigarette", "rooster", "rothsman", "rothman", "sportsman", "embassy", "dunhill", "supermatch", "safari kingsize", "menthol", "lighter", "matchbox"]],
    ["Beer", ["tusker", "guinness", "heineken", "pilsner", "white cap", "whitecap", "balozi", "castle", "lager", "stout", "serengeti", "carlsberg", "corona", "budweiser", "windhoek", "summit", " beer"]],
    ["Cider & ready-to-drink", ["hunters", "savanna", "snapp", "smirnoff ice", "smirnoff guarana", "redds", "cider", "alcopop"]],
    ["Wine", [" wine", "4th street", "four cousins", "caprice", "cabernet", "merlot", "sauvignon", "chardonnay", "champagne", "moet", "robertson", "casabuena", "drostdy"]],
    ["Spirits", ["whisky", "whiskey", "vodka", " gin", "rum", "brandy", "brady", "cognac", "tequila", "liqueur", "baileys", "amarula", "jameson", "johnnie", "jack daniel", "black label", "red label", "chrome", "gilbey", "smirnoff", "konyagi", "kenya cane", "captain morgan", "hennessy", "remy", "martell", "jagermeister", "chivas", "glenfiddich", "ballantine", "general meakins", "richot", "napoleon", "v&a", "best ", "viceroy", "bond 7", "county"]],
    ["Soft drinks & water", ["soda", "coca", "coke", "fanta", "sprite", "pepsi", "stoney", "krest", "mirinda", "tonic", "red bull", "monster", "predator", "power play", "water", "juice", "oris", "minute maid", "delmonte", "aqua", "dasani", "energy", "lemonade", "ginger", "malt"]],
    ["Snacks", ["crisps", "chips", "nuts", "peanut", "biscuit", "gum", "mint", "chocolate", "sausage", "egg", "popcorn"]]
];

function suggestCategory(name) {
    const n = " " + normName(name) + " ";
    for (const [category, words] of CATEGORY_RULES) {
        if (words.some(w => n.includes(w))) return category;
    }
    return "";
}

window.productCategory = "all";          // "all" | "__none" | a category name
window.productCategoryList = [];

/**
 * Draws the Products table for the current search text and category chip
 */
window.renderProductsFiltered = function () {
    const all = window.productsCache || [];
    const searchEl = document.getElementById("searchInput");
    const term = normName(searchEl ? searchEl.value : "");

    const counts = {};
    let uncategorised = 0;
    all.forEach(d => {
        const c = (d.data().category || "").trim();
        if (c) counts[c] = (counts[c] || 0) + 1; else uncategorised++;
    });
    const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));

    window.productCategoryList = [{ key: "all", label: "All", count: all.length }]
        .concat(names.map(n => ({ key: n, label: n, count: counts[n] })));
    if (uncategorised && names.length) window.productCategoryList.push({ key: "__none", label: "Uncategorised", count: uncategorised });
    if (!window.productCategoryList.some(c => c.key === window.productCategory)) window.productCategory = "all";

    const chips = document.getElementById("productCategoryChips");
    if (chips) {
        chips.classList.toggle("d-none", names.length === 0);
        chips.innerHTML = window.productCategoryList.map((c, i) =>
            `<button class="btn btn-soft btn-sm ${c.key === window.productCategory ? "active" : ""}" onclick="window.setProductCategory(${i})">${escHtml(c.label)} <span class="pp-count">${c.count}</span></button>`).join("");
    }

    const dl = document.getElementById("categoryList");
    if (dl) {
        dl.innerHTML = Array.from(new Set(DEFAULT_CATEGORIES.concat(names))).map(n => `<option value="${escHtml(n)}"></option>`).join("");
    }

    const cat = window.productCategory;
    const filtered = all.filter(d => {
        const p = d.data();
        const c = (p.category || "").trim();
        if (cat === "__none" && c) return false;
        if (cat !== "all" && cat !== "__none" && c !== cat) return false;
        return !term || normName(p.name).includes(term);
    });
    window.renderProducts(filtered);
};

window.setProductCategory = (i) => {
    const item = window.productCategoryList[i];
    if (!item) return;
    window.productCategory = item.key;
    window.renderProductsFiltered();
};

window.openCategoriesModal = () => {
    if (!can("categories.manage")) return denyAccess("manage categories");
    const docs = (window.productsCache || []).slice().sort((a, b) => (a.data().name || "").localeCompare(b.data().name || ""));
    document.getElementById("catBody").innerHTML = docs.map(d => {
        const p = d.data();
        const cat = (p.category || "").trim();
        return `
            <tr data-name="${escHtml(normName(p.name))}">
                <td class="fw-semibold">${escHtml(p.name)}</td>
                <td style="min-width:200px"><input list="categoryList" class="form-control form-control-sm cat-input" data-id="${d.id}" data-original="${escHtml(cat)}" value="${escHtml(cat)}" placeholder="No category"></td>
            </tr>`;
    }).join("") || `<tr><td colspan="2"><div class="empty-state"><i class="fas fa-boxes-stacked"></i>No products yet.</div></td></tr>`;
    document.getElementById("catSearch").value = "";
    document.getElementById("catStatus").textContent = "";
    bootstrap.Modal.getOrCreateInstance(document.getElementById("categoriesModal")).show();
};

(function bindCategorySearch() {
    const el = document.getElementById("catSearch");
    if (!el) return;
    el.addEventListener("input", () => {
        const term = normName(el.value);
        document.querySelectorAll("#catBody tr").forEach(row => {
            row.style.display = !term || (row.dataset.name || "").includes(term) ? "" : "none";
        });
    });
})();

window.suggestAllCategories = () => {
    let filled = 0, unknown = 0;
    document.querySelectorAll("#catBody .cat-input").forEach(input => {
        if (input.value.trim()) return;
        const guess = suggestCategory(input.closest("tr").querySelector("td").textContent);
        if (guess) { input.value = guess; filled++; } else unknown++;
    });
    document.getElementById("catStatus").textContent = `Filled in ${filled} product${filled === 1 ? "" : "s"}${unknown ? `. ${unknown} could not be guessed - type those yourself.` : "."} Check them, then press Save.`;
};

window.saveCategories = async () => {
    if (!can("categories.manage")) return denyAccess("manage categories");
    const changed = [...document.querySelectorAll("#catBody .cat-input")]
        .filter(i => i.value.trim() !== (i.dataset.original || ""))
        .map(i => ({ id: i.dataset.id, category: i.value.trim() }));
    if (!changed.length) return Swal.fire("Nothing changed", "You have not changed any category.", "info");

    try {
        for (let start = 0; start < changed.length; start += 400) {
            const batch = window.db.batch();
            changed.slice(start, start + 400).forEach(c => {
                batch.update(window.db.collection("products").doc(c.id), { category: c.category });
            });
            await batch.commit();
        }
        hideModalById("categoriesModal");
        Swal.fire({ icon: "success", title: "Categories saved", text: `${changed.length} product${changed.length === 1 ? "" : "s"} updated.`, timer: 1800, showConfirmButton: false });
    } catch (err) {
        Swal.fire("Could not save", err.message, "error");
    }
};

/**
 * Profit grouped by category (uses the same rows as Profit per product)
 */
function renderCategoryProfit() {
    const body = document.getElementById("catProfitBody");
    if (!body) return;

    const groups = {};
    (window.ppRows || []).forEach(r => {
        const key = r.category || "Uncategorised";
        const g = groups[key] || (groups[key] = { name: key, products: 0, units: 0, revenue: 0, cost: 0, profit: 0 });
        g.products++; g.units += r.units; g.revenue += r.revenue; g.cost += r.cost; g.profit += r.profit;
    });
    const list = Object.values(groups).sort((a, b) => b.profit - a.profit);
    const totalProfit = list.reduce((n, g) => n + Math.max(0, g.profit), 0);

    body.innerHTML = list.length ? list.map(g => {
        const margin = g.revenue > 0 ? (g.profit / g.revenue) * 100 : 0;
        const share = totalProfit > 0 && g.profit > 0 ? (g.profit / totalProfit) * 100 : 0;
        return `
            <tr>
                <td class="fw-semibold">${escHtml(g.name)}<small class="text-muted d-block">${g.products} product${g.products === 1 ? "" : "s"}</small></td>
                <td class="text-end">${window.toMixedFraction(g.units)}</td>
                <td class="text-end">${insightMoney(g.revenue)}</td>
                <td class="text-end text-muted">${insightMoney(g.cost)}</td>
                <td class="text-end fw-bold ${g.profit >= 0 ? "text-success" : "text-danger"}">${insightMoney(g.profit)}</td>
                <td class="text-end">${margin.toFixed(1)}%</td>
                <td style="min-width:130px"><div class="small text-muted">${share.toFixed(0)}% of profit</div><div class="pp-bar"><span style="width:${share}%"></span></div></td>
            </tr>`;
    }).join("") : `<tr><td colspan="7"><div class="empty-state"><i class="fas fa-layer-group"></i>No data yet.</div></td></tr>`;
}


/* ---------------------------------------------------------------- Busy times */
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hourShort = (h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
const hourLong = (h) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;

/**
 * d = { hourRev, hourOrders, dowRev, dowOrders, dowCount, colors, kFormat, days }
 */
window.renderBusyTimes = (d) => {
    const { hourRev, hourOrders, dowRev, dowOrders, dowCount, colors } = d;
    const totalRev = hourRev.reduce((n, v) => n + v, 0);

    // ---- by hour
    const maxHour = Math.max(...hourRev);
    const hourColors = hourRev.map(v => (maxHour > 0 && v >= maxHour * 0.6) ? colors.brand : colors.brand + "55");
    makeInsightChart("busyHourChart", {
        type: "bar",
        data: {
            labels: hourRev.map((_, h) => hourShort(h)),
            datasets: [{ label: "Sales", data: hourRev, backgroundColor: hourColors, borderRadius: 4, maxBarThickness: 18 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => `${hourLong(items[0].dataIndex)} - ${hourLong((items[0].dataIndex + 1) % 24)}`,
                        label: (ctx) => ` ${insightMoney(ctx.parsed.y)} · ${hourOrders[ctx.dataIndex]} order${hourOrders[ctx.dataIndex] === 1 ? "" : "s"}`
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: colors.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
                y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.muted, callback: d.kFormat } }
            }
        }
    });

    // ---- by weekday (average per day), Monday first
    const order = [1, 2, 3, 4, 5, 6, 0];
    const avg = order.map(dow => dowCount[dow] > 0 ? dowRev[dow] / dowCount[dow] : 0);
    const maxAvg = Math.max(...avg);
    makeInsightChart("busyDayChart", {
        type: "bar",
        data: {
            labels: order.map(dow => DAY_NAMES[dow].slice(0, 3)),
            datasets: [{ label: "Average per day", data: avg, backgroundColor: avg.map(v => (maxAvg > 0 && v === maxAvg) ? colors.brand : colors.brand + "55"), borderRadius: 6, maxBarThickness: 36 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => DAY_NAMES[order[items[0].dataIndex]],
                        label: (ctx) => {
                            const dow = order[ctx.dataIndex];
                            return ` Average ${insightMoney(ctx.parsed.y)} · ${dowOrders[dow]} order${dowOrders[dow] === 1 ? "" : "s"} over ${dowCount[dow]} day${dowCount[dow] === 1 ? "" : "s"}`;
                        }
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: colors.muted } },
                y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.muted, callback: d.kFormat } }
            }
        }
    });

    // ---- plain-language summary
    const box = document.getElementById("busyInsights");
    if (!box) return;
    if (totalRev <= 0) {
        box.innerHTML = `<div class="busy-chip"><span>No sales in this period yet.</span></div>`;
        return;
    }

    let peakStart = 0, peakSum = -1;
    for (let h = 0; h < 24; h++) {
        const s = hourRev[h] + hourRev[(h + 1) % 24] + hourRev[(h + 2) % 24];
        if (s > peakSum) { peakSum = s; peakStart = h; }
    }
    const busiestHour = hourRev.indexOf(maxHour);
    const withData = order.filter(dow => dowCount[dow] > 0);
    const busiestDow = withData.reduce((a, b) => (dowRev[b] / dowCount[b] > dowRev[a] / dowCount[a] ? b : a), withData[0]);
    const quietestDow = withData.reduce((a, b) => (dowRev[b] / dowCount[b] < dowRev[a] / dowCount[a] ? b : a), withData[0]);

    box.innerHTML = `
        <div class="busy-chip"><i class="fas fa-fire"></i><span><small>Busiest hour</small><b>${hourLong(busiestHour)} - ${hourLong((busiestHour + 1) % 24)}</b></span></div>
        <div class="busy-chip"><i class="fas fa-clock"></i><span><small>Peak window (3 hours)</small><b>${hourLong(peakStart)} - ${hourLong((peakStart + 3) % 24)}</b> <em>${Math.round((peakSum / totalRev) * 100)}% of sales</em></span></div>
        <div class="busy-chip"><i class="fas fa-calendar-day"></i><span><small>Busiest day</small><b>${DAY_NAMES[busiestDow]}</b> <em>avg ${insightMoney(dowRev[busiestDow] / dowCount[busiestDow])}</em></span></div>
        <div class="busy-chip"><i class="fas fa-moon"></i><span><small>Quietest day</small><b>${DAY_NAMES[quietestDow]}</b> <em>avg ${insightMoney(dowRev[quietestDow] / dowCount[quietestDow])}</em></span></div>`;
};


/* ----------------------------------------------------------- Smart warnings */
const dayKeyOf = (d) => d.toLocaleDateString("en-CA");

function isoWeekKey(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return `${t.getUTCFullYear()}-W${Math.ceil(((t - yearStart) / 86400000 + 1) / 7)}`;
}

/**
 * Looks at sales and stock and returns a list of things the owner should know about right now.
 * Items with alert: true are also sent as phone alerts (once per day / week).
 */
function computeSmartWarnings(now = new Date()) {
    const out = [];
    const sales = window.allSales || [];
    const products = window.productsCache || [];
    const todayKey = dayKeyOf(now);
    const money = (n) => "KSh " + Math.round(n).toLocaleString();

    // 1. Stock that will run out within 2 days (or already has) at the current selling pace
    const since30 = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const sold30 = {};
    sales.forEach(s => {
        if (s.date.toDate().getTime() < since30) return;
        (s.items || []).forEach(i => { const k = normName(i.name); sold30[k] = (sold30[k] || 0) + itemStockQty(i); });
    });
    products.forEach(doc => {
        const p = doc.data();
        const stock = parseFloat(p.stock) || 0;
        const qty30 = sold30[normName(p.name)] || 0;
        if (qty30 < 3) return;                       // too little history to predict anything
        const rate = qty30 / 30;
        const daysLeft = stock / rate;
        if (daysLeft > 2) return;
        const gone = stock <= 0;
        out.push({
            key: `runout:${doc.id}:${todayKey}`, type: "runout", group: "stock", severity: gone || daysLeft < 1 ? "high" : "medium", alert: true, icon: "fa-box-open",
            data: { name: p.name, gone, daysLeft, rate, stock },
            title: gone ? `${p.name} is out of stock` : `${p.name} will run out in ${daysLeft < 1 ? "less than a day" : Math.ceil(daysLeft) + " days"}`,
            detail: gone ? `It sells about ${rate.toFixed(1)} a day.` : `${window.toMixedFraction(stock)} left, selling about ${rate.toFixed(1)} a day.`
        });
    });

    // 2. Sales today compared with the same weekday last week, up to the same time of day
    const lastWeek = new Date(now); lastWeek.setDate(lastWeek.getDate() - 7);
    const lastWeekKey = dayKeyOf(lastWeek);
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    let todaySoFar = 0, lastWeekSoFar = 0;
    sales.forEach(s => {
        const d = s.date.toDate();
        const k = dayKeyOf(d);
        if (k === todayKey) todaySoFar += parseFloat(s.total) || 0;
        else if (k === lastWeekKey && d.getHours() * 60 + d.getMinutes() <= minutesNow) lastWeekSoFar += parseFloat(s.total) || 0;
    });
    if (lastWeekSoFar >= 3000 && todaySoFar < lastWeekSoFar * 0.6) {
        const pct = Math.round((1 - todaySoFar / lastWeekSoFar) * 100);
        out.push({
            key: `pace:${todayKey}`, type: "pace", group: "sales", severity: "medium", alert: true, icon: "fa-arrow-trend-down",
            data: { heading: `Today compared with last ${DAY_NAMES[now.getDay()]}`, pct, a: todaySoFar, b: lastWeekSoFar, labelA: "Today so far", labelB: `Last ${DAY_NAMES[now.getDay()]} by this time` },
            title: `Sales are ${pct}% below last ${DAY_NAMES[now.getDay()]}`,
            detail: `${money(todaySoFar)} so far today, against ${money(lastWeekSoFar)} by this time last ${DAY_NAMES[now.getDay()]}.`
        });
    }

    // 3. The last 7 days compared with the 7 days before
    const startOf = (offset) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - offset); return d.getTime(); };
    const last7Start = startOf(6), prev7Start = startOf(13);
    let last7 = 0, prev7 = 0;
    sales.forEach(s => {
        const t = s.date.toDate().getTime();
        const total = parseFloat(s.total) || 0;
        if (t >= last7Start) last7 += total; else if (t >= prev7Start) prev7 += total;
    });
    if (prev7 >= 10000 && last7 <= prev7 * 0.75) {
        const pct = Math.round((1 - last7 / prev7) * 100);
        out.push({
            key: `weekdrop:${isoWeekKey(now)}`, type: "weekdrop", group: "sales", severity: "medium", alert: true, icon: "fa-chart-line",
            data: { heading: "Last 7 days compared with the week before", pct, a: last7, b: prev7, labelA: "Last 7 days", labelB: "The 7 days before" },
            title: `The last 7 days are ${pct}% lower than the 7 days before`,
            detail: `${money(last7)} against ${money(prev7)}.`
        });
    }

    // 4. Yesterday had sales but was never closed
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const yKey = dayKeyOf(y);
    const yesterdayHadSales = sales.some(s => dayKeyOf(s.date.toDate()) === yKey);
    if (yesterdayHadSales && !(window.dayClosings || {})[yKey] && now.getHours() >= 10) {
        out.push({
            key: `unclosed:${yKey}`, type: "unclosed", group: "books", severity: "medium", alert: true, icon: "fa-calendar-xmark",
            data: { dateKey: yKey, label: y.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }) },
            title: `Yesterday (${y.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}) was not closed`,
            detail: "Nobody counted the cash for that day. Use Close Day and pick yesterday's date."
        });
    }

    // 5. Selling below cost (shown here only)
    products.forEach(doc => {
        const p = doc.data();
        const price = parseFloat(p.price) || 0, buy = parseFloat(p.buyPrice) || 0;
        if (price > 0 && buy > 0 && price < buy) {
            out.push({
                key: `belowcost:${doc.id}`, type: "belowcost", group: "pricing", severity: "high", alert: false, icon: "fa-triangle-exclamation",
                data: { name: p.name, price, buy },
                title: `${p.name} sells for less than it costs`,
                detail: `Sell price ${money(price)}, buy price ${money(buy)}. Every sale loses ${money(buy - price)}.`
            });
        }
    });

    const rank = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * Opens Close Day already set to a particular date (used by the "not closed" warning)
 */
window.openCloseDayFor = (dateKey) => {
    window.openCloseDayModal();
    document.getElementById("closeDayDate").value = dateKey;
    window.updateCloseDaySummary();
};

window.renderSmartWarnings = () => {
    const box = document.getElementById("smartWarnings");
    if (!box) return;

    const list = computeSmartWarnings();
    const urgent = list.filter(w => w.severity === "high").length;
    const watch = list.length - urgent;
    const money = (n) => "KSh " + Math.round(n).toLocaleString();

    const sub = document.getElementById("smartWarnSub");
    if (sub) sub.textContent = list.length ? `${list.length} thing${list.length === 1 ? "" : "s"} need${list.length === 1 ? "s" : ""} your attention` : "Everything looks healthy";
    const summary = document.getElementById("smartWarnSummary");
    if (summary) {
        summary.innerHTML = list.length
            ? (urgent ? `<span class="sw-chip bad"><b>${urgent}</b> urgent</span>` : "") + (watch ? `<span class="sw-chip warn"><b>${watch}</b> to watch</span>` : "")
            : `<span class="sw-chip ok"><i class="fas fa-circle-check me-1"></i>All clear</span>`;
    }
    const badge = document.getElementById("smartWarnCount");
    if (badge) { badge.textContent = list.length; badge.classList.toggle("d-none", list.length === 0); }

    if (!list.length) {
        box.innerHTML = `
            <div class="sw-clear">
                <span class="sw-clear-ico"><i class="fas fa-shield-heart"></i></span>
                <div><div class="fw-bold">All clear</div><div class="small">Stock levels, sales and closings all look healthy right now.</div></div>
            </div>`;
        return;
    }

    const card = (cls, icon, title, count, body, footer) => `
        <div class="sw-card ${cls}">
            <div class="sw-card-head">
                <span class="sw-card-ico"><i class="fas ${icon}"></i></span>
                <span class="sw-card-title">${title}</span>
                <span class="sw-card-count">${count}</span>
            </div>
            <div class="sw-card-body">${body}</div>
            ${footer ? `<div class="sw-card-foot">${footer}</div>` : ""}
        </div>`;

    const cards = [];

    // ---- stock: one compact card instead of one row per product
    const stock = list.filter(w => w.group === "stock");
    if (stock.length) {
        const row = (w) => {
            const d = w.data;
            const status = d.gone ? `<span class="sw-status bad">Out of stock</span>`
                : `<span class="sw-status ${d.daysLeft < 1 ? "bad" : "warn"}">${d.daysLeft < 1 ? "Under a day left" : Math.ceil(d.daysLeft) + " days left"}</span>`;
            return `<div class="sw-row"><div class="sw-row-main"><b>${escHtml(d.name)}</b><small>sells about ${d.rate.toFixed(1)} a day${d.gone ? "" : " · " + window.toMixedFraction(d.stock) + " left"}</small></div>${status}</div>`;
        };
        const shown = stock.slice(0, 5), rest = stock.slice(5);
        const body = shown.map(row).join("") + (rest.length ? `<details class="sw-more"><summary>Show ${rest.length} more</summary>${rest.map(row).join("")}</details>` : "");
        cards.push(card("danger", "fa-box-open", "Stock running out", stock.length, body,
            `<button class="btn btn-custom btn-sm" onclick="window.openReorderModal()"><i class="fas fa-wand-magic-sparkles me-1"></i>Suggest reorder</button>`));
    }

    // ---- sales: a big percentage and a simple comparison
    list.filter(w => w.group === "sales").forEach(w => {
        const d = w.data;
        const max = Math.max(d.a, d.b, 1);
        const body = `
            <div class="sw-metric">
                <div class="sw-big down"><i class="fas fa-arrow-down"></i>${d.pct}%</div>
                <div class="sw-metric-text">${escHtml(d.heading)}</div>
            </div>
            <div class="sw-compare">
                <div class="sw-cmp-row"><span>${escHtml(d.labelA)}</span><b>${money(d.a)}</b></div>
                <div class="sw-cmp-bar"><span class="now" style="width:${(d.a / max) * 100}%"></span></div>
                <div class="sw-cmp-row"><span>${escHtml(d.labelB)}</span><b>${money(d.b)}</b></div>
                <div class="sw-cmp-bar"><span class="before" style="width:${(d.b / max) * 100}%"></span></div>
            </div>
            <div class="sw-takeaway"><b>${money(d.b - d.a)} less</b> than ${d.labelB.charAt(0).toLowerCase() + d.labelB.slice(1)}.</div>`;
        cards.push(card("warn sales", w.icon, w.type === "pace" ? "Sales pace" : "Weekly trend", "", body));
    });

    // ---- books: days that were never closed
    const books = list.filter(w => w.group === "books");
    if (books.length) {
        const body = books.map(w => `
            <div class="sw-row">
                <div class="sw-row-main"><b>${escHtml(w.data.label)} was not closed</b><small>Nobody counted the cash for that day.</small></div>
                <button class="btn btn-soft btn-sm" onclick="window.openCloseDayFor('${w.data.dateKey}')">Close it</button>
            </div>`).join("");
        cards.push(card("warn", "fa-calendar-xmark", "Closing", books.length, body));
    }

    // ---- pricing: products that lose money on every sale
    const pricing = list.filter(w => w.group === "pricing");
    if (pricing.length) {
        const row = (w) => `
            <div class="sw-row">
                <div class="sw-row-main"><b>${escHtml(w.data.name)}</b><small>sells for ${money(w.data.price)} but costs ${money(w.data.buy)}</small></div>
                <span class="sw-status bad">Loses ${money(w.data.buy - w.data.price)} each</span>
            </div>`;
        const shown = pricing.slice(0, 5), rest = pricing.slice(5);
        cards.push(card("danger", "fa-tag", "Priced below cost", pricing.length,
            shown.map(row).join("") + (rest.length ? `<details class="sw-more"><summary>Show ${rest.length} more</summary>${rest.map(row).join("")}</details>` : "")));
    }

    box.innerHTML = `<div class="sw-grid">${cards.join("")}</div>`;
};

/**
 * Sends new warnings to the admin's phone. Each warning is sent once; the shared record in Firebase stops
 * several open devices from sending the same message.
 */
window.runSmartAlerts = async () => {
    const c = window.alertConfig || {};
    if (c.onSmart === false || activeChannels(c).length === 0 || !navigator.onLine) return;
    if (!(window.productsCache || []).length) return;     // data not loaded yet

    const warns = computeSmartWarnings().filter(w => w.alert);
    if (!warns.length) return;

    const today = dayKeyOf(new Date());
    const cutoff = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return dayKeyOf(d); })();
    let fresh = [];

    try {
        const ref = window.db.collection("settings").doc("alert_state");
        fresh = await window.db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const sent = (snap.exists && snap.data().sent) || {};
            const mine = warns.filter(w => !sent[w.key]);
            if (!mine.length) return [];
            const keep = {};
            Object.keys(sent).forEach(k => { if (String(sent[k]) >= cutoff) keep[k] = sent[k]; });
            mine.forEach(w => { keep[w.key] = today; });
            tx.set(ref, { sent: keep, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            return mine;
        });
    } catch (err) {
        // No shared record available: remember on this device instead
        try {
            const seen = JSON.parse(localStorage.getItem("madollar_smart_sent") || "{}");
            fresh = warns.filter(w => !seen[w.key]);
            fresh.forEach(w => { seen[w.key] = today; });
            Object.keys(seen).forEach(k => { if (String(seen[k]) < cutoff) delete seen[k]; });
            localStorage.setItem("madollar_smart_sent", JSON.stringify(seen));
        } catch (e) { fresh = []; }
    }

    if (!fresh.length) return;
    window.sendAlert(`🧠 *Smart warnings*\n` + fresh.map(w => `• ${w.title}\n  ${w.detail}`).join("\n"), "onSmart");
};

window.startSmartWarningTimer = () => {
    if (window.smartTimerStarted) return;
    window.smartTimerStarted = true;
    setTimeout(() => window.runSmartAlerts(), 25000);
    setInterval(() => window.runSmartAlerts(), 30 * 60 * 1000);
};


/* ==========================================================================
   SECTION 12F: ROLES & PERMISSIONS EDITOR (pop-up window opened from the Staff tab, admin only)
   One role and one group of permissions are shown at a time, so there is no long list to scroll.
   ========================================================================== */

window.permDraft = null;       // the ticks being edited (not saved until the admin presses Save)
window.permDirty = false;
window.permRole = "staff";     // which role is being edited: "staff" | "manager"
window.permGroup = PERMISSION_GROUPS[0].id;

const PERM_TOTAL = PERMISSION_GROUPS.reduce((n, g) => n + g.items.length, 0);
const permRoleLabel = (r) => (r === "manager" ? "Manager" : "Staff");

function effectivePermissions() {
    const out = { staff: {}, manager: {} };
    ["staff", "manager"].forEach(role => {
        const custom = (window.permissions && window.permissions[role]) || {};
        PERMISSION_GROUPS.forEach(g => g.items.forEach(i => {
            out[role][i.key] = custom[i.key] !== undefined ? !!custom[i.key] : !!PERMISSION_DEFAULTS[role][i.key];
        }));
    });
    return out;
}

const permCountAllowed = (map, items) => items.filter(i => map[i.key]).length;

function setPermDirty(dirty) {
    window.permDirty = dirty;
    const badge = document.getElementById("permDirty");
    if (badge) badge.classList.toggle("d-none", !dirty);
    const save = document.getElementById("permSaveBtn");
    if (save) save.disabled = !dirty;
}

/**
 * Role tabs, group pills and the button labels (cheap to redraw whenever a switch is flipped)
 */
function renderPermHeader() {
    if (!window.permDraft) return;
    const role = window.permRole;
    const d = window.permDraft;
    const searching = !!(document.getElementById("permSearch") || {}).value;

    const tabs = document.getElementById("permRoleTabs");
    if (tabs) {
        tabs.innerHTML = ["staff", "manager"].map(r => {
            const n = permCountAllowed(d[r], PERMISSION_GROUPS.flatMap(g => g.items));
            return `<button type="button" class="perm-roletab ${r === role ? "active" : ""}" onclick="window.setPermRole('${r}')">
                <span class="perm-roletab-name"><i class="fas ${r === "manager" ? "fa-user-tie" : "fa-user"} me-2"></i>${permRoleLabel(r)}</span>
                <small>${n} of ${PERM_TOTAL} allowed</small></button>`;
        }).join("");
    }

    const pills = document.getElementById("permGroupPills");
    if (pills) {
        pills.classList.toggle("d-none", searching);
        pills.innerHTML = PERMISSION_GROUPS.map(g => {
            const n = permCountAllowed(d[role], g.items);
            return `<button type="button" class="subtab ${g.id === window.permGroup ? "active" : ""}" onclick="window.setPermGroupView('${g.id}')">
                <i class="fas ${g.icon}"></i>${g.title}<b class="subtab-count">${n}/${g.items.length}</b></button>`;
        }).join("");
    }

    const reset = document.getElementById("permResetBtn");
    if (reset) reset.innerHTML = `<i class="fas fa-rotate-left me-1"></i>Reset ${permRoleLabel(role)}`;
}

function permItemHTML(i, checked, groupTitle) {
    return `
        <label class="perm-item">
            <span class="perm-item-text">
                <span class="perm-label">${i.label}${i.risk ? ' <i class="fas fa-triangle-exclamation perm-risk" title="Think carefully before allowing this"></i>' : ""}${groupTitle ? ` <span class="perm-grouptag">${groupTitle}</span>` : ""}</span>
                <span class="perm-hint">${i.hint}</span>
            </span>
            <span class="form-check form-switch m-0"><input class="form-check-input perm-check" type="checkbox" role="switch" data-key="${i.key}" ${checked ? "checked" : ""}></span>
        </label>`;
}

window.renderPermissionEditor = () => {
    const list = document.getElementById("permList");
    if (!list) return;
    if (!window.permDraft) window.permDraft = effectivePermissions();

    const d = window.permDraft[window.permRole];
    const term = String((document.getElementById("permSearch") || {}).value || "").trim().toLowerCase();

    if (term) {
        const matches = [];
        PERMISSION_GROUPS.forEach(g => g.items.forEach(i => {
            if ((i.label + " " + i.hint + " " + g.title).toLowerCase().includes(term)) matches.push({ i, g });
        }));
        list.innerHTML = matches.length
            ? `<div class="perm-found">${matches.length} permission${matches.length === 1 ? "" : "s"} found</div>` + matches.map(m => permItemHTML(m.i, d[m.i.key], m.g.title)).join("")
            : `<div class="empty-state"><i class="fas fa-magnifying-glass"></i>Nothing matches "${escHtml(term)}".</div>`;
    } else {
        const g = PERMISSION_GROUPS.find(x => x.id === window.permGroup) || PERMISSION_GROUPS[0];
        list.innerHTML = `
            <div class="perm-groupbar">
                <span class="perm-groupbar-title"><i class="fas ${g.icon} me-2"></i>${g.title}</span>
                <span>
                    <button type="button" class="perm-mini" onclick="window.setPermGroup('${g.id}','${window.permRole}',true)">Allow all</button>
                    <button type="button" class="perm-mini" onclick="window.setPermGroup('${g.id}','${window.permRole}',false)">Clear all</button>
                </span>
            </div>` + g.items.map(i => permItemHTML(i, d[i.key], "")).join("");
    }
    renderPermHeader();
    setPermDirty(window.permDirty);
};

(function bindPermissionEditor() {
    const list = document.getElementById("permList");
    if (!list) return;
    list.addEventListener("change", (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains("perm-check")) window.onPermToggle(t.dataset.key, t.checked);
    });
})();

window.onPermToggle = (key, checked) => {
    window.permDraft[window.permRole][key] = checked;
    setPermDirty(true);
    renderPermHeader();
};

window.setPermRole = (role) => {
    window.permRole = role;
    window.renderPermissionEditor();
};

window.setPermGroupView = (groupId) => {
    window.permGroup = groupId;
    const search = document.getElementById("permSearch");
    if (search) search.value = "";
    window.renderPermissionEditor();
};

window.setPermGroup = (groupId, role, value) => {
    const group = PERMISSION_GROUPS.find(g => g.id === groupId);
    if (!group || !window.permDraft) return;
    group.items.forEach(i => { window.permDraft[role][i.key] = value; });
    setPermDirty(true);
    window.renderPermissionEditor();
};

/**
 * Smoothly scrolls so the top of an element sits just under the sticky top bar
 */
function scrollToView(el) {
    if (!el) return;
    const bar = document.querySelector(".topbar");
    const offset = (bar ? bar.offsetHeight : 0) + 12;
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

window.openPermissionsView = () => {
    if (!isAdmin()) return denyAccess("change permissions");
    window.permDraft = effectivePermissions();
    window.permRole = "staff";
    window.permGroup = PERMISSION_GROUPS[0].id;
    const search = document.getElementById("permSearch");
    if (search) search.value = "";
    setPermDirty(false);
    window.renderPermissionEditor();
    document.getElementById("staffMainView").classList.add("d-none");
    document.getElementById("permView").classList.remove("d-none");
    scrollToView(document.getElementById("permView"));
};

window.closePermissionsView = async (force) => {
    if (window.permDirty && !force) {
        const res = await Swal.fire({
            title: "Leave without saving?",
            text: "You have changes that are not saved yet.",
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Leave without saving",
            cancelButtonText: "Keep editing"
        });
        if (!res.isConfirmed) return;
    }
    window.permDirty = false;
    window.permDraft = null;
    window.renderPermissionEditor();
    document.getElementById("permView").classList.add("d-none");
    document.getElementById("staffMainView").classList.remove("d-none");
    scrollToView(document.getElementById("staffMainView"));
};

window.resetPermissions = async (role) => {
    const res = await Swal.fire({
        title: `Reset ${permRoleLabel(role)} permissions?`,
        text: "Every switch for this role goes back to the standard setting. Nothing is saved until you press Save.",
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Yes, reset"
    });
    if (!res.isConfirmed) return;
    window.permDraft[role] = Object.assign({}, PERMISSION_DEFAULTS[role]);
    setPermDirty(true);
    window.renderPermissionEditor();
};

window.discardPermissionChanges = () => {
    window.permDraft = effectivePermissions();
    setPermDirty(false);
    window.renderPermissionEditor();
};

window.savePermissions = async () => {
    if (!isAdmin()) return denyAccess("change permissions");
    if (!window.permDraft) return;
    const permChanges = [];
    ["staff", "manager"].forEach(role => PERMISSION_GROUPS.forEach(g => g.items.forEach(i => {
        const saved = window.permissions && window.permissions[role] && window.permissions[role][i.key];
        const before = saved !== undefined ? !!saved : !!PERMISSION_DEFAULTS[role][i.key];
        const draft = window.permDraft[role] ? window.permDraft[role][i.key] : undefined;
        const after = draft !== undefined ? !!draft : before;
        if (before !== after) permChanges.push(`${permRoleLabel(role)}: ${after ? "allowed" : "no longer allowed"} to "${i.label}"`);
    })));
    try {
        await window.db.collection("settings").doc("permissions").set({
            staff: window.permDraft.staff,
            manager: window.permDraft.manager,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: getCurrentUserEmail() || "admin"
        });
        setPermDirty(false);
        if (permChanges.length) logAudit("people", "permissions", `Permissions changed (${permChanges.length})`, permChanges.slice(0, 15).join("\n") + (permChanges.length > 15 ? `\n…and ${permChanges.length - 15} more` : ""), { flag: true });
        Swal.fire({ icon: "success", title: "Permissions saved", text: "The changes apply straight away to everyone who is logged in.", timer: 2400, showConfirmButton: false });
    } catch (err) {
        Swal.fire("Could not save", err.message + " (If this says permission denied, allow write access to the 'settings' collection in your Firestore rules.)", "error");
    }
};

// When the saved ticks change elsewhere, refresh unless the admin is in the middle of editing
window.onPermissionsChanged = () => {
    if (!window.permDirty) window.permDraft = null;
    window.renderPermissionEditor();
};

window.renderPermissionEditor();


/* ==========================================================================
   SECTION 12G: SUPPLIERS & DELIVERIES, DEBT REMINDERS, BARCODE SCANNING
   ========================================================================== */

/* ----------------------------------------------------------------- helpers */
const MIN_MARGIN_PCT = 10;                       // below this profit margin a price change is flagged
const roundUp5 = (n) => Math.ceil(n / 5) * 5;
const toDate = (v) => (v && v.toDate ? v.toDate() : (v ? new Date(v) : null));
const shortDate = (d) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const cleanNum = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

/* ====================================================================== SUPPLIERS & DELIVERIES */
window.suppliersCache = {};
window.deliveries = [];
window.supplierPayments = [];
window.supDeliveryLimit = 25;

window.db.collection("suppliers").onSnapshot(snap => {
    window.suppliersCache = {};
    snap.forEach(d => {
        const data = d.data();
        window.suppliersCache[d.id] = { id: d.id, ...data, balance: cleanNum(data.balance) };
    });
    window.renderSuppliers();
}, err => console.warn("Suppliers listener:", err));

window.db.collection("deliveries").orderBy("date", "desc").limit(300).onSnapshot(snap => {
    window.deliveries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    window.renderSuppliers();
}, err => console.warn("Deliveries listener:", err));

window.db.collection("supplier_payments").orderBy("at", "desc").limit(300).onSnapshot(snap => {
    window.supplierPayments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}, err => console.warn("Supplier payments listener:", err));

/**
 * Checks one delivery line against the product it is for: did the cost change, and does the
 * selling price still leave a profit? (pure, so it can be shown live while typing and again on save)
 */
function deliveryLineCheck(line) {
    const oldCost = parseFloat(line.oldCost) || 0;
    const newCost = parseFloat(line.unitCost) || 0;
    const price = parseFloat(line.price) || 0;
    const out = { changed: false, pct: 0, loss: false, low: false, margin: null, suggest: null, flagged: false };

    if (oldCost > 0 && Math.abs(newCost - oldCost) > 0.004) {
        out.changed = true;
        out.pct = ((newCost - oldCost) / oldCost) * 100;
    }
    if (price > 0 && newCost > 0) {
        out.margin = ((price - newCost) / price) * 100;
        if (newCost >= price) out.loss = true;
        else if (out.margin < MIN_MARGIN_PCT) out.low = true;
        if (out.loss || out.low) out.suggest = roundUp5(newCost / (1 - MIN_MARGIN_PCT / 100));
    }
    // Warn when the supplier's price changed and the profit is now thin, or whenever the product would sell at a loss
    out.flagged = (out.changed && (out.loss || out.low)) || out.loss;
    return out;
}

/* ---------------------------------------------------------------- the Suppliers tab */
window.renderSuppliers = () => {
    const pane = document.getElementById("suppliersTab");
    if (!pane) return;
    if (!pane.classList.contains("active")) { window.suppliersNeedsRender = true; return; }
    window.suppliersNeedsRender = false;

    const list = Object.values(window.suppliersCache).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const owing = list.filter(s => s.balance > 0);
    const totalOwed = owing.reduce((n, s) => n + s.balance, 0);

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText("supOwedTotal", insightMoney(totalOwed));
    setText("supOwedCount", owing.length ? `owed to ${owing.length} supplier${owing.length === 1 ? "" : "s"}` : "you owe nothing right now");
    setText("supCount", list.length);

    const canPay = can("suppliers.pay"), canManage = can("suppliers.manage");
    const canDeliver = can("deliveries.record"), canDelete = can("suppliers.delete");
    const lastBySupplier = {};
    window.deliveries.forEach(dv => { if (!lastBySupplier[dv.supplierId]) lastBySupplier[dv.supplierId] = toDate(dv.date); });

    const body = document.getElementById("suppliersBody");
    if (body) {
        body.innerHTML = list.length ? list.map(s => `
            <tr>
                <td data-label="Supplier" class="fw-semibold">${escHtml(s.name)}${s.notes ? `<small class="text-muted d-block">${escHtml(s.notes)}</small>` : ""}</td>
                <td data-label="Phone">${escHtml(s.phone || "")}</td>
                <td data-label="Owed" class="text-end fw-bold ${s.balance > 0 ? "text-danger" : "text-muted"}">${s.balance > 0 ? insightMoney(s.balance) : "-"}</td>
                <td data-label="Last delivery" class="text-muted">${lastBySupplier[s.id] ? shortDate(lastBySupplier[s.id]) : "None yet"}</td>
                <td class="text-end text-nowrap">
                    ${canDeliver ? `<button class="btn btn-sm btn-custom" onclick="window.openDeliveryModal('${s.id}')" title="Record a delivery"><i class="fas fa-truck-ramp-box me-1"></i>Delivery</button>` : ""}
                    ${s.balance > 0 && canPay ? `<button class="btn btn-sm btn-soft" onclick="window.openSupplierPayment('${s.id}')" title="Record a payment"><i class="fas fa-hand-holding-dollar me-1 text-success"></i>Pay</button>` : ""}
                    <button class="btn btn-sm btn-soft" onclick="window.openSupplierStatement('${s.id}')" title="Statement"><i class="fas fa-file-lines"></i></button>
                    ${canManage ? `<button class="btn btn-sm btn-soft" onclick="window.openSupplierModal('${s.id}')" title="Edit supplier"><i class="fas fa-pen text-primary"></i></button>` : ""}
                    ${canDelete ? `<button class="btn btn-sm btn-soft" onclick="window.deleteSupplier('${s.id}')" title="Delete supplier"><i class="fas fa-trash-can text-danger"></i></button>` : ""}
                </td>
            </tr>`).join("")
            : `<tr><td colspan="5"><div class="empty-state"><i class="fas fa-truck"></i>No suppliers yet. Add your first one.</div></td></tr>`;
    }

    renderDeliveriesList();
    renderCostChanges();
};

function deliveryStatus(dv) {
    const total = parseFloat(dv.total) || 0, paid = parseFloat(dv.paid) || 0;
    if (paid >= total - 0.005) return { key: "paid", label: "Paid", cls: "ok" };
    if (paid > 0) return { key: "part", label: "Part paid", cls: "warn" };
    return { key: "unpaid", label: "Unpaid", cls: "bad" };
}

function renderDeliveriesList() {
    const box = document.getElementById("deliveriesList");
    if (!box) return;
    const list = window.deliveries;
    if (!list.length) {
        box.innerHTML = `<div class="empty-state"><i class="fas fa-truck-ramp-box"></i>No deliveries recorded yet.</div>`;
        return;
    }
    const canVoid = can("suppliers.delete");
    const visible = list.slice(0, window.supDeliveryLimit);

    const rows = visible.map(dv => {
        const d = toDate(dv.date);
        const st = deliveryStatus(dv);
        const items = dv.items || [];
        const lead = items[0];
        const more = items.length - 1;
        const changed = items.filter(i => i.oldCost > 0 && Math.abs(i.unitCost - i.oldCost) > 0.004).length;

        return `
            <details class="sale-row">
                <summary>
                    <span class="sr-time">${d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>
                    <span class="sr-cust"><i class="fas fa-truck"></i>${escHtml(dv.supplierName || "")}</span>
                    <span class="sr-items">${lead ? escHtml(lead.name) + " <b>× " + window.toMixedFraction(lead.qty) + "</b>" : ""}${more > 0 ? ` <span class="sr-more">+${more} more</span>` : ""}${changed ? ` <span class="sr-more sr-warn">${changed} cost change${changed === 1 ? "" : "s"}</span>` : ""}</span>
                    <span class="sr-pay"><span class="cd-pill ${st.cls}">${st.label}</span></span>
                    <span class="sr-total">${insightMoney(dv.total)}</span>
                    <span class="sr-chev"><i class="fas fa-chevron-down"></i></span>
                </summary>
                <div class="sale-detail">
                    <div class="sale-detail-meta">
                        <span><i class="far fa-clock me-1"></i>${d ? d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}</span>
                        ${dv.invoiceNo ? `<span class="sale-chip font-monospace">Invoice ${escHtml(dv.invoiceNo)}</span>` : ""}
                        <span>Paid ${insightMoney(dv.paid)} of ${insightMoney(dv.total)}</span>
                        <span>by ${escHtml(dv.receivedBy || "")}</span>
                    </div>
                    <ul class="sale-items">${items.map(i => {
                        const ch = i.oldCost > 0 && Math.abs(i.unitCost - i.oldCost) > 0.004 ? ((i.unitCost - i.oldCost) / i.oldCost) * 100 : null;
                        return `<li>
                            <span class="sale-qty">${window.toMixedFraction(i.qty)}</span>
                            <span class="name">${escHtml(i.name)}<small class="text-muted d-block">@ ${insightMoney(i.unitCost)}${ch !== null ? ` · was ${insightMoney(i.oldCost)} <b class="${ch > 0 ? "text-danger" : "text-success"}">${ch > 0 ? "▲" : "▼"}${Math.abs(ch).toFixed(1)}%</b>` : ""}</small></span>
                            <strong>${insightMoney(i.qty * i.unitCost)}</strong>
                        </li>`;
                    }).join("")}</ul>
                    ${dv.notes ? `<div class="small text-muted mt-2"><i class="fas fa-note-sticky me-1"></i>${escHtml(dv.notes)}</div>` : ""}
                    ${canVoid ? `<div class="sale-actions"><button class="btn btn-soft btn-sm" onclick="window.voidDelivery('${dv.id}')"><i class="fas fa-rotate-left text-danger me-1"></i>Void delivery</button></div>` : ""}
                </div>
            </details>`;
    }).join("");

    const remaining = list.length - visible.length;
    box.innerHTML = `<div class="sales-day"><div class="sales-day-body">${rows}</div></div>
        <div class="sales-list-footer"><span class="text-muted small">Showing ${visible.length} of ${list.length} deliveries</span>
        ${remaining > 0 ? `<button class="btn btn-custom btn-sm" onclick="window.supDeliveryLimit += 25; window.renderSuppliers()">Show ${Math.min(25, remaining)} more</button>` : ""}</div>`;
}

function renderCostChanges() {
    const body = document.getElementById("costChangesBody");
    if (!body) return;
    const priceOf = (id) => { const d = (window.productsCache || []).find(x => x.id === id); return d ? parseFloat(d.data().price) || 0 : 0; };
    const rows = [];
    window.deliveries.forEach(dv => (dv.items || []).forEach(i => {
        if (i.oldCost > 0 && Math.abs(i.unitCost - i.oldCost) > 0.004) rows.push({ dv, i });
    }));
    body.innerHTML = rows.length ? rows.slice(0, 80).map(({ dv, i }) => {
        const ch = ((i.unitCost - i.oldCost) / i.oldCost) * 100;
        const price = priceOf(i.productId);
        const margin = price > 0 ? ((price - i.unitCost) / price) * 100 : null;
        const bad = margin !== null && margin < MIN_MARGIN_PCT;
        return `<tr>
            <td class="text-muted text-nowrap">${shortDate(toDate(dv.date))}</td>
            <td class="fw-semibold">${escHtml(i.name)}</td>
            <td>${escHtml(dv.supplierName || "")}</td>
            <td class="text-end text-muted">${insightMoney(i.oldCost)}</td>
            <td class="text-end">${insightMoney(i.unitCost)}</td>
            <td class="text-end fw-bold ${ch > 0 ? "text-danger" : "text-success"}">${ch > 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(1)}%</td>
            <td class="text-end">${price > 0 ? insightMoney(price) : "-"}</td>
            <td class="text-end">${margin !== null ? `<span class="cd-pill ${bad ? "bad" : "ok"}">${margin.toFixed(1)}%</span>` : "-"}</td>
        </tr>`;
    }).join("") : `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-arrow-trend-up"></i>No cost changes yet. They appear when a delivery arrives at a different price.</div></td></tr>`;
}

/* ---------------------------------------------------------------- add / edit a supplier */
window.editSupplierId = null;

window.openSupplierModal = (id) => {
    if (!can("suppliers.manage")) return denyAccess("add or edit suppliers");
    const s = id ? window.suppliersCache[id] : null;
    window.editSupplierId = s ? s.id : null;
    document.getElementById("supName").value = s ? s.name : "";
    document.getElementById("supPhone").value = s ? (s.phone || "") : "";
    document.getElementById("supNotes").value = s ? (s.notes || "") : "";
    document.getElementById("supModalTitle").textContent = s ? "Edit Supplier" : "Add Supplier";
    bootstrap.Modal.getOrCreateInstance(document.getElementById("supplierModal")).show();
};

window.saveSupplier = async () => {
    if (!can("suppliers.manage")) return denyAccess("add or edit suppliers");
    const name = document.getElementById("supName").value.trim();
    if (!name) return Swal.fire("Name needed", "Enter the supplier's name.", "warning");
    const clash = Object.values(window.suppliersCache).find(s => normName(s.name) === normName(name) && s.id !== window.editSupplierId);
    if (clash) return Swal.fire("Already added", `${clash.name} is already in your suppliers list.`, "info");

    const data = { name, phone: document.getElementById("supPhone").value.trim(), notes: document.getElementById("supNotes").value.trim() };
    try {
        if (window.editSupplierId) await writeWithGrace(window.db.collection("suppliers").doc(window.editSupplierId).update(data));
        else await writeWithGrace(window.db.collection("suppliers").add({ ...data, balance: 0, createdAt: new Date() }));
        hideModalById("supplierModal");
        Swal.fire({ icon: "success", title: "Supplier saved", timer: 1400, showConfirmButton: false });
    } catch (err) {
        Swal.fire("Could not save", err.message, "error");
    }
};

window.deleteSupplier = async (id) => {
    if (!can("suppliers.delete")) return denyAccess("delete suppliers");
    const s = window.suppliersCache[id];
    if (!s) return;
    if (s.balance > 0) return Swal.fire("You still owe this supplier", `${s.name} is owed ${insightMoney(s.balance)}. Record the payment before deleting them.`, "warning");
    const res = await Swal.fire({ title: `Delete ${s.name}?`, text: "Their past deliveries stay in the history.", icon: "warning", showCancelButton: true, confirmButtonColor: "#d33", confirmButtonText: "Yes, delete" });
    if (!res.isConfirmed) return;
    try {
        const sup = window.suppliersCache && window.suppliersCache[id];
        await window.db.collection("suppliers").doc(id).delete();
        logAudit("delete", "supplier_delete", `Supplier deleted: ${sup ? sup.name : id}`, "", { flag: true });
    } catch (err) { Swal.fire("Error", err.message, "error"); }
};

/* ---------------------------------------------------------------- record a delivery */
window.deliveryLines = [];

window.openDeliveryModal = (supplierId) => {
    if (!can("deliveries.record")) return denyAccess("record deliveries");
    const suppliers = Object.values(window.suppliersCache).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    if (!suppliers.length) return Swal.fire("Add a supplier first", "Use Add supplier, then come back to record the delivery.", "info");

    document.getElementById("dvSupplier").innerHTML = `<option value="">Choose supplier...</option>` + suppliers.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join("");
    if (supplierId) document.getElementById("dvSupplier").value = supplierId;
    document.getElementById("dvDate").value = new Date().toLocaleDateString("en-CA");
    document.getElementById("dvInvoice").value = "";
    document.getElementById("dvPaid").value = "";
    document.getElementById("dvMethod").value = "Cash";
    document.getElementById("dvNotes").value = "";
    document.getElementById("dvProductSearch").value = "";
    document.getElementById("dvProductList").innerHTML = (window.productsCache || []).map(d => `<option value="${escHtml(d.data().name)}"></option>`).join("");

    window.deliveryLines = [];
    renderDeliveryLines();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("deliveryModal")).show();
};

window.addDeliveryLine = (productId) => {
    const doc = (window.productsCache || []).find(d => d.id === productId);
    if (!doc) return;
    const existing = window.deliveryLines.find(l => l.productId === productId);
    if (existing) existing.qty += 1;
    else {
        const p = doc.data();
        const cost = parseFloat(p.buyPrice) || 0;
        window.deliveryLines.push({ productId, name: p.name, qty: 1, unitCost: cost, oldCost: cost, price: parseFloat(p.price) || 0 });
    }
    renderDeliveryLines();
};

window.addDeliveryLineFromSearch = () => {
    const input = document.getElementById("dvProductSearch");
    const term = normName(input.value);
    if (!term) return;
    const doc = (window.productsCache || []).find(d => normName(d.data().name) === term)
        || (window.productsCache || []).find(d => String(d.data().barcode || "").trim() === input.value.trim())
        || (window.productsCache || []).filter(d => normName(d.data().name).includes(term))[0];
    if (!doc) return Swal.fire("Product not found", `No product matches "${input.value}".`, "warning");
    window.addDeliveryLine(doc.id);
    input.value = "";
    input.focus();
};

window.removeDeliveryLine = (i) => { window.deliveryLines.splice(i, 1); renderDeliveryLines(); };

function deliveryBadgeHTML(line) {
    const c = deliveryLineCheck(line);
    let html = "";
    if (c.changed) html += `<span class="dv-chip ${c.pct > 0 ? "up" : "down"}">cost ${insightMoney(line.oldCost)} → ${insightMoney(line.unitCost)} (${c.pct > 0 ? "▲" : "▼"}${Math.abs(c.pct).toFixed(1)}%)</span>`;
    if (c.flagged && c.loss) html += `<span class="dv-chip bad"><i class="fas fa-triangle-exclamation"></i> sells at a loss (price ${insightMoney(line.price)}). Sell at ${insightMoney(c.suggest)} or more</span>`;
    else if (c.flagged && c.low) html += `<span class="dv-chip warn"><i class="fas fa-triangle-exclamation"></i> margin only ${c.margin.toFixed(1)}%. Sell at ${insightMoney(c.suggest)} or more</span>`;
    return html;
}

function updateDeliveryLineUI(i) {
    const line = window.deliveryLines[i];
    if (!line) return;
    const badge = document.getElementById(`dvBadge-${i}`);
    if (badge) badge.innerHTML = deliveryBadgeHTML(line);
    const total = document.getElementById(`dvLineTotal-${i}`);
    if (total) total.textContent = insightMoney(line.qty * line.unitCost);
}

function updateDeliveryTotals() {
    const total = window.deliveryLines.reduce((n, l) => n + l.qty * l.unitCost, 0);
    const paid = Math.min(cleanNum((document.getElementById("dvPaid") || {}).value), total);
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set("dvTotal", insightMoney(total));
    set("dvOwing", insightMoney(Math.max(0, total - paid)));
    set("dvLineCount", `${window.deliveryLines.length} product${window.deliveryLines.length === 1 ? "" : "s"}`);
}

function renderDeliveryLines() {
    const body = document.getElementById("dvLines");
    if (!body) return;
    body.innerHTML = window.deliveryLines.length ? window.deliveryLines.map((l, i) => `
        <tr class="dv-row">
            <td class="dv-c-name"><div class="fw-semibold">${escHtml(l.name)}</div><div class="dv-badges" id="dvBadge-${i}">${deliveryBadgeHTML(l)}</div></td>
            <td class="dv-c-qty" data-label="Qty"><input type="number" min="0" step="any" class="form-control form-control-sm text-end dv-in" data-i="${i}" data-f="qty" value="${l.qty}"></td>
            <td class="dv-c-cost" data-label="Cost each"><input type="number" min="0" step="any" class="form-control form-control-sm text-end dv-in" data-i="${i}" data-f="unitCost" value="${l.unitCost}"></td>
            <td class="dv-c-total text-end fw-semibold text-nowrap" id="dvLineTotal-${i}">${insightMoney(l.qty * l.unitCost)}</td>
            <td class="dv-c-del"><button type="button" class="btn btn-soft btn-sm btn-icon" onclick="window.removeDeliveryLine(${i})" title="Remove"><i class="fas fa-xmark text-danger"></i></button></td>
        </tr>`).join("")
        : `<tr><td colspan="5"><div class="empty-state"><i class="fas fa-box-open"></i>Search or scan a product above to add it to this delivery.</div></td></tr>`;
    updateDeliveryTotals();
}

window.onDeliveryInput = (i, field, value) => {
    const line = window.deliveryLines[i];
    if (!line) return;
    line[field] = parseFloat(value) || 0;
    updateDeliveryLineUI(i);
    updateDeliveryTotals();
};

(function bindDeliveryInputs() {
    const body = document.getElementById("dvLines");
    if (body) body.addEventListener("input", (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains("dv-in")) window.onDeliveryInput(Number(t.dataset.i), t.dataset.f, t.value);
    });
    const paid = document.getElementById("dvPaid");
    if (paid) paid.addEventListener("input", updateDeliveryTotals);
    const search = document.getElementById("dvProductSearch");
    if (search) search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); window.addDeliveryLineFromSearch(); } });
})();

window.payDeliveryInFull = () => {
    const total = window.deliveryLines.reduce((n, l) => n + l.qty * l.unitCost, 0);
    document.getElementById("dvPaid").value = cleanNum(total);
    updateDeliveryTotals();
};

window.scanForDelivery = () => {
    window.openScanner({
        title: "Scan to add to the delivery",
        continuous: true,
        onDetect: (code) => {
            const doc = findProductByBarcode(code);
            if (!doc) return { ok: false, message: `No product has the barcode ${code}.` };
            window.addDeliveryLine(doc.id);
            return { ok: true, message: `Added ${doc.data().name}` };
        }
    });
};

window.saveDelivery = async () => {
    if (!can("deliveries.record")) return denyAccess("record deliveries");
    const supplierId = document.getElementById("dvSupplier").value;
    const supplier = window.suppliersCache[supplierId];
    if (!supplier) return Swal.fire("Choose a supplier", "Pick who the delivery is from.", "warning");
    const lines = window.deliveryLines.filter(l => l.qty > 0);
    if (!lines.length) return Swal.fire("No products", "Add at least one product with a quantity.", "warning");
    if (lines.some(l => l.unitCost < 0)) return Swal.fire("Check the costs", "A cost cannot be negative.", "warning");

    const total = cleanNum(lines.reduce((n, l) => n + l.qty * l.unitCost, 0));
    const paid = Math.min(cleanNum(document.getElementById("dvPaid").value), total);
    const method = document.getElementById("dvMethod").value;
    const dateStr = document.getElementById("dvDate").value || new Date().toLocaleDateString("en-CA");
    const now = new Date();
    const when = new Date(`${dateStr}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`);
    const by = getCurrentUserEmail() || "unknown";

    const checks = lines.map(l => ({ line: l, check: deliveryLineCheck(l) }));
    const items = lines.map(l => ({ productId: l.productId, name: l.name, qty: l.qty, unitCost: cleanNum(l.unitCost), oldCost: cleanNum(l.oldCost) }));

    try {
        const batch = window.db.batch();
        const dvRef = window.db.collection("deliveries").doc();
        batch.set(dvRef, {
            supplierId, supplierName: supplier.name, date: when, dateKey: dateStr,
            invoiceNo: document.getElementById("dvInvoice").value.trim(),
            items, total, paid, method, notes: document.getElementById("dvNotes").value.trim(),
            receivedBy: by, createdAt: new Date()
        });

        checks.forEach(({ line, check }) => {
            const doc = (window.productsCache || []).find(d => d.id === line.productId);
            const current = doc ? parseFloat(doc.data().stock) || 0 : 0;
            const update = { stock: firebase.firestore.FieldValue.increment(line.qty) };
            if (check.changed) update.buyPrice = cleanNum(line.unitCost);          // the product's cost follows the supplier's price
            batch.update(window.db.collection("products").doc(line.productId), update);
            batch.set(window.db.collection("restock_logs").doc(), {
                productId: line.productId, name: line.name, quantityAdded: line.qty,
                previousStock: current, afterStock: current + line.qty,
                reason: `Delivery from ${supplier.name}`, supplierId, restockedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        if (total - paid > 0.004) batch.update(window.db.collection("suppliers").doc(supplierId), { balance: firebase.firestore.FieldValue.increment(cleanNum(total - paid)) });
        if (paid > 0) {
            batch.set(window.db.collection("supplier_payments").doc(), {
                supplierId, supplierName: supplier.name, amount: paid, method, note: "Paid on delivery",
                deliveryId: dvRef.id, paidBy: by, dateKey: dateStr, at: new Date()
            });
        }
        const confirmed = await writeWithGrace(batch.commit());
        hideModalById("deliveryModal");

        const flagged = checks.filter(c => c.check.flagged);
        const changed = checks.filter(c => c.check.changed);
        const html = `
            <div class="text-start">
                <div class="mb-2">${lines.length} product${lines.length === 1 ? "" : "s"} added to stock · total <b>${insightMoney(total)}</b>${total - paid > 0.004 ? ` · you owe <b>${insightMoney(total - paid)}</b>` : " · paid in full"}</div>
                ${changed.length ? `<div class="fw-semibold mt-3 mb-1">Cost updated for ${changed.length} product${changed.length === 1 ? "" : "s"}</div>` + changed.map(c => `<div class="small">• ${escHtml(c.line.name)}: ${insightMoney(c.line.oldCost)} → ${insightMoney(c.line.unitCost)} (${c.check.pct > 0 ? "▲" : "▼"}${Math.abs(c.check.pct).toFixed(1)}%)</div>`).join("") : ""}
                ${flagged.length ? `<div class="fw-semibold mt-3 mb-1 text-danger"><i class="fas fa-triangle-exclamation me-1"></i>Check these selling prices</div>` + flagged.map(c => `<div class="small">• <b>${escHtml(c.line.name)}</b> sells for ${insightMoney(c.line.price)}: ${c.check.loss ? "that is a <b>loss</b>" : `margin only ${c.check.margin.toFixed(1)}%`}. Sell at ${insightMoney(c.check.suggest)} or more.</div>`).join("") : ""}
            </div>`;
        await Swal.fire({ icon: flagged.length ? "warning" : "success", title: confirmed ? "Delivery recorded" : "Saved on this device", html });

        try {
            window.notifyDelivery({ supplier: supplier.name, total, paid, count: lines.length, by, changed, flagged });
        } catch (alertErr) { console.warn("Delivery alert failed:", alertErr); }
    } catch (err) {
        Swal.fire("Could not save the delivery", err.message, "error");
    }
};

window.notifyDelivery = (d) => {
    const lines = [`📦 *Delivery received* - ${d.supplier}`, `${d.count} product${d.count === 1 ? "" : "s"}, total KSh ${Math.round(d.total).toLocaleString()}`,
        d.total - d.paid > 0.004 ? `You owe: KSh ${Math.round(d.total - d.paid).toLocaleString()}` : "Paid in full", `Recorded by: ${d.by}`];
    d.changed.forEach(c => lines.push(`• ${c.line.name}: cost ${Math.round(c.line.oldCost)} → ${Math.round(c.line.unitCost)} (${c.check.pct > 0 ? "+" : ""}${c.check.pct.toFixed(1)}%)`));
    d.flagged.forEach(c => lines.push(`⚠️ ${c.line.name}: ${c.check.loss ? "now sells at a LOSS" : "low margin " + c.check.margin.toFixed(1) + "%"} (price ${Math.round(c.line.price)}, needs ${Math.round(c.check.suggest)}+)`));
    window.sendAlert(lines.join("\n"), "onDelivery");
};

/* ---------------------------------------------------------------- void a delivery */
window.voidDelivery = async (id) => {
    if (!can("suppliers.delete")) return denyAccess("void deliveries");
    const dv = window.deliveries.find(d => d.id === id);
    if (!dv) return;
    if ((parseFloat(dv.paid) || 0) > 0.004) {
        return Swal.fire("This delivery has payments", "Part or all of it has been paid. Voiding it would leave the payments without a delivery, so it cannot be voided.", "info");
    }
    const res = await Swal.fire({
        title: "Void this delivery?",
        html: `The stock added by this delivery is taken off again and the ${insightMoney(dv.total)} is removed from what you owe ${escHtml(dv.supplierName || "the supplier")}. Product cost prices stay as they are.`,
        icon: "warning", showCancelButton: true, confirmButtonColor: "#d33", confirmButtonText: "Yes, void it"
    });
    if (!res.isConfirmed) return;
    try {
        const batch = window.db.batch();
        (dv.items || []).forEach(i => {
            const doc = (window.productsCache || []).find(d => d.id === i.productId);
            if (!doc) return;
            const current = parseFloat(doc.data().stock) || 0;
            batch.update(window.db.collection("products").doc(i.productId), { stock: firebase.firestore.FieldValue.increment(-i.qty) });
            batch.set(window.db.collection("restock_logs").doc(), {
                productId: i.productId, name: i.name, quantityAdded: -i.qty, previousStock: current, afterStock: Math.max(0, current - i.qty),
                reason: `Delivery voided (${dv.supplierName})`, restockedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        if (window.suppliersCache[dv.supplierId]) {
            batch.update(window.db.collection("suppliers").doc(dv.supplierId), { balance: firebase.firestore.FieldValue.increment(-cleanNum(dv.total)) });
        }
        batch.delete(window.db.collection("deliveries").doc(id));
        await batch.commit();
        logAudit("money", "delivery_void", `Delivery voided: ${dv.supplierName || "supplier"}, ${insightMoney(dv.total)}`,
            (dv.items || []).map(i => `${window.toMixedFraction(i.qty)} × ${i.name}`).join(", "), { amount: dv.total, flag: true });
        Swal.fire({ icon: "success", title: "Delivery voided", timer: 1600, showConfirmButton: false });
    } catch (err) {
        Swal.fire("Could not void", err.message, "error");
    }
};

/* ---------------------------------------------------------------- pay a supplier */
/**
 * Spreads a payment over the supplier's oldest unpaid deliveries first
 */
function allocateSupplierPayment(supplierId, amount) {
    const unpaid = window.deliveries
        .filter(d => d.supplierId === supplierId && (parseFloat(d.paid) || 0) < (parseFloat(d.total) || 0) - 0.005)
        .sort((a, b) => toDate(a.date) - toDate(b.date));
    let left = amount;
    const updates = [];
    for (const d of unpaid) {
        if (left <= 0.004) break;
        const paid = parseFloat(d.paid) || 0, total = parseFloat(d.total) || 0;
        const apply = Math.min(total - paid, left);
        updates.push({ id: d.id, paid: cleanNum(paid + apply) });
        left -= apply;
    }
    return updates;
}

window.openSupplierPayment = (id) => {
    if (!can("suppliers.pay")) return denyAccess("pay suppliers");
    const s = window.suppliersCache[id];
    if (!s) return;
    window.supplierPayId = id;
    document.getElementById("spName").textContent = s.name;
    document.getElementById("spBalance").textContent = insightMoney(s.balance);
    document.getElementById("spAmount").value = "";
    document.getElementById("spMethod").value = "Cash";
    document.getElementById("spNote").value = "";
    bootstrap.Modal.getOrCreateInstance(document.getElementById("supplierPayModal")).show();
};

window.fillSupplierPaymentFull = () => {
    const s = window.suppliersCache[window.supplierPayId];
    if (s) document.getElementById("spAmount").value = s.balance;
};

window.saveSupplierPayment = async () => {
    if (!can("suppliers.pay")) return denyAccess("pay suppliers");
    const id = window.supplierPayId;
    const s = window.suppliersCache[id];
    if (!s) return;
    const amount = cleanNum(document.getElementById("spAmount").value);
    if (amount <= 0) return Swal.fire("Enter an amount", "Type how much you paid.", "warning");
    if (amount > s.balance + 0.005) return Swal.fire("Too much", `You only owe ${s.name} ${insightMoney(s.balance)}.`, "warning");

    try {
        const batch = window.db.batch();
        const method = document.getElementById("spMethod").value;
        batch.set(window.db.collection("supplier_payments").doc(), {
            supplierId: id, supplierName: s.name, amount, method, note: document.getElementById("spNote").value.trim(),
            paidBy: getCurrentUserEmail() || "unknown", dateKey: new Date().toLocaleDateString("en-CA"), at: new Date()
        });
        allocateSupplierPayment(id, amount).forEach(u => batch.update(window.db.collection("deliveries").doc(u.id), { paid: u.paid }));
        batch.update(window.db.collection("suppliers").doc(id), { balance: firebase.firestore.FieldValue.increment(-amount) });
        const confirmed = await writeWithGrace(batch.commit());
        hideModalById("supplierPayModal");
        const left = Math.max(0, s.balance - amount);
        Swal.fire({ icon: "success", title: confirmed ? "Payment recorded" : "Saved on this device", text: `${insightMoney(amount)} paid to ${s.name}. ${left > 0 ? "Still owed: " + insightMoney(left) : "Nothing owed now."}` });
    } catch (err) {
        Swal.fire("Could not save the payment", err.message, "error");
    }
};

/* ---------------------------------------------------------------- supplier statement */
window.openSupplierStatement = (id) => {
    if (!can("suppliers.view")) return denyAccess("see suppliers");
    const s = window.suppliersCache[id];
    if (!s) return;
    const entries = [];
    window.deliveries.filter(d => d.supplierId === id).forEach(d => entries.push({
        date: toDate(d.date), desc: `Delivery${d.invoiceNo ? " (invoice " + d.invoiceNo + ")" : ""}: ${(d.items || []).map(i => `${window.toMixedFraction(i.qty)} x ${i.name}`).join(", ")}`, debit: parseFloat(d.total) || 0, credit: 0
    }));
    window.supplierPayments.filter(p => p.supplierId === id).forEach(p => entries.push({
        date: toDate(p.at), desc: `Payment (${p.method})${p.note ? " - " + p.note : ""}`, debit: 0, credit: parseFloat(p.amount) || 0
    }));
    entries.sort((a, b) => b.date - a.date);
    const totalDebit = entries.reduce((n, e) => n + e.debit, 0), totalCredit = entries.reduce((n, e) => n + e.credit, 0);
    window.currentSupplierStatement = { supplier: s, entries, totalDebit, totalCredit };

    document.getElementById("ssName").textContent = s.name + (s.phone ? " · " + s.phone : "");
    document.getElementById("ssBalance").textContent = insightMoney(s.balance);
    document.getElementById("ssBalance").className = "fw-bold fs-5 " + (s.balance > 0 ? "text-danger" : "text-success");
    document.getElementById("ssBody").innerHTML = entries.length ? entries.map(e => `
        <tr><td class="text-nowrap">${shortDate(e.date)}</td><td>${escHtml(e.desc)}</td>
        <td class="text-end">${e.debit ? insightMoney(e.debit) : ""}</td><td class="text-end text-success">${e.credit ? insightMoney(e.credit) : ""}</td></tr>`).join("")
        : `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-file-lines"></i>Nothing recorded yet.</div></td></tr>`;
    document.getElementById("ssTotals").innerHTML = entries.length ? `<tr><th colspan="2">Totals</th><th class="text-end">${insightMoney(totalDebit)}</th><th class="text-end">${insightMoney(totalCredit)}</th></tr>` : "";
    bootstrap.Modal.getOrCreateInstance(document.getElementById("supplierStatementModal")).show();
};

window.downloadSupplierStatement = () => {
    const st = window.currentSupplierStatement;
    if (!st) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(20); doc.setTextColor(41, 128, 185);
    doc.text("MADOLLAR LIQUOR PUB", 105, 15, null, null, "center");
    doc.setFontSize(14); doc.setTextColor(0);
    doc.text("Supplier Statement", 105, 24, null, null, "center");
    doc.setFontSize(11);
    doc.text(`Supplier: ${st.supplier.name}${st.supplier.phone ? " (" + st.supplier.phone + ")" : ""}`, 14, 36);
    doc.text(`Date: ${new Date().toLocaleDateString("en-GB")}`, 14, 43);
    doc.text(`We owe: ${insightMoney(st.supplier.balance)}`, 14, 50);
    doc.autoTable({
        startY: 58, head: [["Date", "Details", "Delivered (KSh)", "Paid (KSh)"]],
        body: st.entries.map(e => [shortDate(e.date), e.desc, e.debit ? e.debit.toLocaleString() : "", e.credit ? e.credit.toLocaleString() : ""]),
        foot: [["", "Totals", st.totalDebit.toLocaleString(), st.totalCredit.toLocaleString()]],
        theme: "striped", headStyles: { fillColor: [41, 128, 185] }, styles: { fontSize: 9, cellPadding: 3 }
    });
    doc.save(`Supplier_${st.supplier.name.replace(/\s+/g, "_")}.pdf`);
};


/* ====================================================================== DEBT REMINDERS */
const DEFAULT_REMINDER_TEXT = "Hello {name}, this is a friendly reminder from Madollar Liquor Pub. Your tab balance is KSh {balance}. Please settle when you can. You can pay by M-PESA to Till 3234719. Thank you!";
window.reminderTemplate = DEFAULT_REMINDER_TEXT;
window.reminderOnly = null;

window.db.collection("settings").doc("reminders").onSnapshot(doc => {
    if (doc.exists && doc.data().template) window.reminderTemplate = doc.data().template;
}, err => console.warn("Reminders settings listener:", err));

function debtorsList() {
    return Object.values(window.customersCache || {})
        .filter(c => c.balance > 0)
        .sort((a, b) => {
            const ta = a.lastReminderAt ? a.lastReminderAt.getTime() : 0, tb = b.lastReminderAt ? b.lastReminderAt.getTime() : 0;
            return ta - tb || b.balance - a.balance;      // never reminded first, then longest ago, then biggest debt
        });
}

window.reminderText = (c, template) => {
    const t = template !== undefined ? template : ((document.getElementById("rmTemplate") || {}).value || window.reminderTemplate);
    return String(t || window.reminderTemplate)
        .replace(/\{name\}/g, c.name || "")
        .replace(/\{balance\}/g, Number(c.balance).toLocaleString(undefined, { maximumFractionDigits: 2 }));
};

function reminderAgo(date) {
    if (!date) return "Never reminded";
    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    return days <= 0 ? "Reminded today" : `Reminded ${days} day${days === 1 ? "" : "s"} ago`;
}

window.openReminders = (customerId) => {
    if (!can("customers.remind")) return denyAccess("send reminders");
    window.reminderOnly = customerId || null;
    document.getElementById("rmTemplate").value = window.reminderTemplate;
    document.getElementById("rmSaveDefaultBtn").classList.toggle("d-none", !isAdmin());
    window.renderReminderList();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("remindersModal")).show();
};

window.renderReminderList = () => {
    const box = document.getElementById("rmList");
    if (!box) return;
    let list = debtorsList();
    const totalAll = list.reduce((n, c) => n + c.balance, 0);
    if (window.reminderOnly) list = list.filter(c => c.id === window.reminderOnly);

    const summary = document.getElementById("rmSummary");
    if (summary) {
        summary.innerHTML = window.reminderOnly
            ? `<a href="#" onclick="event.preventDefault(); window.reminderOnly = null; window.renderReminderList()"><i class="fas fa-users me-1"></i>Show everyone who owes money</a>`
            : (list.length ? `<b>${list.length}</b> customer${list.length === 1 ? "" : "s"} owe <b>${insightMoney(totalAll)}</b> in total` : "No customer owes money.");
    }

    box.innerHTML = list.length ? list.map(c => {
        const phone = normalizePhone(c.phone);
        const ok = phone.length >= 10;
        return `
            <div class="rm-row">
                <div class="rm-who">
                    <b>${escHtml(c.name)}</b>
                    <small>${ok ? escHtml(c.phone) : '<span class="text-danger">No valid phone number</span>'} · ${reminderAgo(c.lastReminderAt)}</small>
                </div>
                <div class="rm-amount">${insightMoney(c.balance)}</div>
                <div class="rm-buttons">
                    <button class="btn btn-sm rm-wa" ${ok ? "" : "disabled"} onclick="window.sendReminder('${c.id}', 'whatsapp')" title="Open WhatsApp with the message ready"><i class="fab fa-whatsapp me-1"></i>WhatsApp</button>
                    <button class="btn btn-sm btn-soft" ${ok ? "" : "disabled"} onclick="window.sendReminder('${c.id}', 'sms')" title="Open the SMS app with the message ready"><i class="fas fa-message me-1"></i>SMS</button>
                    <button class="btn btn-sm btn-soft btn-icon" onclick="window.sendReminder('${c.id}', 'copy')" title="Copy the message"><i class="far fa-copy"></i></button>
                </div>
            </div>`;
    }).join("") : `<div class="empty-state"><i class="fas fa-circle-check"></i>Nobody to remind.</div>`;
};

window.sendReminder = async (customerId, channel) => {
    if (!can("customers.remind")) return denyAccess("send reminders");
    const c = window.customersCache[customerId];
    if (!c) return;
    const text = window.reminderText(c);

    if (channel === "copy") {
        try { await navigator.clipboard.writeText(text); Swal.fire({ toast: true, position: "top", icon: "success", title: "Message copied", timer: 1500, showConfirmButton: false }); }
        catch (e) { Swal.fire("Could not copy", "Your browser blocked copying.", "info"); }
        return;
    }

    const phone = normalizePhone(c.phone);
    if (phone.length < 10) return Swal.fire("No phone number", `${c.name} has no valid phone number saved.`, "info");

    if (channel === "whatsapp") window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
    else window.location.href = `sms:+${phone}?body=${encodeURIComponent(text)}`;

    // remember when they were last reminded
    c.lastReminderAt = new Date();
    window.renderReminderList();
    window.db.collection("customers").doc(customerId).update({
        lastReminderAt: new Date(), reminderCount: firebase.firestore.FieldValue.increment(1)
    }).catch(err => console.warn("Could not record the reminder:", err));
};

window.saveReminderTemplate = async () => {
    if (!isAdmin()) return denyAccess("change the reminder message");
    const template = document.getElementById("rmTemplate").value.trim();
    if (!template) return Swal.fire("Message needed", "The reminder message cannot be empty.", "warning");
    try {
        await window.db.collection("settings").doc("reminders").set({ template, updatedAt: new Date() });
        window.reminderTemplate = template;
        Swal.fire({ toast: true, position: "top", icon: "success", title: "Saved as the standard message", timer: 1800, showConfirmButton: false });
    } catch (err) {
        Swal.fire("Could not save", err.message, "error");
    }
};


/* ====================================================================== BARCODE SCANNING */
function findProductByBarcode(code) {
    const c = String(code || "").trim();
    if (!c) return null;
    return (window.productsCache || []).find(d => String(d.data().barcode || "").trim() === c) || null;
}

function barcodeInUse(code, exceptId) {
    const c = String(code || "").trim();
    return !!c && (window.productsCache || []).some(d => d.id !== exceptId && String(d.data().barcode || "").trim() === c);
}

window.scanner = { stream: null, reader: null, timer: null, onDetect: null, continuous: false, lastCode: "", lastAt: 0, running: false };

function loadZXing() {
    return new Promise((resolve, reject) => {
        if (window.ZXing) return resolve();
        const tag = document.createElement("script");
        tag.src = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
        tag.onload = () => resolve();
        tag.onerror = () => reject(new Error("Could not load the barcode reader. Check your internet connection."));
        document.head.appendChild(tag);
    });
}

function setScanStatus(text, kind) {
    const el = document.getElementById("scanStatus");
    if (!el) return;
    el.textContent = text;
    el.className = "scan-status" + (kind ? " " + kind : "");
}

/**
 * Opens the camera scanner. opts = { title, onDetect(code) -> {ok, message, close}, continuous }
 */
window.openScanner = async (opts) => {
    const sc = window.scanner;
    sc.onDetect = opts.onDetect;
    sc.continuous = !!opts.continuous;
    sc.lastCode = ""; sc.lastAt = 0;
    document.getElementById("scanTitle").textContent = opts.title || "Scan a barcode";
    document.getElementById("scanUnknown").classList.add("d-none");
    document.getElementById("scanLog").innerHTML = "";
    document.getElementById("scanManual").value = "";
    setScanStatus("Starting the camera...");
    bootstrap.Modal.getOrCreateInstance(document.getElementById("scannerModal")).show();
    await startScanner();
};

async function startScanner() {
    const sc = window.scanner;
    const video = document.getElementById("scanVideo");
    stopScanner();
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("This browser cannot use the camera here. You can still type the barcode below.");
        if ("BarcodeDetector" in window) {
            sc.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
            video.srcObject = sc.stream;
            await video.play();
            const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"] });
            sc.running = true;
            sc.timer = setInterval(async () => {
                if (!sc.running || video.readyState < 2) return;
                try {
                    const found = await detector.detect(video);
                    if (found && found.length) window.handleScan(found[0].rawValue);
                } catch (e) { /* a frame without a readable code */ }
            }, 250);
        } else {
            await loadZXing();
            sc.reader = new window.ZXing.BrowserMultiFormatReader();
            sc.running = true;
            sc.reader.decodeFromVideoDevice(null, video, (result) => { if (result) window.handleScan(result.getText()); });
        }
        setScanStatus("Point the camera at a barcode");
    } catch (err) {
        setScanStatus(err && err.name === "NotAllowedError" ? "Camera permission was denied. Allow the camera for this site, or type the barcode below." : (err.message || "Could not open the camera. You can type the barcode below."), "bad");
    }
}

function stopScanner() {
    const sc = window.scanner;
    sc.running = false;
    if (sc.timer) { clearInterval(sc.timer); sc.timer = null; }
    if (sc.stream) { sc.stream.getTracks().forEach(t => t.stop()); sc.stream = null; }
    if (sc.reader) { try { sc.reader.reset(); } catch (e) { } sc.reader = null; }
    const video = document.getElementById("scanVideo");
    if (video) { try { video.srcObject = null; } catch (e) { } }
}
window.stopScanner = stopScanner;

(function bindScannerModal() {
    const modalEl = document.getElementById("scannerModal");
    if (modalEl) modalEl.addEventListener("hidden.bs.modal", stopScanner);
    const manual = document.getElementById("scanManual");
    if (manual) manual.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); window.submitManualScan(); } });
})();

window.closeScanner = () => { stopScanner(); hideModalById("scannerModal"); };

window.submitManualScan = () => {
    const input = document.getElementById("scanManual");
    const code = (input.value || "").trim();
    if (!code) return;
    input.value = "";
    window.handleScan(code, true);
};

/**
 * One barcode has been read (by the camera, a barcode reader, or typed). Repeats of the same code within 1.5s are ignored.
 */
window.handleScan = (rawCode, forced) => {
    const sc = window.scanner;
    const code = String(rawCode || "").trim();
    if (!code || !sc.onDetect) return;
    const now = Date.now();
    if (!forced && code === sc.lastCode && now - sc.lastAt < 1500) return;
    sc.lastCode = code; sc.lastAt = now;

    const res = sc.onDetect(code) || {};
    const log = document.getElementById("scanLog");
    if (res.ok) {
        setScanStatus(res.message || "Scanned", "ok");
        if (log) log.insertAdjacentHTML("afterbegin", `<div class="scan-log-item"><i class="fas fa-check text-success me-2"></i>${escHtml(res.message || code)}</div>`);
        try { new Audio("https://actions.google.com/sounds/v1/ui/beep_short.ogg").play(); } catch (e) { }
        if (res.close || !sc.continuous) window.closeScanner();
    } else if (res.unknown) {
        setScanStatus(res.message || `Barcode ${code} is not linked to a product yet`, "warn");
        window.showUnknownBarcode(code);
    } else {
        setScanStatus(res.message || "Not recognised", "bad");
    }
};

/* ---- unknown barcode: link it to a product on the spot ---- */
window.showUnknownBarcode = (code) => {
    window.scanner.unknownCode = code;
    document.getElementById("scanUnknownCode").textContent = code;
    document.getElementById("scanUnknownList").innerHTML = (window.productsCache || []).map(d => `<option value="${escHtml(d.data().name)}"></option>`).join("");
    document.getElementById("scanUnknownProduct").value = "";
    document.getElementById("scanUnknownSave").classList.toggle("d-none", !can("products.edit"));
    document.getElementById("scanUnknownNote").classList.toggle("d-none", can("products.edit"));
    document.getElementById("scanUnknown").classList.remove("d-none");
};

window.linkUnknownBarcode = async () => {
    if (!can("products.edit")) return denyAccess("edit products");
    const code = window.scanner.unknownCode;
    const term = normName(document.getElementById("scanUnknownProduct").value);
    const doc = (window.productsCache || []).find(d => normName(d.data().name) === term);
    if (!doc) return Swal.fire("Choose a product", "Pick the product from the list.", "warning");
    if (barcodeInUse(code, doc.id)) return Swal.fire("Barcode already used", "That barcode already belongs to another product.", "warning");
    try {
        await writeWithGrace(window.db.collection("products").doc(doc.id).update({ barcode: code }));
        doc.data = (orig => () => ({ ...orig(), barcode: code }))(doc.data);     // use it straight away, before the list refreshes
        document.getElementById("scanUnknown").classList.add("d-none");
        window.handleScan(code, true);
    } catch (err) {
        Swal.fire("Could not save", err.message, "error");
    }
};

/* ---- fill a text box from the camera (product forms) ---- */
window.scanInto = (inputId) => {
    window.openScanner({
        title: "Scan the barcode on the bottle",
        onDetect: (code) => {
            document.getElementById(inputId).value = code;
            if (inputId === "prodBarcode") window.lookupBarcodeName(code);
            return { ok: true, message: `Barcode ${code} captured`, close: true };
        }
    });
};

/* ---- new product: try to fill the name/category from a public product database ---- */
function guessCategory(tags) {
    const t = (tags || []).join(" ").toLowerCase();
    const rules = [[/beer|lager|stout|cider/, "Beer"], [/wine|champagne/, "Wine"], [/whisk|vodka|gin\b|rum\b|brandy|liqueur|tequila|spirit/, "Spirits"],
                   [/water|soda|juice|soft-drink|beverages-and-beverages-preparations|sweetened-beverages|energy/, "Soft drinks"]];
    for (const [re, name] of rules) if (re.test(t)) return name;
    return "";
}

window.lookupBarcodeName = async (code) => {
    code = String(code || "").trim();
    const note = document.getElementById("prodBarcodeNote");
    const nameEl = document.getElementById("prodName");
    const catEl = document.getElementById("prodCategory");
    if (!note || !nameEl || !/^\d{6,14}$/.test(code)) { if (note) note.textContent = ""; return; }
    if (barcodeInUse(code, null)) { note.textContent = "A product in your list already uses this barcode."; return; }
    if (!navigator.onLine) { note.textContent = "No internet, so the name could not be looked up. Type it in."; return; }
    note.textContent = "Looking up the product name...";
    try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 6000);
        const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,quantity,categories_tags`, { signal: ctl.signal });
        clearTimeout(timer);
        const data = await res.json();
        const p = data && data.status === 1 ? data.product : null;
        const found = p && (p.product_name || "").trim();
        if (!found) { note.textContent = "This barcode was not found in the product database. Type the name in."; return; }
        const brand = (p.brands || "").split(",")[0].trim();
        let name = found;
        if (brand && !name.toLowerCase().includes(brand.toLowerCase())) name = brand + " " + name;
        const qty = (p.quantity || "").replace(/\s+/g, "");
        if (qty && !name.replace(/\s+/g, "").toLowerCase().includes(qty.toLowerCase())) name += " " + qty;
        name = name.toUpperCase();
        const filled = [];
        if (!nameEl.value.trim()) { nameEl.value = name; filled.push("name"); }
        const cat = guessCategory(p.categories_tags);
        if (cat && catEl && !catEl.value.trim()) { catEl.value = cat; filled.push("category"); }
        note.textContent = filled.length ? `Found "${name}". Filled in the ${filled.join(" and ")}, please check it.` : `Found "${name}", but you had already typed this in.`;
    } catch (e) {
        note.textContent = "Could not look the name up. Type it in.";
    }
};

(function bindBarcodeLookup() {
    const input = document.getElementById("prodBarcode");
    if (input) input.addEventListener("change", () => window.lookupBarcodeName(input.value));
})();

/* ---- POS: scan a bottle to add it to the cart ---- */
window.openPosScanner = () => {
    if (!can("pos.sell")) return denyAccess("make sales");
    window.openScanner({
        title: "Scan bottles to add them to the cart",
        continuous: true,
        onDetect: (code) => {
            const doc = findProductByBarcode(code);
            if (!doc) return { ok: false, unknown: true, message: `Barcode ${code} is not linked to a product yet` };
            const added = addProductToCart(doc, 1, false, true);
            if (!added) return { ok: false, message: `${doc.data().name} could not be added (see the message)` };
            const inCart = cart.filter(c => c.id === doc.id && !c.unit).reduce((n, c) => n + c.qty, 0);
            return { ok: true, message: `${doc.data().name} · ${window.toMixedFraction(inCart)} in the cart` };
        }
    });
};

// A barcode reader (USB or Bluetooth) types the number and presses Enter: if the box holds a known barcode, add that product
(function bindPosBarcodeEnter() {
    const box = document.getElementById("productSearch");
    if (!box) return;
    box.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const doc = findProductByBarcode(box.value);
        if (!doc) return;
        e.preventDefault();
        if (addProductToCart(doc, 1, false, true)) {
            box.value = "";
            const results = document.getElementById("productResults");
            if (results) results.style.display = "none";
        }
    });
})();


/* ==========================================================================
   SECTION 12H: TILL PRICE CHANGES & DISCOUNTS, REFUNDS AND THE AUDIT TRAIL
   ========================================================================== */

const PRICE_REASONS = ["Regular customer", "Damaged or old stock", "Price agreed with the customer", "Promotion / happy hour", "Wrong price in the system", "Approved by the manager", "Other"];
const REFUND_REASONS = ["Wrong item sold", "Customer changed their mind", "Damaged or spoiled", "Cashier made a mistake", "Wrong price charged", "Other"];

function fillReasonSelect(selectId, list) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">Choose a reason...</option>` + list.map(r => `<option>${escHtml(r)}</option>`).join("");
}

window.onReasonChange = (selectId, otherId) => {
    const sel = document.getElementById(selectId);
    const other = document.getElementById(otherId);
    if (other) other.classList.toggle("d-none", !(sel && sel.value === "Other"));
};

/** The reason the person picked or typed. Empty when they have not given one yet. */
function readReason(selectId, otherId) {
    const sel = document.getElementById(selectId);
    const v = sel ? sel.value : "";
    if (!v) return "";
    if (v === "Other") return ((document.getElementById(otherId) || {}).value || "").trim();
    return v;
}

function resetReason(selectId, otherId) {
    const sel = document.getElementById(selectId);
    const other = document.getElementById(otherId);
    if (sel) sel.value = "";
    if (other) { other.value = ""; other.classList.add("d-none"); }
}

fillReasonSelect("pcReason", PRICE_REASONS);
fillReasonSelect("dcReason", PRICE_REASONS);
fillReasonSelect("rfReason", REFUND_REASONS);

/** What one unit of a cart line cost you (a tot costs its share of the bottle). null when the product is unknown. */
function unitCostForCartLine(c) {
    const doc = (window.productsCache || []).find(p => p.id === c.id);
    if (!doc) return null;
    const p = doc.data();
    const bottle = parseFloat(p.buyPrice) || 0;
    const tots = parseFloat(p.totsPerBottle) || parseFloat(c.totsPerBottle) || 0;
    return c.unit === "tot" && tots > 0 ? bottle / tots : bottle;
}

/* ---------------------------------------------------------------- change one item's price */
window.priceEditIndex = null;

window.openPriceModal = (i) => {
    if (!can("pos.priceoverride")) return denyAccess("change prices at the till");
    const c = cart[i];
    if (!c) return;
    window.priceEditIndex = i;
    const list = c.listPrice !== undefined ? c.listPrice : c.price;
    document.getElementById("pcProduct").textContent = itemLabel(c);
    document.getElementById("pcList").textContent = insightMoney(list);
    document.getElementById("pcNew").value = c.price;
    resetReason("pcReason", "pcReasonOther");
    document.getElementById("pcResetBtn").classList.toggle("d-none", c.listPrice === undefined);
    window.updatePricePreview();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("priceModal")).show();
};

window.updatePricePreview = () => {
    const c = cart[window.priceEditIndex];
    const hint = document.getElementById("pcHint");
    if (!c || !hint) return;
    const list = c.listPrice !== undefined ? c.listPrice : c.price;
    const raw = document.getElementById("pcNew").value;
    if (raw === "") { hint.innerHTML = ""; return; }
    const n = parseFloat(raw);
    if (isNaN(n) || n < 0) { hint.innerHTML = `<span class="text-danger">Enter a price of 0 or more.</span>`; return; }
    const diff = round2(n - list);
    const parts = [];
    if (diff < 0) parts.push(`<span class="text-warning"><i class="fas fa-arrow-down me-1"></i>${insightMoney(-diff)} less each, ${insightMoney(-diff * c.qty)} less in total</span>`);
    else if (diff > 0) parts.push(`<span class="text-info"><i class="fas fa-arrow-up me-1"></i>${insightMoney(diff)} more each</span>`);
    const cost = unitCostForCartLine(c);
    if (cost !== null && cost > 0 && n < cost) {
        parts.push(can("view.buyPrices")
            ? `<span class="text-danger"><i class="fas fa-triangle-exclamation me-1"></i>Below the buying price (${insightMoney(cost)}): you lose ${insightMoney(cost - n)} on each.</span>`
            : `<span class="text-danger"><i class="fas fa-triangle-exclamation me-1"></i>This is below what the item cost you.</span>`);
    }
    hint.innerHTML = parts.join("<br>");
};

window.savePriceChange = () => {
    if (!can("pos.priceoverride")) return denyAccess("change prices at the till");
    const c = cart[window.priceEditIndex];
    if (!c) return;
    const n = round2(parseFloat(document.getElementById("pcNew").value));
    if (isNaN(n) || n < 0) return Swal.fire("Price needed", "Enter the new price for one unit.", "warning");
    const list = c.listPrice !== undefined ? c.listPrice : c.price;
    if (n === list) return window.resetPriceChange();
    const reason = readReason("pcReason", "pcReasonOther");
    if (!reason) return Swal.fire("Reason needed", "Choose or type why the price is different. It is recorded with your name.", "warning");
    c.listPrice = list;
    c.price = n;
    c.priceReason = reason;
    hideModalById("priceModal");
    renderCart();
};

window.resetPriceChange = () => {
    const c = cart[window.priceEditIndex];
    if (c && c.listPrice !== undefined) {
        c.price = c.listPrice;
        delete c.listPrice;
        delete c.priceReason;
    }
    hideModalById("priceModal");
    renderCart();
};

/* ---------------------------------------------------------------- discount on the whole cart */
window.dcKind = "percent";

window.openDiscountModal = () => {
    if (!can("pos.discount")) return denyAccess("give discounts");
    if (!cart.length) return Swal.fire("The cart is empty", "Add the items first, then give the discount.", "info");
    document.getElementById("dcSubtotal").textContent = insightMoney(cartSubtotal());
    document.getElementById("dcValue").value = cartDiscount ? cartDiscount.value : "";
    resetReason("dcReason", "dcReasonOther");
    document.getElementById("dcRemoveBtn").classList.toggle("d-none", !cartDiscount);
    window.setDiscountKind(cartDiscount ? cartDiscount.kind : "percent");
    bootstrap.Modal.getOrCreateInstance(document.getElementById("discountModal")).show();
};

window.setDiscountKind = (kind) => {
    window.dcKind = kind;
    document.getElementById("dcKindPercent").classList.toggle("active", kind === "percent");
    document.getElementById("dcKindAmount").classList.toggle("active", kind === "amount");
    document.getElementById("dcUnit").textContent = kind === "percent" ? "%" : "KSh";
    window.updateDiscountPreview();
};

window.updateDiscountPreview = () => {
    const out = document.getElementById("dcPreview");
    const sub = cartSubtotal();
    const raw = document.getElementById("dcValue").value;
    if (raw === "") { out.innerHTML = ""; return; }
    const v = parseFloat(raw);
    if (isNaN(v) || v <= 0) { out.innerHTML = `<span class="text-danger">Enter a number above 0.</span>`; return; }
    if (window.dcKind === "percent" && v > 100) { out.innerHTML = `<span class="text-danger">A percentage cannot be more than 100.</span>`; return; }
    const amt = discountAmountFor(window.dcKind, v, sub);
    if (window.dcKind === "amount" && v > sub) { out.innerHTML = `<span class="text-danger">That is more than the whole cart (${insightMoney(sub)}).</span>`; return; }
    out.innerHTML = `<div class="d-flex justify-content-between"><span>Discount</span><b>− ${insightMoney(amt)}</b></div>
        <div class="d-flex justify-content-between"><span>New total</span><b>${insightMoney(sub - amt)}</b></div>`;
};

window.saveDiscount = () => {
    if (!can("pos.discount")) return denyAccess("give discounts");
    const v = parseFloat(document.getElementById("dcValue").value);
    const sub = cartSubtotal();
    if (isNaN(v) || v <= 0) return Swal.fire("Discount needed", "Enter how much to take off.", "warning");
    if (window.dcKind === "percent" && v > 100) return Swal.fire("Too much", "A percentage cannot be more than 100.", "warning");
    if (window.dcKind === "amount" && v > sub) return Swal.fire("Too much", "The discount cannot be more than the whole cart.", "warning");
    const reason = readReason("dcReason", "dcReasonOther");
    if (!reason) return Swal.fire("Reason needed", "Choose or type why the discount is given. It is recorded with your name.", "warning");
    cartDiscount = { kind: window.dcKind, value: v, reason };
    hideModalById("discountModal");
    renderCart();
};

window.removeDiscount = () => {
    cartDiscount = null;
    hideModalById("discountModal");
    renderCart();
};

/* ---------------------------------------------------------------- refunds and returns */
window.refundState = null;
window.refundsList = [];

window.db.collection("refunds").orderBy("date", "desc").limit(300).onSnapshot(snap => {
    window.refundsList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}, err => console.warn("Refunds listener:", err));

window.openRefundModal = (saleId) => {
    if (!can("pos.refund")) return denyAccess("give refunds");
    const sale = (window.allSales || []).find(s => s.id === saleId);
    if (!sale || !sale.items || !sale.items.length) return Swal.fire("Nothing to refund", "Every item of this sale has already been refunded.", "info");
    if (sale._pending) return Swal.fire("Not saved yet", "This sale is still waiting to reach the server. Wait until the 'Not synced' tag disappears, then refund it.", "info");

    window.refundState = { saleId, qty: sale.items.map(() => 0), restock: sale.items.map(() => true) };
    const onTab = sale.payment === "Credit";
    document.getElementById("rfSummary").innerHTML = `<b>${escHtml(sale.customer || "Guest")}</b> · ${sale.date.toDate().toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${escHtml(sale.payment || "Cash")} · <b>${insightMoney(sale.total)}</b>`;
    document.getElementById("rfMethodWrap").classList.toggle("d-none", onTab);
    document.getElementById("rfCreditNote").classList.toggle("d-none", !onTab);
    const methodEl = document.getElementById("rfMethod");
    methodEl.value = Array.from(methodEl.options).some(o => o.value === sale.payment) ? sale.payment : "Cash";
    resetReason("rfReason", "rfReasonOther");
    renderRefundLines();
    updateRefundTotal();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("refundModal")).show();
};

function refundSale() {
    return window.refundState ? (window.allSales || []).find(s => s.id === window.refundState.saleId) : null;
}

function renderRefundLines() {
    const sale = refundSale();
    const body = document.getElementById("rfLines");
    if (!sale || !body) return;
    const st = window.refundState;
    body.innerHTML = sale.items.map((it, i) => `
        <div class="rf-line">
            <div class="rf-name"><b>${escHtml(itemLabel(it))}</b><small>${window.toMixedFraction(parseFloat(it.qty) || 0)} sold at ${insightMoney(it.price)}</small></div>
            <div class="rf-qty"><label>Take back</label><input type="number" min="0" max="${parseFloat(it.qty) || 0}" step="any" class="form-control form-control-sm text-end rf-in" data-i="${i}" value="${st.qty[i] || ""}" placeholder="0"></div>
            <label class="rf-restock"><input class="form-check-input rf-stock" type="checkbox" data-i="${i}" ${st.restock[i] ? "checked" : ""}><span>Put back on the shelf</span></label>
        </div>`).join("");
}

function updateRefundTotal() {
    const sale = refundSale();
    const el = document.getElementById("rfTotal");
    if (!sale || !el) return;
    const total = round2(sale.items.reduce((n, it, i) => n + (window.refundState.qty[i] || 0) * (parseFloat(it.price) || 0), 0));
    el.textContent = insightMoney(total);
    document.getElementById("rfSaveBtn").disabled = total <= 0;
}

window.refundEverything = () => {
    const sale = refundSale();
    if (!sale) return;
    window.refundState.qty = sale.items.map(it => parseFloat(it.qty) || 0);
    renderRefundLines();
    updateRefundTotal();
};

(function bindRefundInputs() {
    const body = document.getElementById("rfLines");
    if (!body) return;
    body.addEventListener("input", (e) => {
        const t = e.target;
        if (!t || !t.classList || !t.classList.contains("rf-in")) return;
        const sale = refundSale();
        if (!sale) return;
        const i = Number(t.dataset.i);
        const max = parseFloat(sale.items[i].qty) || 0;
        let v = parseFloat(t.value);
        if (isNaN(v) || v < 0) v = 0;
        if (v > max) { v = max; t.value = max; }
        window.refundState.qty[i] = v;
        updateRefundTotal();
    });
    body.addEventListener("change", (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains("rf-stock")) window.refundState.restock[Number(t.dataset.i)] = !!t.checked;
    });
})();

window.saveRefund = async () => {
    if (!can("pos.refund")) return denyAccess("give refunds");
    const st = window.refundState;
    const sale = refundSale();
    if (!st || !sale) return Swal.fire("Sale not found", "Close this window and open the sale again.", "error");

    const lines = [];
    sale.items.forEach((it, i) => {
        const q = Math.min(parseFloat(st.qty[i]) || 0, parseFloat(it.qty) || 0);
        if (q > 1e-9) lines.push({ i, it, q, restock: !!st.restock[i] });
    });
    if (!lines.length) return Swal.fire("Nothing chosen", "Enter how many of each item are being taken back.", "warning");
    const reason = readReason("rfReason", "rfReasonOther");
    if (!reason) return Swal.fire("Reason needed", "Choose or type why the items are being refunded. It is recorded with your name.", "warning");

    const amount = round2(lines.reduce((n, l) => n + l.q * (parseFloat(l.it.price) || 0), 0));
    const onTab = sale.payment === "Credit";
    const method = onTab ? "Credit" : document.getElementById("rfMethod").value;
    const ok = await Swal.fire({
        title: "Give this refund?",
        html: `<b>${insightMoney(amount)}</b> ${onTab ? "comes off the customer's tab" : `is paid back by ${escHtml(method)}`}.<br>${lines.map(l => `${window.toMixedFraction(l.q)} × ${escHtml(itemLabel(l.it))}${l.restock ? "" : " (not put back on the shelf)"}`).join("<br>")}`,
        icon: "question", showCancelButton: true, confirmButtonText: "Yes, refund"
    });
    if (!ok.isConfirmed) return;

    const btn = document.getElementById("rfSaveBtn");
    btn.disabled = true;
    try {
        const batch = window.db.batch();
        const saleRef = window.db.collection("sales").doc(sale.id);
        const byIndex = {};
        lines.forEach(l => { byIndex[l.i] = l; });

        const newItems = [];
        sale.items.forEach((it, i) => {
            const l = byIndex[i];
            if (!l) { newItems.push(it); return; }
            const oldQty = parseFloat(it.qty) || 0;
            const left = Math.round((oldQty - l.q) * 1e6) / 1e6;
            if (left <= 1e-9) return;
            const kept = Object.assign({}, it, { qty: left });
            if (it.stockQty !== undefined) kept.stockQty = Math.round(itemStockQty(it) * left / oldQty * 1e6) / 1e6;
            newItems.push(kept);
        });
        const newTotal = round2(newItems.reduce((n, it) => n + (parseFloat(it.price) || 0) * (parseFloat(it.qty) || 0), 0));
        const now = new Date();
        const by = getCurrentUserEmail() || "unknown";

        batch.update(saleRef, {
            items: newItems,
            total: newTotal,
            originalItems: sale.originalItems || sale.items,
            originalTotal: sale.originalTotal !== undefined ? sale.originalTotal : sale.total,
            refundedAmount: firebase.firestore.FieldValue.increment(amount),
            lastRefund: { amount, reason, by, at: now, method }
        });

        const restocked = [];
        lines.forEach(l => {
            if (!l.restock) return;
            const stockBack = Math.round(itemStockQty(l.it) * l.q / (parseFloat(l.it.qty) || 1) * 1e6) / 1e6;
            let doc = l.it.id ? (window.productsCache || []).find(p => p.id === l.it.id) : null;
            if (!doc) doc = (window.productsCache || []).find(p => p.data().name.trim().toLowerCase() === (l.it.name || "").trim().toLowerCase());
            if (!doc || stockBack <= 0) return;
            batch.update(window.db.collection("products").doc(doc.id), { stock: firebase.firestore.FieldValue.increment(stockBack) });
            restocked.push(`${itemLabel(l.it)} +${window.toMixedFraction(stockBack)}`);
        });

        reverseCreditForSale(batch, sale, amount);

        batch.set(window.db.collection("refunds").doc(), {
            saleId: sale.id,
            customer: sale.customer || "Guest",
            customerId: sale.customerId || null,
            items: lines.map(l => Object.assign({ id: l.it.id || null, name: l.it.name, qty: l.q, price: parseFloat(l.it.price) || 0, restocked: l.restock }, l.it.unit ? { unit: l.it.unit } : {})),
            amount, reason, method,
            originalPayment: sale.payment || "Cash",
            by, date: now,
            dateKey: now.toLocaleDateString("en-CA"),
            saleDateKey: sale.date.toDate().toLocaleDateString("en-CA")
        });

        await writeWithGrace(batch.commit());

        logAudit("refund", "refund", `Refund ${insightMoney(amount)}: ${sale.customer || "Guest"}`,
            `${lines.map(l => `${window.toMixedFraction(l.q)} × ${itemLabel(l.it)}`).join(", ")}\nReason: ${reason}\n${onTab ? "Taken off the customer's tab" : "Paid back by " + method}. ${restocked.length ? "Stock put back: " + restocked.join(", ") : "Nothing put back on the shelf."}`,
            { amount, ref: sale.id, alert: true });

        hideModalById("refundModal");
        window.refundState = null;
        Swal.fire({ icon: "success", title: "Refund recorded", text: `${insightMoney(amount)} refunded${restocked.length ? " and the stock is back on the shelf" : ""}.`, timer: 2400, showConfirmButton: false });
    } catch (err) {
        console.error("Refund error:", err);
        Swal.fire("Could not refund", err.message, "error");
    } finally {
        btn.disabled = false;
    }
};

/* ---------------------------------------------------------------- audit trail */
const AUDIT_CATS = {
    price: { label: "Prices & discounts", icon: "fa-tags" },
    refund: { label: "Refunds", icon: "fa-rotate-left" },
    delete: { label: "Deletions", icon: "fa-trash-can" },
    stock: { label: "Products & stock", icon: "fa-boxes-stacked" },
    money: { label: "Money & suppliers", icon: "fa-coins" },
    people: { label: "Staff & access", icon: "fa-user-shield" }
};
window.auditList = [];
window.auditFilter = "all";
window.auditQuery = "";
window.auditLimit = 40;
window.auditStarted = false;
window.auditError = "";

window.startAuditListener = () => {
    if (window.auditStarted || !can("audit.view")) return;
    window.auditStarted = true;
    window.db.collection("audit").orderBy("at", "desc").limit(500).onSnapshot(snap => {
        window.auditError = "";
        window.auditList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        window.renderAudit();
    }, err => {
        window.auditStarted = false;
        window.auditError = err && err.message ? err.message : "unknown error";
        window.renderAudit();
    });
};

window.setAuditFilter = (c) => { window.auditFilter = c; window.auditLimit = 40; window.renderAudit(); };
window.showMoreAudit = () => { window.auditLimit += 40; window.renderAudit(); };

window.renderAudit = () => {
    const box = document.getElementById("auditList");
    if (!box) return;
    if (!can("audit.view")) { box.innerHTML = ""; return; }
    if (window.auditError) {
        box.innerHTML = `<div class="empty-state"><i class="fas fa-lock"></i>The audit trail could not be loaded. Allow the 'audit' collection in your Firestore rules. (${escHtml(window.auditError)})</div>`;
        return;
    }
    const all = window.auditList || [];

    // Last 7 days at a glance
    const weekAgo = Date.now() - 7 * 86400000;
    let given = 0, refunded = 0, deletes = 0, flagged = 0;
    all.forEach(a => {
        const t = toDate(a.at);
        if (!t || t.getTime() < weekAgo) return;
        const amt = parseFloat(a.amount) || 0;
        if (a.category === "price" && (a.action === "discount" || a.action === "price_change")) given += amt;
        if (a.action === "refund") refunded += amt;
        if (a.category === "delete") deletes++;
        if (a.flag) flagged++;
    });
    const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setText("auditGiven", insightMoney(given));
    setText("auditRefunded", insightMoney(refunded));
    setText("auditDeletes", String(deletes));
    setText("auditFlagged", String(flagged));

    const counts = {};
    all.forEach(a => { counts[a.category] = (counts[a.category] || 0) + 1; });
    const chips = document.getElementById("auditChips");
    if (chips) {
        chips.innerHTML = `<button class="btn btn-soft btn-sm ${window.auditFilter === "all" ? "active" : ""}" onclick="window.setAuditFilter('all')">All <span class="au-count">${all.length}</span></button>` +
            Object.keys(AUDIT_CATS).map(k => `<button class="btn btn-soft btn-sm ${window.auditFilter === k ? "active" : ""}" onclick="window.setAuditFilter('${k}')"><i class="fas ${AUDIT_CATS[k].icon} me-1"></i>${AUDIT_CATS[k].label} <span class="au-count">${counts[k] || 0}</span></button>`).join("");
    }

    const q = (window.auditQuery || "").trim().toLowerCase();
    const rows = all.filter(a => (window.auditFilter === "all" || a.category === window.auditFilter) &&
        (!q || [a.title, a.detail, a.by].some(v => String(v || "").toLowerCase().includes(q))));

    if (!rows.length) {
        box.innerHTML = `<div class="empty-state"><i class="fas fa-clipboard-list"></i>${all.length ? "Nothing matches your search." : "Nothing recorded yet. Discounts, price changes, refunds and deletions will appear here."}</div>`;
        return;
    }

    const visible = rows.slice(0, window.auditLimit);
    let html = "", lastDay = null;
    visible.forEach(a => {
        const t = toDate(a.at) || new Date();
        const dayKey = t.toDateString();
        if (dayKey !== lastDay) {
            html += `<div class="au-day">${t.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>`;
            lastDay = dayKey;
        }
        const cat = AUDIT_CATS[a.category] || { label: "Other", icon: "fa-circle-info" };
        html += `
            <div class="au-row ${a.flag ? "flag" : ""}">
                <span class="au-ico au-${escHtml(a.category || "other")}"><i class="fas ${cat.icon}"></i></span>
                <div class="au-main">
                    <div class="au-title">${escHtml(a.title)}${a.flag ? ' <span class="au-flag" title="Worth a look"><i class="fas fa-flag"></i></span>' : ""}</div>
                    ${a.detail ? `<div class="au-detail">${escHtml(a.detail).replace(/\n/g, "<br>")}</div>` : ""}
                </div>
                <div class="au-meta"><b>${escHtml(a.by || "unknown")}</b><span>${escHtml(a.role || "")}</span><small>${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>${can("audit.delete") ? `<button type="button" class="au-del" title="Delete this entry" onclick="window.deleteAuditEntry('${escHtml(a.id)}')"><i class="fas fa-trash-can"></i></button>` : ""}</div>
            </div>`;
    });
    if (rows.length > visible.length) html += `<div class="text-center mt-3"><button class="btn btn-soft btn-sm" onclick="window.showMoreAudit()">Show more (${rows.length - visible.length} left)</button></div>`;
    box.innerHTML = html;
};

window.deleteAuditEntry = async (id) => {
    if (!can("audit.delete")) return denyAccess("delete audit entries");
    const a = (window.auditList || []).find(x => x.id === id);
    if (!a) return;
    const res = await Swal.fire({
        title: "Delete this entry?",
        text: "It is removed from the audit trail. A note that you deleted it is kept.",
        icon: "warning", showCancelButton: true, confirmButtonColor: "#d33", confirmButtonText: "Yes, delete"
    });
    if (!res.isConfirmed) return;
    try {
        await window.db.collection("audit").doc(id).delete();
        const when = toDate(a.at);
        logAudit("delete", "audit_delete", `Audit entry deleted: ${a.title}`, `It was recorded for ${a.by || "unknown"}${when ? " on " + when.toLocaleString() : ""}`, { flag: true });
    } catch (err) {
        Swal.fire("Could not delete", err.message, "error");
    }
};

/** Clears old entries (or all of them) in one go */
window.openAuditCleanup = async () => {
    if (!can("audit.delete")) return denyAccess("delete audit entries");
    const pick = await Swal.fire({
        title: "Delete audit entries",
        text: "Which entries should be deleted?",
        input: "select",
        inputOptions: { "30": "Older than 30 days", "90": "Older than 90 days", "365": "Older than 1 year", "all": "Everything" },
        inputPlaceholder: "Choose...",
        showCancelButton: true,
        confirmButtonText: "Continue",
        preConfirm: (v) => { if (!v) { Swal.showValidationMessage("Choose which entries to delete."); return false; } return v; }
    });
    if (!pick.isConfirmed || !pick.value || pick.value === true) return;
    const choice = String(pick.value);
    try {
        const coll = window.db.collection("audit");
        const snap = choice === "all" ? await coll.get() : await coll.where("at", "<", new Date(Date.now() - Number(choice) * 86400000)).get();
        const docs = snap.docs || [];
        if (!docs.length) return Swal.fire("Nothing to delete", "No entries match that choice.", "info");
        const label = choice === "all" ? "every entry" : `entries older than ${choice === "365" ? "1 year" : choice + " days"}`;
        const ok = await Swal.fire({
            title: `Delete ${docs.length} entr${docs.length === 1 ? "y" : "ies"}?`,
            text: `This removes ${label} from the audit trail. A note that you did this is kept. It cannot be undone.`,
            icon: "warning", showCancelButton: true, confirmButtonColor: "#d33", confirmButtonText: "Yes, delete"
        });
        if (!ok.isConfirmed) return;
        for (let i = 0; i < docs.length; i += 400) {
            const batch = window.db.batch();
            docs.slice(i, i + 400).forEach(d => batch.delete(d.ref || coll.doc(d.id)));
            await batch.commit();
        }
        logAudit("delete", "audit_clear", `Audit trail cleared: ${docs.length} entr${docs.length === 1 ? "y" : "ies"} deleted`, `Deleted ${label}`, { flag: true, alert: true });
        Swal.fire({ icon: "success", title: "Deleted", text: `${docs.length} entr${docs.length === 1 ? "y" : "ies"} removed.`, timer: 2000, showConfirmButton: false });
    } catch (err) {
        Swal.fire("Could not delete", err.message + " (Your Firestore rules must allow deleting from the 'audit' collection.)", "error");
    }
};

(function bindAuditSearch() {
    const s = document.getElementById("auditSearch");
    if (s) s.addEventListener("input", () => { window.auditQuery = s.value; window.auditLimit = 40; window.renderAudit(); });
})();

/** Phone alert for the things an owner wants to hear about straight away */
window.notifyAudit = (title, detail, by) => {
    window.sendAlert(
        `🔎 *${title}*\n${detail ? detail + "\n" : ""}By: ${by || "unknown"}\n${new Date().toLocaleString()}`,
        "onAudit"
    );
};

/* ==========================================================================
   SECTION 12I: WORK LOCATION (where staff may clock in from), set by the admin
   ========================================================================== */

const WP_RADIUS_CHOICES = [50, 100, 200, 300, 500, 1000, 5000, 10000];
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Pulls a latitude and longitude out of whatever the admin pastes from Google Maps:
 *  - the numbers Google shows when you right-click or press and hold a spot ("-1.533134, 37.131476")
 *  - a long map link (.../@-1.53,37.13,17z   or   ...!3d-1.53!4d37.13   or   ...?q=-1.53,37.13)
 *  - degrees/minutes/seconds ("1°31'59.3"S 37°07'53.3"E")
 * Returns { lat, lon } or null. Short links (maps.app.goo.gl) cannot be opened from here.
 */
function parseMapsLocation(raw) {
    let s = String(raw || "").trim();
    if (!s) return null;
    try { s = decodeURIComponent(s.replace(/\+/g, " ")); } catch (e) { /* keep as typed */ }
    const num = "(-?\\d+(?:\\.\\d+)?)";
    const valid = (lat, lon) => (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) ? { lat: round6(lat), lon: round6(lon) } : null;
    let m;

    // The dropped pin itself (more exact than the centre of the screen)
    if ((m = s.match(new RegExp("!3d" + num + "!4d" + num)))) return valid(+m[1], +m[2]);
    // ?q=lat,lon   ll=lat,lon   query=...   destination=...
    if ((m = s.match(new RegExp("[?&](?:q|ll|query|center|destination|daddr)=\\s*" + num + "\\s*,\\s*" + num)))) return valid(+m[1], +m[2]);
    // .../@lat,lon,17z
    if ((m = s.match(new RegExp("@" + num + ",\\s*" + num)))) return valid(+m[1], +m[2]);

    // Degrees, minutes, seconds
    const part = "(\\d+(?:\\.\\d+)?)\\s*°\\s*(?:(\\d+(?:\\.\\d+)?)\\s*['′]\\s*)?(?:(\\d+(?:\\.\\d+)?)\\s*[\"″]\\s*)?";
    if ((m = s.match(new RegExp(part + "([NSns])[\\s,]*" + part + "([EWew])")))) {
        const toDec = (d, mi, se, hemi) => {
            const v = (+d) + (+(mi || 0)) / 60 + (+(se || 0)) / 3600;
            return /[SsWw]/.test(hemi) ? -v : v;
        };
        return valid(toDec(m[1], m[2], m[3], m[4]), toDec(m[5], m[6], m[7], m[8]));
    }

    // Plain "lat, lon"
    if ((m = s.match(new RegExp("^\\(?\\s*" + num + "\\s*[,;\\s]\\s*" + num + "\\s*\\)?$")))) return valid(+m[1], +m[2]);
    // Two long decimals somewhere in the text
    if ((m = s.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/))) return valid(+m[1], +m[2]);
    return null;
}

const mapsLink = (lat, lon) => `https://www.google.com/maps?q=${lat},${lon}`;

window.wpDraft = null;
window.wpFound = null;      // the pin found in the paste box: { lat, lon }

function radiusLabel(m) { return formatDistance(m); }

function radiusSelectHTML(value, attrs) {
    const opts = WP_RADIUS_CHOICES.slice();
    if (!opts.includes(value)) opts.push(value);
    opts.sort((a, b) => a - b);
    return `<select class="form-select form-select-sm" ${attrs}>${opts.map(o => `<option value="${o}" ${o === value ? "selected" : ""}>${radiusLabel(o)}</option>`).join("")}</select>`;
}

window.openWorkplaceModal = () => {
    if (!can("attendance.location")) return denyAccess("change the work location");
    const cfg = window.workplaceConfig || DEFAULT_WORKPLACE();
    window.wpDraft = JSON.parse(JSON.stringify(cfg));
    window.wpFound = null;
    ["wpName", "wpPaste"].forEach(id => { const e = document.getElementById(id); if (e) e.value = ""; });
    document.getElementById("wpRadius").innerHTML = WP_RADIUS_CHOICES.map(o => `<option value="${o}" ${o === 100 ? "selected" : ""}>${radiusLabel(o)}</option>`).join("");
    document.getElementById("wpParsed").innerHTML = "";
    document.getElementById("wpTest").innerHTML = "";
    renderWorkplaceModal();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("workplaceModal")).show();
};

function renderWorkplaceModal() {
    const d = window.wpDraft;
    if (!d) return;
    document.getElementById("wpEnabled").checked = d.enabled;
    document.getElementById("wpBody").classList.toggle("wp-off", !d.enabled);
    const list = document.getElementById("wpList");
    list.innerHTML = d.locations.length ? d.locations.map((l, i) => `
        <div class="wp-row ${l.active === false ? "wp-inactive" : ""}">
            <div class="wp-main">
                <label class="wp-use"><input class="form-check-input" type="checkbox" ${l.active === false ? "" : "checked"} onchange="window.wpSetActive(${i}, this.checked)"> <b>${escHtml(l.name)}</b></label>
                <small>${l.lat}, ${l.lon} · <a href="${mapsLink(l.lat, l.lon)}" target="_blank" rel="noopener">Open in Google Maps</a></small>
                ${l.radius > 500 ? `<small class="wp-warn"><i class="fas fa-triangle-exclamation me-1"></i>Staff up to ${radiusLabel(l.radius)} away can clock in. Pick a smaller distance to keep them on site.</small>` : ""}
            </div>
            <div class="wp-radius"><label>Allowed distance</label>${radiusSelectHTML(l.radius, `data-i="${i}"`)}</div>
            <button type="button" class="btn btn-soft btn-sm btn-icon" title="Remove" onclick="window.wpRemove(${i})"><i class="fas fa-trash-can text-danger"></i></button>
        </div>`).join("")
        : `<div class="empty-state"><i class="fas fa-location-dot"></i>No location yet. Add one below.</div>`;
}

window.wpToggle = (on) => { if (window.wpDraft) { window.wpDraft.enabled = !!on; renderWorkplaceModal(); } };
window.wpSetActive = (i, on) => { if (window.wpDraft && window.wpDraft.locations[i]) { window.wpDraft.locations[i].active = !!on; renderWorkplaceModal(); } };
window.wpRemove = (i) => { if (window.wpDraft) { window.wpDraft.locations.splice(i, 1); renderWorkplaceModal(); } };

(function bindWorkplaceInputs() {
    const list = document.getElementById("wpList");
    if (list) list.addEventListener("change", (e) => {
        const t = e.target;
        if (t && t.tagName === "SELECT" && t.dataset && t.dataset.i !== undefined && window.wpDraft) {
            window.wpDraft.locations[Number(t.dataset.i)].radius = Number(t.value);
            renderWorkplaceModal();
        }
    });
    const paste = document.getElementById("wpPaste");
    if (paste) paste.addEventListener("input", () => window.wpParsePaste());
})();

/** Reads the paste box and tells the admin what was found */
window.wpParsePaste = () => {
    const raw = document.getElementById("wpPaste").value;
    const out = document.getElementById("wpParsed");
    window.wpFound = parseMapsLocation(raw);
    if (!raw.trim()) { out.innerHTML = ""; return; }
    if (window.wpFound) {
        const { lat, lon } = window.wpFound;
        out.innerHTML = `<span class="text-success"><i class="fas fa-circle-check me-1"></i>Found ${lat}, ${lon}</span> · <a href="${mapsLink(lat, lon)}" target="_blank" rel="noopener">Check it on the map</a>`;
    } else if (/goo\.gl|maps\.app/i.test(raw)) {
        out.innerHTML = `<span class="text-warning"><i class="fas fa-triangle-exclamation me-1"></i>That is a short link and this page cannot open it. Open it in Google Maps, then copy the numbers shown for the pin, or the full link from the address bar.</span>`;
    } else {
        out.innerHTML = `<span class="text-danger"><i class="fas fa-circle-xmark me-1"></i>No location found in that. Paste a Google Maps link, or numbers like -1.533134, 37.131476.</span>`;
    }
};

/** Stand at the workplace and use the phone's own GPS */
window.wpUseMyLocation = async () => {
    const out = document.getElementById("wpParsed");
    out.innerHTML = `<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Getting your location...</span>`;
    const pos = await getPositionOnce();
    if (!pos.success) {
        out.innerHTML = `<span class="text-danger"><i class="fas fa-circle-xmark me-1"></i>Could not get your location. Allow location access for this site and try again.</span>`;
        return;
    }
    const lat = round6(pos.coords.latitude), lon = round6(pos.coords.longitude);
    document.getElementById("wpPaste").value = `${lat}, ${lon}`;
    window.wpFound = { lat, lon };
    const acc = Math.round(pos.coords.accuracy || 0);
    out.innerHTML = `<span class="text-success"><i class="fas fa-circle-check me-1"></i>Found ${lat}, ${lon}</span> · accurate to about ${acc} m${acc > 100 ? ` <span class="text-warning">(weak signal: go outside and try again for a better pin)</span>` : ""}`;
};

window.wpAdd = () => {
    if (!window.wpDraft) return;
    window.wpParsePaste();
    if (!window.wpFound) return Swal.fire("Location needed", "Paste the pin from Google Maps, or press 'Use my current location' while standing at the workplace.", "warning");
    const radius = Number(document.getElementById("wpRadius").value) || 100;
    const name = document.getElementById("wpName").value.trim() || `Workplace ${window.wpDraft.locations.length + 1}`;
    window.wpDraft.locations.push({ name, lat: window.wpFound.lat, lon: window.wpFound.lon, radius, active: true });
    document.getElementById("wpName").value = "";
    document.getElementById("wpPaste").value = "";
    document.getElementById("wpParsed").innerHTML = `<span class="text-success"><i class="fas fa-circle-check me-1"></i>Added. Press Save to apply it.</span>`;
    window.wpFound = null;
    renderWorkplaceModal();
};

/** How far am I from each saved location right now? */
window.wpTestDistance = async () => {
    const out = document.getElementById("wpTest");
    if (!window.wpDraft || !window.wpDraft.locations.length) { out.innerHTML = `<span class="text-muted">Add a location first.</span>`; return; }
    out.innerHTML = `<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Checking where you are...</span>`;
    const pos = await getPositionOnce();
    if (!pos.success) { out.innerHTML = `<span class="text-danger">Could not get your location. Allow location access and try again.</span>`; return; }
    out.innerHTML = window.wpDraft.locations.filter(l => l.active !== false).map(l => {
        const d = distanceMeters(pos.coords.latitude, pos.coords.longitude, l.lat, l.lon);
        const inside = d - Math.min(pos.coords.accuracy || 0, 50) <= l.radius;
        return `<div><i class="fas ${inside ? "fa-circle-check text-success" : "fa-circle-xmark text-danger"} me-1"></i>You are ${formatDistance(d)} from <b>${escHtml(l.name)}</b>: ${inside ? "you could clock in here" : "too far to clock in"} (allowed ${formatDistance(l.radius)}).</div>`;
    }).join("");
};

window.saveWorkplace = async () => {
    if (!can("attendance.location")) return denyAccess("change the work location");
    const d = window.wpDraft;
    if (!d) return;
    if (d.enabled && !d.locations.some(l => l.active !== false)) return Swal.fire("Tick a location", "Tick at least one place staff can clock in from, or switch the location check off.", "warning");
    const before = window.workplaceConfig || DEFAULT_WORKPLACE();
    try {
        await writeWithGrace(window.db.collection("settings").doc("workplace").set({
            enabled: d.enabled,
            locations: d.locations.map(l => ({ name: l.name, lat: l.lat, lon: l.lon, radius: l.radius, active: l.active !== false })),
            updatedAt: new Date(),
            updatedBy: getCurrentUserEmail() || "admin"
        }));
        window.workplaceConfig = normalizeWorkplace(d);
        const describe = (c) => c.enabled ? (c.locations.filter(l => l.active !== false).map(l => `${l.name} (${l.lat}, ${l.lon}, within ${formatDistance(l.radius)})`).join("; ") || "no location") : "location check OFF";
        logAudit("people", "workplace", "Work location changed", `Before: ${describe(before)}\nNow: ${describe(window.workplaceConfig)}`, { flag: true, alert: true });
        window.renderWorkplaceNote();
        hideModalById("workplaceModal");
        window.wpDraft = null;
        Swal.fire({ icon: "success", title: "Work location saved", text: "It applies the next time anyone clocks in.", timer: 2400, showConfirmButton: false });
    } catch (err) {
        Swal.fire("Could not save", err.message + " (If this says permission denied, allow write access to the 'settings' collection in your Firestore rules.)", "error");
    }
};

/** The line under the Clock In & Out heading, so staff know the rule */
window.renderWorkplaceNote = () => {
    const note = document.getElementById("attLocationNote");
    if (!note) return;
    const cfg = window.workplaceConfig;
    if (!cfg) { note.textContent = ""; return; }
    const used = cfg.locations.filter(l => l.active !== false);
    note.textContent = !cfg.enabled || !used.length
        ? "You can clock in from anywhere."
        : "You can clock in within " + used.map(l => `${formatDistance(l.radius)} of ${l.name}`).join(" or ") + ".";
};
window.onWorkplaceChanged = () => window.renderWorkplaceNote();

/* ==========================================================================
   SECTION 13: UI NAVIGATION & SCROLL HELPERS
   ========================================================================== */

/* ==========================================================================
   SECTION 12C: ALERTS (Telegram, WhatsApp via CallMeBot, Email via Web3Forms) - set up by the admin
   ========================================================================== */

window.alertConfig = {
    enabled: false,
    // useTelegram / useWhatsApp are left undefined until saved, so older single-"channel" settings still work
    tgToken: "", tgChatId: "",
    phone: "", apiKey: "",
    useEmail: false, emailKey: "", emailImportantOnly: false,
    onSale: true, onLowStock: true, onDayClose: true, onStockTake: true, onSmart: true, onDelivery: true, onAudit: true
};

// Live copy of the admin's alert settings (read by every device so any till can send the alert)
window.db.collection("settings").doc("alerts").onSnapshot(doc => {
    if (doc.exists) window.alertConfig = { ...window.alertConfig, ...doc.data() };
}, err => console.warn("Alerts settings listener:", err));

/**
 * Turns "0712 345 678" / "+254712345678" into 254712345678 (Kenya numbers by default)
 */
function normalizePhone(raw) {
    let digits = String(raw || "").replace(/\D/g, "");
    if (digits.startsWith("0") && digits.length === 10) digits = "254" + digits.slice(1);
    return digits;
}

// Bot tokens only use letters, digits, _ - and : so anything else is stripped
const cleanToken = (t) => String(t || "").replace(/[^A-Za-z0-9_:\-]/g, "");

/**
 * Channels that are switched on AND fully filled in.
 * (Older saved settings only had a single "channel" field, which is still understood.)
 */
function activeChannels(c) {
    if (!c || !c.enabled) return [];
    const useTg = c.useTelegram !== undefined ? c.useTelegram : c.channel !== "whatsapp";
    const useWa = c.useWhatsApp !== undefined ? c.useWhatsApp : c.channel === "whatsapp";
    const out = [];
    if (useTg && c.tgToken && c.tgChatId) out.push("telegram");
    if (useWa && c.phone && c.apiKey) out.push("whatsapp");
    if (c.useEmail && c.emailKey) out.push("email");
    return out;
}

function sendWhatsApp(phone, apiKey, text) {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey)}`;
    // no-cors: the browser cannot read CallMeBot's reply, so success can't be confirmed from here
    return fetch(url, { mode: "no-cors" }).then(() => ({ ok: true, unconfirmed: true })).catch(() => ({ ok: false, error: "Could not reach the sending service." }));
}

async function sendTelegram(token, chatId, text) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${cleanToken(token)}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // plain text on purpose: names or emails containing _ or * would break Markdown
            body: JSON.stringify({ chat_id: chatId, text: text.replace(/\*/g, "") })
        });
        const data = await res.json();
        return data.ok ? { ok: true } : { ok: false, error: data.description || "Telegram rejected the message." };
    } catch (e) {
        return { ok: false, error: "Could not reach Telegram. Check the internet connection." };
    }
}

async function sendEmail(accessKey, text) {
    const plain = text.replace(/\*/g, "");
    try {
        const res = await fetch("https://api.web3forms.com/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({
                access_key: accessKey,
                subject: "Madollar: " + plain.split("\n")[0],
                from_name: "Madollar System",
                message: plain
            })
        });
        const data = await res.json();
        return data.success ? { ok: true } : { ok: false, error: data.message || "The email service rejected the request." };
    } catch (e) {
        return { ok: false, error: "Could not reach the email service. Check the internet connection." };
    }
}

function sendOnChannel(channel, c, text) {
    if (channel === "telegram") return sendTelegram(c.tgToken, c.tgChatId, text);
    if (channel === "whatsapp") return sendWhatsApp(c.phone, c.apiKey, text);
    return sendEmail(c.emailKey, text);
}

// Messages go out one at a time with a pause, because the services limit bursts
const alertQueue = [];
let alertBusy = false;

async function drainAlertQueue() {
    if (alertBusy) return;
    alertBusy = true;
    while (alertQueue.length) {
        const { text, type } = alertQueue.shift();
        const c = window.alertConfig || {};
        const channels = activeChannels(c).filter(ch => {
            // Email goes out for every alert unless the admin chose "only low stock and day closing"
            if (ch === "email" && c.emailImportantOnly === true && type === "onSale") return false;
            return true;
        });
        const results = await Promise.all(channels.map(ch => sendOnChannel(ch, c, text)));
        results.forEach((r, i) => { if (!r.ok) console.warn(`Alert not sent via ${channels[i]}:`, r.error); });
        await new Promise(r => setTimeout(r, channels.includes("whatsapp") ? 2500 : 1200));
    }
    alertBusy = false;
}

/**
 * Queues an alert. `type` is the setting that must be on (onSale, onLowStock, onDayClose)
 */
window.sendAlert = (text, type) => {
    const c = window.alertConfig || {};
    if (activeChannels(c).length === 0) return;
    if (type && c[type] === false) return;
    alertQueue.push({ text, type });
    drainAlertQueue();
};

window.notifySale = (sale) => {
    const lines = (sale.items || []).map(i => `• ${window.toMixedFraction(i.qty)} x ${itemLabel(i)} (KSh ${((parseFloat(i.price) || 0) * (parseFloat(i.qty) || 0)).toLocaleString()})`);
    window.sendAlert(
        `🧾 *New sale* - KSh ${(sale.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
        `Customer: ${sale.customer || "Guest"}\n` +
        `Payment: ${sale.payment || "Cash"}${sale.transaction ? " (" + sale.transaction + ")" : ""}\n` +
        `${lines.join("\n")}\n` +
        `By: ${getCurrentUserEmail() || "unknown"}\n` +
        `${new Date().toLocaleString()}`,
        "onSale"
    );

    if (sale.lowStock && sale.lowStock.length) {
        window.sendAlert(
            `⚠️ *Low stock*\n` +
            sale.lowStock.map(p => `• ${p.name}: ${window.toMixedFraction(p.stock)} left (min ${window.toMixedFraction(p.min)})`).join("\n"),
            "onLowStock"
        );
    }
};

window.notifyDayClose = (c) => {
    const status = c.difference === 0 ? "✅ Balanced"
        : c.difference < 0 ? `❌ SHORT by KSh ${Math.abs(c.difference).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
        : `⚠️ OVER by KSh ${c.difference.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    window.sendAlert(
        `📒 *Day closed* - ${c.label}\n` +
        `Total sales: KSh ${c.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
        `Expected cash: KSh ${c.expected.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
        `Counted: KSh ${c.counted.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
        `${status}\n` +
        `Closed by: ${c.closedBy}`,
        "onDayClose"
    );
};

/* ---- settings window ---- */
window.toggleAlertChannel = () => {
    [["alertsUseTelegram", "alertsTelegramFields"], ["alertsUseWhatsApp", "alertsWhatsAppFields"], ["alertsUseEmail", "alertsEmailFields"]]
        .forEach(([checkId, bodyId]) => {
            document.getElementById(bodyId).classList.toggle("d-none", !document.getElementById(checkId).checked);
        });
};

window.openAlertsModal = () => {
    if (!can("alerts.manage")) return denyAccess("change alert settings");
    const c = window.alertConfig || {};
    const useTg = c.useTelegram !== undefined ? c.useTelegram : c.channel !== "whatsapp";
    const useWa = c.useWhatsApp !== undefined ? c.useWhatsApp : c.channel === "whatsapp";

    document.getElementById("alertsEnabled").checked = !!c.enabled;
    document.getElementById("alertsUseTelegram").checked = !!useTg;
    document.getElementById("alertsUseWhatsApp").checked = !!useWa;
    document.getElementById("alertsUseEmail").checked = !!c.useEmail;
    document.getElementById("alertsTgToken").value = c.tgToken || "";
    document.getElementById("alertsTgChat").value = c.tgChatId || "";
    document.getElementById("alertsPhone").value = c.phone || "";
    document.getElementById("alertsApiKey").value = c.apiKey || "";
    document.getElementById("alertsEmailKey").value = c.emailKey || "";
    document.getElementById("alertsEmailImportant").checked = c.emailImportantOnly === true;
    document.getElementById("alertsOnSale").checked = c.onSale !== false;
    document.getElementById("alertsOnLowStock").checked = c.onLowStock !== false;
    document.getElementById("alertsOnDayClose").checked = c.onDayClose !== false;
    document.getElementById("alertsOnStockTake").checked = c.onStockTake !== false;
    document.getElementById("alertsOnSmart").checked = c.onSmart !== false;
    document.getElementById("alertsOnDelivery").checked = c.onDelivery !== false;
    document.getElementById("alertsOnAudit").checked = c.onAudit !== false;
    document.getElementById("alertsStatus").textContent = "";
    window.toggleAlertChannel();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("alertsModal")).show();
};

function readAlertForm() {
    return {
        enabled: document.getElementById("alertsEnabled").checked,
        useTelegram: document.getElementById("alertsUseTelegram").checked,
        tgToken: document.getElementById("alertsTgToken").value.trim(),
        tgChatId: document.getElementById("alertsTgChat").value.trim(),
        useWhatsApp: document.getElementById("alertsUseWhatsApp").checked,
        phone: normalizePhone(document.getElementById("alertsPhone").value),
        apiKey: document.getElementById("alertsApiKey").value.trim(),
        useEmail: document.getElementById("alertsUseEmail").checked,
        emailKey: document.getElementById("alertsEmailKey").value.trim(),
        emailImportantOnly: document.getElementById("alertsEmailImportant").checked,
        onSale: document.getElementById("alertsOnSale").checked,
        onLowStock: document.getElementById("alertsOnLowStock").checked,
        onDayClose: document.getElementById("alertsOnDayClose").checked,
        onStockTake: document.getElementById("alertsOnStockTake").checked,
        onSmart: document.getElementById("alertsOnSmart").checked,
        onDelivery: document.getElementById("alertsOnDelivery").checked,
        onAudit: document.getElementById("alertsOnAudit").checked
    };
}

/**
 * Lists what is missing for every channel that is ticked (empty list = good to go)
 */
function alertFormProblems(f) {
    const problems = [];
    if (!f.useTelegram && !f.useWhatsApp && !f.useEmail) problems.push("Tick at least one place to send alerts to.");
    if (f.useTelegram && (!f.tgToken || !f.tgChatId)) problems.push("Telegram needs the bot token and your chat ID.");
    if (f.useWhatsApp && (f.phone.length < 10 || !f.apiKey)) problems.push("WhatsApp needs your number (with country code) and the CallMeBot key.");
    if (f.useEmail && !f.emailKey) problems.push("Email needs your Web3Forms access key.");
    return problems;
}

window.saveAlertSettings = async () => {
    if (!can("alerts.manage")) return denyAccess("change alert settings");

    const f = readAlertForm();
    if (f.enabled) {
        const problems = alertFormProblems(f);
        if (problems.length) return Swal.fire("Details needed", problems.join("<br>"), "warning");
    }

    try {
        await window.db.collection("settings").doc("alerts").set({
            ...f,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        hideModalById("alertsModal");
        Swal.fire({ icon: "success", title: f.enabled ? "Alerts are on" : "Alerts are off", timer: 1500, showConfirmButton: false });
    } catch (err) {
        Swal.fire("Could not save", err.message, "error");
    }
};

window.sendAlertTest = async () => {
    const f = readAlertForm();
    const status = document.getElementById("alertsStatus");
    status.style.whiteSpace = "pre-line";

    const problems = alertFormProblems(f);
    if (problems.length) {
        status.className = "small mt-2 text-warning";
        status.textContent = problems.join("\n");
        return;
    }

    status.className = "small mt-2 text-muted";
    status.textContent = "Sending...";

    const text = `✅ Madollar test message. Alerts are working! (${new Date().toLocaleTimeString()})`;
    const channels = [];
    if (f.useTelegram) channels.push(["telegram", "Telegram"]);
    if (f.useWhatsApp) channels.push(["whatsapp", "WhatsApp"]);
    if (f.useEmail) channels.push(["email", "Email"]);

    const results = await Promise.all(channels.map(([ch]) => sendOnChannel(ch, f, text)));
    const lines = results.map((r, i) => {
        const name = channels[i][1];
        if (!r.ok) return `✗ ${name}: ${r.error}`;
        return r.unconfirmed ? `• ${name}: sent (can take a minute, cannot be confirmed)` : `✓ ${name}: delivered`;
    });
    status.className = "small mt-2 " + (results.every(r => r.ok) ? "text-success" : "text-danger");
    status.textContent = lines.join("\n");
};

/**
 * Looks up the admin's Telegram chat ID from the bot's latest message (the admin must press Start in the bot first)
 */
window.findTelegramChatId = async () => {
    const token = document.getElementById("alertsTgToken").value.trim();
    const status = document.getElementById("alertsStatus");
    if (!token) {
        status.className = "small mt-2 text-warning";
        status.textContent = "Paste the bot token first.";
        return;
    }
    status.className = "small mt-2 text-muted";
    status.textContent = "Looking for your chat...";
    try {
        const res = await fetch(`https://api.telegram.org/bot${cleanToken(token)}/getUpdates`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || "Telegram rejected the token.");
        const msgs = (data.result || []).map(u => u.message || u.channel_post || u.my_chat_member).filter(Boolean);
        const last = msgs.length ? msgs[msgs.length - 1] : null;
        if (!last || !last.chat) {
            status.className = "small mt-2 text-warning";
            status.textContent = "No messages found. Open your bot in Telegram, press Start, send \"hi\", then try again.";
            return;
        }
        document.getElementById("alertsTgChat").value = last.chat.id;
        status.className = "small mt-2 text-success";
        status.textContent = `Found it (${last.chat.first_name || last.chat.title || "chat"}). Now press Send test message.`;
    } catch (err) {
        status.className = "small mt-2 text-danger";
        status.textContent = err.message;
    }
};


/**
 * "What's new" popup: shown once per person after an update.
 * Add a NEW release at the TOP of APP_RELEASES (with a new id) whenever you ship changes.
 * Items marked admin:true are only shown to admins.
 */
const APP_RELEASES = [
    {
        id: "2026.10.85",
        date: "25 Oct 2026",
        title: "Choose where staff can clock in",
        items: [
            { icon: "fa-location-dot", text: "Clock in now follows a work location the admin sets. The Clock In & Out tab shows how close you need to be." },
            { icon: "fa-location-crosshairs", admin: true, text: "New Work location button in Clock In & Out: paste the pin from Google Maps (a link or the coordinates), or stand at the workplace and use your phone's GPS. Add more than one place, and choose how close staff must be." },
            { icon: "fa-user-shield", admin: true, text: "Two new permissions: set the work location, and clock in from anywhere (shown as 'off-site' in the records)." }
        ]
    },
    {
        id: "2026.10.80",
        date: "25 Oct 2026",
        title: "Discounts, refunds and the audit trail",
        items: [
            { icon: "fa-tag", text: "At the till, trusted staff can now change an item's price or give a discount on the whole sale. A reason is always asked for and recorded with their name." },
            { icon: "fa-rotate-left", text: "Refunds: open a sale in the Sales tab and press Refund to take back some or all of the items. The stock can go back on the shelf and the refund is logged with the reason." },
            { icon: "fa-clipboard-list", admin: true, text: "New Audit trail tab: who changed prices, gave discounts, refunded, deleted sales or changed stock, and when. Only people with the delete permission can remove entries, and a note is always kept." },
            { icon: "fa-user-shield", admin: true, text: "New permissions control this: give discounts, change prices at the till, give refunds, see the audit trail, and delete audit entries. Managers can do the first three by default." },
            { icon: "fa-bell", admin: true, text: "New phone alert option: get told straight away when a discount, price change, refund or deletion happens." }
        ]
    },
    {
        id: "2026.10.70",
        date: "25 Oct 2026",
        title: "Barcode scanning, debt reminders and suppliers",
        items: [
            { icon: "fa-barcode", text: "Scan a bottle with the phone camera in POS to add it to the cart. A barcode reader plugged into the computer works too: just scan into the product box." },
            { icon: "fa-bell", text: "Customers who owe money can be reminded in one tap: a WhatsApp or SMS message opens with their name and balance already written." },

            { icon: "fa-truck", admin: true, text: "New Suppliers tab: record what arrived, from whom, at what cost, and whether you paid. It adds the stock, updates product costs, warns when a price change leaves too little profit, and shows what you owe each supplier." },
            { icon: "fa-barcode", admin: true, text: "Give each product a barcode in Add or Edit Product (type it or scan it). If you scan a bottle that has no barcode yet, you can link it to a product on the spot." }
        ]
    },
    {
        id: "2026.10.53",
        date: "25 Oct 2026",
        title: "Choose what each role can do",
        items: [
            { icon: "fa-user-shield", admin: true, text: "Roles and permissions: in the Staff tab you can now tick exactly what Staff and Managers are allowed to see and do, from adding products to deleting sales. Changes apply straight away to everyone who is logged in." }
        ]
    },
    {
        id: "2026.10.42",
        date: "25 Oct 2026",
        title: "Tots, categories and smarter insights",
        items: [
            { icon: "fa-martini-glass", text: "Sell by the tot: products set up with tots per bottle can be sold as single tots in POS. Stock is taken off automatically." },
            { icon: "fa-tags", text: "Products now have categories (beer, spirits and so on). Tap a category above the product list to filter." },

            { icon: "fa-user-tie", admin: true, text: "New Manager role: a manager can restock, count stock and close days, but cannot see profit or cost figures and cannot delete records. Set it when adding or editing a staff member." },
            { icon: "fa-fire", admin: true, text: "Insights now shows your busy times: sales by hour and by weekday, your peak window, and your busiest and quietest days." },
            { icon: "fa-brain", admin: true, text: "Smart warnings: a list at the top of Insights, and phone alerts, for stock about to run out, sales running behind last week, and days that were never closed." },
            { icon: "fa-layer-group", admin: true, text: "Profit by category in Insights, and a Categories button in Products to sort all your products into categories quickly." }
        ]
    },
    {
        id: "2026.10.38",
        date: "25 Oct 2026",
        title: "Works offline, customer tabs and stock counts",
        items: [
            { icon: "fa-wifi", text: "Works without internet: if the connection drops, sales are saved on this device and sent automatically when it is back. A badge at the top shows when you are offline." },
            { icon: "fa-mobile-screen-button", text: "Install the app: when an Install button appears in the top bar, tap it to add Madollar to your home screen." },
            { icon: "fa-book", text: "Customers can now buy on credit. Choose Credit at checkout for a registered customer, and record their payments from the Customers tab. Each customer has a statement you can download." },
            { icon: "fa-clipboard-check", text: "Stock Take: in the Products tab, count the bottles on the shelf and submit the numbers." },

            { icon: "fa-magnifying-glass-chart", admin: true, text: "Insights now shows profit per product: which products really earn money and which sell a lot for little profit." },
            { icon: "fa-cart-flatbed", admin: true, text: "Requisition has a Suggest reorder button: it works out what to order from how fast each product sells and adds it to the list." },
            { icon: "fa-scale-balanced", admin: true, text: "Stock take results: see what is short or over, with the value in KSh, and update stock to match the count in one tap." },
            { icon: "fa-hand-holding-dollar", admin: true, text: "Close Day now includes cash received from customers paying off their tabs." }
        ]
    },
    {
        id: "2026.10.34",
        date: "24 Oct 2026",
        title: "Phone alerts",
        items: [
            { icon: "fa-paper-plane", admin: true, text: "New Alerts button in the top bar: get a Telegram, WhatsApp or email message for every sale, low stock and day closing results. Switch alerts on or off and choose which ones you want." }
        ]
    },
    {
        id: "2026.10.32",
        date: "24 Oct 2026",
        title: "A fresh look and new tools",
        items: [
            { icon: "fa-moon", text: "Dark theme by default, with a sun/moon button in the top bar to switch to light mode." },
            { icon: "fa-mobile-screen", text: "Works properly on phones: tables scroll sideways with the name column pinned, and buttons respond faster." },
            { icon: "fa-receipt", text: "Sales are now a clean list grouped by day. Tap a sale to see its items. Quick filters: Today, Yesterday, 7 days, This month." },
            { icon: "fa-layer-group", text: "Sales tab now has sections: Sales and Daily Products Sold, so nothing needs scrolling." },
            { icon: "fa-calendar-check", text: "Close Day: at the end of the day enter the cash you counted in the till and submit it." },
            { icon: "fa-user-clock", text: "If you forgot to clock out on your last shift, you'll be asked the time you left when you log in." },
            { icon: "fa-window-restore", text: "Adding customers now happens in a neat popup window." },
            { icon: "fa-arrows-rotate", text: "The app now tells you when a new update is available, with a Refresh button." },
            { icon: "fa-bell", text: "Notifications have a cleaner design." },

            { icon: "fa-chart-pie", admin: true, text: "New Insights tab: sales trend chart, top 10 sellers, and Profit & Loss by month." },
            { icon: "fa-sack-dollar", admin: true, text: "New Profit section in Sales: today's profit compared with yesterday, month-by-month margins, and a typed confirmation before deleting a month." },
            { icon: "fa-scale-balanced", admin: true, text: "Closing Day section in Sales: see whether each day's cash count was balanced, short or over. Cashiers count blind and can't see the expected amount." },
            { icon: "fa-boxes-packing", admin: true, text: "Add Product, Edit Product and Stock (add or reduce with a reason) now open in popup windows." },
            { icon: "fa-id-badge", admin: true, text: "Add and edit Staff now happen in a popup window, with a show/hide password button." },
            { icon: "fa-coins", admin: true, text: "Profit amounts now show two decimals (for example KSh 207,491.54)." }
        ]
    }
];

function whatsNewKey() {
    return `madollar_whatsnew_${(getCurrentUserEmail() || "global").toLowerCase().trim()}`;
}

window.showWhatsNew = (force = false) => {
    const modalEl = document.getElementById("whatsNewModal");
    const body = document.getElementById("whatsNewBody");
    if (!modalEl || !body || modalEl.classList.contains("show")) return;

    let seen = null;
    try { seen = localStorage.getItem(whatsNewKey()); } catch (e) { }

    let releases;
    if (force) releases = APP_RELEASES;
    else if (seen === APP_RELEASES[0].id) releases = [];
    else {
        const idx = APP_RELEASES.findIndex(r => r.id === seen);
        releases = idx === -1 ? APP_RELEASES.slice(0, 1) : APP_RELEASES.slice(0, idx);
    }

    const admin = isAdmin();
    const html = releases.map(r => {
        const items = r.items.filter(i => admin || !i.admin);
        if (!items.length) return "";
        return `
            <div class="wn-release">
                <div class="wn-head"><strong>${r.title}</strong><span>${r.date}</span></div>
                ${items.map(i => `
                    <div class="wn-item">
                        <span class="wn-ico"><i class="${/\bfab\b/.test(i.icon) ? "" : "fas "}${i.icon}"></i></span>
                        <span>${i.text}${i.admin ? ' <span class="wn-tag">Admin</span>' : ''}</span>
                    </div>`).join("")}
            </div>`;
    }).join("");

    if (!html) return;

    body.innerHTML = html;
    modalEl.addEventListener("hidden.bs.modal", () => {
        try { localStorage.setItem(whatsNewKey(), APP_RELEASES[0].id); } catch (e) { }
    }, { once: true });
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
};

// Waits for other popups (notifications, check-in dialogs) to finish before showing "What's new"
window.showWhatsNewWhenReady = (attempt = 0) => {
    const busy = (typeof Swal !== "undefined" && Swal.isVisible()) || document.querySelector(".modal.show");
    if (busy && attempt < 6) {
        setTimeout(() => window.showWhatsNewWhenReady(attempt + 1), 1500);
        return;
    }
    if (!busy) window.showWhatsNew(false);
};

/**
 * New-version notifier: compares the server's copy of main.js (ETag / Last-Modified)
 * with the one seen at page load and invites the user to refresh when it changes.
 */
(function setupUpdateChecker() {
    let baseline = null;
    let notified = false;

    const fingerprint = async () => {
        const res = await fetch(`main.js?_=${Date.now()}`, { method: "HEAD", cache: "no-store" });
        if (!res.ok) return null;
        return (res.headers.get("etag") || "") + "|" + (res.headers.get("last-modified") || "") + "|" + (res.headers.get("content-length") || "");
    };

    const showBanner = () => {
        if (notified) return;
        notified = true;
        const bar = document.createElement("div");
        bar.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:3000;max-width:94vw;" +
            "background:#2b1d0e;color:#fff;border:1px solid #d4a373;border-radius:14px;padding:12px 14px;" +
            "box-shadow:0 12px 40px rgba(0,0,0,.5);display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center";
        bar.innerHTML = `
            <span><i class="fas fa-circle-arrow-up me-2" style="color:#d4a373"></i><strong>New update available.</strong> Refresh to get the latest version.</span>
            <span class="d-flex gap-2">
                <button type="button" class="btn btn-sm btn-custom" id="updateNowBtn">Refresh now</button>
                <button type="button" class="btn btn-sm btn-soft" id="updateLaterBtn">Later</button>
            </span>`;
        document.body.appendChild(bar);
        bar.querySelector("#updateNowBtn").onclick = () => location.reload();
        bar.querySelector("#updateLaterBtn").onclick = () => { bar.remove(); notified = false; baseline = null; };
    };

    const check = async () => {
        try {
            const fp = await fingerprint();
            if (!fp) return;
            if (baseline === null) { baseline = fp; return; }
            if (fp !== baseline) showBanner();
        } catch (e) { /* offline or blocked: try again later */ }
    };

    check();
    setInterval(check, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
})();

/**
 * Light / dark theme toggle (dark is the default, choice is remembered)
 */
function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-bs-theme", theme);
    document.querySelectorAll(".theme-icon").forEach(icon => {
        icon.className = `fas ${theme === "dark" ? "fa-sun" : "fa-moon"} theme-icon`;
    });
}

window.toggleTheme = () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    try { localStorage.setItem("madollar_theme", next); } catch (e) { }
    applyTheme(next);
    if (typeof window.renderInsights === "function") window.renderInsights();
};

applyTheme(document.documentElement.getAttribute("data-theme") || "dark");

document.addEventListener("DOMContentLoaded", function () {
    // Sales sub-tabs: the search / date filters only apply to Transactions and Daily Summary
    const salesSubTabs = document.getElementById("salesSubTabs");
    if (salesSubTabs) {
        salesSubTabs.addEventListener("shown.bs.tab", (e) => {
            const target = e.target.getAttribute("data-bs-target");
            const filters = document.getElementById("salesFilters");
            if (filters) filters.classList.toggle("d-none", target === "#salesSubProfit" || target === "#salesSubClosings");
        });
    }

    const insightsTabBtn = document.querySelector('[data-bs-target="#insightsTab"]');
    if (insightsTabBtn) {
        insightsTabBtn.addEventListener("shown.bs.tab", () => window.renderInsights());
    }

    const auditTabBtn = document.querySelector('[data-bs-target="#auditTab"]');
    if (auditTabBtn) {
        auditTabBtn.addEventListener("shown.bs.tab", () => { window.startAuditListener(); window.renderAudit(); });
    }
    const suppliersTabBtn = document.querySelector('[data-bs-target="#suppliersTab"]');
    if (suppliersTabBtn) {
        suppliersTabBtn.addEventListener("shown.bs.tab", () => window.renderSuppliers());
    }

    const salesTabBtn = document.querySelector('[data-bs-target="#salesTab"]');
    if (salesTabBtn) {
        salesTabBtn.addEventListener("shown.bs.tab", () => {
            if (window.salesNeedsRender !== false) window.filterSalesTable();
        });
    }

    const backToTopBtn = document.getElementById("backToTopBtn");

    if (backToTopBtn) {
        window.addEventListener("scroll", function () {
            if (window.scrollY > 250) {
                backToTopBtn.classList.add("show");
            } else {
                backToTopBtn.classList.remove("show");
            }
        });

        backToTopBtn.addEventListener("click", function () {
            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });
        });
    }
});
