/* Pro Purchase – Google Play (Cordova/Capacitor + cordova-plugin-purchase v13+ safe)
   Product ID: ccf_pro_upgrade (ONE-TIME / NON-CONSUMABLE)
   Fixes:
   - store.refresh() removed (deprecated; use update/restorePurchases)
   - store.initialize([Platform.GOOGLE_PLAY]) correct signature
   - Unlock on APPROVED so purchase always unlocks even without validator
   - Writes both pro flags used across the app: ccf.pro.v1 + ccf.proUnlocked
*/
(function () {
  "use strict";

  // ✅ Play Console Product ID (case-sensitive)
  const PRO_PRODUCT_ID = "ccf_pro_upgrade";

  // ✅ Keys used across your app (you currently use both in different files)
  const PRO_KEY_V1 = "ccf.pro.v1";         // reports.js uses this
  const PRO_KEY_UNLOCKED = "ccf.proUnlocked"; // app.js uses this

  let _ready = false;
  let _product = null;
  let _lastError = null;
  let _purchasing = false;

  function hasPlugin() {
    return !!(window.CdvPurchase && window.CdvPurchase.store);
  }

  function isPro() {
    try {
      return localStorage.getItem(PRO_KEY_V1) === "1" || localStorage.getItem(PRO_KEY_UNLOCKED) === "1";
    } catch (e) {
      return false;
    }
  }

  function setPro(on) {
    try {
      localStorage.setItem(PRO_KEY_V1, on ? "1" : "0");
      localStorage.setItem(PRO_KEY_UNLOCKED, on ? "1" : "0");
      window.dispatchEvent(new CustomEvent("ccf:pro-changed", { detail: { pro: !!on } }));
    } catch (e) {}
  }

  function pickOrderableOffer(p) {
    if (!p || !p.offers) return null;
    return p.offers.find(o => typeof o.order === "function") || null;
  }

  function getStore() {
    return window.CdvPurchase?.store || null;
  }

  function getProduct() {
    const store = getStore();
    if (!store) return null;

    // Some versions support store.get(id, platform), some just store.get(id)
    try {
      const p2 = store.get(PRO_PRODUCT_ID, window.CdvPurchase.Platform.GOOGLE_PLAY);
      if (p2) return p2;
    } catch (e) {}
    try {
      return store.get(PRO_PRODUCT_ID) || null;
    } catch (e) {
      return null;
    }
  }

  function getPriceString() {
    try {
      const p = _product || getProduct();
      const offer = pickOrderableOffer(p);
      // Best-effort display (varies by adapter/version)
      const ph = offer?.pricingPhases?.[0];
      const price = ph?.price || offer?.price || p?.price;
      if (typeof price === "string" && price.trim()) return price;
    } catch (e) {}
    return "";
  }

  async function init() {
    if (_ready || !hasPlugin()) return;

    const C = window.CdvPurchase;
    const store = C.store;

    try {
      // Optional: keep logs quiet in production. (Raise to 4 temporarily if needed.)
      // store.verbosity = 0;

      // Register product first (safe)
      store.register([{
        id: PRO_PRODUCT_ID,
        platform: C.Platform.GOOGLE_PLAY,
        type: C.ProductType.NON_CONSUMABLE
      }]);

      // ✅ Correct initialize signature: array of platforms/options
      await store.initialize([C.Platform.GOOGLE_PLAY]);

      // Listen for updates and transactions
      store.when()
        .productUpdated(p => {
          if (p && p.id === PRO_PRODUCT_ID) _product = p;
        })
        .approved(async (tx) => {
          // ✅ PRODUCTION SAFE: unlock immediately on APPROVED
          // Some versions can re-fire approved; unlock is idempotent.
          try { setPro(true); } catch (e) {}
          _purchasing = false;

          // Finish so Play considers it delivered
          try { await tx.finish(); } catch (e) {}
        })
        .error(err => {
          _lastError = err;
          _purchasing = false;
        });

      // If the product is already owned, unlock
      store.when(PRO_PRODUCT_ID).owned(() => {
        setPro(true);
      });

      // ✅ Replace deprecated refresh() with update()
      try { await store.update(); } catch (e) {}

      // If owned state isn't reliable in some edge cases, a second check is harmless
      try {
        const p = getProduct();
        if (p && p.owned) setPro(true);
      } catch (e) {}

      _ready = true;
      window.dispatchEvent(new Event("ccf:pro-ready"));

    } catch (e) {
      _lastError = e;
    }
  }

  async function buy() {
    if (isPro()) return { ok: true, already: true };
    if (!hasPlugin()) return { ok: false, error: "IAP not available in web preview." };
    if (_purchasing) return { ok: false, error: "Purchase already in progress." };

    try {
      _purchasing = true;

      const store = getStore();
      if (!store) throw new Error("Billing store missing");

      // Ensure fresh product data
      try { await store.update(); } catch (e) {}

      const p = getProduct();
      if (!p) throw new Error("Product not loaded from Google Play. Confirm Play product is Active and app installed from the testing track.");

      // Prefer offer.order() when available; fallback to store.order(id)
      const offer = pickOrderableOffer(p);
      if (offer && typeof offer.order === "function") {
        await offer.order();
      } else if (typeof store.order === "function") {
        await store.order(PRO_PRODUCT_ID);
      } else {
        throw new Error("No purchase method available (offer.order/store.order missing).");
      }

      return { ok: true };
    } catch (e) {
      _purchasing = false;
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  async function restore() {
    if (!hasPlugin()) return { ok: false, error: "IAP not available in web preview." };
    try {
      const C = window.CdvPurchase;
      const store = getStore();
      if (!store) throw new Error("Billing store missing");

      // Prefer restorePurchases if present; else update
      if (typeof store.restorePurchases === "function") {
        await store.restorePurchases(C.Platform.GOOGLE_PLAY);
      } else {
        await store.update();
      }

      // Re-check ownership
      const p = getProduct();
      if (p && p.owned) setPro(true);

      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  document.addEventListener("deviceready", init, false);
  window.addEventListener("load", () => setTimeout(init, 500));

  window.ProPurchase = {
    init,
    buy,
    restore,
    isPro,
    isReady: () => _ready,
    getLastError: () => _lastError,
    getProductId: () => PRO_PRODUCT_ID,
    getPriceString
  };
})();
