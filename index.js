import express from "express";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import Tesseract from "tesseract.js";

const app = express();
app.use(bodyParser.json());

// --- CONFIG ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;

// Keep Render alive - pings itself every 10 mins so free instance never sleeps
setInterval(() => {
  axios.get(`https://dukandaar-ai.onrender.com/`).catch(()=>{});
  console.log("keep-alive ping");
}, 10 * 60 * 1000);

// Hindi + Common Mistakes Dictionary - Balti = Bucket
const DICTIONARY = {
  "balti": "bucket", "bulti": "bucket", "balty": "bucket",
  "jhadu": "broom", "jhaadu": "broom",
  "pocha": "mop", "poncha": "mop",
  "aata": "atta", "atta": "atta",
  "dormat": "doormat", "paidan": "doormat", "dormet": "doormat",
  "lizol": "lizol", "phenyl": "phenyl"
};

// Fuzzy Match - Letter correction for Pigeon Dormat etc
function levenshtein(a, b) {
  const m = []; for(let i=0;i<=b.length;i++) m[i]=[i]; for(let j=0;j<=a.length;j++) m[0][j]=j;
  for(let i=1;i<=b.length;i++) for(let j=1;j<=a.length;j++) m[i][j]= b.charAt(i-1)==a.charAt(j-1)? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
  return m[b.length][a.length];
}

async function findProducts(text) {
  let q = text.toLowerCase().trim();
  q = DICTIONARY[q] || q; // Hindi to English convert

  // 1. Exact search
  let { data } = await supabase.from("products").select("*").ilike("name", `%${q}%`).limit(5);
  if (data && data.length > 0) return data;

  // 2. Fuzzy search if exact not found
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

app.get("/", (req,res)=> res.send("Dukaandaar AI Live - Sell Project - Permanent Token Active"));

// NEW: Stock page link for welcome message
app.get("/stock", async (req,res)=>{
  let { data } = await supabase.from("products").select("name, price").limit(200);
  let html = `<html><head><title>Rahul Store Stock</title></head><body style="font-family:Arial;padding:20px">
  <h1>🏪 Rahul's General Store - Full Stock List</h1>
  <p>Total Products: 1006 | Order on WhatsApp by typing product name</p>
  <hr><ul>`;
  data.forEach(p=> html+= `<li><b>${p.name}</b> - Rs ${p.price}</li>`);
  html+= `</ul><p><i>Showing first 200 products. Search on WhatsApp for full list.</i></p>
  <p>WhatsApp: Send "Balti" or "Bucket" to order</p>
  </body></html>`;
  res.send(html);
});

app.post("/webhook", async (req,res)=>{
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(!msg) return res.sendStatus(200);
    const from = msg.from;
    let userText = msg.text?.body || "";

    // FEATURE: Screenshot / Handwritten list reading with OCR
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

    // --- NEW: WELCOME MESSAGE FOR HI / HELLO ---
    const hiWords = ["hi", "hello", "hii", "hey", "hlw", "hlo", "namaste", "namaskar", "good morning", "good evening", "good afternoon", "gm", "helo"];
    if (hiWords.includes(userText.toLowerCase().trim())) {
      const welcomeMsg = `Hello! I hope you are doing well. 😊

Welcome to *Dukaandaar AI* - Your Smart Shopping Assistant from Rahul's General Store, Mohone.

Thank you for reaching out! I am here to help you find anything you need quickly.

🛒 *To get started:*
👉 Click here to view our complete stock list:
https://dukandaar-ai.onrender.com/stock

You can simply type any product name, for example:
• "Bucket" or "Balti"
• "Atta 5kg"
• "Doormat"

Or even send a photo of your handwritten shopping list - I will read it for you!

Let me know what you would like to purchase today. Have a wonderful day! 🙏✨`;

      await sendWhatsApp(from, welcomeMsg);
      return res.sendStatus(200);
    }

    // Handle Order command - e.g. Order 12
    if(userText.toLowerCase().startsWith("order")) {
      const parts = userText.split(" ");
      const prodId = parts[1];
      if(prodId) {
        let { data: prod } = await supabase.from("products").select("*").eq("id", prodId).single();
        if(prod) {
          await supabase.from("orders").insert({ phone: from, product_id: prod.id, product_name: prod.name });
          await sendWhatsApp(from, `✅ Order Confirmed!\n\nProduct: ${prod.name}\nPrice: Rs ${prod.price}\n\nThank you for shopping with us! Your order will be delivered soon. 🙏\nType "Hi" to order more.`);
          return res.sendStatus(200);
        }
      }
    }

    const products = await findProducts(userText);

    if(products.length === 0) {
      // ALWAYS REPLY - Never silent
      await sendWhatsApp(from, `Maaf kijiye, "${userText}" stock me nahi mila. 🙏\nAap 'Bucket', 'Atta 5kg', 'Doormat' try karo.\nYa product ka photo bhejo, mai dhoondh dunga.\n\nFor full list type: Hi and click stock link.`);
      return res.sendStatus(200);
    }

    // Found products - Send list
    let reply = `Ye rahe ${products.length} products "${userText}" ke liye:\n\n`;
    products.forEach((p,i)=> {
      reply += `${i+1}. ${p.name} - Rs ${p.price}\nOrder karne ke liye likho: Order ${p.id}\n\n`;
    });
    await sendWhatsApp(from, reply);

    await supabase.from("messages").insert({ phone: from, query: userText, reply: reply });

  } catch(e) { console.error(e); }
  res.sendStatus(200);
});

app.get("/webhook", (req,res)=>{
  if(req.query["hub.verify_token"] === "dukandaar123") res.send(req.query["hub.challenge"]);
  else res.sendStatus(403);
});

app.listen(10000, ()=> console.log("Live on 10000 - Permanent Token Active"));
