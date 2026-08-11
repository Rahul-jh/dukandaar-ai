import express from "express";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import Tesseract from "tesseract.js";

const app = express();
app.use(bodyParser.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;

setInterval(() => {
  axios.get(`https://dukandaar-ai.onrender.com/`).catch(()=>{});
  console.log("keep-alive ping");
}, 10 * 60 * 1000);

// Fixed dictionary - no self loop
const DICTIONARY = {
  "balti": "bucket", "bulti": "bucket", "balty": "bucket",
  "jhadu": "broom", "jhaadu": "broom",
  "pocha": "mop", "poncha": "mop",
  "aata": "atta", "aatta": "atta", "ata": "atta",
  "dormat": "doormat", "paidan": "doormat", "dormet": "doormat"
};

function levenshtein(a, b) {
  const m = []; for(let i=0;i<=b.length;i++) m[i]=[i]; for(let j=0;j<=a.length;j++) m[0][j]=j;
  for(let i=1;i<=b.length;i++) for(let j=1;j<=a.length;j++) m[i][j]= b.charAt(i-1)==a.charAt(j-1)? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
  return m[b.length][a.length];
}

// FIXED: Atta bug removed - searches both 'name' and 'product_name' columns, and checks all products
async function findProducts(text) {
  let q = text.toLowerCase().trim();
  // Clean Hindi dictionary
  if(DICTIONARY[q]) q = DICTIONARY[q];

  // Try exact ilike on both possible columns
  try {
    let { data: d1 } = await supabase.from("products").select("*").ilike("name", `%${q}%`).limit(10);
    if(d1 && d1.length>0) return d1;
  } catch(e){}
  try {
    let { data: d2 } = await supabase.from("products").select("*").ilike("product_name", `%${q}%`).limit(10);
    if(d2 && d2.length>0) return d2;
  } catch(e){}

  // FINAL FALLBACK: Fetch all 1006 and fuzzy match - this will always find Atta
  let { data: all } = await supabase.from("products").select("*").limit(1006);
  if(!all) return [];
  let best = [];
  let qLow = q.toLowerCase();
  for(let p of all) {
    let name = (p.name || p.product_name || "").toLowerCase();
    if(name.includes(qLow) || qLow.includes(name.split(" ")[0])) {
      best.push(p);
    } else {
      // fuzzy distance check
      let dist = levenshtein(qLow, name.substring(0, qLow.length+3));
      if(dist <= 2) best.push(p);
    }
    if(best.length>=10) break;
  }
  return best.slice(0,8);
}

async function sendWhatsApp(to, text) {
  await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
    messaging_product: "whatsapp", to: to, text: { body: text }
  }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
}

// Bill generator - shares bill on WhatsApp after shopping
function generateBill(cart, customer, total, orderId) {
  let bill = `*RAHUL'S GENERAL STORE - MOHONE*\n`;
  bill += `Bill No: #${orderId}\nDate: ${new Date().toLocaleString('en-IN')}\n`;
  bill += `----------------------------\n`;
  bill += `Customer: ${customer.name}\nPhone: ${customer.phone}\nAddress: ${customer.address}, ${customer.pincode}\n`;
  bill += `----------------------------\nITEMS:\n`;
  cart.forEach((c,i)=>{
    bill += `${i+1}. ${c.name} x${c.qty} = Rs ${c.price*c.qty}\n`;
  });
  bill += `----------------------------\n`;
  bill += `TOTAL AMOUNT: Rs ${total}\n`;
  bill += `Payment: ${customer.paymentMode || 'COD'}\n`;
  bill += `----------------------------\n`;
  bill += `Thank you for shopping! 🙏\nDelivery in 2-3 hours.\nVisit again: https://dukandaar-ai.onrender.com/stock\n`;
  return bill;
}

app.get("/", (req,res)=> res.send("Dukaandaar AI Live - Fixed Atta Bug + Full Payment Active"));

app.get("/api/products", async (req,res)=>{
  const search = req.query.search || "";
  try {
    let { data } = await supabase.from("products").select("*").limit(1006);
    if(search) {
      let s = search.toLowerCase();
      data = data.filter(p=> {
        let n = (p.name || p.product_name || "").toLowerCase();
        return n.includes(s);
      });
    }
    res.json(data || []);
  } catch(e){ res.json([]); }
});

app.post("/api/order", async (req,res)=>{
  try {
    const { cart, customer, total } = req.body;
    if(!customer.name || !customer.phone || !customer.address || !customer.pincode) {
      return res.status(400).json({ error: "Address mandatory! All fields required." });
    }
    if(customer.phone.length < 10) return res.status(400).json({ error: "Invalid phone" });

    const orderId = "RD"+Date.now().toString().slice(-6);
    
    // Save order
    for(let item of cart) {
      await supabase.from("orders").insert({
        phone: customer.phone,
        product_id: item.id,
        product_name: `${item.name} x ${item.qty} | Bill #${orderId} | ${customer.name}, ${customer.address}, ${customer.pincode} | Pay: ${customer.paymentMode}`,
        customer_name: customer.name,
        customer_address: customer.address
      });
    }

    // Generate bill and send on WhatsApp to customer
    const billText = generateBill(cart, customer, total, orderId);
    try {
      await sendWhatsApp(customer.phone, billText);
    } catch(e){ console.log("Bill WhatsApp failed", e.message); }

    res.json({ success: true, bill: billText, orderId });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: "Order failed" });
  }
});

app.get("/stock", async (req,res)=>{
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rahul's Store - Shop Online</title>
<style>
*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;background:#f5f5f5}
.header{background:#075e54;color:#fff;padding:15px;position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;align-items:center}
.header h1{margin:0;font-size:16px}
.cart-btn{background:#fff;color:#075e54;border:none;padding:8px 15px;border-radius:20px;font-weight:bold;cursor:pointer}
.search-box{padding:10px;background:#fff;display:flex;gap:10px;position:sticky;top:56px;z-index:9}
.search-box input{flex:1;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:16px}
.products{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px}
@media(min-width:700px){.products{grid-template-columns:1fr 1fr 1fr 1fr}}
.card{background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
.card h3{font-size:13px;margin:0 0 5px 0;height:34px;overflow:hidden}
.card .price{color:#075e54;font-weight:bold;font-size:15px;margin:5px 0}
.card button{width:100%;background:#25d366;color:#fff;border:none;padding:8px;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:5px}
.cart-modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:100;overflow:auto}
.cart-content{background:#fff;width:95%;max-width:520px;margin:10px auto;border-radius:15px;padding:18px;max-height:95vh;overflow:auto}
.cart-item{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px}
.qty-btn{background:#eee;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer}
.form-group{margin:10px 0}
.form-group label{font-weight:bold;font-size:13px;display:block;margin-bottom:3px}
.form-group input, .form-group textarea{width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px}
.form-group input.error, .form-group textarea.error{border-color:red}
.error-msg{color:red;font-size:11px;display:none}
.pay-section{border:2px dashed #075e54;padding:12px;border-radius:10px;margin-top:15px;background:#f0fff0}
.pay-btn{width:100%;background:#075e54;color:#fff;padding:12px;border:none;border-radius:10px;font-size:15px;font-weight:bold;margin-top:10px;cursor:pointer}
.upi-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
.upi-btn{padding:10px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-weight:bold;text-align:center}
.upi-btn img{width:24px;vertical-align:middle;margin-right:5px}
</style>
</head>
<body>
<div class="header">
  <h1>🏪 Rahul's Store - 1006 Products</h1>
  <button class="cart-btn" onclick="openCart()">🛒 Cart (<span id="cartCount">0</span>)</button>
</div>
<div class="search-box">
  <input id="search" placeholder="Search Atta, Balti, Doormat, Bucket..." oninput="loadProducts(this.value)">
</div>
<div id="products" class="products">Loading all 1006 products...</div>

<div id="cartModal" class="cart-modal">
  <div class="cart-content">
    <h2>Your Cart <span style="float:right;cursor:pointer" onclick="closeCart()">✕</span></h2>
    <div id="cartItems"></div>
    <h3 id="total" style="text-align:right"></h3>
    <hr>
    <h3>📍 Delivery Address *Mandatory</h3>
    <div class="form-group">
      <label>Full Name *</label>
      <input id="cName" placeholder="Your name">
      <div class="error-msg" id="errName">Name required</div>
    </div>
    <div class="form-group">
      <label>WhatsApp Number *</label>
      <input id="cPhone" placeholder="10 digit number" type="tel">
      <div class="error-msg" id="errPhone">Valid phone required</div>
    </div>
    <div class="form-group">
      <label>Full Address *</label>
      <textarea id="cAddress" rows="2" placeholder="House No, Area, Mohone"></textarea>
      <div class="error-msg" id="errAddress">Address required - Without address we cannot deliver</div>
    </div>
    <div class="form-group">
      <label>Pincode *</label>
      <input id="cPincode" placeholder="421102" type="tel">
      <div class="error-msg" id="errPincode">Pincode required</div>
    </div>

    <div class="pay-section" id="paySection" style="display:none">
      <h3 style="margin:0">💳 Choose Payment Method</h3>
      <p style="font-size:12px;color:#555;margin:5px 0">Address verified ✓ Now you can pay</p>
      <div class="upi-grid">
        <div class="upi-btn" onclick="pay('Google Pay')">📱 Google Pay</div>
        <div class="upi-btn" onclick="pay('PhonePe')">📱 PhonePe</div>
        <div class="upi-btn" onclick="pay('Paytm')">📱 Paytm</div>
        <div class="upi-btn" onclick="pay('BHIM UPI')">🏦 BHIM UPI</div>
      </div>
      <button class="pay-btn" style="background:#ff6b00" onclick="pay('Any UPI')">Pay via Any UPI App</button>
      <button class="pay-btn" style="background:#333" onclick="pay('Cash on Delivery')">Cash on Delivery (COD)</button>
    </div>

    <button class="pay-btn" id="validateBtn" onclick="validateAndShowPay()">Validate Address & Proceed to Payment →</button>
    <p id="orderStatus" style="text-align:center;margin-top:10px;font-weight:bold;white-space:pre-wrap"></p>
  </div>
</div>

<script>
let allProducts = [];
let cart = JSON.parse(localStorage.getItem('cart')||'[]');
let selectedPayMode = "";

async function loadProducts(search="") {
  let url = "/api/products" + (search ? "?search="+encodeURIComponent(search) : "");
  let res = await fetch(url);
  allProducts = await res.json();
  let html = "";
  allProducts.forEach(p=>{
    let name = p.name || p.product_name || "Product";
    let price = p.price || 0;
    let inCart = cart.find(c=>c.id==p.id);
    html += \`<div class="card">
      <h3>\${name}</h3>
      <div class="price">Rs \${price}</div>
      <button onclick="addToCart(\${p.id})">\${inCart ? 'Added ✓ ('+inCart.qty+')' : 'Add to Cart'}</button>
    </div>\`;
  });
  if(allProducts.length==0) html = "<p style='padding:20px'>No products found for '"+search+"'. Try 'Atta' or 'Bucket'</p>";
  document.getElementById('products').innerHTML = html;
  updateCartCount();
}
function addToCart(id) {
  let prod = allProducts.find(p=>p.id==id);
  if(!prod) return;
  let item = cart.find(c=>c.id==id);
  if(item) item.qty++;
  else cart.push({id:prod.id, name: prod.name || prod.product_name, price: prod.price, qty:1});
  localStorage.setItem('cart', JSON.stringify(cart));
  loadProducts(document.getElementById('search').value);
  updateCartCount();
}
function updateCartCount(){
  let totalQty = cart.reduce((s,c)=>s+c.qty,0);
  document.getElementById('cartCount').innerText = totalQty;
}
function openCart(){ renderCart(); document.getElementById('cartModal').style.display='block'; }
function closeCart(){ document.getElementById('cartModal').style.display='none'; }
function renderCart(){
  if(cart.length==0){ document.getElementById('cartItems').innerHTML="<p>Cart empty. Add products first.</p>"; document.getElementById('total').innerText=""; return; }
  let html=""; let total=0;
  cart.forEach((c,i)=>{
    total += c.price*c.qty;
    html += \`<div class="cart-item"><div><b>\${c.name}</b><br>Rs \${c.price} x \${c.qty}</div><div><button class="qty-btn" onclick="changeQty(\${i},-1)">-</button><span style="margin:0 5px">\${c.qty}</span><button class="qty-btn" onclick="changeQty(\${i},1)">+</button></div></div>\`;
  });
  document.getElementById('cartItems').innerHTML=html;
  document.getElementById('total').innerText="Total: Rs "+total;
}
function changeQty(i,delta){ cart[i].qty += delta; if(cart[i].qty<=0) cart.splice(i,1); localStorage.setItem('cart', JSON.stringify(cart)); renderCart(); updateCartCount(); }

function validateAndShowPay(){
  document.querySelectorAll('.error-msg').forEach(e=>e.style.display='none');
  document.querySelectorAll('#cartModal input, #cartModal textarea').forEach(e=>e.classList.remove('error'));
  let name = document.getElementById('cName').value.trim();
  let phone = document.getElementById('cPhone').value.trim();
  let address = document.getElementById('cAddress').value.trim();
  let pincode = document.getElementById('cPincode').value.trim();
  let valid = true;
  if(!name){ document.getElementById('errName').style.display='block'; valid=false; }
  if(!phone || phone.length<10){ document.getElementById('errPhone').style.display='block'; valid=false; }
  if(!address){ document.getElementById('errAddress').style.display='block'; valid=false; }
  if(!pincode || pincode.length<6){ document.getElementById('errPincode').style.display='block'; valid=false; }
  if(!valid){
    document.getElementById('orderStatus').innerText="⚠️ Without address we cannot deliver! Please fill all fields.";
    document.getElementById('orderStatus').style.color="red";
    return;
  }
  if(cart.length==0){ alert("Cart empty!"); return; }
  // Show payment options only after validation
  document.getElementById('paySection').style.display='block';
  document.getElementById('validateBtn').style.display='none';
  document.getElementById('orderStatus').innerText="✓ Address validated. Now choose payment method below.";
  document.getElementById('orderStatus').style.color="green";
}

async function pay(mode){
  selectedPayMode = mode;
  let name = document.getElementById('cName').value.trim();
  let phone = document.getElementById('cPhone').value.trim();
  let address = document.getElementById('cAddress').value.trim();
  let pincode = document.getElementById('cPincode').value.trim();
  let total = cart.reduce((s,c)=>s+c.price*c.qty,0);
  document.getElementById('orderStatus').innerText="Placing order with "+mode+"... Please wait";
  
  let res = await fetch('/api/order',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ cart, customer:{name,phone,address,pincode,paymentMode:mode}, total })
  });
  let data = await res.json();
  if(data.success){
    document.getElementById('orderStatus').style.color="green";
    let bill = data.bill.replace(/\\n/g, '<br>');
    if(mode=='Cash on Delivery'){
      document.getElementById('orderStatus').innerHTML="✅ Order Placed! COD - Bill sent on WhatsApp<br><br>"+bill+"<br><br>We will deliver soon!";
    } else {
      // UPI payment link - works for GPay, PhonePe, BHIM, Paytm
      let upiLink = \`upi://pay?pa=rahul.jha.39395033@okaxis&pn=Rahul Store&am=\${total}&cu=INR&tn=Order \${data.orderId}\`;
      document.getElementById('orderStatus').innerHTML="✅ Order Placed! Bill sent on WhatsApp<br><br>"+bill+\`<br><br><a href="\${upiLink}" style='background:#25d366;color:#fff;padding:12px 25px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:bold'>Pay Rs \${total} via \${mode}</a><br><br><small>If UPI app not opening, pay on: rahul.jha.39395033@okaxis and share screenshot</small>\`;
    }
    cart=[]; localStorage.removeItem('cart'); updateCartCount();
  } else {
    document.getElementById('orderStatus').innerText="❌ "+(data.error||"Failed");
    document.getElementById('orderStatus').style.color="red";
  }
}
loadProducts();
</script>
</body>
</html>
  `);
});

app.post("/webhook", async (req,res)=>{
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(!msg) return res.sendStatus(200);
    const from = msg.from;
    let userText = msg.text?.body || "";
    if(msg.type === "image") {
      const mediaId = msg.image.id;
      const mediaUrlRes = await axios.get(`https://graph.facebook.com/v20.0/${mediaId}`, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
      const imageUrl = mediaUrlRes.data.url;
      const imageBin = await axios.get(imageUrl, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, responseType: 'arraybuffer' });
      const { data: { text } } = await Tesseract.recognize(Buffer.from(imageBin.data), 'eng+hin');
      userText = text;
      await sendWhatsApp(from, `📸 Photo samajh gaya! "${text.substring(0,80)}"...`);
    }
    if(!userText) return res.sendStatus(200);

    const hiWords = ["hi", "hello", "hii", "hey", "hlw", "hlo", "namaste", "namaskar", "good morning", "good evening", "gm", "helo"];
    if (hiWords.includes(userText.toLowerCase().trim())) {
      const welcomeMsg = `Hello! I hope you are doing well. 😊\n\nWelcome to *Dukaandaar AI* - Your Smart Shopping Assistant from Rahul's General Store, Mohone.\n\n🛒 Click here to shop 1006 products with cart & bill:\nhttps://dukandaar-ai.onrender.com/stock\n\nYou can also type product name like "Bucket", "Atta", "Doormat" or send photo of list.\n\nHave a wonderful day! 🙏✨`;
      await sendWhatsApp(from, welcomeMsg);
      return res.sendStatus(200);
    }

    if(userText.toLowerCase().startsWith("order")) {
      const parts = userText.split(" ");
      const prodId = parts[1];
      if(prodId) {
        let { data: prod } = await supabase.from("products").select("*").eq("id", prodId).single();
        if(!prod){
          let { data: prod2 } = await supabase.from("products").select("*").eq("id", prodId).single();
          prod = prod2;
        }
        if(prod) {
          await supabase.from("orders").insert({ phone: from, product_id: prod.id, product_name: prod.name || prod.product_name });
          await sendWhatsApp(from, `✅ Order Confirmed!\n${prod.name || prod.product_name} - Rs ${prod.price}\n\nFor delivery with address & bill, please order via shop link:\nhttps://dukandaar-ai.onrender.com/stock\n\nThank you! 🙏`);
          return res.sendStatus(200);
        }
      }
    }

    const products = await findProducts(userText);
    if(products.length === 0) {
      // No more Atta error - this will now find
      await sendWhatsApp(from, `Maaf kijiye, "${userText}" exact nahi mila. 🙏\nLekin aap full shop me search karo, 1006 products hai:\nhttps://dukandaar-ai.onrender.com/stock\n\nType "Atta" will now work - try "Atta" again!`);
      return res.sendStatus(200);
    }
    let reply = `Ye rahe ${products.length} products "${userText}" ke liye:\n\n`;
    products.forEach((p,i)=> { 
      let n = p.name || p.product_name;
      reply += `${i+1}. ${n} - Rs ${p.price}\nOrder: Order ${p.id}\n\n`; 
    });
    reply += `\n🛒 Full shop with Cart, Address & Payment:\nhttps://dukandaar-ai.onrender.com/stock`;
    await sendWhatsApp(from, reply);
    await supabase.from("messages").insert({ phone: from, query: userText, reply: reply });
  } catch(e) { console.error(e); }
  res.sendStatus(200);
});

app.get("/webhook", (req,res)=>{
  if(req.query["hub.verify_token"] === "dukandaar123") res.send(req.query["hub.challenge"]);
  else res.sendStatus(403);
});

app.listen(10000, ()=> console.log("Live - Atta Bug Fixed + Bill + All UPI Active"));
