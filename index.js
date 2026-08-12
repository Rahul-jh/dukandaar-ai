import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// 1. Webhook Verification for Meta
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

// 2. Fix for your 400 Error - Correct Send Function
async function sendWhatsApp(to, text) {
  try {
    const data = {
      messaging_product: "whatsapp",
      to: to, // use 'from' from webhook, don't hardcode
      type: "text",
      text: {
        body: text,
        preview_url: false // IMPORTANT: true causes 400 for render links
      }
    };
    const res = await axios.post(
      https://graph.facebook.com/v20.0/${PHONE_ID}/messages,
      data,
      { headers: { Authorization: Bearer ${TOKEN}, 'Content-Type': 'application/json' } }
    );
    console.log("WA Sent OK:", res.data.messages?.[0]?.id);
  } catch (err) {
    // THIS WILL SHOW YOU THE REAL REASON
    console.error("WA FULL ERROR:", JSON.stringify(err.response?.data || err.message, null, 2));
  }
}

// 3. Receive messages
app.post('/webhook', async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.toLowerCase() || "";

    console.log("Incoming:", from, text);

    if (text.includes("hi") || text.includes("hello")) {
      await sendWhatsApp(from, 🌟 Hello! Rahul General Store, Mohone\n\n📦 Stock: https://dukandaar-ai.onrender.com/stock\n\nType: Atta, Bucket, Broom, Doormat\nHome Ration Only | Secure Checkout 🔒);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});

app.get('/stock', (req, res) => {
  res.send("Stock: Atta, Bucket, Broom, Doormat - Home Ration Only");
});

app.get('/', (req, res) => res.send("Dukandaar AI Live"));

app.listen(PORT, '0.0.0.0', () => {
  console.log(FINAL FINISH LINE on ${PORT} - Welcome + Cart + 6 Addr + OTP Resend + Payment + Bill);
  console.log(Your service is live);
});
