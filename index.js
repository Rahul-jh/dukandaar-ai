const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PHONE_ID = process.env.PHONE_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "dukandaar123";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const seenMsg = new Set();

const DICT = { balti:'bucket', dormat:'doormat', jhadu:'broom', pochha:'mop', aata:'atta' };
const GREETINGS = ['hi','hello','hey','hii','helo','namaste','namaskar','good morning','good evening','hlo','hy'];

function getKg(userText, prodName){
  const u = userText.match(/(\d+)\s*kg/i);
  const p = prodName.match(/(\d+)\s*kg/i);
  if(u && p){
    return { userKg: parseInt(u[1]), prodKg: parseInt(p[1]) };
  }
  return null;
}

async function findProducts(q){
  if(!q) return [];
  let s = q.toLowerCase().trim();
  s = s.replace(/[?.!,]/g, '').trim();
  s = s.replace(/(\d+)\s*kg/gi, '$1kg');
  if(DICT[s]) s = DICT[s];
  if(GREETINGS.includes(s)) {
    const { data } = await supabase.from('products').select('*').limit(5);
    return data || [];
  }
  const words = s.split(' ').filter(w=>w.length>1);
  if(words.length===0) return [];
  let mainWord = words[0];
  if(/^\d+kg$/i.test(mainWord) && words[1]) mainWord = words[1];
  if(/^\d+kg$/i.test(mainWord) && words.length===1){
    // if only "5kg" typed, search all with kg
    mainWord = 'kg';
  }
  const orFilter = `name.ilike.%${mainWord}%`;
  const { data } = await supabase.from('products').select('*').or(orFilter).limit(5);
  return data || [];
}

async function sendWhatsApp(to, body){
  try{
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: body }
    }, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
  }catch(e){
    console.error("META ERROR:", JSON.stringify(e.response?.data || e.message));
  }
}

app.get('/', (req,res)=>{
  res.send('Dukaandaar AI Live - v2 Welcome + 1KG calc');
});

app.get('/webhook', (req,res)=>{
  if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN){
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req,res)=>{
  try{
    const entry = req.body.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if(!msg) return res.sendStatus(200);
    const msgId = msg.id;
    if(seenMsg.has(msgId)) return res.sendStatus(200);
    seenMsg.add(msgId);
    setTimeout(()=>seenMsg.delete(msgId), 60000);
    const from = msg.from;
    const text = msg.text?.body || '';
    if(!text) return res.sendStatus(200);

    if(text.toLowerCase().startsWith('order')){
      const id = text.split(' ')[1];
      const { data: prod } = await supabase.from('products').select('*').eq('id', id).single();
      if(prod){
        await supabase.from('orders').insert([{ phone: from, product_id: id, product_name: prod.name, price: prod.price }]);
        await sendWhatsApp(from, `Order Confirmed! ${prod.name} Rs ${prod.price}. Jaldi deliver hoga!`);
      }
      return res.sendStatus(200);
    }

    const cleanText = text.toLowerCase().replace(/[?.!,]/g,'').trim();
    if(GREETINGS.includes(cleanText)){
      const products = await findProducts(text);
      let reply = `Welcome to Dukaandaar AI! 🙏\nAapko kya chahiye? Ye rahe kuch products:\n`;
      products.forEach((p,i)=>{
        reply += `\n${i+1}. ${p.name} - Rs ${p.price}\nOrder: Order ${p.id}`;
      });
      reply += `\n\nKoi bhi product naam bhejo jaise 'Atta' ya 'Bucket'`;
      await sendWhatsApp(from, reply);
      return res.sendStatus(200);
    }

    const products = await findProducts(text);
    if(products.length===0){
      await sendWhatsApp(from, `Maaf kijiye, '${text}' stock me nahi mila. 'Bucket', 'Atta 5kg' try karo.`);
    }else{
      let reply = `Ye rahe ${products.length} products '${text}' ke liye:\n`;
      products.forEach((p,i)=>{
        let finalPrice = p.price;
        let note = '';
        const kgInfo = getKg(text, p.name);
        if(kgInfo && kgInfo.userKg!== kgInfo.prodKg){
          finalPrice = Math.round((p.price / kgInfo.prodKg) * kgInfo.userKg);
          note = ` (${kgInfo.prodKg}KG Rs ${p.price} -> ${kgInfo.userKg}KG Rs ${finalPrice})`;
        }
        reply += `\n${i+1}. ${p.name} - Rs ${finalPrice}${note}\nOrder: Order ${p.id}`;
      });
      await sendWhatsApp(from, reply);
    }
    res.sendStatus(200);
  }catch(e){
    console.error(e);
    res.sendStatus(200);
  }
});

app.listen(PORT, ()=>console.log(`Live on ${PORT}`));
