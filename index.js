import express from "express";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import Tesseract from "tesseract.js";

const app = express();
app.use(bodyParser.json());
app.use(express.json());

// ============================================================
// CONFIG - Supabase & WhatsApp Permanent Token
// ============================================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;

// Keep Render alive every 10 mins
setInterval(() => {
  axios.get(`https://dukandaar-ai.onrender.com/`).catch(()=>{});
  console.log("keep-alive ping - Preventing Render sleep");
}, 10 * 60 * 1000);

// ============================================================
// DICTIONARY - Hindi to English
// ============================================================
const DICTIONARY = {
  "balti": "bucket",
  "bulti": "bucket",
  "balty": "bucket",
  "jhadu": "broom",
  "jhaadu": "broom",
  "jhadu pocha": "broom",
  "pocha": "mop",
  "poncha": "mop",
  "aata": "atta",
  "aatta": "atta",
  "ata": "atta",
  "wheat flour": "atta",
  "chakki": "atta",
  "aashirwad": "atta",
  "ashirwad": "atta",
  "dormat": "doormat",
  "paidan": "doormat",
  "dormet": "doormat",
  "lizol": "lizol",
  "phenyl": "phenyl"
};

// ============================================================
// Fuzzy Search - Levenshtein Distance
// ============================================================
function levenshtein(a, b) {
  const m = [];
  for(let i=0;i<=b.length;i++) m[i]=[i];
  for(let j=0;j<=a.length;j++) m[0][j]=j;
  for(let i=1;i<=b.length;i++) {
    for(let j=1;j<=a.length;j++) {
      m[i][j]= b.charAt(i-1)==a.charAt(j-1)? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
    }
  }
  return m[b.length][a.length];
}

// ============================================================
// FIND PRODUCTS - FINAL FIX FOR ATTA
// ============================================================
async function findProducts(text) {
  let q = text.toLowerCase().trim();
  
  // Dictionary mapping
  if(DICTIONARY[q]) {
    q = DICTIONARY[q];
  }

  // Fetch all 1006 products
  let allProducts = [];
  try {
    let { data, error } = await supabase.from("products").select("*").limit(1006);
    if(error) console.log("Supabase fetch error:", error);
    allProducts = data || [];
  } catch(e) {
    console.log("Fetch failed:", e.message);
    return [];
  }

  if(allProducts.length === 0) return [];

  let qLow = q.toLowerCase();
  let best = [];

  // Special Atta handling
  let searchTerms = [qLow];
  if(qLow.includes("atta") || qLow.includes("aata") || qLow === "ata") {
    searchTerms = ["atta", "aata", "flour", "chakki", "wheat", "ashir", "aashir", "aata"];
  }
  if(qLow.includes("balti") || qLow.includes("bucket")) {
    searchTerms = ["bucket", "balti", "bulti"];
  }

  // First pass - direct substring match
  for(let p of allProducts) {
    let name = (p.name || p.product_name || "").toLowerCase();
    for(let term of searchTerms) {
      if(name.includes(term)) {
        best.push(p);
        break;
      }
    }
    if(best.length >= 12) break;
  }

  // Second pass - fuzzy if nothing found
  if(best.length === 0) {
    for(let p of allProducts) {
      let name = (p.name || p.product_name || "").toLowerCase();
      let firstWord = name.split(" ")[0] || "";
      let dist = levenshtein(qLow, firstWord.substring(0, qLow.length+2));
      if(dist <= 2 || name.includes(qLow)) {
        best.push(p);
      }
      if(best.length >= 8) break;
    }
  }

  return best.slice(0, 10);
}

// ============================================================
// WhatsApp Sender
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
  } catch(e) {
    console.log("WhatsApp send failed:", e.response?.data || e.message);
  }
}

// ============================================================
// Bill Generator - Shares bill on WhatsApp after order
// ============================================================
function generateBill(cart, customer, total, orderId) {
  let bill = `*RAHUL'S GENERAL STORE - MOHONE*\n`;
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
    let name = c.name.length > 25 ? c.name.substring(0,25)+".." : c.name;
    bill += `${i+1}. ${name} x${c.qty} = Rs ${c.price*c.qty}\n`;
  });
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `TOTAL AMOUNT: Rs ${total}\n`;
  bill += `Payment Mode: ${customer.paymentMode || 'COD'}\n`;
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `Thank you for shopping! 🙏\n`;
  bill += `Delivery in 2-3 hours at Mohone.\n`;
  bill += `Shop again: https://dukandaar-ai.onrender.com/stock\n`;
  return bill;
}

// ============================================================
// ROUTES
// ============================================================
app.get("/", (req,res)=> {
  res.send("Dukaandaar AI Live - Full Shop 1006 Products + Permanent Token + Bill + UPI Payment Active");
});

// API - Get all 1006 products
app.get("/api/products", async (req,res)=>{
  const search = (req.query.search || "").toLowerCase();
  try {
    let { data } = await supabase.from("products").select("*").limit(1006);
    let products = data || [];
    
    if(search) {
      let terms = [];
      if(search.includes("atta") || search.includes("aata")) {
        terms = ["atta","aata","flour","wheat","chakki","ashir"];
      } else if(search.includes("balti") || search.includes("bucket")) {
        terms = ["bucket","balti"];
      } else {
        terms = [search];
      }
      
      products = products.filter(p=> {
        let n = (p.name || p.product_name || "").toLowerCase();
        return terms.some(t=> n.includes(t));
      });
    }
    
    res.json(products);
  } catch(e){
    console.log(e);
    res.json([]);
  }
});

// API - Place order with address validation + Bill WhatsApp
app.post("/api/order", async (req,res)=>{
  try {
    const { cart, customer, total } = req.body;
    
    // Address validation - Mandatory - will not go to payment if fails
    if(!customer.name || !customer.phone || !customer.address || !customer.pincode) {
      return res.status(400).json({ error: "Address is mandatory! Please fill all fields. Without address we cannot deliver." });
    }
    if(customer.phone.length < 10) {
      return res.status(400).json({ error: "Invalid phone number" });
    }
    if(customer.pincode.length < 6) {
      return res.status(400).json({ error: "Invalid pincode" });
    }
    if(cart.length === 0) {
      return res.status(400).json({ error: "Cart empty" });
    }

    const orderId = "RD"+Date.now().toString().slice(-6);
    
    // Save each item in Supabase orders table
    for(let item of cart) {
      await supabase.from("orders").insert({
        phone: customer.phone,
        product_id: item.id,
        product_name: `${item.name} x ${item.qty} | Bill #${orderId} | ${customer.name}, ${customer.address}, ${customer.pincode} | Pay: ${customer.paymentMode} | Total Rs ${total}`,
        customer_name: customer.name,
        customer_address: `${customer.address}, ${customer.pincode} - Payment: ${customer.paymentMode}`
      });
    }

    // Generate bill and send on WhatsApp
    const billText = generateBill(cart, customer, total, orderId);
    try {
      await sendWhatsApp(customer.phone, billText);
    } catch(e){
      console.log("Bill WhatsApp failed", e.message);
    }

    res.json({ success: true, bill: billText, orderId, total });
  } catch(e) {
    console.error("Order error:", e);
    res.status(500).json({ error: "Order failed - try again" });
  }
});

// FULL SHOP PAGE - 1006 products, Cart, Address Mandatory, UPI Payment Fix
app.get("/stock", async (req,res)=>{
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rahul's Store - 1006 Products Shop Online</title>
<style>
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;margin:0;background:#f5f5f5;padding-bottom:80px}
.header{background:#075e54;color:#fff;padding:15px;position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;align-items:center}
.header h1{margin:0;font-size:16px;line-height:1.2}
.cart-btn{background:#fff;color:#075e54;border:none;padding:10px 18px;border-radius:25px;font-weight:bold;cursor:pointer;font-size:14px}
.search-box{padding:12px;background:#fff;display:flex;gap:10px;position:sticky;top:56px;z-index:9;box-shadow:0 2px 5px rgba(0,0,0,0.1)}
.search-box input{flex:1;padding:14px;border:1px solid #ddd;border-radius:10px;font-size:16px}
.products{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}
@media(min-width:768px){.products{grid-template-columns:1fr 1fr 1fr 1fr}}
.card{background:#fff;border-radius:12px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,0.08);display:flex;flex-direction:column}
.card h3{font-size:13px;margin:0 0 6px 0;height:36px;overflow:hidden;line-height:1.3}
.card .price{color:#075e54;font-weight:bold;font-size:16px;margin:6px 0}
.card button{width:100%;background:#25d366;color:#fff;border:none;padding:10px;border-radius:8px;font-weight:bold;cursor:pointer;margin-top:auto;font-size:13px}
.card button:active{transform:scale(0.95)}
.cart-modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100;overflow:auto;padding:10px}
.cart-content{background:#fff;width:100%;max-width:540px;margin:10px auto;border-radius:18px;padding:20px;max-height:95vh;overflow:auto}
.cart-item{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #eee;font-size:14px}
.qty-controls{display:flex;align-items:center;gap:6px}
.qty-btn{background:#eee;border:none;width:32px;height:32px;border-radius:50%;cursor:pointer;font-weight:bold;font-size:16px}
.form-group{margin:14px 0}
.form-group label{font-weight:bold;font-size:13px;display:block;margin-bottom:5px;color:#333}
.form-group input, .form-group textarea{width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;font-size:14px;outline:none}
.form-group input:focus, .form-group textarea:focus{border-color:#075e54}
.form-group input.error, .form-group textarea.error{border-color:#e74c3c;background:#fff0f0}
.error-msg{color:#e74c3c;font-size:11px;display:none;margin-top:3px}
.pay-section{border:2px dashed #075e54;padding:16px;border-radius:14px;margin-top:18px;background:#f0fff4}
.pay-btn{width:100%;background:#075e54;color:#fff;padding:14px;border:none;border-radius:12px;font-size:15px;font-weight:bold;margin-top:12px;cursor:pointer}
.pay-btn:disabled{background:#ccc}
.upi-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.upi-btn{padding:14px;border:1.5px solid #ddd;border-radius:12px;background:#fff;cursor:pointer;font-weight:bold;text-align:center;font-size:14px;transition:0.2s;display:flex;align-items:center;justify-content:center;gap:6px}
.upi-btn:hover{border-color:#075e54;background:#f0fff4;transform:scale(1.02)}
.upi-btn:active{transform:scale(0.96)}
.cod-btn{background:#2c3e50 !important}
.total-box{text-align:right;font-size:18px;font-weight:bold;color:#075e54;margin:15px 0}
</style>
</head>
<body>
<div class="header">
  <h1>🏪 Rahul's General Store<br><small style="font-weight:normal;font-size:12px">Mohone - 1006 Products</small></h1>
  <button class="cart-btn" onclick="openCart()">🛒 Cart (<span id="cartCount">0</span>)</button>
</div>

<div class="search-box">
  <input id="search" placeholder="Search Atta, Balti, Bucket, Doormat..." oninput="loadProducts(this.value)">
</div>

<div id="products" class="products">Loading all 1006 products... Please wait...</div>

<!-- CART & CHECKOUT MODAL -->
<div id="cartModal" class="cart-modal">
  <div class="cart-content">
    <h2 style="margin-top:0">Your Cart <span style="float:right;cursor:pointer;font-size:22px" onclick="closeCart()">✕</span></h2>
    <div id="cartItems"><p>Cart empty. Add products first.</p></div>
    <div class="total-box" id="total"></div>
    
    <hr style="margin:20px 0">
    <h3 style="margin:0 0 5px 0">📍 Delivery Address *Mandatory</h3>
    <p style="font-size:11px;color:#e74c3c;margin:0 0 10px 0">Without address we cannot deliver - All fields required</p>
    
    <div class="form-group">
      <label>Full Name *</label>
      <input id="cName" placeholder="Ex: Rahul Jha">
      <div class="error-msg" id="errName">Name is required</div>
    </div>
    <div class="form-group">
      <label>WhatsApp Number *</label>
      <input id="cPhone" placeholder="10 digit number" type="tel" inputmode="numeric">
      <div class="error-msg" id="errPhone">Valid 10 digit phone required</div>
    </div>
    <div class="form-group">
      <label>Full Address *</label>
      <textarea id="cAddress" rows="3" placeholder="House No, Building, Area, Mohone, Kalyan"></textarea>
      <div class="error-msg" id="errAddress">Full address is required for delivery</div>
    </div>
    <div class="form-group">
      <label>Pincode *</label>
      <input id="cPincode" placeholder="421102" type="tel" inputmode="numeric">
      <div class="error-msg" id="errPincode">6 digit pincode required</div>
    </div>

    <button class="pay-btn" id="validateBtn" onclick="validateAndShowPay()">Validate Address & Proceed to Payment →</button>

    <!-- PAYMENT GATEWAY - FIXED CLICK -->
    <div class="pay-section" id="paySection" style="display:none">
      <h3 style="margin:0 0 8px 0">💳 Choose Payment Method</h3>
      <p style="font-size:12px;color:#27ae60;margin:0 0 10px 0;font-weight:bold">✓ Address verified - Now select payment</p>
      
      <div class="upi-grid">
        <div class="upi-btn" onclick="payWithUPI('Google Pay')"><span>📱</span> Google Pay</div>
        <div class="upi-btn" onclick="payWithUPI('PhonePe')"><span>📱</span> PhonePe</div>
        <div class="upi-btn" onclick="payWithUPI('Paytm')"><span>📱</span> Paytm</div>
        <div class="upi-btn" onclick="payWithUPI('BHIM UPI')"><span>🏦</span> BHIM UPI</div>
      </div>
      
      <button class="pay-btn" style="background:#ff6b00;margin-top:12px" onclick="payWithUPI('Any UPI')">💳 Pay via Any UPI App</button>
      <button class="pay-btn cod-btn" onclick="payWithUPI('Cash on Delivery')">💵 Cash on Delivery (COD)</button>
      
      <p style="font-size:11px;color:#666;text-align:center;margin-top:10px">Clicking UPI will open your UPI app with payment amount</p>
    </div>

    <p id="orderStatus" style="text-align:center;margin-top:15px;font-weight:bold;white-space:pre-wrap;line-height:1.5"></p>
  </div>
</div>

<script>
let allProducts = [];
let cart = JSON.parse(localStorage.getItem('dukandaar_cart')||'[]');
let currentTotal = 0;
let currentOrderId = "";

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
      let btnColor = inCart ? '#888' : '#25d366';
      html += \`<div class="card">
        <h3>\${name}</h3>
        <div class="price">Rs \${price}</div>
        <button onclick="addToCart(\${id})" style="background:\${btnColor}">\${btnText}</button>
      </div>\`;
    });
    if(allProducts.length==0) {
      html = "<div style='grid-column:1/-1;padding:30px;text-align:center'><p>No products found for '<b>"+search+"</b>'</p><p>Try Atta, Bucket, Balti, Doormat</p></div>";
    }
    document.getElementById('products').innerHTML = html;
    updateCartCount();
  } catch(e) {
    document.getElementById('products').innerHTML = "<p style='padding:20px'>Error loading products. Refresh page.</p>";
  }
}

function addToCart(id) {
  let prod = allProducts.find(p=>p.id==id);
  if(!prod) return;
  let item = cart.find(c=>c.id==id);
  if(item) {
    item.qty++;
  } else {
    cart.push({id:prod.id, name: (prod.name || prod.product_name), price: prod.price, qty:1});
  }
  localStorage.setItem('dukandaar_cart', JSON.stringify(cart));
  loadProducts(document.getElementById('search').value);
  updateCartCount();
  // Small vibration feedback
  if(navigator.vibrate) navigator.vibrate(50);
}

function updateCartCount(){
  let totalQty = cart.reduce((s,c)=>s+c.qty,0);
  document.getElementById('cartCount').innerText = totalQty;
}

function openCart(){
  renderCart();
  document.getElementById('cartModal').style.display='block';
  document.body.style.overflow='hidden';
}
function closeCart(){
  document.getElementById('cartModal').style.display='none';
  document.body.style.overflow='auto';
}

function renderCart(){
  if(cart.length==0){
    document.getElementById('cartItems').innerHTML="<p style='text-align:center;padding:20px'>Cart empty.<br>Add products from shop.</p>";
    document.getElementById('total').innerText="";
    currentTotal = 0;
    return;
  }
  let html=""; let total=0;
  cart.forEach((c,i)=>{
    total += c.price*c.qty;
    html += \`<div class="cart-item">
      <div style="flex:1"><b>\${c.name}</b><br><small>Rs \${c.price} x \${c.qty} = Rs \${c.price*c.qty}</small></div>
      <div class="qty-controls">
        <button class="qty-btn" onclick="changeQty(\${i},-1)">-</button>
        <span style="min-width:20px;text-align:center">\${c.qty}</span>
        <button class="qty-btn" onclick="changeQty(\${i},1)">+</button>
      </div>
    </div>\`;
  });
  document.getElementById('cartItems').innerHTML=html;
  document.getElementById('total').innerText="Total: Rs "+total;
  currentTotal = total;
}

function changeQty(i,delta){
  cart[i].qty += delta;
  if(cart[i].qty<=0) cart.splice(i,1);
  localStorage.setItem('dukandaar_cart', JSON.stringify(cart));
  renderCart();
  updateCartCount();
}

function validateAndShowPay(){
  // Reset errors
  document.querySelectorAll('.error-msg').forEach(e=>e.style.display='none');
  document.querySelectorAll('#cartModal input, #cartModal textarea').forEach(e=>e.classList.remove('error'));
  
  let name = document.getElementById('cName').value.trim();
  let phone = document.getElementById('cPhone').value.trim();
  let address = document.getElementById('cAddress').value.trim();
  let pincode = document.getElementById('cPincode').value.trim();
  let valid = true;

  if(!name || name.length<2){ document.getElementById('errName').style.display='block'; document.getElementById('cName').classList.add('error'); valid=false; }
  if(!phone || phone.length<10 || isNaN(phone)){ document.getElementById('errPhone').style.display='block'; document.getElementById('cPhone').classList.add('error'); valid=false; }
  if(!address || address.length<10){ document.getElementById('errAddress').style.display='block'; document.getElementById('cAddress').classList.add('error'); valid=false; }
  if(!pincode || pincode.length<6 || isNaN(pincode)){ document.getElementById('errPincode').style.display='block'; document.getElementById('cPincode').classList.add('error'); valid=false; }

  if(!valid){
    document.getElementById('orderStatus').innerText="⚠️ Without address we cannot deliver! Please fill all fields correctly.";
    document.getElementById('orderStatus').style.color="#e74c3c";
    return; // STOP - Will not go to payment page
  }

  if(cart.length==0){
    document.getElementById('orderStatus').innerText="Cart empty! Add products first.";
    document.getElementById('orderStatus').style.color="#e74c3c";
    return;
  }

  // Validation passed - Show payment gateway
  document.getElementById('paySection').style.display='block';
  document.getElementById('validateBtn').style.display='none';
  document.getElementById('orderStatus').innerText="✓ Address validated successfully! Now choose payment method below to complete order and get bill on WhatsApp.";
  document.getElementById('orderStatus').style.color="#27ae60";
}

// FIXED: Payment gateway click now works and opens UPI app
async function payWithUPI(mode){
  let name = document.getElementById('cName').value.trim();
  let phone = document.getElementById('cPhone').value.trim();
  let address = document.getElementById('cAddress').value.trim();
  let pincode = document.getElementById('cPincode').value.trim();
  let total = currentTotal;

  if(total==0) total = cart.reduce((s,c)=>s+c.price*c.qty,0);

  document.getElementById('orderStatus').innerText="Placing order with "+mode+"... Please wait...";
  document.getElementById('orderStatus').style.color="#333";

  try {
    let res = await fetch('/api/order',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ cart, customer:{name,phone,address,pincode,paymentMode:mode}, total })
    });
    let data = await res.json();
    
    if(data.success){
      document.getElementById('orderStatus').style.color="#27ae60";
      let billHtml = data.bill.replace(/\\n/g, '<br>');
      currentOrderId = data.orderId;
      
      if(mode=='Cash on Delivery'){
        document.getElementById('orderStatus').innerHTML="✅ Order Placed Successfully! (COD)<br><br>Bill sent on WhatsApp to "+phone+"<br><br><div style='background:#f9f9f9;padding:12px;border-radius:8px;text-align:left;font-size:13px'>"+billHtml+"</div><br>We will deliver in 2-3 hours! Thank you 🙏";
      } else {
        // FIXED: UPI Links that actually open GPay, PhonePe, BHIM
        let upiId = "rahul.jha.39395033@okaxis";
        // Create UPI intent link - works for all UPI apps
        let upiLink = \`upi://pay?pa=\${upiId}&pn=Rahul%20Store%20Mohone&am=\${total}&cu=INR&tn=Order_\${data.orderId}_\${name}\`;
        let gpayLink = \`tez://upi/pay?pa=\${upiId}&pn=Rahul%20Store&am=\${total}&cu=INR&tn=Order_\${data.orderId}\`;
        let phonepeLink = \`phonepe://pay?pa=\${upiId}&pn=Rahul%20Store&am=\${total}&cu=INR\`;
        
        document.getElementById('orderStatus').innerHTML="✅ Order Placed! Bill sent on WhatsApp<br><br><div style='background:#f9f9f9;padding:12px;border-radius:8px;text-align:left;font-size:13px'>"+billHtml+"</div><br>"+
          \`<div style='margin-top:15px'>
            <a href="\${upiLink}" style='background:#25d366;color:#fff;padding:14px 28px;border-radius:12px;text-decoration:none;display:block;font-weight:bold;margin-bottom:10px;text-align:center'>💳 Pay Rs \${total} via \${mode} - CLICK HERE</a>
            <p style='font-size:12px;color:#666'>If \${mode} app doesn't open, click below:</p>
            <a href="\${upiLink}" style='color:#075e54;font-weight:bold'>Open Any UPI App</a> | 
            <a href="\${gpayLink}" style='color:#4285f4;font-weight:bold'>Open GPay</a>
            <p style='font-size:11px;margin-top:10px'>UPI ID: \${upiId}<br>Amount: Rs \${total}<br>Order: #\${data.orderId}</p>
            <p style='font-size:12px;color:#e74c3c'>After payment, share screenshot on WhatsApp: \${phone}</p>
          </div>\`;
        
        // Auto open UPI app after 1 second
        setTimeout(()=>{ window.location.href = upiLink; }, 1000);
      }
      
      cart=[]; 
      localStorage.removeItem('dukandaar_cart'); 
      updateCartCount();
      renderCart();
      
    } else {
      document.getElementById('orderStatus').innerText="❌ "+(data.error||"Order failed - try again");
      document.getElementById('orderStatus').style.color="#e74c3c";
    }
  } catch(e){
    document.getElementById('orderStatus').innerText="❌ Network error - Check internet and try again";
    document.getElementById('orderStatus').style.color="#e74c3c";
  }
}

// Close modal when clicking outside
document.getElementById('cartModal').addEventListener('click', function(e){
  if(e.target === this) closeCart();
});

// Initial load
loadProducts();
</script>
</body>
</html>
  `);
});

// ============================================================
// WHATSAPP WEBHOOK
// ============================================================
app.post("/webhook", async (req,res)=>{
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(!msg) return res.sendStatus(200);
    
    const from = msg.from;
    let userText = msg.text?.body || "";

    // OCR for image / handwritten list
    if(msg.type === "image") {
      try {
        const mediaId = msg.image.id;
        const mediaUrlRes = await axios.get(`https://graph.facebook.com/v20.0/${mediaId}`, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
        const imageUrl = mediaUrlRes.data.url;
        const imageBin = await axios.get(imageUrl, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, responseType: 'arraybuffer' });
        const { data: { text } } = await Tesseract.recognize(Buffer.from(imageBin.data), 'eng+hin');
        userText = text;
        await sendWhatsApp(from, `📸 Photo samajh gaya! Aapne likha hai: "${text.substring(0,100)}..."\nAb products dhoondh raha hu...`);
      } catch(e){ console.log("OCR failed", e.message); }
    }

    if(!userText) return res.sendStatus(200);

    // Welcome message for Hi/Hello
    const hiWords = ["hi", "hello", "hii", "hey", "hlw", "hlo", "namaste", "namaskar", "good morning", "good evening", "good afternoon", "gm", "helo", "hey there"];
    if (hiWords.includes(userText.toLowerCase().trim())) {
      const welcomeMsg = `Hello! I hope you are doing well. 😊\n\nWelcome to *Dukaandaar AI* - Your Smart Shopping Assistant from Rahul's General Store, Mohone.\n\n🛒 Click here to view and shop our complete stock of 1006 products with Cart, Address & Bill:\nhttps://dukandaar-ai.onrender.com/stock\n\n✨ Features:\n• 1006 products - Add to Cart\n• Address mandatory for delivery\n• Payment: Google Pay, PhonePe, BHIM UPI, COD\n• Auto Bill on WhatsApp\n\nYou can also type any product name like "Bucket", "Atta", "Doormat" or send photo of handwritten list.\n\nHave a wonderful day! 🙏✨`;
      await sendWhatsApp(from, welcomeMsg);
      return res.sendStatus(200);
    }

    // Order by ID
    if(userText.toLowerCase().startsWith("order")) {
      const parts = userText.split(" ");
      const prodId = parts[1];
      if(prodId) {
        let { data: prod } = await supabase.from("products").select("*").eq("id", prodId).single();
        if(prod) {
          await supabase.from("orders").insert({ phone: from, product_id: prod.id, product_name: prod.name || prod.product_name });
          await sendWhatsApp(from, `✅ Order Confirmed!\n\nProduct: ${prod.name || prod.product_name}\nPrice: Rs ${prod.price}\n\nFor home delivery with address & bill, order via shop:\nhttps://dukandaar-ai.onrender.com/stock\n\nThank you! 🙏`);
          return res.sendStatus(200);
        }
      }
    }

    // Search products
    const products = await findProducts(userText);

    if(products.length === 0) {
      // FINAL: Never show "nahi mila" error - show popular products
      let { data: fallback } = await supabase.from("products").select("*").limit(6);
      let reply = `Aapne "${userText}" search kiya - ye rahe kuch popular products aapke liye:\n\n`;
      fallback.forEach((p,i)=>{
        let n = p.name || p.product_name;
        reply += `${i+1}. ${n} - Rs ${p.price}\nOrder: Order ${p.id}\n\n`;
      });
      reply += `🛒 Full shop me search karo - waha "Atta" pakka milega:\nhttps://dukandaar-ai.onrender.com/stock\n\nFeatures: Cart, Address, Google Pay, PhonePe, Bill on WhatsApp!`;
      await sendWhatsApp(from, reply);
      return res.sendStatus(200);
    }

    let reply = `Ye rahe ${products.length} products "${userText}" ke liye:\n\n`;
    products.forEach((p,i)=> { 
      let n = p.name || p.product_name;
      reply += `${i+1}. ${n} - Rs ${p.price}\nOrder: Order ${p.id}\n\n`; 
    });
    reply += `🛒 Full shop with Cart, Address, Google Pay/PhonePe/BHIM/COD & Bill:\nhttps://dukandaar-ai.onrender.com/stock`;
    
    await sendWhatsApp(from, reply);
    
    try {
      await supabase.from("messages").insert({ phone: from, query: userText, reply: reply });
    } catch(e){}

  } catch(e) { 
    console.error("Webhook error:", e.message); 
  }
  res.sendStatus(200);
});

app.get("/webhook", (req,res)=>{
  if(req.query["hub.verify_token"] === "dukandaar123") res.send(req.query["hub.challenge"]);
  else res.sendStatus(403);
});

app.listen(10000, ()=> console.log("Live on 10000 - Full 415 lines - Atta Fixed + UPI Click Fixed + Bill Active"));
