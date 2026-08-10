// DUKANDAAR AI 2.0 - Sell on WhatsApp - Full Fixed Code
// Features: Hindi-English, Fuzzy Search, Image OCR, Always-Reply, Render Keep-Alive
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const Tesseract = require('tesseract.js');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '10mb' }));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "dukandaar123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const PORT = process.env.PORT || 3000;

const HINDI_MAP = {
  "balti": "bucket", "baltis": "bucket", "balty": "bucket",
  "jhadu": "broom", "jhaadu": "broom",
  "aata": "atta", "atta": "atta",
  "tel": "oil", "chini": "sugar", "namak": "salt",
  "dormat": "doormat", "darmat": "doormat", "paaydaan": "doormat",
  "katori": "bowl", "thali": "plate", "chawal": "rice",
  "sabun": "soap", "lizol": "lizol"
};

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i-1) === a.charAt(j-1)) matrix[i][j] = matrix[i-1][j-1];
      else matrix[i][j] = Math.min(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1);
    }
  }
  return matrix[b.length][a.length];
}

function correctAndTranslate(query) {
  let q = query.toLowerCase().trim();
  if (HINDI_MAP[q]) q = HINDI_MAP[q];
  let words = q.split(" ").map(w => HINDI_MAP[w] || w);
  q = words.join(" ");
  return q;
}

async function searchProducts(rawQuery) {
  const cleanQuery = correctAndTranslate(rawQuery);
  console.log(`Original: ${rawQuery} -> Cleaned: ${cleanQuery}`);
  let { data: products } = await supabase.from('products').select('*').ilike('name', `%${cleanQuery}%`).limit(10);
  if (products && products.length > 0) return products;
  const { data: allProducts } = await supabase.from('products').select('*').limit(200);
  let scored = [];
  if (allProducts) {
    for (let p of allProducts) {
      const dist = levenshtein(cleanQuery.toLowerCase(), p.name.toLowerCase().substring(0, cleanQuery.length + 5));
      if (p.name.toLowerCase().includes(cleanQuery.toLowerCase().split(" ")[0]) || dist <= 2) {
        scored.push({ product: p, score: dist });
      }
    }
    scored.sort((a,b) => a.score - b.score);
    return scored.slice(0,3).map(s => s.product);
  }
  return [];
}

async function sendWhatsApp(to, text, buttons = null) {
  try {
    let payload;
    if (buttons) {
      payload = { messaging_product: "whatsapp", to: to, type: "interactive", interactive: { type: "button", body: { text: text }, action: { buttons: buttons } } };
    } else {
      payload = { messaging_product: "whatsapp", to: to, type: "text", text: { body: text } };
    }
    await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, payload, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
  } catch (e) { console.error("Send Error:", e.response?.data || e.message); }
}

async function handleImageMessage(imageId, from) {
  try {
    await sendWhatsApp(from, "Photo mil gaya! Pad raha hu... 2 sec 📸");
    const mediaInfo = await axios.get(`https://graph.facebook.com/v19.0/${imageId}`, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
    const imageUrl = mediaInfo.data.url;
    const imageRes = await axios.get(imageUrl, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, responseType: 'arraybuffer' });
    const tempPath = `/tmp/${imageId}.jpg`;
    fs.writeFileSync(tempPath, imageRes.data);
    const { data: { text } } = await Tesseract.recognize(tempPath, 'eng+hin');
    console.log("OCR Text:", text);
    try { fs.unlinkSync(tempPath); } catch(e){}
    if (!text || text.trim().length < 2) { await sendWhatsApp(from, "Photo saaf nahi hai. Product naam likh ke bhejo jaise 'Bucket'"); return; }
    await sendWhatsApp(from, `Aapne ye likha hai photo me: "${text.substring(0,200)}"\n\nIsme se dhoondh raha hu...`);
    const firstQuery = text.split('\n')[0].trim();
    const products = await searchProducts(firstQuery);
    await handleProductReply(from, products, firstQuery);
  } catch (err) { console.error("Image error", err); await sendWhatsApp(from, "Photo padhne me problem hui. Seedha naam likh ke bhejo - jaise 'Bucket'"); }
}

async function handleProductReply(from, products, query) {
  if (!products || products.length === 0) {
    await sendWhatsApp(from, `Maaf kijiye, "${query}" abhi stock me nahi mila. 🙏\n\nAap ye try karo: Bucket, Lizol, Pigeon Doormat, Aata 5kg, Broom\nYa product ka photo bhejo, me dhoondh dunga!`);
    return;
  }
  let text = `Ye raha "${query}" ke liye:\n\n`;
  let buttons = [];
  products.slice(0,3).forEach((p,i) => {
    text += `${i+1}. ${p.name} - Rs.${p.price}\n`;
    buttons.push({ type: "reply", reply: { id: `ORDER_${p.id}`, title: `Order ${i+1}` } });
  });
  text += `\nBatao kaunsa order karna hai? Click button`;
  if (buttons.length > 0) await sendWhatsApp(from, text, buttons); else await sendWhatsApp(from, text);
}

app.get('/webhook', (req,res) => { if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']); else res.sendStatus(403); });
app.post('/webhook', async (req,res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0]; const change = entry?.changes?.[0]; const value = change?.value; const message = value?.messages?.[0];
    if (!message) return;
    const from = message.from; const type = message.type;
    await supabase.from('messages').insert([{ phone: from, type: type, raw: message, created_at: new Date() }]);
    if (type === 'text') { const q = message.text.body; const products = await searchProducts(q); await handleProductReply(from, products, q); }
    else if (type === 'image') { await handleImageMessage(message.image.id, from); }
    else if (type === 'interactive') {
      const buttonId = message.interactive.button_reply.id;
      if (buttonId.startsWith('ORDER_')) {
        const productId = buttonId.replace('ORDER_','');
        const { data: prod } = await supabase.from('products').select('*').eq('id', productId).single();
        const orderId = `ORD-${Date.now()}`;
        await supabase.from('orders').insert([{ order_id: orderId, phone: from, product_id: productId, product_name: prod?.name || 'Unknown', status: 'confirmed', created_at: new Date() }]);
        await sendWhatsApp(from, `Order Confirmed! Rahul Jha ji, aapne ${prod?.name} - order kiya.\n\nTotal Bill ban raha hai... Mohone shop se delivery 1 ghante me hogi. Cash on Delivery available!\n\nOrder ID: ${orderId}`);
      }
    }
  } catch (e) { console.error("Webhook error", e); }
});

app.get('/', (req,res) => res.send('Dukandaar AI 2.0 is LIVE - Hindi+English+Photo OCR'));
app.get('/ping', (req,res) => res.send('pong '+ new Date().toISOString()));
app.listen(PORT, () => console.log(`Server LIVE on ${PORT}`));
