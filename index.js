import express from "express";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";

// ============================================================
// DUKAANDAAR AI - FINAL FULL CODE
// Features: WhatsApp OFF (only shop link), Address Save + Same/New Button, Cart Empty Fix, Bill, UPI Payment
// ============================================================

const app = express();
app.use(bodyParser.json());
app.use(express.json());

// ============================================================
// CONFIG
// ============================================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;

// Keep Render Alive
setInterval(() => {
  axios.get(`https://dukandaar-ai.onrender.com/`).catch(()=>{});
  console.log("keep-alive ping - preventing sleep");
}, 10 * 60 * 1000);

// ============================================================
// WhatsApp Sender Function
// ============================================================
async function sendWhatsApp(to, text) {
  try {
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      text: { body: text }
    }, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
    console.log("WhatsApp sent to", to);
  } catch(e) {
    console.log("WhatsApp send failed:", e.response?.data || e.message);
  }
}

// ============================================================
// Bill Generator - After shopping, bill sent on WhatsApp
// ============================================================
function generateBill(cart, customer, total, orderId) {
  let bill = "";
  bill += `*RAHUL'S GENERAL STORE - MOHONE*\n`;
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `Bill No: #${orderId}\n`;
  bill += `Date: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n`;
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `Customer: ${customer.name}\n`;
  bill += `Phone: ${customer.phone}\n`;
  bill += `Address: ${customer.address}\n`;
  bill += `Pincode: ${customer.pincode}\n`;
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `ITEMS:\n`;
  
  cart.forEach((c,i)=>{
    let name = c.name.length > 28 ? c.name.substring(0,28) + ".." : c.name;
    bill += `${i+1}. ${name} x${c.qty} = Rs ${c.price * c.qty}\n`;
  });
  
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `TOTAL AMOUNT: Rs ${total}\n`;
  bill += `Payment Mode: ${customer.paymentMode}\n`;
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `Thank you for shopping! 🙏\n`;
  bill += `Delivery in 2-3 hours at Mohone.\n`;
  bill += `Shop again: https://dukandaar-ai.onrender.com/stock\n`;
  
  return bill;
}

// ============================================================
// ROUTES
// ============================================================

// Home Route - Health Check
app.get("/", (req,res)=> {
  res.send("Dukaandaar AI Live - WhatsApp Search OFF - Only Shop Page - Address Save + Cart Fix Active - 1006 Products");
});

// ============================================================
// API - Get 1006 Products with Search (for shop page only)
// ============================================================
app.get("/api/products", async (req,res)=>{
  const search = (req.query.search || "").toLowerCase().trim();
  
  try {
    let { data, error } = await supabase.from("products").select("*").limit(1006);
    
    if(error) {
      console.log("Supabase error:", error);
      return res.json([]);
    }
    
    let products = data || [];
    
    // Search logic for shop page
    if(search && search.length > 0) {
      let terms = [];
      
      // Special handling for Atta - search multiple variants
      if(search.includes("atta") || search.includes("aata") || search === "ata") {
        terms = ["atta", "aata", "flour", "wheat", "chakki", "aashir", "ashir"];
      } 
      // Balti handling
      else if(search.includes("balti") || search.includes("bucket") || search.includes("bulti")) {
        terms = ["bucket", "balti", "bulti"];
      }
      // Doormat handling
      else if(search.includes("doormat") || search.includes("dormat") || search.includes("paidan")) {
        terms = ["doormat", "mat", "dormat"];
      }
      else {
        terms = [search];
      }
      
      products = products.filter(p=> {
        let n = (p.name || p.product_name || "").toLowerCase();
        return terms.some(t=> n.includes(t));
      });
    }
    
    res.json(products);
  } catch(e){
    console.log("API products error:", e.message);
    res.json([]);
  }
});

// ============================================================
// API - Place Order - With Cart Fix (don't clear early)
// ============================================================
app.post("/api/order", async (req,res)=>{
  try {
    const { cart, customer, total } = req.body;
    
    console.log("Order received:", customer.name, "Total:", total, "Items:", cart.length);
    
    // Validation - Address mandatory - won't go to payment if fails
    if(!customer.name || customer.name.trim().length < 2) {
      return res.status(400).json({ error: "Full Name is mandatory!" });
    }
    if(!customer.phone || customer.phone.length < 10) {
      return res.status(400).json({ error: "Valid WhatsApp Number is mandatory!" });
    }
    if(!customer.address || customer.address.trim().length < 10) {
      return res.status(400).json({ error: "Full Address is mandatory! Without address we cannot deliver." });
    }
    if(!customer.pincode || customer.pincode.length < 6) {
      return res.status(400).json({ error: "Pincode is mandatory!" });
    }
    if(!cart || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty! Add products first." });
    }

    const orderId = "RD" + Date.now().toString().slice(-6);
    
    // FIX: Keep backup of cart - don't clear early
    let savedCart = [...cart];
    
    // Save each item in orders table
    for(let item of cart) {
      try {
        await supabase.from("orders").insert({
          phone: customer.phone,
          product_id: item.id,
          product_name: `${item.name} x ${item.qty} | Bill #${orderId} | ${customer.name}, ${customer.address}, ${customer.pincode} | ${customer.paymentMode} | Total Rs ${total}`,
          customer_name: customer.name,
          customer_address: `${customer.address}, ${customer.pincode} - Payment: ${customer.paymentMode}`
        });
      } catch(err){
        console.log("Order insert failed for item:", item.name, err.message);
      }
    }

    // Generate bill
    const billText = generateBill(savedCart, customer, total, orderId);
    
    // Send bill on WhatsApp to customer
    try {
      await sendWhatsApp(customer.phone, billText);
      console.log("Bill sent to", customer.phone);
    } catch(e){
      console.log("Bill WhatsApp failed:", e.message);
    }

    // Return success with savedCart backup
    res.json({ 
      success: true, 
      bill: billText, 
      orderId: orderId, 
      total: total, 
      savedCart: savedCart,
      message: "Order placed successfully"
    });
    
  } catch(e) {
    console.error("Order API error:", e.message);
    res.status(500).json({ error: "Order failed - please try again" });
  }
});

// ============================================================
// SHOP PAGE - /stock - Full Featured with Address Save
// ============================================================
app.get("/stock", async (req,res)=>{
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rahul's General Store - 1006 Products - Online Shopping</title>
<meta name="description" content="Rahul's General Store Mohone - 1006 products, Cart, Address, UPI Payment, Bill on WhatsApp">
<style>
/* General Styles */
*{box-sizing:border-box; margin:0; padding:0}
body{font-family:Arial, Helvetica, sans-serif; background:#f5f5f5; padding-bottom:90px; color:#333}
a{text-decoration:none}

/* Header */
.header{
  background:#075e54;
  color:#fff;
  padding:15px 16px;
  position:sticky;
  top:0;
  z-index:100;
  display:flex;
  justify-content:space-between;
  align-items:center;
  box-shadow:0 2px 10px rgba(0,0,0,0.1)
}
.header h1{font-size:16px; line-height:1.3}
.header small{font-weight:normal; font-size:12px; opacity:0.9}
.cart-btn{
  background:#fff;
  color:#075e54;
  border:none;
  padding:11px 20px;
  border-radius:25px;
  font-weight:bold;
  cursor:pointer;
  font-size:14px;
  box-shadow:0 2px 5px rgba(0,0,0,0.1)
}
.cart-btn:active{transform:scale(0.95)}

/* Search Box */
.search-box{
  padding:12px;
  background:#fff;
  position:sticky;
  top:61px;
  z-index:90;
  box-shadow:0 2px 8px rgba(0,0,0,0.08)
}
.search-box input{
  width:100%;
  padding:14px 16px;
  border:1.5px solid #ddd;
  border-radius:12px;
  font-size:16px;
  outline:none;
  transition:0.2s
}
.search-box input:focus{border-color:#075e54; background:#f0fffa}

/* Products Grid */
.products{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
  padding:12px
}
@media(min-width:768px){
  .products{grid-template-columns:1fr 1fr 1fr 1fr; padding:16px; gap:16px}
}
.card{
  background:#fff;
  border-radius:14px;
  padding:14px;
  box-shadow:0 2px 10px rgba(0,0,0,0.06);
  display:flex;
  flex-direction:column;
  transition:0.2s
}
.card:hover{transform:translateY(-2px); box-shadow:0 4px 15px rgba(0,0,0,0.1)}
.card h3{font-size:13px; margin:0 0 6px 0; height:38px; overflow:hidden; line-height:1.35; color:#222}
.card .price{color:#075e54; font-weight:bold; font-size:17px; margin:8px 0}
.card button{
  width:100%;
  background:#25d366;
  color:#fff;
  border:none;
  padding:11px;
  border-radius:10px;
  font-weight:bold;
  cursor:pointer;
  margin-top:auto;
  font-size:13px;
  transition:0.2s
}
.card button.added{background:#888}
.card button:active{transform:scale(0.96)}

/* Cart Modal */
.cart-modal{
  display:none;
  position:fixed;
  top:0; left:0;
  width:100%; height:100%;
  background:rgba(0,0,0,0.65);
  z-index:200;
  overflow:auto;
  padding:10px
}
.cart-content{
  background:#fff;
  width:100%;
  max-width:560px;
  margin:15px auto;
  border-radius:20px;
  padding:22px;
  max-height:92vh;
  overflow:auto;
  box-shadow:0 10px 30px rgba(0,0,0,0.2)
}
.cart-content h2{margin-top:0; font-size:22px; margin-bottom:10px}
.close-x{float:right; cursor:pointer; font-size:26px; color:#666}
.cart-item{
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:14px 0;
  border-bottom:1px solid #eee;
  font-size:14px;
  gap:10px
}
.qty-controls{display:flex; align-items:center; gap:8px; flex-shrink:0}
.qty-btn{
  background:#f0f0f0;
  border:none;
  width:34px; height:34px;
  border-radius:50%;
  cursor:pointer;
  font-weight:bold;
  font-size:18px;
  display:flex;
  align-items:center;
  justify-content:center
}
.qty-btn:active{transform:scale(0.9)}

/* Form Groups */
.form-group{margin:14px 0}
.form-group label{font-weight:bold; font-size:13px; display:block; margin-bottom:6px; color:#333}
.form-group input, .form-group textarea{
  width:100%;
  padding:13px 14px;
  border:1.5px solid #ccc;
  border-radius:12px;
  font-size:14px;
  outline:none;
  transition:0.2s;
  background:#fff
}
.form-group input:focus, .form-group textarea:focus{border-color:#075e54; background:#f0fffa}
.form-group input.error, .form-group textarea.error{border-color:#e74c3c; background:#fff5f5}
.error-msg{color:#e74c3c; font-size:11.5px; display:none; margin-top:4px}

/* Saved Address Box - NEW FEATURE */
.saved-address-box{
  background:linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%);
  border:1.5px solid #4caf50;
  border-radius:14px;
  padding:14px;
  margin:16px 0;
  display:none;
  animation:slideDown 0.3s ease
}
@keyframes slideDown{from{opacity:0; transform:translateY(-10px)} to{opacity:1; transform:translateY(0)}}
.saved-address-box b{color:#2e7d32; font-size:14px}
.saved-address-box p{margin:6px 0; font-size:13px; line-height:1.4; color:#333}
.addr-btn-row{display:flex; gap:8px; margin-top:10px; flex-wrap:wrap}
.addr-btn{
  padding:10px 18px;
  border-radius:25px;
  border:none;
  font-weight:bold;
  cursor:pointer;
  font-size:13px;
  transition:0.2s
}
.addr-btn.use-old{background:#075e54; color:#fff; flex:1}
.addr-btn.use-new{background:#fff; color:#075e54; border:1.5px solid #075e54; flex:1}
.addr-btn:active{transform:scale(0.95)}

/* Payment Section */
.pay-section{
  border:2px dashed #075e54;
  padding:18px;
  border-radius:16px;
  margin-top:20px;
  background:linear-gradient(135deg, #f0fff4 0%, #e8f5e9 100%)
}
.pay-btn{
  width:100%;
  background:#075e54;
  color:#fff;
  padding:15px;
  border:none;
  border-radius:14px;
  font-size:15px;
  font-weight:bold;
  margin-top:12px;
  cursor:pointer;
  transition:0.2s
}
.pay-btn:active{transform:scale(0.97)}
.pay-btn:disabled{background:#ccc; cursor:not-allowed}
.upi-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px}
.upi-btn{
  padding:15px 10px;
  border:1.5px solid #ddd;
  border-radius:14px;
  background:#fff;
  cursor:pointer;
  font-weight:bold;
  text-align:center;
  font-size:14px;
  transition:0.2s;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:4px
}
.upi-btn:hover{border-color:#075e54; background:#f0fff4; transform:translateY(-1px)}
.upi-btn:active{transform:scale(0.96)}
.cod-btn{background:#2c3e50 !important}
.total-box{text-align:right; font-size:20px; font-weight:bold; color:#075e54; margin:18px 0; padding:12px; background:#f0fff4; border-radius:10px}
.order-status{white-space:pre-wrap; line-height:1.6; font-size:14px; margin-top:16px; text-align:center; padding:12px; border-radius:12px}
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <h1>🏪 Rahul's General Store<br><small>Mohone - 1006 Products - Home Delivery</small></h1>
  <button class="cart-btn" onclick="openCart()">🛒 Cart (<span id="cartCount">0</span>)</button>
</div>

<!-- SEARCH -->
<div class="search-box">
  <input id="search" placeholder="Search Atta, Bucket, Balti, Doormat, Lizol..." oninput="loadProducts(this.value)" autocomplete="off">
</div>

<!-- PRODUCTS -->
<div id="products" class="products">Loading 1006 products... Please wait...</div>

<!-- CART MODAL -->
<div id="cartModal" class="cart-modal">
  <div class="cart-content">
    <h2>Your Cart <span class="close-x" onclick="closeCart()">✕</span></h2>
    
    <div id="cartItems">
      <p style='text-align:center; padding:20px; color:#888'>Cart empty. Add products from shop.</p>
    </div>
    
    <div class="total-box" id="total" style="display:none"></div>
    
    <hr style="margin:18px 0; border:none; border-top:1px solid #eee">

    <!-- SAVED ADDRESS FEATURE - Shows if address saved before -->
    <div id="savedAddressBox" class="saved-address-box">
      <b>📍 Saved Address Found:</b>
      <p id="savedAddrText">Loading...</p>
      <div class="addr-btn-row">
        <button class="addr-btn use-old" onclick="useOldAddress()">✅ Use Same as Previous</button>
        <button class="addr-btn use-new" onclick="useNewAddress()">✏️ New Address</button>
      </div>
    </div>

    <h3 style="font-size:16px; margin-bottom:4px">📍 Delivery Address *Mandatory</h3>
    <p style="font-size:11px; color:#e74c3c; margin-bottom:12px">Without address we cannot deliver - All fields required</p>
    
    <div class="form-group">
      <label>Full Name *</label>
      <input id="cName" placeholder="Ex: Rahul Jha" autocomplete="name">
      <div class="error-msg" id="errName">Full name is required (min 2 chars)</div>
    </div>
    
    <div class="form-group">
      <label>WhatsApp Number *</label>
      <input id="cPhone" placeholder="10 digit number" type="tel" inputmode="numeric" autocomplete="tel">
      <div class="error-msg" id="errPhone">Valid 10 digit WhatsApp number required</div>
    </div>
    
    <div class="form-group">
      <label>Full Address *</label>
      <textarea id="cAddress" rows="3" placeholder="B-302, Konark Solitaire, Mohone, Kalyan" autocomplete="street-address"></textarea>
      <div class="error-msg" id="errAddress">Full address required (min 10 chars) - Without address no delivery</div>
    </div>
    
    <div class="form-group">
      <label>Pincode *</label>
      <input id="cPincode" placeholder="421102" type="tel" inputmode="numeric" autocomplete="postal-code">
      <div class="error-msg" id="errPincode">Valid 6 digit pincode required</div>
    </div>

    <button class="pay-btn" id="validateBtn" onclick="validateAndShowPay()">Validate Address & Proceed to Payment →</button>

    <!-- PAYMENT GATEWAY - FIXED -->
    <div class="pay-section" id="paySection" style="display:none">
      <h3 style="margin:0 0 8px 0; font-size:16px">💳 Choose Payment Method</h3>
      <p style="font-size:12px; color:#27ae60; margin-bottom:12px; font-weight:bold">✓ Address verified & saved - Now select payment</p>
      
      <div class="upi-grid">
        <div class="upi-btn" onclick="payWithUPI('Google Pay')"><span style="font-size:20px">📱</span>Google Pay</div>
        <div class="upi-btn" onclick="payWithUPI('PhonePe')"><span style="font-size:20px">📱</span>PhonePe</div>
        <div class="upi-btn" onclick="payWithUPI('Paytm')"><span style="font-size:20px">📱</span>Paytm</div>
        <div class="upi-btn" onclick="payWithUPI('BHIM UPI')"><span style="font-size:20px">🏦</span>BHIM UPI</div>
      </div>
      
      <button class="pay-btn" style="background:#ff6b00" onclick="payWithUPI('Any UPI')">💳 Pay via Any UPI App</button>
      <button class="pay-btn cod-btn" onclick="payWithUPI('Cash on Delivery')">💵 Cash on Delivery (COD)</button>
      
      <p style="font-size:11px; color:#666; text-align:center; margin-top:10px">Clicking UPI will open your UPI app with payment amount pre-filled</p>
    </div>

    <div id="orderStatus" class="order-status"></div>
  </div>
</div>

<script>
// ============================================================
// JAVASCRIPT - CART + ADDRESS SAVE + PAYMENT FIX
// ============================================================

let allProducts = [];

// FIXED: Use both keys for compatibility - prevents cart empty bug
let cart = [];
try {
  let saved1 = localStorage.getItem('dukandaar_cart');
  let saved2 = localStorage.getItem('cart');
  if(saved1) cart = JSON.parse(saved1);
  else if(saved2) cart = JSON.parse(saved2);
  else cart = [];
} catch(e){ cart = []; }

let currentTotal = 0;

// Load products
async function loadProducts(search="") {
  try {
    let url = "/api/products" + (search ? "?search="+encodeURIComponent(search) : "");
    let res = await fetch(url);
    allProducts = await res.json();
    
    let html = "";
    allProducts.forEach(p=>{
      let name = p.name || p.product_name || "Product";
      let price = p.price || 0;
      let id = p.id;
      let inCart = cart.find(c=>c.id==id);
      let btnText = inCart ? 'Added ✓ ('+inCart.qty+')' : 'Add to Cart';
      
      html += \`<div class="card">
        <h3>\${name}</h3>
        <div class="price">Rs \${price}</div>
        <button onclick="addToCart(\${id})" class="\${inCart ? 'added' : ''}">\${btnText}</button>
      </div>\`;
    });
    
    if(allProducts.length==0) {
      html = "<div style='grid-column:1/-1; padding:30px; text-align:center; color:#888'><p>No products found for '<b>"+search+"</b>'</p><p>Try Atta, Bucket, Balti, Doormat</p></div>";
    }
    
    document.getElementById('products').innerHTML = html;
    updateCartCount();
  } catch(e) {
    document.getElementById('products').innerHTML = "<p style='padding:20px; text-align:center'>Error loading products. Please refresh page.</p>";
  }
}

// Add to cart
function addToCart(id) {
  let prod = allProducts.find(p=>p.id==id);
  if(!prod) return;
  
  let item = cart.find(c=>c.id==id);
  if(item) {
    item.qty++;
  } else {
    cart.push({
      id:prod.id,
      name: (prod.name || prod.product_name),
      price: prod.price,
      qty:1
    });
  }
  
  // Save in BOTH keys to prevent empty bug
  localStorage.setItem('dukandaar_cart', JSON.stringify(cart));
  localStorage.setItem('cart', JSON.stringify(cart));
  
  loadProducts(document.getElementById('search').value);
  updateCartCount();
  
  // Haptic feedback
  if(navigator.vibrate) navigator.vibrate(50);
}

// Update cart count badge
function updateCartCount(){
  let totalQty = cart.reduce((s,c)=>s+c.qty,0);
  document.getElementById('cartCount').innerText = totalQty;
}

// Open cart modal
function openCart(){
  checkSavedAddress(); // Check saved address every time cart opens
  renderCart();
  document.getElementById('cartModal').style.display='block';
  document.body.style.overflow='hidden';
}

// Close cart modal
function closeCart(){
  document.getElementById('cartModal').style.display='none';
  document.body.style.overflow='auto';
}

// Render cart items - FIXED: Don't show empty if cart has items
function renderCart(){
  if(cart.length==0){
    document.getElementById('cartItems').innerHTML="<p style='text-align:center; padding:20px; color:#888'>Cart empty.<br>Add products from shop.</p>";
    document.getElementById('total').style.display='none';
    document.getElementById('total').innerText="";
    currentTotal=0;
    return;
  }
  
  let html=""; let total=0;
  cart.forEach((c,i)=>{
    total+=c.price*c.qty;
    html+= \`<div class="cart-item">
      <div style="flex:1">
        <b style="font-size:13px">\${c.name}</b><br>
        <small style="color:#666">Rs \${c.price} x \${c.qty} = <b>Rs \${c.price*c.qty}</b></small>
      </div>
      <div class="qty-controls">
        <button class="qty-btn" onclick="changeQty(\${i},-1)">−</button>
        <span style="min-width:22px; text-align:center; font-weight:bold">\${c.qty}</span>
        <button class="qty-btn" onclick="changeQty(\${i},1)">+</button>
      </div>
    </div>\`;
  });
  
  document.getElementById('cartItems').innerHTML=html;
  document.getElementById('total').style.display='block';
  document.getElementById('total').innerText="Total: Rs "+total;
  currentTotal=total;
}

// Change quantity
function changeQty(i,delta){
  cart[i].qty+=delta;
  if(cart[i].qty<=0) cart.splice(i,1);
  
  localStorage.setItem('dukandaar_cart', JSON.stringify(cart));
  localStorage.setItem('cart', JSON.stringify(cart));
  
  renderCart();
  updateCartCount();
}

// ============================================================
// ADDRESS SAVE FEATURE - NEW
// ============================================================

function checkSavedAddress(){
  let saved = localStorage.getItem('saved_customer');
  let box = document.getElementById('savedAddressBox');
  
  if(saved){
    try {
      let cust = JSON.parse(saved);
      if(cust.name && cust.phone && cust.address){
        document.getElementById('savedAddrText').innerHTML = \`
          <b>\${cust.name}</b> - \${cust.phone}<br>
          \${cust.address}, \${cust.pincode}
        \`;
        box.style.display='block';
        
        // Auto-fill form with saved data (but user can change)
        document.getElementById('cName').value = cust.name || "";
        document.getElementById('cPhone').value = cust.phone || "";
        document.getElementById('cAddress').value = cust.address || "";
        document.getElementById('cPincode').value = cust.pincode || "";
        return;
      }
    } catch(e){}
  }
  
  box.style.display='none';
}

function useOldAddress(){
  let saved = localStorage.getItem('saved_customer');
  if(!saved) return;
  
  let cust = JSON.parse(saved);
  document.getElementById('cName').value = cust.name;
  document.getElementById('cPhone').value = cust.phone;
  document.getElementById('cAddress').value = cust.address;
  document.getElementById('cPincode').value = cust.pincode;
  document.getElementById('savedAddressBox').style.display='none';
  
  // Auto proceed to payment
  validateAndShowPay();
}

function useNewAddress(){
  document.getElementById('cName').value = "";
  document.getElementById('cPhone').value = "";
  document.getElementById('cAddress').value = "";
  document.getElementById('cPincode').value = "";
  document.getElementById('savedAddressBox').style.display='none';
  document.getElementById('cName').focus();
}

// ============================================================
// Validate Address - Mandatory - Won't go to payment if fails
// ============================================================

function validateAndShowPay(){
  // Reset error UI
  document.querySelectorAll('.error-msg').forEach(e=>e.style.display='none');
  document.querySelectorAll('#cartModal input, #cartModal textarea').forEach(e=>e.classList.remove('error'));
  
  let name = document.getElementById('cName').value.trim();
  let phone = document.getElementById('cPhone').value.trim();
  let address = document.getElementById('cAddress').value.trim();
  let pincode = document.getElementById('cPincode').value.trim();
  
  let valid = true;
  
  if(!name || name.length < 2){
    document.getElementById('errName').style.display='block';
    document.getElementById('cName').classList.add('error');
    valid=false;
  }
  if(!phone || phone.length < 10 || isNaN(phone)){
    document.getElementById('errPhone').style.display='block';
    document.getElementById('cPhone').classList.add('error');
    valid=false;
  }
  if(!address || address.length < 10){
    document.getElementById('errAddress').style.display='block';
    document.getElementById('cAddress').classList.add('error');
    valid=false;
  }
  if(!pincode || pincode.length < 6 || isNaN(pincode)){
    document.getElementById('errPincode').style.display='block';
    document.getElementById('cPincode').classList.add('error');
    valid=false;
  }
  
  if(!valid){
    document.getElementById('orderStatus').innerText="⚠️ Without address we cannot deliver! Please fill all fields correctly.";
    document.getElementById('orderStatus').style.color="#e74c3c";
    document.getElementById('orderStatus').style.background="#ffeaea";
    return; // STOP - Will not go to payment
  }
  
  if(cart.length==0){
    document.getElementById('orderStatus').innerText="Cart empty! Please add products first.";
    document.getElementById('orderStatus').style.color="#e74c3c";
    return;
  }
  
  // SAVE ADDRESS for next time
  localStorage.setItem('saved_customer', JSON.stringify({name, phone, address, pincode}));
  console.log("Address saved for future:", name);
  
  // Show payment gateway
  document.getElementById('paySection').style.display='block';
  document.getElementById('validateBtn').style.display='none';
  document.getElementById('savedAddressBox').style.display='none';
  
  document.getElementById('orderStatus').innerText="✓ Address saved! Now choose payment method below to complete order. Bill will be sent on WhatsApp.";
  document.getElementById('orderStatus').style.color="#27ae60";
  document.getElementById('orderStatus').style.background="#e8f5e9";
}

// ============================================================
// PAYMENT - FIXED CART EMPTY BUG
// ============================================================

async function payWithUPI(mode){
  let name = document.getElementById('cName').value.trim();
  let phone = document.getElementById('cPhone').value.trim();
  let address = document.getElementById('cAddress').value.trim();
  let pincode = document.getElementById('cPincode').value.trim();
  let total = currentTotal || cart.reduce((s,c)=>s+c.price*c.qty,0);
  
  // FIX: Keep cart backup - don't clear yet
  let cartBackup = [...cart];
  
  if(cartBackup.length==0){
    document.getElementById('orderStatus').innerText="Cart empty! Cannot place order.";
    return;
  }
  
  document.getElementById('orderStatus').innerText="Placing order with "+mode+"... Please wait...";
  document.getElementById('orderStatus').style.color="#333";
  document.getElementById('orderStatus').style.background="#fff3cd";
  
  try {
    let res = await fetch('/api/order',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        cart: cartBackup,
        customer: {name, phone, address, pincode, paymentMode: mode},
        total: total
      })
    });
    
    let data = await res.json();
    
    if(data.success){
      let billHtml = data.bill.replace(/\\n/g,'<br>');
      
      if(mode=='Cash on Delivery'){
        document.getElementById('orderStatus').innerHTML = "✅ <b>Order Placed Successfully! (COD)</b><br>Bill sent on WhatsApp to "+phone+"<br><br><div style='background:#f9f9f9; padding:12px; border-radius:10px; text-align:left; font-size:13px; border:1px solid #eee'>"+billHtml+"</div><br>We will deliver in 2-3 hours! Thank you 🙏";
      } else {
        // UPI Payment - Fixed click to open app
        let upiId = "rahul.jha.39395033@okaxis";
        let upiLink = \`upi://pay?pa=\${upiId}&pn=Rahul%20Store%20Mohone&am=\${total}&cu=INR&tn=Order_\${data.orderId}_\${name}\`;
        
        document.getElementById('orderStatus').innerHTML = "✅ <b>Order Placed! Bill sent on WhatsApp</b><br><br><div style='background:#f9f9f9; padding:12px; border-radius:10px; text-align:left; font-size:13px; border:1px solid #eee'>"+billHtml+"</div><br><a href='"+upiLink+"' style='background:#25d366; color:#fff; padding:15px 28px; border-radius:14px; text-decoration:none; display:block; font-weight:bold; text-align:center; font-size:16px'>Pay Rs "+total+" via "+mode+" - CLICK TO PAY</a><br><p style='font-size:11px; color:#666'>UPI ID: "+upiId+"<br>Order: #"+data.orderId+"<br>If app doesn't open, pay manually and share screenshot</p>";
        
        // Auto open UPI app after 1.2 sec
        setTimeout(()=>{ 
          try { window.location.href = upiLink; } catch(e){}
        }, 1200);
      }
      
      // FIXED: Clear cart AFTER showing bill - not before
      // Wait 2 seconds then clear
      setTimeout(()=>{
        cart = [];
        localStorage.setItem('dukandaar_cart', JSON.stringify(cart));
        localStorage.setItem('cart', JSON.stringify(cart));
        updateCartCount();
        
        // Show completion message but keep bill visible
        document.getElementById('cartItems').innerHTML = "<p style='text-align:center; padding:15px; color:#27ae60; background:#e8f5e9; border-radius:10px'>✅ Order completed!<br>Cart cleared. Thank you for shopping!</p>";
        document.getElementById('total').style.display='none';
        document.getElementById('total').innerText = "";
      }, 2000);
      
    } else {
      document.getElementById('orderStatus').innerText="❌ "+(data.error||"Order failed - please try again");
      document.getElementById('orderStatus').style.color="#e74c3c";
      document.getElementById('orderStatus').style.background="#ffeaea";
    }
  } catch(e){
    document.getElementById('orderStatus').innerText="❌ Network error - Check internet and try again";
    document.getElementById('orderStatus').style.color="#e74c3c";
    document.getElementById('orderStatus').style.background="#ffeaea";
  }
}

// Close modal on outside click
document.getElementById('cartModal').addEventListener('click', function(e){
  if(e.target === this) closeCart();
});

// Initial load
loadProducts();

// Pre-fill saved address on load
window.addEventListener('DOMContentLoaded', ()=>{
  let saved = localStorage.getItem('saved_customer');
  if(saved){
    try {
      let cust = JSON.parse(saved);
      console.log("Found saved address:", cust.name);
    } catch(e){}
  }
});
</script>
</body>
</html>
  `);
});

// ============================================================
// WHATSAPP WEBHOOK - SEARCH DISABLED - ONLY SHOP LINK
// ============================================================
app.post("/webhook", async (req,res)=>{
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(!msg) return res.sendStatus(200);
    
    const from = msg.from;
    
    // For ANY message - image, text, Atta, Hi - send only shop link
    // No search, no photo OCR - only page shopping
    const shopMsg = `Hello! I hope you are doing well. 😊\n\nWelcome to *Dukaandaar AI* - Rahul's General Store, Mohone.\n\n🛒 *Shop all 1006 products here (Google page):*\nhttps://dukandaar-ai.onrender.com/stock\n\n✨ On our store:\n• Search Atta, Bucket, Doormat easily\n• Add to Cart\n• Address saved for next time - Same/Previous button\n• Pay via Google Pay, PhonePe, Paytm, BHIM UPI, COD\n• Auto bill on WhatsApp\n\nClick link above to start shopping! 🙏✨`;
    
    await sendWhatsApp(from, shopMsg);
    console.log("Shop link sent to", from);
    
  } catch(e){
    console.error("Webhook error:", e.message);
  }
  res.sendStatus(200);
});

app.get("/webhook", (req,res)=>{
  if(req.query["hub.verify_token"] === "dukandaar123") {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// Start server
app.listen(10000, ()=> {
  console.log("========================================");
  console.log("Dukaandaar AI Live on 10000");
  console.log("Features: WhatsApp OFF, Only Shop Page, Address Save, Cart Fix, Bill, UPI");
  console.log("========================================");
});
