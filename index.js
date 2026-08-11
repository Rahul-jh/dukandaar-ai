import express from "express";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";

// ============================================================================
// DUKAANDAAR AI - RAHUL'S GENERAL STORE - MOHONE
// FULL FINAL CODE - 950 LINES VERSION
// 
// Features in this version:
// 1. WhatsApp Search OFF - Only Shop Link (Clean message, No 1006, No bullets)
// 2. Shop Page - Search all products, Add to Cart, Qty +/-
// 3. Delivery Address Mandatory - Validation blocks payment if empty
// 4. Address Save Feature - Shows "Use Same as Previous" / "New Address" button
// 5. Cart Empty Bug Fixed - Cart stays visible when clicking COD / Google Pay
// 6. Payment Gateway - Google Pay, PhonePe, Paytm, BHIM UPI, Any UPI, COD
// 7. Auto Bill on WhatsApp after order
// 8. Keep Render Alive
// ============================================================================

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ============================================================================
// SUPABASE & WHATSAPP CONFIG
// ============================================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;

// ============================================================================
// KEEP RENDER ALIVE - Prevent sleeping
// ============================================================================

setInterval(() => {
  axios.get(`https://dukandaar-ai.onrender.com/`)
    .then(() => console.log("Keep-alive ping success"))
    .catch(() => console.log("Keep-alive ping failed - retry next"));
}, 10 * 60 * 1000);

// ============================================================================
// WHATSAPP SEND FUNCTION
// ============================================================================

async function sendWhatsApp(to, text) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log("WhatsApp sent successfully to", to);
    return response.data;
  } catch (e) {
    console.log("WhatsApp send failed:", e.response?.data || e.message);
    // Don't throw - fail silently for bill
    return null;
  }
}

// ============================================================================
// BILL GENERATOR - Professional Bill Format
// ============================================================================

function generateBill(cart, customer, total, orderId) {
  let bill = "";
  
  bill += `*RAHUL'S GENERAL STORE - MOHONE*\n`;
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `Bill No: #${orderId}\n`;
  bill += `Date: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n`;
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `Customer Details:\n`;
  bill += `Name: ${customer.name}\n`;
  bill += `Phone: ${customer.phone}\n`;
  bill += `Address: ${customer.address}\n`;
  bill += `Pincode: ${customer.pincode}\n`;
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `ITEMS ORDERED:\n`;
  
  cart.forEach((c, i) => {
    let name = c.name;
    // Truncate long names for bill readability
    if (name.length > 30) {
      name = name.substring(0, 30) + "..";
    }
    bill += `${i + 1}. ${name} x${c.qty} = Rs ${c.price * c.qty}\n`;
  });
  
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `TOTAL AMOUNT: Rs ${total}\n`;
  bill += `Payment Mode: ${customer.paymentMode}\n`;
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  bill += `Thank you for shopping! 🙏\n`;
  bill += `Delivery in 2-3 hours at Mohone.\n`;
  bill += `Shop again: https://dukandaar-ai.onrender.com/stock\n`;
  bill += `━━━━━━━━━━━━━━━━━━━━\n`;
  
  return bill;
}

// ============================================================================
// ROUTES
// ============================================================================

// Home Route - Health Check for Render
app.get("/", (req, res) => {
  res.send(`
    <h2>Dukaandaar AI Live</h2>
    <p>Status: Active</p>
    <p>Features: Clean WhatsApp (No 1006, No Bullets), Shop Page, Address Save, Cart Fix, UPI Payment, Bill</p>
    <p><a href="/stock">Go to Shop</a></p>
  `);
});

// ============================================================================
// API - GET PRODUCTS - For Shop Page Only
// ============================================================================

app.get("/api/products", async (req, res) => {
  const search = (req.query.search || "").toLowerCase().trim();
  
  console.log("API products called, search:", search);
  
  try {
    let { data, error } = await supabase
      .from("products")
      .select("*")
      .limit(2000);
    
    if (error) {
      console.log("Supabase fetch error:", error);
      return res.json([]);
    }
    
    let products = data || [];
    
    console.log("Total products fetched:", products.length);
    
    // Search filter for shop page
    if (search && search.length > 0) {
      let terms = [];
      
      // Atta variants
      if (search.includes("atta") || search.includes("aata") || search === "ata") {
        terms = ["atta", "aata", "flour", "wheat", "chakki", "aashir", "ashir"];
      } 
      // Balti / Bucket variants
      else if (
        search.includes("balti") ||
        search.includes("bucket") ||
        search.includes("bulti") ||
        search.includes("balty")
      ) {
        terms = ["bucket", "balti", "bulti", "balty"];
      }
      // Doormat variants
      else if (
        search.includes("doormat") ||
        search.includes("dormat") ||
        search.includes("paidan") ||
        search.includes("door mat")
      ) {
        terms = ["doormat", "mat", "dormat", "paidan"];
      }
      // Broom variants
      else if (search.includes("jhadu") || search.includes("broom")) {
        terms = ["broom", "jhadu", "jhaadu"];
      }
      // Mop variants
      else if (search.includes("pocha") || search.includes("mop")) {
        terms = ["mop", "pocha", "poncha"];
      }
      else {
        terms = [search];
      }
      
      // Filter products
      products = products.filter(p => {
        let n = (p.name || p.product_name || "").toLowerCase();
        return terms.some(t => n.includes(t));
      });
      
      console.log("Filtered products for", search, ":", products.length);
    }
    
    res.json(products);
  } catch (e) {
    console.log("API products exception:", e.message);
    res.json([]);
  }
});

// ============================================================================
// API - PLACE ORDER - With Full Validation & Bill
// ============================================================================

app.post("/api/order", async (req, res) => {
  try {
    const { cart, customer, total } = req.body;
    
    console.log("=== NEW ORDER ===");
    console.log("Customer:", customer.name, customer.phone);
    console.log("Total:", total, "Items:", cart?.length);
    
    // Validation - Address mandatory
    if (!customer.name || customer.name.trim().length < 2) {
      return res.status(400).json({ 
        error: "Full Name is mandatory! Please enter your name." 
      });
    }
    
    if (!customer.phone || customer.phone.length < 10) {
      return res.status(400).json({ 
        error: "Valid WhatsApp Number is mandatory! Enter 10 digit number." 
      });
    }
    
    if (!customer.address || customer.address.trim().length < 10) {
      return res.status(400).json({ 
        error: "Full Address is mandatory! Without address we cannot deliver." 
      });
    }
    
    if (!customer.pincode || customer.pincode.length < 6) {
      return res.status(400).json({ 
        error: "Pincode is mandatory! Enter 6 digit pincode." 
      });
    }
    
    if (!cart || cart.length === 0) {
      return res.status(400).json({ 
        error: "Cart is empty! Please add products first." 
      });
    }
    
    // Generate Order ID
    const orderId = "RD" + Date.now().toString().slice(-6);
    
    // Keep cart backup - IMPORTANT for fixing empty bug
    let savedCart = [...cart];
    
    // Save each item in Supabase orders table
    for (let item of cart) {
      try {
        await supabase.from("orders").insert({
          phone: customer.phone,
          product_id: item.id,
          product_name: `${item.name} x ${item.qty} | Bill #${orderId} | ${customer.name}, ${customer.address}, ${customer.pincode} | ${customer.paymentMode} | Total Rs ${total}`,
          customer_name: customer.name,
          customer_address: `${customer.address}, ${customer.pincode} - Payment: ${customer.paymentMode}`
        });
        console.log("Order item saved:", item.name);
      } catch (err) {
        console.log("Order insert failed for item:", item.name, err.message);
      }
    }
    
    // Generate bill
    const billText = generateBill(savedCart, customer, total, orderId);
    
    console.log("Bill generated for", orderId);
    
    // Send bill on WhatsApp to customer
    try {
      await sendWhatsApp(customer.phone, billText);
      console.log("Bill sent to customer WhatsApp:", customer.phone);
    } catch (e) {
      console.log("Bill WhatsApp failed but order saved:", e.message);
    }
    
    // Return success
    res.json({
      success: true,
      bill: billText,
      orderId: orderId,
      total: total,
      savedCart: savedCart,
      message: "Order placed successfully"
    });
    
  } catch (e) {
    console.error("Order API exception:", e.message);
    res.status(500).json({ 
      error: "Order failed - please try again. Check your internet." 
    });
  }
});

// ============================================================================
// SHOP PAGE - /stock - Main Shopping Page
// Features:
// - Search products (no 1006 text)
// - Add to Cart with localStorage
// - Cart modal with qty +/-
// - Address Save + Same as Previous / New Address buttons
// - Address mandatory validation
// - Payment gateway (GPay, PhonePe, Paytm, BHIM UPI, Any UPI, COD)
// - Cart NOT empty bug fixed
// - Bill on WhatsApp
// ============================================================================

app.get("/stock", async (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Rahul's General Store - Shop Online</title>
<meta name="description" content="Rahul's General Store Mohone - Online Kirana & General Items, Cart, Home Delivery, UPI Payment, Bill on WhatsApp">

<style>
/* =========================================================================
   GENERAL STYLES
   ========================================================================= */

*{
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  background: #f5f5f5;
  padding-bottom: 100px;
  color: #333;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a{
  text-decoration: none;
  color: inherit;
}

/* =========================================================================
   HEADER
   ========================================================================= */

.header{
  background: #075e54;
  color: #fff;
  padding: 16px 16px;
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 12px rgba(0,0,0,0.12);
}

.header h1{
  font-size: 17px;
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: -0.2px;
}

.cart-btn{
  background: #fff;
  color: #075e54;
  border: none;
  padding: 11px 20px;
  border-radius: 25px;
  font-weight: 700;
  cursor: pointer;
  font-size: 14px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.cart-btn:active{
  transform: scale(0.94);
}

/* =========================================================================
   SEARCH BOX
   ========================================================================= */

.search-box{
  padding: 14px 12px;
  background: #fff;
  position: sticky;
  top: 62px;
  z-index: 90;
  box-shadow: 0 2px 10px rgba(0,0,0,0.06);
  border-bottom: 1px solid #eee;
}

.search-box input{
  width: 100%;
  padding: 15px 16px;
  border: 1.8px solid #ddd;
  border-radius: 12px;
  font-size: 16px;
  outline: none;
  transition: all 0.2s;
  background: #fafafa;
}

.search-box input:focus{
  border-color: #075e54;
  background: #f0fffa;
  box-shadow: 0 0 0 3px rgba(7, 94, 84, 0.1);
}

.search-box input::placeholder{
  color: #999;
}

/* =========================================================================
   PRODUCTS GRID
   ========================================================================= */

.products{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px;
}

@media(min-width: 768px){
  .products{
    grid-template-columns: 1fr 1fr 1fr 1fr;
    padding: 18px;
    gap: 16px;
    max-width: 1200px;
    margin: 0 auto;
  }
}

.card{
  background: #fff;
  border-radius: 14px;
  padding: 14px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.06);
  display: flex;
  flex-direction: column;
  transition: all 0.25s;
  border: 1px solid #f0f0f0;
}

.card:hover{
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.1);
  border-color: #e0e0e0;
}

.card h3{
  font-size: 13.5px;
  margin: 0 0 8px 0;
  height: 40px;
  overflow: hidden;
  line-height: 1.4;
  color: #222;
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.card .price{
  color: #075e54;
  font-weight: 800;
  font-size: 17px;
  margin: 8px 0 10px 0;
  letter-spacing: -0.3px;
}

.card button{
  width: 100%;
  background: #25d366;
  color: #fff;
  border: none;
  padding: 11px;
  border-radius: 10px;
  font-weight: 700;
  cursor: pointer;
  margin-top: auto;
  font-size: 13px;
  transition: all 0.2s;
  letter-spacing: 0.2px;
}

.card button.added{
  background: #888;
}

.card button:active{
  transform: scale(0.96);
}

/* =========================================================================
   CART MODAL
   ========================================================================= */

.cart-modal{
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.68);
  z-index: 200;
  overflow: auto;
  padding: 12px;
  backdrop-filter: blur(2px);
}

.cart-content{
  background: #fff;
  width: 100%;
  max-width: 560px;
  margin: 20px auto;
  border-radius: 20px;
  padding: 24px;
  max-height: 90vh;
  overflow: auto;
  box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  animation: modalSlide 0.3s ease;
}

@keyframes modalSlide{
  from{opacity:0; transform: translateY(20px);}
  to{opacity:1; transform: translateY(0);}
}

.cart-content h2{
  margin-top: 0;
  font-size: 22px;
  margin-bottom: 12px;
  font-weight: 800;
  color: #111;
}

.close-x{
  float: right;
  cursor: pointer;
  font-size: 28px;
  color: #666;
  line-height: 1;
  padding: 0 4px;
  transition: 0.2s;
}

.close-x:hover{
  color: #000;
}

.cart-item{
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 14px;
  gap: 12px;
}

.cart-item b{
  font-size: 13.5px;
  color: #222;
}

.cart-item small{
  color: #666;
  font-size: 12px;
}

.qty-controls{
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.qty-btn{
  background: #f0f0f0;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  font-weight: 800;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  color: #333;
}

.qty-btn:hover{
  background: #e0e0e0;
}

.qty-btn:active{
  transform: scale(0.88);
}

/* =========================================================================
   FORM GROUPS - ADDRESS
   ========================================================================= */

.form-group{
  margin: 16px 0;
}

.form-group label{
  font-weight: 700;
  font-size: 13px;
  display: block;
  margin-bottom: 6px;
  color: #333;
  letter-spacing: 0.1px;
}

.form-group input,
.form-group textarea{
  width: 100%;
  padding: 13px 14px;
  border: 1.8px solid #ccc;
  border-radius: 12px;
  font-size: 14px;
  outline: none;
  transition: all 0.2s;
  background: #fff;
  font-family: inherit;
}

.form-group input:focus,
.form-group textarea:focus{
  border-color: #075e54;
  background: #f0fffa;
  box-shadow: 0 0 0 3px rgba(7, 94, 84, 0.08);
}

.form-group input.error,
.form-group textarea.error{
  border-color: #e74c3c;
  background: #fff5f5;
}

.form-group textarea{
  resize: vertical;
  min-height: 80px;
}

.error-msg{
  color: #e74c3c;
  font-size: 11.5px;
  display: none;
  margin-top: 5px;
  font-weight: 500;
}

/* =========================================================================
   SAVED ADDRESS BOX - NEW FEATURE
   ========================================================================= */

.saved-address-box{
  background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%);
  border: 1.5px solid #4caf50;
  border-radius: 14px;
  padding: 14px;
  margin: 18px 0;
  display: none;
  animation: slideDown 0.35s ease;
}

@keyframes slideDown{
  from{opacity:0; transform:translateY(-12px);}
  to{opacity:1; transform:translateY(0);}
}

.saved-address-box b{
  color: #2e7d32;
  font-size: 14px;
}

.saved-address-box p{
  margin: 8px 0;
  font-size: 13px;
  line-height: 1.5;
  color: #333;
}

.addr-btn-row{
  display: flex;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.addr-btn{
  padding: 11px 18px;
  border-radius: 25px;
  border: none;
  font-weight: 700;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  flex: 1;
  min-width: 140px;
}

.addr-btn.use-old{
  background: #075e54;
  color: #fff;
  box-shadow: 0 2px 8px rgba(7, 94, 84, 0.25);
}

.addr-btn.use-new{
  background: #fff;
  color: #075e54;
  border: 1.8px solid #075e54;
}

.addr-btn:active{
  transform: scale(0.95);
}

/* =========================================================================
   PAYMENT SECTION
   ========================================================================= */

.pay-section{
  border: 2px dashed #075e54;
  padding: 18px;
  border-radius: 16px;
  margin-top: 22px;
  background: linear-gradient(135deg, #f0fff4 0%, #e8f5e9 100%);
}

.pay-section h3{
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 800;
}

.pay-btn{
  width: 100%;
  background: #075e54;
  color: #fff;
  padding: 15px;
  border: none;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 700;
  margin-top: 12px;
  cursor: pointer;
  transition: all 0.2s;
  letter-spacing: 0.2px;
  box-shadow: 0 2px 10px rgba(7, 94, 84, 0.2);
}

.pay-btn:hover{
  background: #064e45;
  transform: translateY(-1px);
}

.pay-btn:active{
  transform: scale(0.97);
}

.pay-btn:disabled{
  background: #ccc;
  cursor: not-allowed;
  box-shadow: none;
}

.upi-grid{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 14px;
}

.upi-btn{
  padding: 16px 10px;
  border: 1.8px solid #ddd;
  border-radius: 14px;
  background: #fff;
  cursor: pointer;
  font-weight: 700;
  text-align: center;
  font-size: 14px;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #333;
}

.upi-btn span{
  font-size: 22px;
}

.upi-btn:hover{
  border-color: #075e54;
  background: #f0fff4;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.upi-btn:active{
  transform: scale(0.96);
}

.cod-btn{
  background: #2c3e50 !important;
}

.cod-btn:hover{
  background: #1a252f !important;
}

.total-box{
  text-align: right;
  font-size: 19px;
  font-weight: 800;
  color: #075e54;
  margin: 18px 0;
  background: #f0fff4;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid #c8e6c9;
  letter-spacing: -0.3px;
}

.bill-box{
  background: #f9f9f9;
  padding: 14px;
  border-radius: 12px;
  text-align: left;
  font-size: 13px;
  border: 1px solid #eee;
  margin-top: 14px;
  white-space: pre-wrap;
  line-height: 1.6;
  font-family: 'Courier New', monospace;
  max-height: 300px;
  overflow: auto;
}

.order-status{
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: 14px;
  margin-top: 18px;
  text-align: center;
  padding: 14px;
  border-radius: 12px;
}

.post-order-actions{
  display: none;
  margin-top: 18px;
  text-align: center;
  padding-top: 16px;
  border-top: 1px solid #eee;
}
</style>
</head>

<body>

<!-- HEADER -->
<div class="header">
  <h1>🏪 Rahul's General Store</h1>
  <button class="cart-btn" onclick="openCart()">🛒 Cart (<span id="cartCount">0</span>)</button>
</div>

<!-- SEARCH BAR -->
<div class="search-box">
  <input id="search" placeholder="Search products..." oninput="loadProducts(this.value)" autocomplete="off" spellcheck="false">
</div>

<!-- PRODUCTS GRID -->
<div id="products" class="products">Loading products... Please wait</div>

<!-- CART MODAL -->
<div id="cartModal" class="cart-modal">
  <div class="cart-content">
    
    <h2>Your Cart <span class="close-x" onclick="closeCart()">✕</span></h2>
    
    <div id="cartItems">
      <p style='text-align:center; padding:20px; color:#888'>Cart empty. Add products from shop.</p>
    </div>
    
    <div class="total-box" id="total" style="display:none"></div>
    
    <hr style="margin:18px 0; border:none; border-top:1px solid #eee">
    
    <!-- SAVED ADDRESS BOX - Shows if address saved before -->
    <div id="savedAddressBox" class="saved-address-box">
      <b>📍 Saved Address Found:</b>
      <p id="savedAddrText">Loading saved address...</p>
      <div class="addr-btn-row">
        <button class="addr-btn use-old" onclick="useOldAddress()">✅ Use Same as Previous</button>
        <button class="addr-btn use-new" onclick="useNewAddress()">✏️ New Address</button>
      </div>
    </div>
    
    <!-- ADDRESS FORM SECTION -->
    <div id="addressSection">
      <h3 style="font-size:16px; margin-bottom:4px">📍 Delivery Address *Mandatory</h3>
      <p style="font-size:11px; color:#e74c3c; margin-bottom:14px">Without address we cannot deliver - All fields required</p>
      
      <div class="form-group">
        <label>Full Name *</label>
        <input id="cName" placeholder="Your full name" autocomplete="name">
        <div class="error-msg" id="errName">Full name is required (min 2 chars)</div>
      </div>
      
      <div class="form-group">
        <label>WhatsApp Number *</label>
        <input id="cPhone" placeholder="10 digit WhatsApp number" type="tel" inputmode="numeric" autocomplete="tel">
        <div class="error-msg" id="errPhone">Valid 10 digit WhatsApp number required</div>
      </div>
      
      <div class="form-group">
        <label>Full Address *</label>
        <textarea id="cAddress" rows="3" placeholder="House No, Building, Area, Mohone, Kalyan" autocomplete="street-address"></textarea>
        <div class="error-msg" id="errAddress">Full address required (min 10 chars) - Without address no delivery</div>
      </div>
      
      <div class="form-group">
        <label>Pincode *</label>
        <input id="cPincode" placeholder="421102" type="tel" inputmode="numeric" autocomplete="postal-code">
        <div class="error-msg" id="errPincode">Valid 6 digit pincode required</div>
      </div>
      
      <button class="pay-btn" id="validateBtn" onclick="validateAndShowPay()">Validate Address & Proceed to Payment →</button>
    </div>
    
    <!-- PAYMENT SECTION - FIXED CART EMPTY BUG -->
    <div class="pay-section" id="paySection" style="display:none">
      <h3>💳 Choose Payment Method</h3>
      <p style="font-size:12px; color:#27ae60; margin:6px 0 12px 0; font-weight:600">✓ Address verified - Your cart is safe, it will NOT become empty when you click payment</p>
      
      <div class="upi-grid">
        <div class="upi-btn" onclick="payWithUPI('Google Pay')"><span>📱</span>Google Pay</div>
        <div class="upi-btn" onclick="payWithUPI('PhonePe')"><span>📱</span>PhonePe</div>
        <div class="upi-btn" onclick="payWithUPI('Paytm')"><span>📱</span>Paytm</div>
        <div class="upi-btn" onclick="payWithUPI('BHIM UPI')"><span>🏦</span>BHIM UPI</div>
      </div>
      
      <button class="pay-btn" style="background:#ff6b00" onclick="payWithUPI('Any UPI')">💳 Pay via Any UPI App</button>
      <button class="pay-btn cod-btn" onclick="payWithUPI('Cash on Delivery')">💵 Cash on Delivery (COD)</button>
      
      <p style="font-size:11px; color:#666; text-align:center; margin-top:10px">Clicking UPI will open your UPI app with amount pre-filled</p>
    </div>
    
    <!-- ORDER STATUS - Bill will show here -->
    <div id="orderStatus" class="order-status"></div>
    
    <!-- POST ORDER ACTIONS - Clear Cart Button -->
    <div id="postOrderActions" class="post-order-actions">
      <button class="pay-btn" style="background:#27ae60" onclick="clearCartAndContinue()">🛒 Clear Cart & Continue Shopping</button>
      <button class="pay-btn" style="background:#888; box-shadow:none" onclick="closeCart()">Close</button>
    </div>
    
  </div>
</div>

<script>
// ============================================================================
// JAVASCRIPT - CART, ADDRESS SAVE, PAYMENT FIX - 950 LINES VERSION
// ============================================================================

// Global variables
let allProducts = [];
let cart = [];
let currentTotal = 0;
let isOrderPlaced = false;

// ============================================================================
// CART LOAD & SAVE - ROBUST VERSION - Fixes empty bug
// ============================================================================

function loadCartFromStorage(){
  try {
    // Try multiple keys for compatibility
    let s1 = localStorage.getItem('dukandaar_cart');
    let s2 = localStorage.getItem('cart');
    let s3 = localStorage.getItem('dukandaar_cart_backup');
    
    if(s1 && JSON.parse(s1).length > 0){
      cart = JSON.parse(s1);
    } else if(s2 && JSON.parse(s2).length > 0){
      cart = JSON.parse(s2);
    } else if(s3 && JSON.parse(s3).length > 0){
      cart = JSON.parse(s3);
    } else {
      cart = [];
    }
    
    console.log("Cart loaded from storage:", cart.length, "items");
  } catch(e){
    console.log("Cart load error:", e.message);
    cart = [];
  }
}

function saveCart(){
  try {
    let cartStr = JSON.stringify(cart);
    localStorage.setItem('dukandaar_cart', cartStr);
    localStorage.setItem('cart', cartStr);
    localStorage.setItem('dukandaar_cart_backup', cartStr);
    console.log("Cart saved:", cart.length, "items");
  } catch(e){
    console.log("Cart save error:", e.message);
  }
}

// Initial load
loadCartFromStorage();

// ============================================================================
// LOAD PRODUCTS
// ============================================================================

async function loadProducts(search="") {
  try {
    let url = "/api/products" + (search ? "?search=" + encodeURIComponent(search) : "");
    let res = await fetch(url);
    
    if(!res.ok) throw new Error("Network error");
    
    allProducts = await res.json();
    
    let html = "";
    
    allProducts.forEach(p=>{
      let name = p.name || p.product_name || "Product";
      let price = p.price || 0;
      let id = p.id;
      let inCart = cart.find(c=>c.id==id);
      let btnText = inCart ? 'Added ✓ ('+inCart.qty+')' : 'Add to Cart';
      let btnClass = inCart ? 'added' : '';
      
      html += \`<div class="card">
        <h3>\${name}</h3>
        <div class="price">Rs \${price}</div>
        <button onclick="addToCart(\${id})" class="\${btnClass}">\${btnText}</button>
      </div>\`;
    });
    
    if(allProducts.length==0) {
      html = "<div style='grid-column:1/-1; text-align:center; padding:30px; color:#888'><p>No products found for '<b>"+search+"</b>'</p><p>Try searching with different words</p></div>";
    }
    
    document.getElementById('products').innerHTML = html;
    updateCartCount();
  } catch(e){
    console.log("loadProducts error:", e.message);
    document.getElementById('products').innerHTML = "<p style='padding:20px; text-align:center; color:#e74c3c'>Error loading products. Please refresh page.</p>";
  }
}

// ============================================================================
// ADD TO CART
// ============================================================================

function addToCart(id) {
  // Reload cart before adding - fixes empty bug
  loadCartFromStorage();
  
  let prod = allProducts.find(p=>p.id==id);
  if(!prod){
    alert("Product not loaded yet, please wait or refresh page");
    return;
  }
  
  let item = cart.find(c=>c.id==id);
  if(item){
    item.qty++;
  } else {
    cart.push({
      id: prod.id,
      name: (prod.name || prod.product_name),
      price: prod.price,
      qty: 1
    });
  }
  
  saveCart();
  loadProducts(document.getElementById('search').value);
  updateCartCount();
  
  // Haptic feedback
  if(navigator.vibrate) navigator.vibrate(50);
  
  console.log("Added to cart, total items now:", cart.length);
}

// ============================================================================
// UPDATE CART COUNT BADGE
// ============================================================================

function updateCartCount(){
  let totalQty = cart.reduce((s,c)=>s+c.qty,0);
  document.getElementById('cartCount').innerText = totalQty;
}

// ============================================================================
// OPEN / CLOSE CART MODAL
// ============================================================================

function openCart(){
  // Reload cart every time cart opens - FIXES empty bug
  loadCartFromStorage();
  
  // Check saved address
  checkSavedAddress();
  
  // Render cart
  renderCart();
  
  // Show modal
  document.getElementById('cartModal').style.display='block';
  document.body.style.overflow='hidden';
  
  // Reset post order UI if not yet ordered
  if(!isOrderPlaced){
    document.getElementById('postOrderActions').style.display='none';
    document.getElementById('addressSection').style.display='block';
    document.getElementById('paySection').style.display='none';
    document.getElementById('validateBtn').style.display='block';
    document.getElementById('orderStatus').innerHTML='';
    
    // Make address fields editable
    document.getElementById('addressSection').querySelectorAll('input, textarea').forEach(e=>{
      e.removeAttribute('readonly');
    });
  }
  
  console.log("Cart opened, items:", cart.length);
}

function closeCart(){
  document.getElementById('cartModal').style.display='none';
  document.body.style.overflow='auto';
  
  if(isOrderPlaced){
    // Reset flag after closing after order
    isOrderPlaced = false;
  }
}

// ============================================================================
// RENDER CART ITEMS
// ============================================================================

function renderCart(){
  if(cart.length==0){
    document.getElementById('cartItems').innerHTML="<p style='text-align:center; padding:20px; color:#888'>Cart empty.<br>Add products from shop.</p>";
    document.getElementById('total').innerHTML="";
    document.getElementById('total').style.display='none';
    currentTotal=0;
    return;
  }
  
  let html=""; 
  let total=0;
  
  cart.forEach((c,i)=>{
    total+=c.price*c.qty;
    html+= \`<div class="cart-item">
      <div style="flex:1">
        <b>\${c.name}</b><br>
        <small>Rs \${c.price} x \${c.qty} = <b>Rs \${c.price*c.qty}</b></small>
      </div>
      <div class="qty-controls">
        <button class="qty-btn" onclick="changeQty(\${i},-1)">−</button>
        <b style="min-width:22px; text-align:center">\${c.qty}</b>
        <button class="qty-btn" onclick="changeQty(\${i},1)">+</button>
      </div>
    </div>\`;
  });
  
  document.getElementById('cartItems').innerHTML=html;
  document.getElementById('total').style.display='block';
  document.getElementById('total').innerText="Total: Rs "+total;
  currentTotal=total;
}

// ============================================================================
// CHANGE QTY
// ============================================================================

function changeQty(i,delta){
  if(isOrderPlaced){
    // Don't allow change after order placed
    return;
  }
  
  cart[i].qty+=delta;
  if(cart[i].qty<=0){
    cart.splice(i,1);
  }
  
  saveCart();
  renderCart();
  updateCartCount();
  loadProducts(document.getElementById('search').value);
}

// ============================================================================
// ADDRESS SAVE FEATURE
// ============================================================================

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
        
        // Pre-fill form
        document.getElementById('cName').value = cust.name || "";
        document.getElementById('cPhone').value = cust.phone || "";
        document.getElementById('cAddress').value = cust.address || "";
        document.getElementById('cPincode').value = cust.pincode || "";
        
        console.log("Saved address found and pre-filled:", cust.name);
        return;
      }
    } catch(e){
      console.log("Saved address parse error");
    }
  }
  
  box.style.display='none';
}

function useOldAddress(){
  let saved = localStorage.getItem('saved_customer');
  if(!saved) return;
  
  try {
    let cust = JSON.parse(saved);
    document.getElementById('cName').value=cust.name;
    document.getElementById('cPhone').value=cust.phone;
    document.getElementById('cAddress').value=cust.address;
    document.getElementById('cPincode').value=cust.pincode;
    document.getElementById('savedAddressBox').style.display='none';
    
    console.log("Using old address:", cust.name);
    
    // Auto validate
    validateAndShowPay();
  } catch(e){
    console.log("useOldAddress error");
  }
}

function useNewAddress(){
  document.getElementById('cName').value="";
  document.getElementById('cPhone').value="";
  document.getElementById('cAddress').value="";
  document.getElementById('cPincode').value="";
  document.getElementById('savedAddressBox').style.display='none';
  document.getElementById('cName').focus();
  
  console.log("New address selected - form cleared");
}

// ============================================================================
// VALIDATE ADDRESS - Blocks payment if empty
// ============================================================================

function validateAndShowPay(){
  // Reset errors
  document.querySelectorAll('.error-msg').forEach(e=>e.style.display='none');
  document.querySelectorAll('#cartModal input, #cartModal textarea').forEach(e=>e.classList.remove('error'));
  
  let name=document.getElementById('cName').value.trim();
  let phone=document.getElementById('cPhone').value.trim();
  let address=document.getElementById('cAddress').value.trim();
  let pincode=document.getElementById('cPincode').value.trim();
  
  let valid=true;
  
  if(!name || name.length<2){
    document.getElementById('errName').style.display='block';
    document.getElementById('cName').classList.add('error');
    valid=false;
  }
  if(!phone || phone.length<10 || isNaN(phone)){
    document.getElementById('errPhone').style.display='block';
    document.getElementById('cPhone').classList.add('error');
    valid=false;
  }
  if(!address || address.length<10){
    document.getElementById('errAddress').style.display='block';
    document.getElementById('cAddress').classList.add('error');
    valid=false;
  }
  if(!pincode || pincode.length<6 || isNaN(pincode)){
    document.getElementById('errPincode').style.display='block';
    document.getElementById('cPincode').classList.add('error');
    valid=false;
  }
  
  if(!valid){
    document.getElementById('orderStatus').innerHTML="<div style='color:#e74c3c; background:#ffeaea; padding:10px; border-radius:8px'>⚠️ Without address we cannot deliver! Please fill all fields correctly.</div>";
    console.log("Address validation failed");
    return; // STOP - Will not go to payment
  }
  
  if(cart.length==0){
    document.getElementById('orderStatus').innerHTML="<div style='color:#e74c3c; background:#ffeaea; padding:10px; border-radius:8px'>Cart empty! Add products first.</div>";
    return;
  }
  
  // SAVE ADDRESS for next time
  localStorage.setItem('saved_customer', JSON.stringify({name, phone, address, pincode}));
  console.log("Address validated and saved:", name);
  
  // Show payment gateway - IMPORTANT: Do NOT clear cart here
  document.getElementById('paySection').style.display='block';
  document.getElementById('validateBtn').style.display='none';
  document.getElementById('savedAddressBox').style.display='none';
  
  // Make address readonly after validation
  document.getElementById('addressSection').querySelectorAll('input, textarea').forEach(e=>{
    e.setAttribute('readonly','readonly');
  });
  
  document.getElementById('orderStatus').innerHTML="<div style='color:#27ae60; background:#e8f5e9; padding:10px; border-radius:8px'>✓ Address saved & locked! Your cart is safe - it will NOT become empty when you click payment. Now choose payment method below.</div>";
}

// ============================================================================
// PAY WITH UPI - FIXED CART EMPTY BUG
// Cart stays visible, not empty, after clicking payment
// ============================================================================

async function payWithUPI(mode){
  let name=document.getElementById('cName').value.trim();
  let phone=document.getElementById('cPhone').value.trim();
  let address=document.getElementById('cAddress').value.trim();
  let pincode=document.getElementById('cPincode').value.trim();
  let total=currentTotal||cart.reduce((s,c)=>s+c.price*c.qty,0);
  
  if(cart.length==0){
    document.getElementById('orderStatus').innerHTML="<div style='color:#e74c3c; background:#ffeaea; padding:10px; border-radius:8px'>Cart is empty! Add products again.</div>";
    return;
  }
  
  // Keep cart backup - IMPORTANT
  let cartBackup=[...cart];
  console.log("Payment clicked:", mode, "cart backup items:", cartBackup.length, "total:", total);
  
  document.getElementById('orderStatus').innerHTML="<div style='color:#333; background:#fff3cd; padding:10px; border-radius:8px'>Placing order with "+mode+"... Please wait, your cart is safe and will NOT become empty</div>";
  
  try {
    let res=await fetch('/api/order',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        cart: cartBackup,
        customer: {name, phone, address, pincode, paymentMode: mode},
        total: total
      })
    });
    
    let data=await res.json();
    
    if(data.success){
      isOrderPlaced = true;
      let billHtml=data.bill.replace(/\\n/g,'<br>');
      
      let resultHtml = "";
      
      if(mode=='Cash on Delivery'){
        resultHtml = "✅ <b>COD Order Placed Successfully!</b> Bill sent on WhatsApp to "+phone+"<br><div class='bill-box'>"+billHtml+"</div>";
      } else {
        // UPI Payment
        let upiId="rahul.jha.39395033@okaxis";
        let upiLink=\`upi://pay?pa=\${upiId}&pn=Rahul%20Store%20Mohone&am=\${total}&cu=INR&tn=Order_\${data.orderId}_\${name}\`;
        
        resultHtml = "✅ <b>Order Placed! Bill sent on WhatsApp</b><br><div class='bill-box'>"+billHtml+"</div><br><a href='"+upiLink+"' style='background:#25d366; color:#fff; padding:15px 28px; border-radius:14px; text-decoration:none; display:block; font-weight:700; text-align:center; font-size:16px; margin-top:12px'>Pay Rs "+total+" via "+mode+" - CLICK TO PAY</a><p style='font-size:11px; color:#666; text-align:center; margin-top:8px'>UPI ID: "+upiId+"<br>Order: #"+data.orderId+"<br>If app doesn't open, pay manually and share screenshot on WhatsApp</p>";
        
        // Auto open UPI app after 1.3 sec
        setTimeout(()=>{
          try{
            window.location.href=upiLink;
          }catch(e){
            console.log("UPI auto open failed");
          }
        }, 1300);
      }
      
      document.getElementById('orderStatus').innerHTML = resultHtml;
      document.getElementById('postOrderActions').style.display='block';
      
      // Keep cart visible - show paid total - DO NOT CLEAR YET
      document.getElementById('total').style.display='block';
      document.getElementById('total').innerHTML = "Paid Total: Rs "+total+" - Order #"+data.orderId+" - Cart safe ✓";
      document.getElementById('total').style.background="#e8f5e9";
      
      console.log("Order success, cart kept visible, not cleared yet");
      
    } else {
      document.getElementById('orderStatus').innerHTML="<div style='color:#e74c3c; background:#ffeaea; padding:10px; border-radius:8px'>❌ "+(data.error||"Order failed - please try again")+"</div>";
    }
  } catch(e){
    console.log("Payment error:", e.message);
    document.getElementById('orderStatus').innerHTML="<div style='color:#e74c3c; background:#ffeaea; padding:10px; border-radius:8px'>❌ Network error - Check internet and try again. Your cart is safe.</div>";
  }
}

// ============================================================================
// CLEAR CART AND CONTINUE - Only called after order success
// ============================================================================

function clearCartAndContinue(){
  cart=[];
  saveCart();
  localStorage.removeItem('dukandaar_cart');
  localStorage.removeItem('cart');
  // Keep backup for safety
  // localStorage.removeItem('dukandaar_cart_backup');
  
  updateCartCount();
  renderCart();
  
  document.getElementById('orderStatus').innerHTML='';
  document.getElementById('postOrderActions').style.display='none';
  document.getElementById('paySection').style.display='none';
  document.getElementById('validateBtn').style.display='block';
  document.getElementById('addressSection').style.display='block';
  document.getElementById('addressSection').querySelectorAll('input, textarea').forEach(e=>{
    e.removeAttribute('readonly');
  });
  
  isOrderPlaced=false;
  
  closeCart();
  loadProducts();
  
  // Success message
  setTimeout(()=> alert("Cart cleared! Thank you for shopping. Continue shopping for more products."), 200);
  
  console.log("Cart cleared by user after order");
}

// ============================================================================
// CLOSE MODAL ON OUTSIDE CLICK
// ============================================================================

document.getElementById('cartModal').addEventListener('click', function(e){
  if(e.target===this){
    closeCart();
  }
});

// ============================================================================
// INITIAL LOAD
// ============================================================================

loadProducts();

console.log("Dukaandaar AI Shop Loaded - Full 950 lines version");
console.log("Features: Clean WhatsApp, Address Save, Cart Fix, UPI, Bill");

</script>
</body>
</html>
  `);
});

// ============================================================================
// WHATSAPP WEBHOOK - CLEAN MESSAGE - NO 1006, NO BULLETS
// ============================================================================

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    
    if (!msg) {
      return res.sendStatus(200);
    }
    
    const from = msg.from;
    
    console.log("WhatsApp message from:", from, "type:", msg.type);
    
    // For ANY message - text, image, Atta, Hi, Hello - send only clean shop link
    // No product search on WhatsApp - only shop page shopping
    
    const shopMsg = `Hello! I hope you are doing well. 😊

Welcome to *Dukaandaar AI* - Rahul's General Store, Mohone.

🛒 *Shop all products here:*
https://dukandaar-ai.onrender.com/stock

Click link above to start shopping!

Have a wonderful day! 🙏✨`;

    await sendWhatsApp(from, shopMsg);
    
    console.log("Clean shop link sent to", from);
    
  } catch (e) {
    console.error("Webhook error:", e.message);
  }
  
  res.sendStatus(200);
});

// Webhook verification for Meta
app.get("/webhook", (req, res) => {
  const verifyToken = "dukandaar123";
  
  if (req.query["hub.verify_token"] === verifyToken) {
    console.log("Webhook verified");
    res.send(req.query["hub.challenge"]);
  } else {
    console.log("Webhook verification failed");
    res.sendStatus(403);
  }
});

// ============================================================================
// START SERVER
// ============================================================================

const PORT = 10000;

app.listen(PORT, () => {
  console.log("========================================");
  console.log("Dukaandaar AI Live on port", PORT);
  console.log("URL: https://dukandaar-ai.onrender.com");
  console.log("Shop: https://dukandaar-ai.onrender.com/stock");
  console.log("Features:");
  console.log("- Clean WhatsApp (No 1006, No Bullets)");
  console.log("- Shop All Products (No number)");
  console.log("- Address Save + Same as Previous / New Address");
  console.log("- Cart Fix - Cart stays on payment click, not empty");
  console.log("- Payment: GPay, PhonePe, Paytm, BHIM UPI, Any UPI, COD");
  console.log("- Bill on WhatsApp");
  console.log("========================================");
});
