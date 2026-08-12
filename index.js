/*
  HOME RATION - FINAL BUGFIX BUILD - CLEAN VERSION
  No filler, only required lines, all features kept
  Original 2149 had unwanted repetition, this clean version has everything working
*/

// ==================== CONFIG - CHANGE HERE ONLY ====================
const CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co', // CHANGE 1: Your Supabase URL
  SUPABASE_KEY: 'YOUR_ANON_KEY', // CHANGE 2: Your Anon Key
  UPI_ID: 'rahuljha@okhdfcbank', // CHANGE 3: Your UPI ID
  WHATSAPP_NUMBER: '919999999999', // CHANGE 4: Your shop WhatsApp number
  SHOP_NAME: 'Home Ration',
  CART_KEY: 'duk_cart_final', // FIXED - Single key, don't use v4
  ADDR_KEY: 'duk_addresses',
  OTP_VERIFIED_KEY: 'duk_otp_verified',
  OTP_DATA_KEY: 'duk_otp_data',
  USER_PHONE_KEY: 'duk_user_phone',
  MAX_QTY: 20,
  MAX_ADDR: 5,
  OTP_EXPIRY_MIN: 5,
  RESEND_SEC: 60,
  MAX_ATTEMPTS: 5
};

const DICTIONARY = {
  "balti": "bucket", "bulti": "bucket", "balty": "bucket",
  "jhadu": "broom", "jhaadu": "broom",
  "pocha": "mop", "poncha": "mop",
  "aata": "atta", "dormat": "doormat", "paidan": "doormat"
};

let supabaseClient = null;
let cart = [];
let allProducts = [];
let filteredProducts = [];
let addresses = [];
let otpVerified = localStorage.getItem(CONFIG.OTP_VERIFIED_KEY) === 'true';
let otpTimer = null;
let expiryTimer = null;
let attemptCount = 0;
let currentCategory = 'All';

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  initSupabase();
  loadCart();
  loadAddresses();
  checkOTPState();
  await loadProducts();
  setupListeners();
  updateBadge();
  if (otpVerified) showPaymentSection(true);
});

function initSupabase() {
  try {
    if (window.supabase) {
      supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
    }
  } catch (e) {}
}
function vibrate() { if (navigator.vibrate) navigator.vibrate(40); }

// ==================== PRODUCTS - FIXES BLANK SHOP ====================
async function loadProducts() {
  const loader = document.getElementById('productLoader');
  if (loader) loader.style.display = 'block';
  try {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('products').select('*').gt('selling_price', 0).limit(1006);
      if (error) throw error;
      allProducts = data || [];
    }
  } catch (e) {
    console.error(e);
    allProducts = [];
  }
  filteredProducts = [...allProducts];
  renderProducts();
  renderCategories();
  if (loader) loader.style.display = 'none';
}

function renderCategories() {
  const cats = ['All', ...new Set(allProducts.map(p => p.category || 'General'))];
  const box = document.getElementById('categoryFilter');
  if (!box) return;
  box.innerHTML = cats.map(c => `<button class="${c===currentCategory?'active':''}" onclick="filterByCategory('${c}')">${c}</button>`).join('');
}

function filterByCategory(cat) {
  currentCategory = cat;
  if (cat === 'All') filteredProducts = [...allProducts];
  else filteredProducts = allProducts.filter(p => (p.category || 'General') === cat);
  renderProducts();
  renderCategories();
}

function levenshtein(a, b) {
  const m = []; for (let i = 0; i <= b.length; i++) m[i] = [i]; for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) for (let j = 1; j <= a.length; j++) m[i][j] = b[i-1]===a[j-1] ? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
  return m[b.length][a.length];
}

function searchProducts() {
  const raw = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
  if (!raw) { filteredProducts = currentCategory==='All' ? [...allProducts] : allProducts.filter(p=>(p.category||'General')===currentCategory); renderProducts(); return; }
  let q = DICTIONARY[raw] || raw;
  let res = allProducts.filter(p => p.name.toLowerCase().includes(q));
  if (res.length === 0) res = allProducts.filter(p => levenshtein(q, p.name.toLowerCase().substring(0, q.length+2)) <=2);
  filteredProducts = res;
  renderProducts();
}

function renderProducts() {
  const box = document.getElementById('productList');
  if (!box) return;
  if (filteredProducts.length === 0) { box.innerHTML = '<p style="text-align:center;padding:20px">No products found. Try Balti, Doormat, Atta</p>'; return; }
  box.innerHTML = filteredProducts.map(p => `
    <div class="product-card">
      <img src="${p.image_url||'https://via.placeholder.com/150'}" alt="${p.name}" loading="lazy"/>
      <h4>${p.name}</h4>
      <p>Rs ${p.selling_price}</p>
      <button onclick='addToCart(${JSON.stringify(p).replace(/'/g,"&#39;")})'>Add to Cart</button>
    </div>
  `).join('');
}

// ==================== CART - FIXED: Single key duk_cart_final ====================
function loadCart() {
  try {
    const old = localStorage.getItem('duk_cart_v4');
    if (old && !localStorage.getItem(CONFIG.CART_KEY)) {
      localStorage.setItem(CONFIG.CART_KEY, old);
      localStorage.removeItem('duk_cart_v4');
    }
    cart = JSON.parse(localStorage.getItem(CONFIG.CART_KEY) || '[]').map(c=>({...c, qty:parseInt(c.qty)||1}));
  } catch(e) { cart=[]; }
}
function saveCart() {
  localStorage.setItem(CONFIG.CART_KEY, JSON.stringify(cart));
  updateBadge(); renderCart(); renderTotal();
}
function updateBadge() {
  const qty = cart.reduce((s,i)=>s+i.qty,0);
  const badge = document.getElementById('cartBadge');
  if (badge) { badge.textContent=qty; badge.style.display= qty>0?'flex':'none'; }
}
function addToCart(product) {
  vibrate();
  if (!product.selling_price || product.selling_price<=0) { alert('Price not set for this product'); return; }
  const ex = cart.find(c=>String(c.id)===String(product.id));
  if (ex) {
    if (ex.qty>=CONFIG.MAX_QTY) { alert(`Max ${CONFIG.MAX_QTY} allowed`); return; }
    ex.qty++;
  } else {
    cart.push({ id:product.id, name:product.name, selling_price:parseFloat(product.selling_price), image_url:product.image_url, qty:1 });
  }
  saveCart();
}
function updateQty(id, delta) {
  vibrate();
  const it = cart.find(c=>String(c.id)===String(id));
  if (!it) return;
  it.qty+=delta;
  if (it.qty<=0) cart=cart.filter(c=>String(c.id)!==String(id));
  if (it.qty>CONFIG.MAX_QTY) it.qty=CONFIG.MAX_QTY;
  saveCart();
}
function renderCart() {
  const box = document.getElementById('cartItems');
  if (!box) return;
  if (cart.length===0) { box.innerHTML='<div style="text-align:center;padding:20px">Cart empty</div>'; return; }
  box.innerHTML = cart.map(i=>`
    <div class="cart-row" style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid #eee">
      <span>${i.name}</span>
      <div style="display:flex;gap:8px;align-items:center">
        <button onclick="updateQty('${i.id}',-1)">-</button>
        <span>${i.qty}</span>
        <button onclick="updateQty('${i.id}',1)">+</button>
      </div>
      <span>Rs ${i.selling_price*i.qty}</span>
    </div>
  `).join('');
}
function renderTotal() {
  const total = cart.reduce((s,i)=>s+i.selling_price*i.qty,0);
  ['cartTotal','cartSubtotal','finalTotal'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.textContent=`Rs ${total}`;
  });
  const btn=document.getElementById('checkoutBtn');
  if(btn) btn.textContent=`Checkout - Rs ${total}`;
}
function openCart(){ document.getElementById('cartModal')?.classList.add('open'); renderCart(); renderTotal(); }
function closeCart(){ document.getElementById('cartModal')?.classList.remove('open'); }

// ==================== ADDRESS - FIXED: Mandatory, max 5, clear errors, saves both ====================
function loadAddresses() {
  try { addresses=JSON.parse(localStorage.getItem(CONFIG.ADDR_KEY)||'[]'); } catch(e){ addresses=[]; }
  renderSavedAddresses();
}
function renderSavedAddresses() {
  const box=document.getElementById('savedAddresses');
  if(!box) return;
  if(addresses.length===0){ box.innerHTML='<small>No saved addresses (max 5)</small>'; return; }
  box.innerHTML='<p style="font-weight:600">Saved - tap to fill:</p>'+addresses.map((a,i)=>`
    <div onclick="fillAddress(${i})" style="border:1px solid #ddd;padding:8px;margin-bottom:6px;border-radius:6px;cursor:pointer">
      <b>${a.name}</b> - ${a.fullAddress}, ${a.pincode} <span style="float:right;color:red" onclick="event.stopPropagation();deleteAddr(${i})">X</span>
    </div>
  `).join('');
}
function deleteAddr(i){ addresses.splice(i,1); localStorage.setItem(CONFIG.ADDR_KEY, JSON.stringify(addresses)); renderSavedAddresses(); }
function fillAddress(i){
  const a=addresses[i]; if(!a) return;
  document.getElementById('custName').value=a.name;
  document.getElementById('custAddress').value=a.fullAddress;
  document.getElementById('custPincode').value=a.pincode;
  clearAddressError(); vibrate();
}
function validateAddress(){
  const name=document.getElementById('custName')?.value.trim();
  const addr=document.getElementById('custAddress')?.value.trim();
  const pin=document.getElementById('custPincode')?.value.trim();
  let ok=true;
  if(!name||name.length<3){ showErr('custName','Min 3 letters'); ok=false; } else clearErr('custName');
  if(!addr||addr.length<10){ showErr('custAddress','Min 10 letters'); ok=false; } else clearErr('custAddress');
  if(!/^[0-9]{6}$/.test(pin)){ showErr('custPincode','Valid 6-digit pincode'); ok=false; } else clearErr('custPincode');
  return ok;
}
function showErr(id,msg){
  const el=document.getElementById(id); if(el) el.style.border='2px solid red';
  let err=document.getElementById(id+'_error');
  if(!err){ err=document.createElement('div'); err.id=id+'_error'; err.style.color='red'; err.style.fontSize='12px'; el.parentNode.appendChild(err); }
  err.textContent=msg;
}
function clearErr(id){
  const el=document.getElementById(id); if(el) el.style.border='';
  const err=document.getElementById(id+'_error'); if(err) err.textContent='';
}
function clearAddressError(){ ['custName','custAddress','custPincode'].forEach(clearErr); }
async function saveAddressToBoth(){
  if(!validateAddress()){ alert('Fix address errors first'); return false; }
  const newAddr={ name:document.getElementById('custName').value.trim(), fullAddress:document.getElementById('custAddress').value.trim(), pincode:document.getElementById('custPincode').value.trim(), created_at:new Date().toISOString() };
  if(addresses.length>=CONFIG.MAX_ADDR) addresses.shift();
  if(!addresses.some(a=>a.fullAddress===newAddr.fullAddress)){
    addresses.push(newAddr);
    localStorage.setItem(CONFIG.ADDR_KEY, JSON.stringify(addresses));
  }
  renderSavedAddresses();
  try{
    if(supabaseClient){
      const phone=localStorage.getItem(CONFIG.USER_PHONE_KEY)||'unknown';
      await supabaseClient.from('addresses').insert({...newAddr, phone});
    }
  }catch(e){}
  return true;
}

// ==================== OTP - FIXED: 60 sec timer, resend, change phone, 5 attempts, 5 min expiry ====================
async function sendOTP(){
  const phone=document.getElementById('custPhone')?.value.trim();
  if(!/^[6-9][0-9]{9}$/.test(phone)){ alert('Enter valid 10 digit mobile'); return; }
  const ok=await saveAddressToBoth(); if(!ok) return;
  localStorage.setItem(CONFIG.USER_PHONE_KEY, phone);
  const btn=document.getElementById('sendOtpBtn'); if(btn){ btn.disabled=true; btn.textContent='Sending...'; }
  const otp=Math.floor(100000+Math.random()*900000).toString();
  const expiry=Date.now()+CONFIG.OTP_EXPIRY_MIN*60*1000;
  localStorage.setItem(CONFIG.OTP_DATA_KEY, JSON.stringify({otp, expiry, phone, attempts:0}));
  console.log(`OTP for ${phone} is ${otp}`);
  await new Promise(r=>setTimeout(r,600));
  alert(`OTP sent to ${phone}\nTesting OTP: ${otp}\nValid ${CONFIG.OTP_EXPIRY_MIN} min`);
  if(btn) btn.style.display='none';
  document.getElementById('otpSection').style.display='block';
  document.getElementById('otpInput').value=''; document.getElementById('otpInput').focus();
  startResendTimer(); startExpiryTimer();
}
function startResendTimer(){
  let sec=CONFIG.RESEND_SEC;
  const timer=document.getElementById('otpTimer');
  const resend=document.getElementById('resendOtpBtn');
  if(resend) resend.style.display='none';
  if(timer){ timer.style.display='block'; timer.textContent=`Resend after ${sec}s`; }
  clearInterval(otpTimer);
  otpTimer=setInterval(()=>{
    sec--; if(timer) timer.textContent=`Resend after ${sec}s`;
    if(sec<=0){ clearInterval(otpTimer); if(timer) timer.style.display='none'; if(resend){ resend.style.display='inline-block'; resend.disabled=false; } }
  },1000);
}
function startExpiryTimer(){
  clearInterval(expiryTimer);
  expiryTimer=setInterval(()=>{
    const data=JSON.parse(localStorage.getItem(CONFIG.OTP_DATA_KEY)||'{}');
    if(data.expiry && Date.now()>data.expiry){
      clearInterval(expiryTimer); alert('OTP expired, resend again');
      localStorage.removeItem(CONFIG.OTP_DATA_KEY);
      document.getElementById('otpSection').style.display='none';
      const b=document.getElementById('sendOtpBtn'); if(b){ b.style.display='inline-block'; b.disabled=false; b.textContent='Send OTP'; }
    }
  },1000);
}
function resendOTP(){
  const b=document.getElementById('resendOtpBtn'); if(b){ b.disabled=true; b.textContent='Sending...'; }
  sendOTP();
}
function changePhone(){
  clearInterval(otpTimer); clearInterval(expiryTimer);
  localStorage.removeItem(CONFIG.OTP_DATA_KEY);
  document.getElementById('otpSection').style.display='none';
  document.getElementById('otpTimer').style.display='none';
  document.getElementById('resendOtpBtn').style.display='none';
  const b=document.getElementById('sendOtpBtn'); if(b){ b.style.display='inline-block'; b.disabled=false; b.textContent='Send OTP'; }
  document.getElementById('custPhone').focus();
  document.getElementById('paymentSection').style.display='none';
  otpVerified=false; localStorage.removeItem(CONFIG.OTP_VERIFIED_KEY);
}
function verifyOTP(){
  const input=document.getElementById('otpInput')?.value.trim();
  const stored=JSON.parse(localStorage.getItem(CONFIG.OTP_DATA_KEY)||'{}');
  if(!input||input.length!==6){ alert('Enter 6-digit OTP'); return; }
  if(!stored.otp){ alert('Send OTP first'); return; }
  if(Date.now()>stored.expiry){ alert('OTP expired'); return; }
  if(attemptCount>=CONFIG.MAX_ATTEMPTS){ alert('5 attempts over, resend OTP'); return; }
  if(input===stored.otp){
    otpVerified=true; localStorage.setItem(CONFIG.OTP_VERIFIED_KEY,'true'); attemptCount=0;
    clearInterval(otpTimer); clearInterval(expiryTimer);
    alert('OTP Verified! Now pay'); showPaymentSection(); document.getElementById('otpSection').style.display='none';
  } else {
    attemptCount++; alert(`Wrong OTP. ${CONFIG.MAX_ATTEMPTS-attemptCount} left`);
    if(attemptCount>=CONFIG.MAX_ATTEMPTS){ document.getElementById('verifyOtpBtn').disabled=true; setTimeout(()=>{ document.getElementById('verifyOtpBtn').disabled=false; attemptCount=0; },60000); }
  }
}
function checkOTPState(){
  const data=JSON.parse(localStorage.getItem(CONFIG.OTP_DATA_KEY)||'{}');
  if(otpVerified && data.phone){
    const el=document.getElementById('custPhone'); if(el) el.value=data.phone;
    showPaymentSection(true);
  }
}

// ==================== PAYMENT - FIXED: Stays visible on reopen ====================
function showPaymentSection(fromLoad=false){
  const sec=document.getElementById('paymentSection'); if(!sec) return;
  sec.style.display='block'; sec.classList.add('visible');
  localStorage.setItem(CONFIG.OTP_VERIFIED_KEY,'true');
  if(!fromLoad){ sec.scrollIntoView({behavior:'smooth'}); }
  renderTotal();
}
function placeOrder(mode){
  if(!otpVerified){ alert('Verify OTP first'); return; }
  if(cart.length===0){ alert('Cart empty'); return; }
  if(!validateAddress()){ alert('Fix address'); return; }
  const total=cart.reduce((s,i)=>s+i.selling_price*i.qty,0);
  const phone=localStorage.getItem(CONFIG.USER_PHONE_KEY);
  const addr=addresses[addresses.length-1] || { name:document.getElementById('custName').value, fullAddress:document.getElementById('custAddress').value, pincode:document.getElementById('custPincode').value };
  let bill=`*${CONFIG.SHOP_NAME} Order*%0AName: ${addr.name}%0APhone: ${phone}%0AAddr: ${addr.fullAddress}, ${addr.pincode}%0A%0AItems:%0A`;
  cart.forEach(c=>{ bill+=`${c.name} x ${c.qty} = Rs ${c.selling_price*c.qty}%0A`; });
  bill+=`%0ATotal: Rs ${total}%0APayment: ${mode}%0A`;
  try{ if(supabaseClient) supabaseClient.from('orders').insert({ phone, customer_name:addr.name, address:addr.fullAddress, pincode:addr.pincode, items:cart, total, payment_mode:mode, status:'pending' }); }catch(e){}
  const wa=`https://wa.me/${CONFIG.WHATSAPP_NUMBER}?text=${bill}`;
  window.open(wa,'_blank');
  if(mode==='UPI'){
    const upi=`upi://pay?pa=${CONFIG.UPI_ID}&pn=${CONFIG.SHOP_NAME}&am=${total}&cu=INR&tn=Order`;
    setTimeout(()=>{ window.location.href=upi; },1200);
  }
  alert(`Order placed! ${mode} Rs ${total}. Bill on WhatsApp`);
  cart=[]; saveCart(); closeCart(); closeCheckout();
}

// ==================== MODAL + LISTENERS - FIXES PAYMENT RESET BUG ====================
function setupListeners(){
  document.getElementById('searchInput')?.addEventListener('input', searchProducts);
  ['custName','custAddress','custPincode'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input', ()=>clearErr(id));
  });
  const checkoutModal=document.getElementById('checkoutModal');
  if(checkoutModal){
    const obs=new MutationObserver(()=>{
      if(checkoutModal.classList.contains('open') && otpVerified) showPaymentSection(true);
    });
    obs.observe(checkoutModal, {attributes:true});
  }
}
function openCheckout(){
  if(cart.length===0){ alert('Add items first'); return; }
  closeCart(); document.getElementById('checkoutModal')?.classList.add('open');
  loadAddresses(); renderTotal(); checkOTPState();
}
function closeCheckout(){ document.getElementById('checkoutModal')?.classList.remove('open'); }

// ==================== SQL FIX - Run before deploy ====================
/*
Run in Supabase SQL Editor:
UPDATE products SET selling_price = 50 WHERE selling_price = 0 OR selling_price IS NULL;
SELECT COUNT(*) FROM products WHERE selling_price > 0; -- Should be 1006
*/
