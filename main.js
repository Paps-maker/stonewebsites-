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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");
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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");
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
    if (!isAdmin()) {
        return Swal.fire("Access Denied", "Admins only", "error");
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
    if (!isAdmin()) {
        return Swal.fire("Access Denied", "Admins only", "error");
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

    // Re-render products table so Admin Quick Restock & Actions buttons appear immediately
    if (typeof window.renderProducts === "function" && window.productsCache && window.productsCache.length > 0) {
        window.renderProducts(window.productsCache);
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
                const userDoc = await window.db.collection("users").doc(emailVal).get();

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
                    .get();

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
                            const position = await new Promise((resolve) => {
                                navigator.geolocation.getCurrentPosition(
                                    (pos) => resolve({ success: true, coords: pos.coords }),
                                    (err) => resolve({ success: false, error: err }),
                                    { enableHighAccuracy: true }
                                );
                            });

                            if (!position.success) {
                                Swal.showValidationMessage("Location Required: Please enable GPS/location services.");
                                return false;
                            }

                            const { latitude, longitude } = position.coords;
                            const distance = Math.sqrt(
                                Math.pow(latitude - OFFICE_LAT, 2) +
                                Math.pow(longitude - OFFICE_LON, 2)
                            );

                            if (distance > MAX_DISTANCE) {
                                Swal.showValidationMessage("Access Denied: You are too far from the workplace.");
                                return false;
                            }

                            try {
                                await window.db.collection("attendance").add({
                                    staffEmail: emailVal,
                                    date: today,
                                    clockIn: firebase.firestore.FieldValue.serverTimestamp(),
                                    clockOut: null,
                                    location: { lat: latitude, lon: longitude }
                                });
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
        window.auth.signOut();
    }
});


/* ==========================================================================
   SECTION 5: ATTENDANCE & GEOLOCATION TRACKING
   ========================================================================== */

const OFFICE_LAT = -1.533134;

const OFFICE_LON = 37.131476;

const MAX_DISTANCE = 0.090;

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
                const role = window.currentRole || "staff";
                const isAdminRole = role === "admin";

                if (!isAdminRole && a.staffEmail !== email) return;

                rowsHTML += `
                    <tr>
                        <td data-label="Date">${a.date}</td>
                        ${isAdminRole ? `<td data-label="Staff">${a.staffEmail}</td>` : ""}
                        <td data-label="In">${a.clockIn.toDate().toLocaleTimeString()}</td>
                        <td data-label="Out">${a.clockOut ? a.clockOut.toDate().toLocaleTimeString() + (a.clockOutManual ? ' <span class="badge text-bg-light border" title="Entered manually by staff on next login">manual</span>' : '') : "Ongoing"}</td>
                        ${isAdminRole ? `
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
                rowsHTML = `<tr><td colspan="${isAdmin() ? 5 : 3}" class="text-center text-muted py-3">No attendance records found.</td></tr>`;
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

    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;

        const distance = Math.sqrt(
            Math.pow(latitude - OFFICE_LAT, 2) +
            Math.pow(longitude - OFFICE_LON, 2)
        );

        if (distance > MAX_DISTANCE) {
            return Swal.fire(
                "Access Denied",
                "You are too far from workplace",
                "error"
            );
        }

        const today = new Date().toLocaleDateString();

        const check = await window.db.collection("attendance")
            .where("staffEmail", "==", email)
            .where("date", "==", today)
            .get();

        if (!check.empty) {
            return Swal.fire("Already Checked In", "You have already completed check-in for today.", "warning");
        }

        await window.db.collection("attendance").add({
            staffEmail: email,
            date: today,
            clockIn: firebase.firestore.FieldValue.serverTimestamp(),
            clockOut: null,
            location: { lat: latitude, lon: longitude }
        });

        await Swal.fire("Clocked In", "Success! Your dashboard access is fully active.", "success");
        showDashboard();

    }, () => {
        Swal.fire("Location Required", "Please allow GPS and location access parameters to clock in.", "warning");
    }, { enableHighAccuracy: true });
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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

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
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const email = getCurrentUserEmail();
    const role = window.currentRole || "staff";

    let query = window.db.collection("attendance").orderBy("clockIn", "desc");
    if (role !== "admin") {
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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

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

    // 1. Build Table Headers Dynamically
    let headerHTML = `<tr><th>Name</th>`;
    if (isAdmin()) headerHTML += `<th>Buy</th>`;
    headerHTML += `<th>Sell</th><th>Stock</th><th>Min</th>`;
    if (isAdmin()) headerHTML += `<th class="text-end">Actions</th>`;
    headerHTML += `</tr>`;

    if (productsHead) productsHead.innerHTML = headerHTML;

    // 2. Sort and Build Rows
    const sortedDocs = [...docs].sort((a, b) => a.data().name.localeCompare(b.data().name));
    let rowsHTML = "";

    sortedDocs.forEach(doc => {
        const p = doc.data();
        const id = doc.id;
        const isLow = parseFloat(p.stock || 0) <= parseFloat(p.min || 0);

        if (isLow) lowStockItems.push(p);

        let rowHTML = `<tr class="${isLow ? 'table-danger' : ''}"><td data-label="Product" class="fw-semibold">${p.name}${isLow ? ' <span class="low-stock ms-1">Low</span>' : ''}</td>`;
        if (isAdmin()) {
            rowHTML += `<td data-label="Buy">KSh ${parseFloat(p.buyPrice || 0).toFixed(2)}</td>`;
        }
        rowHTML += `<td data-label="Sell">KSh ${parseFloat(p.price || 0).toFixed(2)}</td>
                   <td data-label="Stock"><span class="stock-pill">${window.toMixedFraction(p.stock)}</span></td>
                   <td data-label="Min" class="text-muted">${window.toMixedFraction(p.min)}</td>`;

        if (isAdmin()) {
            rowHTML += `
            <td class="text-end text-nowrap">
                <button class="btn btn-sm btn-soft stockBtn" data-id="${id}" title="Add or reduce stock"><i class="fas fa-boxes-packing me-1 text-success"></i>Stock</button>
                <button class="btn btn-sm btn-soft editBtn" data-id="${id}" title="Edit product"><i class="fas fa-pen text-primary"></i></button>
                <button class="btn btn-sm btn-soft delBtn" data-id="${id}" title="Delete product"><i class="fas fa-trash-can text-danger"></i></button>
            </td>`;
        }
        rowHTML += `</tr>`;
        rowsHTML += rowHTML;
    });

    if (!rowsHTML) {
        const cols = isAdmin() ? 6 : 3 + 1;
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

            const editModalEl = document.getElementById("editProductModal");
            if (editModalEl) bootstrap.Modal.getOrCreateInstance(editModalEl).show();
        };
    });

    // 5. Attach Delete Listeners (with Undo functionality)
    document.querySelectorAll(".delBtn").forEach(btn => {
        btn.onclick = async () => {
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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");
    ["prodName", "prodBuyPrice", "prodPrice", "prodStock", "prodMin"].forEach(id => {
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
            if (!isAdmin()) {
                return Swal.fire("Access Denied", "Admins only", "error");
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

            try {
                // Save main product record
                const docRef = await window.db.collection("products").add({
                    name: pName,
                    buyPrice: parseFloat(prodBuyPrice.value) || 0,
                    price: parseFloat(prodPrice.value) || 0,
                    stock: parsedStock,
                    min: parseFloat(prodMin.value) || 0
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
            } catch (err) {
                Swal.fire("Error", "Failed to add product: " + err.message, "error");
            }
        };
    }

    // Save Edit Product Handler
    if (saveEditBtn) {
        saveEditBtn.onclick = async () => {
            if (!editProductId) return;
            try {
                await window.db.collection("products").doc(editProductId).update({
                    name: document.getElementById("editProdName").value,
                    buyPrice: parseFloat(document.getElementById("editProdBuyingPrice").value) || 0,
                    price: parseFloat(document.getElementById("editProdPrice").value) || 0,
                    stock: parseFloat(document.getElementById("editProdStock").value) || 0,
                    min: parseFloat(document.getElementById("editProdMin").value) || 0
                });
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
    window.renderProducts(window.productsCache);

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
    searchInput.oninput = (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = window.productsCache.filter(doc => {
            const name = doc.data().name || "";
            return name.toLowerCase().includes(term);
        });
        window.renderProducts(filtered);
    };
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

                const deleteBtn = isAdmin() ? `
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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

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

    const hideBtnClass = isAdmin() ? '' : 'd-none';
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
        if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

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

        const isAdminRole = isAdmin();
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

window.openCustomerModal = () => {
    if (custName) custName.value = "";
    if (custPhone) custPhone.value = "";
    bootstrap.Modal.getOrCreateInstance(document.getElementById("customerModal")).show();
};

if (addCustomerBtn) {
    addCustomerBtn.onclick = async () => {
        if (!custName || !custPhone || !custName.value.trim() || !custPhone.value.trim()) {
            return Swal.fire("Missing Info", "Enter both the customer's name and phone number.", "warning");
        }
        try {
            await window.db.collection("customers").add({ name: custName.value.trim(), phone: custPhone.value.trim() });
            custName.value = custPhone.value = "";
            hideModalById("customerModal");
            Swal.fire({ icon: "success", title: "Customer saved", timer: 1200, showConfirmButton: false });
        } catch (e) {
            Swal.fire("Error", "Could not save customer: " + e.message, "error");
        }
    };
}

if (customersTable && posCustomer) {
    window.db.collection("customers").onSnapshot(snap => {
        let rowsHTML = "";
        posCustomer.innerHTML = '<option value="">Guest</option>';

        snap.forEach(doc => {
            const c = doc.data();
            let actions = "";
            if (isAdmin()) {
                actions = `<button class="btn btn-sm btn-soft delCustBtn" data-id="${doc.id}" title="Delete customer"><i class="fas fa-trash-can text-danger"></i></button>`;
            }
            rowsHTML += `<tr>
                <td data-label="Name" class="fw-semibold">${c.name}</td><td data-label="Phone">${c.phone || ''}</td><td class="text-end">${actions}</td>
            </tr>`;

            const option = document.createElement("option");
            option.value = doc.id;
            option.textContent = c.name;
            posCustomer.appendChild(option);
        });

        customersTable.innerHTML = rowsHTML || `<tr><td colspan="3"><div class="empty-state"><i class="fas fa-users"></i>No customers registered yet.</div></td></tr>`;

        if (isAdmin()) {
            document.querySelectorAll(".delCustBtn").forEach(btn => {
                btn.onclick = async () => {
                    const id = btn.dataset.id;
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
                        Swal.fire("Deleted!", "Customer record removed.", "success");
                    }
                };
            });
        }
        const custCountEl = document.getElementById("customerCount");
        if (custCountEl) custCountEl.textContent = snap.size;
    });
}

function renderCart() {
    if (!cartList) return;
    cartList.innerHTML = "";
    let runningTotal = 0;

    if (cart.length === 0) {
        cartList.innerHTML = `<li class="empty-state list-unstyled"><i class="fas fa-basket-shopping"></i>Your cart is empty. Search a product above to add it.</li>`;
    }

    cart.forEach((c, i) => {
        runningTotal += (c.price * c.qty);
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between align-items-center gap-3";
        li.innerHTML = `
            <div class="me-auto">
                <div class="cart-line-name"></div>
                <div class="cart-line-meta">${window.toMixedFraction(c.qty)} × KSh ${Number(c.price).toLocaleString()}</div>
            </div>
            <div class="cart-line-total">KSh ${(c.price * c.qty).toFixed(2)}</div>`;
        li.querySelector(".cart-line-name").textContent = c.name;
        const rmBtn = document.createElement("button");
        rmBtn.className = "btn btn-soft btn-sm btn-icon";
        rmBtn.title = "Remove item";
        rmBtn.innerHTML = `<i class="fas fa-xmark text-danger"></i>`;
        rmBtn.onclick = () => { cart.splice(i, 1); renderCart(); };
        li.appendChild(rmBtn);
        cartList.appendChild(li);
    });

    if (cartTotalDisplay) cartTotalDisplay.textContent = `KSh ${runningTotal.toFixed(2)}`;
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
                    ${p.name} - <strong>KSh ${p.price}</strong> ${isOutOfStock ? '<span class="low-stock ms-1">Out of Stock</span>' : ""}
                </a>
            `;
        }).join('');
        productResults.style.display = matches.length ? "block" : "none";
    };
}

window.selectProd = (id, name, price) => {
    if (productSearch) productSearch.value = name;
    selectedProduct = { id, name, price };
    if (productResults) productResults.style.display = "none";
};

if (addToCartBtn) {
    addToCartBtn.onclick = () => {
        let targetDoc = null;
        if (selectedProduct && selectedProduct.id) {
            targetDoc = window.productsCache.find(p => p.id === selectedProduct.id);
        } else if (posProductEl && posProductEl.value) {
            targetDoc = window.productsCache.find(p => p.id === posProductEl.value);
        }

        if (!targetDoc) return Swal.fire("No Product Selected", "Search and pick a product first.", "warning");
        const prodData = targetDoc.data();
        const prodId = targetDoc.id;

        const parseQty = (val) => {
            if (typeof val === 'string' && val.includes('/')) {
                const parts = val.split('/');
                if (parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1])) && parseFloat(parts[1]) !== 0) {
                    return parseFloat(parts[0]) / parseFloat(parts[1]);
                }
            }
            return parseFloat(val);
        };

        const currentStock = parseFloat(prodData.stock) || 0;
        const requestedQty = parseQty(posQty.value);

        if (isNaN(requestedQty) || requestedQty <= 0) return Swal.fire("Invalid Quantity", "Enter a quantity such as 1 or 1/2.", "warning");
        if (currentStock <= 0) return Swal.fire("Out of Stock", `Sorry, ${prodData.name} is out of stock.`, "warning");
        if (requestedQty > currentStock) return Swal.fire("Insufficient Stock", `Only ${window.toMixedFraction(currentStock)} available.`, "warning");

        cart.push({
            id: prodId,
            name: prodData.name,
            price: parseFloat(prodData.price),
            qty: requestedQty
        });

        try {
            new Audio("https://actions.google.com/sounds/v1/ui/beep_short.ogg").play();
        } catch (e) { }

        renderCart();

        selectedProduct = null;
        if (productSearch) productSearch.value = "";
        if (posQty) posQty.value = "1";
        if (productSearch) productSearch.focus();
    };
}

if (saveCustomerBtn) {
    saveCustomerBtn.onclick = async () => {
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

if (clearCartBtn) clearCartBtn.onclick = () => { cart = []; renderCart(); };
renderCart();

if (checkoutBtn) {
    checkoutBtn.onclick = () => {
        if (cart.length === 0) return Swal.fire("Cart Empty", "Please add items to cart before proceeding to checkout.", "warning");

        const posCustEl = document.getElementById("posCustomer");
        const customerName = (posCustEl && posCustEl.value && posCustEl.value !== "")
            ? posCustEl.selectedOptions[0].text
            : "Guest";

        const runningTotal = cart.reduce((sum, c) => sum + (c.price * c.qty), 0);

        const modalCustEl = document.getElementById("modalCustomerName");
        const modalTotalEl = document.getElementById("modalTotalAmount");
        const modalCartSummary = document.getElementById("modalCartSummary");

        if (modalCustEl) modalCustEl.textContent = customerName;
        if (modalTotalEl) modalTotalEl.textContent = `KSh ${runningTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        if (modalCartSummary) {
            modalCartSummary.innerHTML = cart.map(i => `
                <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                    <div>
                        <strong>${i.name}</strong>
                        <span class="badge text-bg-light border ms-1">× ${window.toMixedFraction(i.qty)}</span>
                    </div>
                    <span class="fw-bold">KSh ${(i.price * i.qty).toFixed(2)}</span>
                </div>
            `).join('');
        }

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

        paymentCompleteBtn.disabled = true;
        const originalText = paymentCompleteBtn.innerHTML;
        paymentCompleteBtn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> Processing...`;

        const posCustEl = document.getElementById("posCustomer");
        const customerName = (posCustEl && posCustEl.value && posCustEl.value !== "")
            ? posCustEl.selectedOptions[0].text
            : "Guest";

        const paymentMethodEl = document.getElementById("paymentMethod");
        const transCodeEl = document.getElementById("transCode");

        // Close payment modal during processing attempt
        const paymentModalEl = document.getElementById("paymentModal");
        if (paymentModalEl) {
            const inst = bootstrap.Modal.getInstance(paymentModalEl);
            if (inst) inst.hide();
        }

        if (typeof hideToast === 'function') hideToast();

        const processCheckout = async () => {
            const processedItems = [];
            let totalAmount = 0;
            const batch = window.db.batch();

            // 1. Fetch current product data & validate stock levels
            for (const c of cart) {
                const prodRef = window.db.collection("products").doc(c.id);
                const snap = await prodRef.get();

                if (!snap.exists) throw new Error(`Product "${c.name}" not found in inventory.`);
                const pData = snap.data();

                const currentStock = parseFloat(pData.stock) || 0;
                const requestedQty = parseFloat(c.qty) || 0;

                if (currentStock < requestedQty) {
                    throw new Error(`Insufficient stock for "${c.name}". Available: ${currentStock}, Requested: ${requestedQty}`);
                }

                const sellPrice = parseFloat(c.price) || 0;
                totalAmount += (sellPrice * requestedQty);

                processedItems.push({
                    id: c.id,
                    name: c.name,
                    price: sellPrice,
                    qty: requestedQty,
                    cost: parseFloat(pData.buyPrice) || 0
                });

                // Batch stock reduction
                const newStock = Math.max(currentStock - requestedQty, 0);
                batch.update(prodRef, { stock: newStock });
            }

            // 2. Add Sale transaction record to batch
            const saleRef = window.db.collection("sales").doc();
            batch.set(saleRef, {
                customer: customerName,
                items: processedItems,
                total: totalAmount,
                payment: paymentMethodEl ? paymentMethodEl.value : "Cash",
                transaction: transCodeEl ? transCodeEl.value : "",
                date: new Date()
            });

            // 3. Execute atomic batch write (all or nothing)
            await batch.commit();
        };

        // 10-Second Timeout Race Controller
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("NETWORK_TIMEOUT")), 10000);
        });

        try {
            await Promise.race([processCheckout(), timeoutPromise]);

            // Clear cart & reset inputs
            cart = [];
            renderCart();
            if (transCodeEl) transCodeEl.value = "";
            if (posCustEl) posCustEl.value = "";

            if (typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) Swal.close();

            Swal.fire({
                title: "Payment Completed!",
                text: "Sale recorded successfully and inventory stock updated.",
                icon: "success",
                confirmButtonColor: "#198754"
            });

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
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No matching sales records found.</td></tr>`;
        renderGroupedSales(filtered, query);
        return;
    }

    let rowsHTML = "";

    filtered.forEach(s => {
        const saleDate = s.date.toDate();
        const dateStr = saleDate.toLocaleDateString('en-GB');
        const timeStr = saleDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const itemsMiniTable = `
            <div class="pe-1" style="max-height: 220px; overflow-y: auto;">
                <table class="table table-sm table-borderless table-hover align-middle mb-0" style="font-size: 0.84rem; background: transparent;">
                    <tbody>
                        ${s.items.map((i, idx) => {
            const isMatch = query && i.name.toLowerCase().includes(query);
            const qtyVal = parseFloat(i.qty) || 0;
            const isFraction = (qtyVal % 1 !== 0);
            const formattedQty = window.toMixedFraction(qtyVal);
            const priceVal = parseFloat(i.price) || 0;
            const subtotal = priceVal * qtyVal;

            return `
                                <tr class="${isMatch ? 'table-warning rounded fw-bold' : ''}">
                                    <td style="width: 85px;" class="ps-0 py-1">
                                        <span class="badge ${isFraction ? 'bg-primary-subtle text-primary border border-primary-subtle' : 'bg-light text-dark border'} font-monospace px-2 py-1">
                                            x ${formattedQty}
                                        </span>
                                    </td>
                                    <td class="fw-semibold text-dark py-1">
                                        ${i.name}
                                    </td>
                                    <td class="text-nowrap text-muted text-end py-1" style="width: 130px;">
                                        <small class="text-secondary opacity-75">@ ${priceVal.toLocaleString()}</small>
                                        <strong class="text-dark ms-1">KSh ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                                    </td>
                                    ${isAdmin() ? `
                                        <td style="width: 25px;" class="text-end pe-0 py-1">
                                            <button class="btn btn-link text-danger p-0 border-0 ms-1 opacity-75 hover-opacity-100" 
                                                    title="Delete item from this sale" 
                                                    onclick="window.deleteItemFromSale('${s.id}', ${idx})">
                                                <i class="fas fa-times-circle text-danger"></i>
                                            </button>
                                        </td>
                                    ` : ''}
                                </tr>
                            `;
        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

        const adminDeleteBtn = isAdmin()
            ? `<button class="btn btn-sm btn-outline-danger" title="Delete Sale Transaction" onclick="window.deleteSale('${s.id}')">
                <i class="fas fa-trash-alt me-1"></i>Delete
               </button>`
            : '';

        const totalQty = s.items.reduce((sum, item) => sum + (parseFloat(item.qty) || 0), 0);

        rowsHTML += `
            <tr>
                <td style="vertical-align: top;" class="py-3">
                    <div class="fw-bold text-dark text-nowrap" style="font-size: 0.88rem;">
                        <i class="far fa-calendar-alt text-primary me-1"></i>${dateStr}
                    </div>
                    <div class="text-muted text-nowrap" style="font-size: 0.78rem;">
                        <i class="far fa-clock me-1 text-secondary"></i>${timeStr}
                    </div>
                    ${s.transaction ? `<div class="mt-1"><span class="badge bg-light text-secondary border font-monospace" style="font-size: 0.68rem;">${s.transaction}</span></div>` : ''}
                </td>
                <td style="vertical-align: top;" class="py-3">
                    <div class="d-flex align-items-center">
                        <div class="avatar-sm bg-light text-primary rounded-circle d-flex align-items-center justify-content-center me-2" style="width:26px; height:26px; font-size:0.75rem; flex-shrink:0;">
                            <i class="fas fa-user"></i>
                        </div>
                        <span class="fw-medium text-dark text-nowrap" style="font-size: 0.88rem;">${s.customer || 'Guest'}</span>
                    </div>
                </td>
                <td style="vertical-align: top;" class="py-3">
                    ${itemsMiniTable}
                </td>
                <td style="vertical-align: top;" class="py-3">
                    <div class="text-start">
                        <div class="fw-bold text-success text-nowrap" style="font-size: 1rem;">
                            KSh ${parseFloat(s.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <small class="text-muted d-block text-nowrap" style="font-size: 0.75rem;">
                            ${s.items.length} product${s.items.length > 1 ? 's' : ''} (${window.toMixedFraction(totalQty)} units)
                        </small>
                    </div>
                </td>
                <td style="vertical-align: top;" class="text-end py-3">
                    <div class="d-flex justify-content-end gap-1 flex-nowrap">
                        <button class="btn btn-sm btn-outline-primary" title="Download PDF Receipt" onclick="window.downloadSale('${s.id}')">
                            <i class="fas fa-file-pdf me-1"></i>PDF
                        </button>
                        ${adminDeleteBtn}
                    </div>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = rowsHTML;

    // Synchronize Daily Product Sales Summary list to match search query across all dates sold
    renderGroupedSales(filtered, query);
};

// Sales Snapshot Listener
window.db.collection("sales").orderBy("date", "desc").onSnapshot(snap => {
    let allSales = [];
    let todayTotal = 0;
    let yesterdayTotal = 0;
    let monthlyTotal = 0;
    let dailyProfit = 0;
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
        allSales.push({ id: doc.id, ...s });
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
        if (sDateStr === today) { todayTotal += parseFloat(s.total); dailyProfit += profit; }
        if (sDateStr === yesterdayDateStr) { yesterdayTotal += parseFloat(s.total); }
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
    if (dProfit) dProfit.textContent = "KSh " + dailyProfit.toLocaleString();
    if (tProfit) tProfit.textContent = "KSh " + totalProfit.toLocaleString();

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
    renderGroupedSales(allSales);
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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

    const salesToDelete = (window.allSales || []).filter(s => {
        const mKey = s.date.toDate().toLocaleString('default', { month: 'long', year: 'numeric' });
        return mKey === monthKey;
    });

    if (salesToDelete.length === 0) {
        return Swal.fire("Notice", "No records found for this month.", "info");
    }

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

            if (shouldRestock && Array.isArray(s.items)) {
                s.items.forEach(item => {
                    const qty = parseFloat(item.qty) || 0;
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
            window.filterSalesTable();
        }, 150);
    };
}
if (dateFromEl) dateFromEl.onchange = () => window.filterSalesTable();
if (dateToEl) dateToEl.onchange = () => window.filterSalesTable();

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
                s.items.map(i => `${i.name} (${window.toMixedFraction(i.qty)} x KSh ${i.price})`).join("\n"),
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

    sortedDates.forEach(date => {
        const dailySales = grouped[date];
        let dayTotal = 0;
        let productSummary = {};

        dailySales.forEach(s => {
            s.items.forEach(item => {
                const itemMatches = !query || item.name.toLowerCase().includes(query);
                if (itemMatches) {
                    if (!productSummary[item.name]) productSummary[item.name] = { qty: 0, total: 0 };
                    const qtyVal = parseFloat(item.qty) || 0;
                    const priceVal = parseFloat(item.price) || 0;
                    const subtotal = priceVal * qtyVal;
                    productSummary[item.name].qty += qtyVal;
                    productSummary[item.name].total += subtotal;
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

        const adminDeleteDayBtn = isAdmin()
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
                        <button class="btn btn-sm btn-outline-primary" onclick="window.downloadDailyReport('${date}')">
                            <i class="fas fa-file-pdf me-1"></i>PDF Report
                        </button>
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

    container.innerHTML = cardsHTML;
}

// Delete Specific Item from a Sale Transaction
window.deleteItemFromSale = async (saleId, itemIndex) => {
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

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
        const qty = parseFloat(itemToDelete.qty) || 0;

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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

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

        const restockedItems = [];

        if (shouldRestock && sale && Array.isArray(sale.items)) {
            for (const item of sale.items) {
                const qty = parseFloat(item.qty) || 0;
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
window.deleteDay = async (dateStr) => {
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");

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

            if (shouldRestock && Array.isArray(s.items)) {
                s.items.forEach(item => {
                    const qty = parseFloat(item.qty) || 0;
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
            if (!productSummary[item.name]) {
                productSummary[item.name] = { qty: 0, total: 0 };
            }
            productSummary[item.name].qty += parseFloat(item.qty) || 0;
            productSummary[item.name].total += (item.price * item.qty);
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

    profitCardBreakdown.innerHTML = "";
    const monthlyProfits = window.monthlyProfitsCache || {};
    const sortedMonths = Object.keys(monthlyProfits);

    if (sortedMonths.length === 0) {
        profitCardBreakdown.innerHTML = `<div class="opacity-75">No sales profit history recorded yet.</div>`;
        return;
    }

    let html = "";
    sortedMonths.forEach(mKey => {
        const mData = monthlyProfits[mKey];
        const deleteBtnHTML = isAdmin()
            ? `<button class="btn btn-sm btn-danger py-0 px-2 ms-2 shadow-sm" style="font-size: 0.75rem;" title="Delete all sales for ${mKey}" onclick="window.deleteMonthProfit('${mKey}')"><i class="fas fa-trash-alt me-1"></i>Delete</button>`
            : '';

        html += `
            <div class="d-flex justify-content-between align-items-center py-1 border-bottom border-white border-opacity-25">
                <span class="opacity-75 font-monospace fw-semibold">${mKey}:</span>
                <div class="d-flex align-items-center flex-wrap justify-content-end">
                    <span class="fw-bold me-2">Profit: KSh ${mData.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <small class="opacity-75 me-1">(Rev: KSh ${mData.revenue.toLocaleString()})</small>
                    ${deleteBtnHTML}
                </div>
            </div>
        `;
    });
    profitCardBreakdown.innerHTML = html;
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
            i.name,
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
                    return `${i.name} (${window.toMixedFraction(i.qty)} x KSh ${i.price.toLocaleString()} = KSh ${sub.toLocaleString()})`;
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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");
    window.editStaffId = null;
    ["staffName", "staffEmail", "staffPassword"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    const emailEl = document.getElementById("staffEmail");
    if (emailEl) emailEl.disabled = false;
    const roleEl = document.getElementById("staffRole");
    if (roleEl) roleEl.value = "staff";
    document.getElementById("staffModalTitle").textContent = "Add Staff Member";
    document.getElementById("addStaffBtn").textContent = "Save";
    bootstrap.Modal.getOrCreateInstance(document.getElementById("staffModal")).show();
};

window.saveStaffMember = async () => {
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
                <td data-label="Role"><span class="badge rounded-pill ${staffRole === 'admin' ? 'text-bg-warning' : 'text-bg-primary'}">${staffRole.toUpperCase()}</span></td>
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
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");
    try {
        const newStatus = currentStatus === "blocked" ? "active" : "blocked";
        await window.db.collection("users").doc(docId).update({ status: newStatus });
        Swal.fire("Status Updated", `Employee profile set to ${newStatus}`, "success");
    } catch (err) {
        Swal.fire("Action Error", err.message, "error");
    }
};

window.deleteStaffUser = async (docId) => {
    if (!isAdmin()) return Swal.fire("Access Denied", "Admins only", "error");
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
            Swal.fire("Deleted", "Profile removed from database", "success");
        }
    } catch (err) {
        Swal.fire("Action Error", err.message, "error");
    }
};


/* ==========================================================================
   SECTION 13: UI NAVIGATION & SCROLL HELPERS
   ========================================================================== */

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
};

applyTheme(document.documentElement.getAttribute("data-theme") || "dark");

document.addEventListener("DOMContentLoaded", function () {
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
