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

// Keep Render alive - pings itself every 10 mins
setInterval(() => {
  axios.get(https://dukandaar-ai.onrender.com/).catch(()=>{});
  console.log("keep-alive ping");
}, 10 * 60 * 1000);

// Hindi + Common mistakes dictionary
const DICTIONARY = {
  "balti": "bucket", "bulti": "bucket", "balty": "bucket",
  "jhadu": "broom", "jhaadu": "broom",
  "pocha": "mop", "poncha": "mop",
  "aata": "atta", "atta": "atta",
  "dormat": "doormat", "paidan": "doormat",
  "lizol": "lizol", "phenyl": "phenyl"
};

// Fuzzy match - Letter correction
function levenshtein(a, b) {
  const m = []; for(let i=0;i<=b.length;i++) m[i]=[i]; for(let j=0;j<=a.length;j++) m[0][j]=j;
  for(let i=1;i<=b.length;i++) for(let j=1;j<=a.length;j++) m[i][j]= b.charAt(i-1)==a.charAt(j-1)? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
  return m[b.length][a.length];
}

async function findProducts(text) {
  let q = text.toLowerCase().trim();
  q = DICTIONARY[q] || q; // Hindi to English

  // 1. Exact search
  let { data } = await supabase.from("products").select("*").ilike("name", %${q}%).limit(5);
  if (data && data.length > 0) return data;

  // 2. Fuzzy search if not found
  let { data: all } = await supabase.from("products").select("*").limit(1000);
  let best = [];
  for(let p of all) {
    let dist = levenshtein(q, p.name.toLowerCase().substring(0, q.length+2));
    if(dist <= 2 || p.name.toLowerCase().includes(q)) best.push(p);
  }
  return best.slice(0,5);
}

async function sendWhatsApp(to, text) {
  await axios.post(https://graph.facebook.com/v20.0/${PHONE_ID}/messages, {
    messaging_product: "whatsapp", to: to, text: { body: text }
  }, { headers: { Authorization: Bearer ${WHATSAPP_TOKEN} } });
}

app.get("/", (req,res)=> res.send("Dukaandaar AI Live - Sell Project"));

app.post("/webhook", async (req,res)=>{
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(!msg) return res.sendStatus(200);
    const from = msg.from;
    let userText = msg.text?.body || "";

    // --- FEATURE: Screenshot / Handwritten page reading ---
    if(msg.type === "image") {
      const mediaId = msg.image.id;
      // Get image URL from Meta
      const mediaUrlRes = await axios.get(https://graph.facebook.com/v20.0/${mediaId}, { headers: { Authorization: Bearer ${WHATSAPP_TOKEN} } });
      const imageUrl = mediaUrlRes.data.url;
      const imageBin = await axios.get(imageUrl, { headers: { Authorization: Bearer ${WHATSAPP_TOKEN} }, responseType: 'arraybuffer' });
      // OCR
      const { data: { text } } = await Tesseract.recognize(Buffer.from(imageBin.data), 'eng+hin');
      userText = text; // OCR text becomes search query
      await sendWhatsApp(from, Photo samajh gaya! Aapne likha hai: "${text.substring(0,100)}"\nAb products dhoondh raha hu...);
    }

    if(!userText) return res.sendStatus(200);

    const products = await findProducts(userText);

    if(products.length === 0) {
      // ALWAYS REPLY - Bug fixed
      await sendWhatsApp(from, Maaf kijiye, "${userText}" stock me nahi mila. 🙏\nAap 'Bucket', 'Atta 5kg', 'Doormat' try karo.\nYa product ka photo bhejo, mai dhoondh dunga.);
      return res.sendStatus(200);
    }

    // Found - Send list with Order button text
    let reply = Ye rahe ${products.length} products "${userText}" ke liye:\n\n;
    products.forEach((p,i)=> {
      reply += ${i+1}. ${p.name} - Rs ${p.price}\nOrder karne ke liye likho: Order ${p.id}\n\n;
    });
    await sendWhatsApp(from, reply);

    // Save to messages table
    await supabase.from("messages").insert({ phone: from, query: userText, reply: reply });

  } catch(e) { console.error(e); }
  res.sendStatus(200);
});

app.get("/webhook", (req,res)=>{
  if(req.query["hub.verify_token"] === "dukandaar123") res.send(req.query["hub.challenge"]);
  else res.sendStatus(403);
});

app.listen(10000, ()=> console.log("Live on 10000"));
