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
const DICT = { balti:'bucket', dormat:'doormat', jhadu:'broom', pochha:'mop', aata:'atta', aloo:'potato' };
function getKg(userText, prodName){
  const u = userText.match(/(\d+)\s*kg/i)?.[1];
  const p = prodName.match(/(\d+)\s*kg/i)?.[1];
  if(u && p) return { userKg: parseInt(u), prodKg: parseInt(p) };
  return null;
}
async function findProducts(q){
  if(!q) return [];
  let s = q.toLowerCase().trim();
  s = DICT[s] || s;
  const words = s.split(' ').filter(w=>w.length>1);
  let query = supabase.from('products').select('*');
  if(words.length>=1){
    query = query.or(words.map(w=>name.ilike.%${w}%).join(','));
  }
  const {data} = await query.limit(5);
  return data||[];
}
async function sendWhatsApp(to, body){
  try{
    await axios.post(https://graph.facebook.com/v20.0/${PHONE_ID}/messages, {
      messaging_product:"whatsapp", to, type:"text", text:{body}
    }, { headers:{ Authorization:Bearer ${WHATSAPP_TOKEN} } });
  }catch(e){ console.error("META ERROR:", JSON.stringify(e.response?.data || e.message)); }
}
app.get('/', (req,res)=>res.send('Dukaandaar AI Live - 112 lines with 1kg calc'));
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
      const {data:prod} = await supabase.from('products').select('*').eq('id', id).single();
      if(prod){
        await supabase.from('orders').insert([{ phone:from, product_id:id, product_name:prod.name, price:prod.price }]);
        await sendWhatsApp(from, Order Confirmed! ${prod.name} Rs ${prod.price}. Jaldi deliver hoga!);
      }
      return res.sendStatus(200);
    }
    const products = await findProducts(text);
    if(products.length===0){
      await sendWhatsApp(from, Maaf kijiye, '${text}' stock me nahi mila. 'Bucket', 'Atta 5kg' try karo.);
    }else{
      let reply = Ye rahe ${products.length} products '${text}' ke liye:\n;
      products.forEach((p,i)=>{
        let finalPrice = p.price;
        let note = '';
        const kgInfo = getKg(text, p.name);
        if(kgInfo && kgInfo.userKg!== kgInfo.prodKg){
          finalPrice = Math.round((p.price / kgInfo.prodKg) * kgInfo.userKg);
          note = ` (${kgInfo.prodKg}KG Rs ${p.price} -> ${kgInfo.userKg}KG Rs ${finalPrice})`;
        }
        reply += \n${i+1}. ${p.name} - Rs ${finalPrice}${note}\nOrder: Order ${p.id};
      });
      await sendWhatsApp(from, reply);
    }
    res.sendStatus(200);
  }catch(e){ console.error(e); res.sendStatus(200); }
});
app.listen(PORT, ()=>console.log('Live on '+PORT));
