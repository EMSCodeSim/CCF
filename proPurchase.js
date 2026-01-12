/*
  Pro Purchase (Android Play Billing) via cordova-plugin-purchase

  - Works in Capacitor/Cordova builds (global CdvPurchase)
  - Safe no-op on the web (so Netlify / browser preview still works)

  IMPORTANT
  - Create a one-time in-app product in Google Play Console (Managed product)
  - Put that product id below (must match exactly)
*/
(function(){
  "use strict";

  const PRO_KEY = "ccf.pro.v1";

  // ✅ CHANGE THIS to your Play Console Product ID
  // Example: const PRO_PRODUCT_ID = "ccf_pro_upgrade";
  const PRO_PRODUCT_ID = "ccf_pro_upgrade";

  function isPro(){
    try{ return localStorage.getItem(PRO_KEY) === "1"; }catch(e){ return false; }
  }
  function setPro(on){
    try{
      localStorage.setItem(PRO_KEY, on ? "1" : "0");
      window.dispatchEvent(new CustomEvent("ccf:pro-changed", { detail:{ pro:on } }));
    }catch(e){}
  }

  // Internal state
  let _ready = false;
  let _product = null;
  let _lastError = null;

  function hasPlugin(){
    return !!(window.CdvPurchase && window.CdvPurchase.store);
  }

  function getPriceString(){
    try{
      if(_product && _product.offers && _product.offers.length){
        const offer = _product.getOffer ? _product.getOffer() : _product.offers[0];
        if(offer && offer.pricingPhases && offer.pricingPhases.length){
          const ph = offer.pricingPhases[0];
          return ph.price ? (ph.price + "") : (ph.priceString || "");
        }
      }
      // Some builds expose product.price or product.priceMicros
      if(_product && _product.priceString) return _product.priceString;
    }catch(e){}
    return "";
  }

  function init(){
    if(_ready) return;
    if(!hasPlugin()) return;

    const CdvPurchase = window.CdvPurchase;
    const store = CdvPurchase.store;

    try{
      // Register the managed (non-consumable) product
      store.register([{
        id: PRO_PRODUCT_ID,
        platform: CdvPurchase.Platform.GOOGLE_PLAY,
        type: CdvPurchase.ProductType.NON_CONSUMABLE,
      }]);

      // Event handlers
      store.when()
        .productUpdated((p)=>{
          if(p && p.id === PRO_PRODUCT_ID){
            _product = p;
            window.dispatchEvent(new CustomEvent("ccf:pro-product", { detail:{ product:p } }));
          }
        })
        .approved((tx)=>{
          // NOTE: For simple one-time unlocks, local ownership is usually enough.
          // If you add server validation later, call tx.verify() and unlock on verified.
          try{ tx.finish && tx.finish(); }catch(e){}
          setPro(true);
        })
        .error((err)=>{ _lastError = err; });

      store.when(PRO_PRODUCT_ID)
        .owned(()=>{ setPro(true); });

      // Initialize + refresh
      store.initialize([{ platform: CdvPurchase.Platform.GOOGLE_PLAY }]);
      store.refresh();
      _ready = true;
      window.dispatchEvent(new Event("ccf:pro-ready"));
    }catch(e){
      _lastError = e;
    }
  }

  async function buy(){
    if(isPro()) return { ok:true, already:true };
    if(!hasPlugin()) return { ok:false, error:"IAP not available in web preview." };
    try{
      const store = window.CdvPurchase.store;
      const p = store.get(PRO_PRODUCT_ID);
      if(!p) return { ok:false, error:"Product not found. Check Play Console product id." };
      const offer = p.getOffer ? p.getOffer() : (p.offers && p.offers[0]);
      if(!offer || !offer.order) return { ok:false, error:"No offer available for this product." };
      const err = await offer.order();
      if(err){
        return { ok:false, error:(err.message || (""+err)) };
      }
      // approved/owned handlers will setPro(true)
      return { ok:true };
    }catch(e){
      return { ok:false, error:(e && e.message) ? e.message : (""+e) };
    }
  }

  async function restore(){
    if(!hasPlugin()) return { ok:false, error:"IAP not available in web preview." };
    try{
      const store = window.CdvPurchase.store;
      await store.refresh();
      // owned() handler will setPro(true) if user owns it
      return { ok:true };
    }catch(e){
      return { ok:false, error:(e && e.message) ? e.message : (""+e) };
    }
  }

  // Auto-init when running in Capacitor/Cordova
  document.addEventListener("deviceready", init, false);
  // Also try shortly after load (some builds don’t fire deviceready reliably)
  window.addEventListener("load", ()=>setTimeout(init, 400));

  window.ProPurchase = {
    init,
    buy,
    restore,
    isReady: ()=>_ready,
    isPro,
    getPriceString,
    getLastError: ()=>_lastError,
    getProductId: ()=>PRO_PRODUCT_ID,
  };
})();
