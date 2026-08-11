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

// Keep-alive for Render free instance
setInterval(() => {
  axios.get(`https://dukandaar-ai.onrender.com/`).catch(()=>{});
  console.log("keep-alive ping");
}, 10 * 60 * 1000);

const DICTIONARY = {
  "balti": "bucket", "bulti": "bucket", "balty": "bucket",
  "jhadu": "broom", "jhaadu": "broom",
  "pocha": "mop", "poncha": "mop",
  "aata": "atta", "atta": "atta",
  "dormat": "doormat", "paidan": "doormat", "dormet": "doormat"
};

function levenshtein(a, b) {
  const m = []; for(let i=0;i<=b.length;i++) m[i]=[i]; for(let j=0;j<=a.length;j++) m[0][j]=j;
  for(let i=1;i<=b.length;i++) for(let j=1;j<=a.length;j++) m[i][j]= b.charAt(i-1)==a.charAt(j-1)? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
  return m[b.length][a.length];
}

async function findProducts(text) {
  let q = text.toLowerCase().trim();
  q = DICTIONARY[q] || q;
  let { data } = await supabase.from("products").select("*").ilike("name", `%${q}%`).limit(5);
  if (data && data.length > 0) return data;
  let { data: all } = await supabase.from("products").select("*").limit(1000);
  let best = [];
  for(let p of all) {
    let dist = levenshtein(q, p.name.toLowerCase().substring(0, q.length+2));
    if(dist <= 2 || p.name.toLowerCase().includes(q)) best.push(p);
  }
  return best.slice(0,5);
}

async function sendWhatsApp(to, text) {
  await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
    messaging_product: "whatsapp", to: to, text: { body: text }
  }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
}

app.get("/", (req,res)=> res.send("Dukaandaar AI Live - Full Shop + Permanent Token Active"));

// API to get all 1006 products for shop
app.get("/api/products", async (req,res)=>{
  const search = req.query.search || "";
  let query = supabase.from("products").select("*").limit(1006);
  if(search) query = query.ilike("name", `%${search}%`).limit(100);
  let { data } = await query;
  res.json(data || []);
});

// API to place order with address validation
app.post("/api/order", async (req,res)=>{
  try {
    const { cart, customer } = req.body;
    // Address validation - mandatory
    if(!customer.name || !customer.phone || !customer.address || !customer.pincode) {
      return res.status(400).json({ error: "Address is mandatory. Please fill all fields." });
    }
    if(customer.phone.length < 10 || customer.pincode.length < 6) {
      return res.status(400).json({ error: "Invalid phone or pincode" });
    }
    // Save each product as separate order with address
    for(let item of cart) {
      await supabase.from("orders").insert({
        phone: customer.phone,
        product_id: item.id,
        product_name: `${item.name} x ${item.qty} - ${customer.name}, ${customer.address}, ${customer.pincode}`,
        customer_name: customer.name,
        customer_address: customer.address
      });
    }
    // Optional: Send WhatsApp confirmation if phone matches WhatsApp format
    try {
      await sendWhatsApp(customer.phone, `✅ Order Confirmed ${customer.name}!\n\n${cart.length} items ordered.\nTotal: Rs ${req.body.total}\nDelivery Address: ${customer.address}, ${customer.pincode}\n\nThank you for shopping with Rahul's Store! 🙏`);
    } catch(e){}
    res.json({ success: true, message: "Order placed successfully" });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: "Order failed" });
  }
});

// FULL SHOP PAGE - 1006 products, Add to Cart, Address mandatory, Payment
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
.header h1{margin:0;font-size:18px}
.cart-btn{background:#fff;color:#075e54;border:none;padding:8px 15px;border-radius:20px;font-weight:bold;cursor:pointer}
.search-box{padding:10px;background:#fff;display:flex;gap:10px;position:sticky;top:58px;z-index:9}
.search-box input{flex:1;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:16px}
.products{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px}
@media(min-width:700px){.products{grid-template-columns:1fr 1fr 1fr 1fr}}
.card{background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
.card h3{font-size:14px;margin:0 0 5px 0;height:36px;overflow:hidden}
.card .price{color:#075e54;font-weight:bold;font-size:16px;margin:5px 0}
.card button{width:100%;background:#25d366;color:#fff;border:none;padding:8px;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:5px}
.card button.added{background:#999}
.cart-modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:100;overflow:auto}
.cart-content{background:#fff;width:95%;max-width:500px;margin:20px auto;border-radius:15px;padding:20px;max-height:90vh;overflow:auto}
.cart-item{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee}
.qty-btn{background:#eee;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer}
.form-group{margin:12px 0}
.form-group label{font-weight:bold;font-size:14px;display:block;margin-bottom:4px}
.form-group input, .form-group textarea{width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px}
.form-group input.error, .form-group textarea.error{border-color:red}
.error-msg{color:red;font-size:12px;display:none}
.pay-btn{width:100%;background:#075e54;color:#fff;padding:14px;border:none;border-radius:10px;font-size:16px;font-weight:bold;margin-top:15px;cursor:pointer}
.pay-btn:disabled{background:#ccc}
.upi-option{background:#f0f8ff;padding:10px;border-radius:8px;margin-top:10px;text-align:center;border:1px dashed #075e54}
</style>
</head>
<body>
<div class="header">
  <h1>🏪 Rahul's Store - 1006 Products</h1>
  <button class="cart-btn" onclick="openCart()">🛒 Cart (<span id="cartCount">0</span>)</button>
</div>
<div class="search-box">
  <input id="search" placeholder="Search Balti, Atta, Doormat..." oninput="loadProducts(this.value)">
</div>
<div id="products" class="products">Loading 1006 products...</div>

<!-- Cart & Checkout Modal -->
<div id="cartModal" class="cart-modal">
  <div class="cart-content">
    <h2>Your Cart <span style="float:right;cursor:pointer" onclick="closeCart()">✕</span></h2>
    <div id="cartItems"></div>
    <h3 id="total" style="text-align:right"></h3>
    
    <hr>
    <h3>📍 Delivery Address - Mandatory</h3>
    <div class="form-group">
      <label>Full Name *</label>
      <input id="cName" placeholder="Your full name">
      <div class="error-msg" id="errName">Name is required</div>
    </div>
    <div class="form-group">
      <label>WhatsApp Number *</label>
      <input id="cPhone" placeholder="10 digit number" type="tel">
      <div class="error-msg" id="errPhone">Valid phone required</div>
    </div>
    <div class="form-group">
      <label>Full Address *</label>
      <textarea id="cAddress" rows="3" placeholder="House No, Area, Mohone, Kalyan..."></textarea>
      <div class="error-msg" id="errAddress">Address is required</div>
    </div>
    <div class="form-group">
      <label>Pincode *</label>
      <input id="cPincode" placeholder="421102" type="tel">
      <div class="error-msg" id="errPincode">Pincode is required</div>
    </div>

    <button class="pay-btn" onclick="placeOrder()">Proceed to Payment →</button>
    
    <div class="upi-option">
      <p style="margin:5px">💳 After address, you can pay via:</p>
      <b>UPI / Cash on Delivery</b><br>
      <small>Payment page will open after address validation</small>
    </div>
    <p id="orderStatus" style="text-align:center;margin-top:10px;font-weight:bold"></p>
  </div>
</div>

<script>
let allProducts = [];
let cart = JSON.parse(localStorage.getItem('cart')||'[]');

async function loadProducts(search="") {
  let url = "/api/products" + (search ? "?search="+encodeURIComponent(search) : "");
  let res = await fetch(url);
  allProducts = await res.json();
  let html = "";
  allProducts.forEach(p=>{
    let inCart = cart.find(c=>c.id==p.id);
    html += \`<div class="card">
      <h3>\${p.name}</h3>
      <div class="price">Rs \${p.price}</div>
      <button onclick="addToCart(\${p.id})" class="\${inCart?'added':''}">\${inCart ? 'Added ✓ ('+inCart.qty+')' : 'Add to Cart'}</button>
    </div>\`;
  });
  if(allProducts.length==0) html = "<p style='padding:20px'>No products found. Try Bucket, Atta, Doormat</p>";
  document.getElementById('products').innerHTML = html;
  updateCartCount();
}

function addToCart(id) {
  let prod = allProducts.find(p=>p.id==id);
  if(!prod) return;
  let item = cart.find(c=>c.id==id);
  if(item) item.qty++;
  else cart.push({id:prod.id, name:prod.name, price:prod.price, qty:1});
  localStorage.setItem('cart', JSON.stringify(cart));
  loadProducts(document.getElementById('search').value);
  updateCartCount();
}

function updateCartCount(){
  let totalQty = cart.reduce((s,c)=>s+c.qty,0);
  document.getElementById('cartCount').innerText = totalQty;
}

function openCart(){
  renderCart();
  document.getElementById('cartModal').style.display='block';
}
function closeCart(){ document.getElementById('cartModal').style.display='none'; }

function renderCart(){
  if(cart.length==0){ document.getElementById('cartItems').innerHTML="<p>Cart empty. Add products first.</p>"; document.getElementById('total').innerText=""; return; }
  let html=""; let total=0;
  cart.forEach((c,i)=>{
    total += c.price*c.qty;
    html += \`<div class="cart-item">
      <div><b>\${c.name}</b><br>Rs \${c.price} x \${c.qty}</div>
      <div>
        <button class="qty-btn" onclick="changeQty(\${i},-1)">-</button>
        <span style="margin:0 5px">\${c.qty}</span>
        <button class="qty-btn" onclick="changeQty(\${i},1)">+</button>
      </div>
    </div>\`;
  });
  document.getElementById('cartItems').innerHTML=html;
  document.getElementById('total').innerText="Total: Rs "+total;
}

function changeQty(i,delta){
  cart[i].qty += delta;
  if(cart[i].qty<=0) cart.splice(i,1);
  localStorage.setItem('cart', JSON.stringify(cart));
  renderCart(); updateCartCount();
}

async function placeOrder(){
  // Reset errors
  document.querySelectorAll('.error-msg').forEach(e=>e.style.display='none');
  document.querySelectorAll('#cartModal input, #cartModal textarea').forEach(e=>e.classList.remove('error'));
  
  let name = document.getElementById('cName').value.trim();
  let phone = document.getElementById('cPhone').value.trim();
  let address = document.getElementById('cAddress').value.trim();
  let pincode = document.getElementById('cPincode').value.trim();
  let valid = true;

  if(!name){ document.getElementById('errName').style.display='block'; document.getElementById('cName').classList.add('error'); valid=false; }
  if(!phone || phone.length<10){ document.getElementById('errPhone').style.display='block'; document.getElementById('cPhone').classList.add('error'); valid=false; }
  if(!address){ document.getElementById('errAddress').style.display='block'; document.getElementById('cAddress').classList.add('error'); valid=false; }
  if(!pincode || pincode.length<6){ document.getElementById('errPincode').style.display='block'; document.getElementById('cPincode').classList.add('error'); valid=false; }

  if(!valid){
    document.getElementById('orderStatus').innerText="⚠️ Please fill all address fields - Address is mandatory!";
    document.getElementById('orderStatus').style.color="red";
    return; // STOP - will not go to payment
  }

  if(cart.length==0){ alert("Cart empty!"); return; }

  let total = cart.reduce((s,c)=>s+c.price*c.qty,0);
  document.getElementById('orderStatus').innerText="Placing order...";
  
  let res = await fetch('/api/order',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ cart, customer:{name,phone,address,pincode}, total })
  });
  let data = await res.json();
  if(data.success){
    document.getElementById('orderStatus').style.color="green";
    document.getElementById('orderStatus').innerHTML="✅ Order Placed! Redirecting to Payment...<br><br><a href='upi://pay?pa=rahuljha@upi&pn=Rahuls Store&am="+total+"&cu=INR' style='background:#25d366;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:10px'>Pay Rs "+total+" via UPI</a><br><br>Or Pay Cash on Delivery - We will call you on "+phone;
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
      await sendWhatsApp(from, `📸 Photo samajh gaya! Aapne likha hai: "${text.substring(0,100)}"\nAb products dhoondh raha hu...`);
    }

    if(!userText) return res.sendStatus(200);

    const hiWords = ["hi", "hello", "hii", "hey", "hlw", "hlo", "namaste", "namaskar", "good morning", "good evening", "good afternoon", "gm", "helo"];
    if (hiWords.includes(userText.toLowerCase().trim())) {
      const welcomeMsg = `Hello! I hope you are doing well. 😊

Welcome to *Dukaandaar AI* - Your Smart Shopping Assistant from Rahul's General Store, Mohone.

Thank you for reaching out! I am here to help you find anything you need quickly.

🛒 *To get started:*
👉 Click here to view and shop our complete stock of 1006 products:
https://dukandaar-ai.onrender.com/stock

You can:
• See all products, add to cart, and buy directly
• Or simply type any product name like "Bucket", "Atta 5kg", "Doormat"
• Or send a photo of your handwritten list

Let me know what you would like to purchase today. Have a wonderful day! 🙏✨`;
      await sendWhatsApp(from, welcomeMsg);
      return res.sendStatus(200);
    }

    if(userText.toLowerCase().startsWith("order")) {
      const parts = userText.split(" ");
      const prodId = parts[1];
      if(prodId) {
        let { data: prod } = await supabase.from("products").select("*").eq("id", prodId).single();
        if(prod) {
          await supabase.from("orders").insert({ phone: from, product_id: prod.id, product_name: prod.name });
          await sendWhatsApp(from, `✅ Order Confirmed!\n\nProduct: ${prod.name}\nPrice: Rs ${prod.price}\n\nFor home delivery with address, please order via our shop link:\nhttps://dukandaar-ai.onrender.com/stock\n\nThank you! 🙏`);
          return res.sendStatus(200);
        }
      }
    }

    const products = await findProducts(userText);
    if(products.length === 0) {
      await sendWhatsApp(from, `Maaf kijiye, "${userText}" stock me nahi mila. 🙏\nAap 'Bucket', 'Atta 5kg', 'Doormat' try karo.\nYa full shop dekho: https://dukandaar-ai.onrender.com/stock`);
      return res.sendStatus(200);
    }
    let reply = `Ye rahe ${products.length} products "${userText}" ke liye:\n\n`;
    products.forEach((p,i)=> { reply += `${i+1}. ${p.name} - Rs ${p.price}\nOrder: Order ${p.id}\n\n`; });
    reply += `\n🛒 Full shop with cart & delivery:\nhttps://dukandaar-ai.onrender.com/stock`;
    await sendWhatsApp(from, reply);
    await supabase.from("messages").insert({ phone: from, query: userText, reply: reply });
  } catch(e) { console.error(e); }
  res.sendStatus(200);
});

app.get("/webhook", (req,res)=>{
  if(req.query["hub.verify_token"] === "dukandaar123") res.send(req.query["hub.challenge"]);
  else res.sendStatus(403);
});

app.listen(10000, ()=> console.log("Live on 10000 - Full Shop Active"));
