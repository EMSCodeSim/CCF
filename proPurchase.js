/* Pro Purchase – Google Play (Billing v7 safe) */
(function(){
  "use strict";

  const PRO_KEY = "ccf.pro.v1";
  const PRO_PRODUCT_ID = "ccf_pro_upgrade";

  let _ready = false;
  let _product = null;
  let _lastError = null;
  let _purchasing = false;

  function hasPlugin(){
    return !!(window.CdvPurchase && window.CdvPurchase.store);
  }

  function isPro(){
    try { return localStorage.getItem(PRO_KEY) === "1"; }
    catch(e){ return false; }
  }

  function setPro(on){
    try{
      localStorage.setItem(PRO_KEY, on ? "1" : "0");
      window.dispatchEvent(new CustomEvent("ccf:pro-changed", { detail:{ pro:on } }));
    }catch(e){}
  }

  function pickOrderableOffer(p){
    if(!p || !p.offers) return null;
    return p.offers.find(o => typeof o.order === "function") || null;
  }

  function init(){
    if(_ready || !hasPlugin()) return;

    const { store, Platform, ProductType } = window.CdvPurchase;

    try{
      store.initialize([{ platform: Platform.GOOGLE_PLAY }]);

      store.register([{
        id: PRO_PRODUCT_ID,
        platform: Platform.GOOGLE_PLAY,
        type: ProductType.NON_CONSUMABLE
      }]);

      store.when()
        .productUpdated(p=>{
          if(p.id === PRO_PRODUCT_ID) _product = p;
        })
        .approved(tx=>{
          try{ tx.finish(); }catch(e){}
          setPro(true);
          _purchasing = false;
        })
        .error(err=>{
          _lastError = err;
          _purchasing = false;
        });

      store.when(PRO_PRODUCT_ID).owned(()=>{
        setPro(true);
      });

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
    if(_purchasing) return { ok:false, error:"Purchase already in progress." };

    try{
      _purchasing = true;
      const store = window.CdvPurchase.store;
      const p = store.get(PRO_PRODUCT_ID);
      if(!p) throw "Product not loaded";

      const offer = pickOrderableOffer(p);
      if(!offer) throw "No purchasable offer found";

      await offer.order();
      return { ok:true };
    }catch(e){
      _purchasing = false;
      return { ok:false, error:(e.message || ""+e) };
    }
  }

  async function restore(){
    if(!hasPlugin()) return { ok:false, error:"IAP not available in web preview." };
    try{
      await window.CdvPurchase.store.refresh();
      return { ok:true };
    }catch(e){
      return { ok:false, error:(e.message || ""+e) };
    }
  }

  document.addEventListener("deviceready", init, false);
  window.addEventListener("load", ()=>setTimeout(init, 500));

  window.ProPurchase = {
    init,
    buy,
    restore,
    isPro,
    isReady: ()=>_ready,
    getLastError: ()=>_lastError,
    getProductId: ()=>PRO_PRODUCT_ID
  };
})();
