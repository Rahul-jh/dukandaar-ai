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
const SHOP_URL = "https://dukandaar-ai.onrender.com/shop";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const seenMsg = new Set();
const GREETINGS = ['hi','hello','hey','hii','namaste','hlo'];

function getKg(uText, pName){
  const u = uText.match(/(\d+)\s*kg/i);
  const p = pName.match(/(\d+)\s*kg/i);
  if(u && p) return { userKg: parseInt(u[1]), prodKg: parseInt(p[1]) };
  return null;
}

async function findProducts(q){
  if(!q) return [];
  let s = q.toLowerCase().trim().replace(/[?.!,]/g,'').trim().replace(/(\d+)\s*kg/gi, '$1kg');
  let tries = [s];
  if(s.includes('atta')) tries.push(s.replace('atta','aata'));
  if(s.includes('aata')) tries.push(s.replace('aata','atta'));
  const clean = s.replace(/\d+kg/g,'').trim();
  if(clean) tries.push(clean);
  if(clean.includes('atta')) tries.push(clean.replace('atta','aata'));
  for(let term of tries){
    if(!term) continue;
    const { data } = await supabase.from('products').select('*').or(name.ilike.%${term}%).limit(5);
    if(data && data.length>0) return data;
  }
  return [];
}

async function sendWhatsApp(to, body){
  await axios.post(https://graph.facebook.com/v20.0/${PHONE_ID}/messages, {
    messaging_product: "whatsapp", to: to, type: "text", text: { body: body }
  }, { headers: { Authorization: Bearer ${WHATSAPP_TOKEN} } }).catch(e=>console.error(e.response?.data));
}

app.get('/', (req,res)=>res.send('Dukaandaar AI Live v3 Shop'));
app.get('/api/products', async (req,res)=>{ const { data } = await supabase.from('products').select('*').limit(100); res.json(data||[]); });
app.post('/api/order', async (req,res)=>{
  const { phone, address, name, items, total, payment } = req.body;
  await supabase.from('orders').insert([{ phone, address, customer_name: name, product_name: items.map(i=>${i.name} x${i.qty}).join(', '), price: total, payment_mode: payment }]);
  res.json({ success: true });
});

// SIMPLE SHOP HTML - Replace with full shop later
app.get('/shop', (req,res)=>{
  res.send(<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dukaandaar Shop</title><style>body{font-family:system-ui;background:#f6f6f6;margin:0}header{background:#0a7c42;color:#fff;padding:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px}.card{background:#fff;border-radius:12px;padding:10px}.price{color:#0a7c42;font-weight:700} button{background:#0a7c42;color:#fff;border:none;padding:8px;border-radius:8px;width:100%;margin-top:6px}</style></head><body><header><h3>Dukaandaar AI - Shop</h3><input id="s" placeholder="Search Atta, Bucket..." style="width:100%;padding:8px;border-radius:8px;border:none;margin-top:8px"></header><div class="grid" id="g"></div><div style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:10px;display:flex;justify-content:space-between"><b id="c">0 items</b><span>Rs <span id="t">0</span></span><button onclick="alert('Cart: '+JSON.stringify(cart))" style="width:auto">View Cart</button></div><script>let products=[],cart=[];async function load(){try{let r=await fetch('/api/products');products=await r.json();if(!products.length)throw'';}catch(e){products=[{id:1,name:'Aashirvaad Atta 5kg',price:250},{id:2,name:'Aata 1kg Local',price:55},{id:3,name:'Bucket Small',price:2230},{id:4,name:'Tata Salt',price:30}];}render();}function render(){let q=document.getElementById('s').value.toLowerCase();let g=document.getElementById('g');g.innerHTML='';products.filter(p=>!q||p.name.toLowerCase().includes(q)|| (q.includes('atta')&&p.name.toLowerCase().includes('aata'))).forEach(p=>{g.innerHTML+='<div class=card><div>'+p.name+'</div><div class=price>Rs '+p.price+'</div><button onclick="cart.push(p);document.getElementById(\\'c\\').innerText=cart.length+\\' items\\';let tot=0;cart.forEach(c=>tot+=c.price);document.getElementById(\\'t\\').innerText=tot">Add to Cart</button></div>';});}document.getElementById('s').addEventListener('input',render);load();<\/script></body></html>);
});

app.get('/webhook', (req,res)=>{ if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN) return res.send(req.query['hub.challenge']); res.sendStatus(403); });
app.post('/webhook', async (req,res)=>{
  try{
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(!msg) return res.sendStatus(200);
    if(seenMsg.has(msg.id)) return res.sendStatus(200);
    seenMsg.add(msg.id); setTimeout(()=>seenMsg.delete(msg.id),60000);
    const from = msg.from; const text = msg.text?.body || ''; if(!text) return res.sendStatus(200);
    if(text.toLowerCase().startsWith('order')){
      const id = text.split(' ')[1];
      const { data: prod } = await supabase.from('products').select('*').eq('id', id).single();
      if(prod){
        await supabase.from('orders').insert([{ phone: from, product_id: id, product_name: prod.name, price: prod.price }]);
        await sendWhatsApp(from, Order Confirmed! ${prod.name} Rs ${prod.price}. Jaldi deliver hoga!);
      }
      return res.sendStatus(200);
    }
    const clean = text.toLowerCase().replace(/[?.!,]/g,'').trim();
    if(GREETINGS.includes(clean)){
      await sendWhatsApp(from, Welcome to Dukaandaar AI! 🙏\n\n🛒 Pura saman ek click me dekho:\n${SHOP_URL}\n\n👆 Link pe click karo -> Products + Price -> Cart Add -> Address + Payment -> Order!\n\nShop owner ko turant order + payment + address mil jayega.);
      return res.sendStatus(200);
    }
    const products = await findProducts(text);
    if(products.length===0){
      await sendWhatsApp(from, Maaf kijiye, '${text}' stock me nahi mila.\nPura list yaha dekho: ${SHOP_URL});
    }else{
      let reply = Ye rahe ${products.length} products '${text}' ke liye:\nPura shop: ${SHOP_URL}\n;
      products.forEach((p,i)=>{ let fp=p.price, note=''; const kg=getKg(text,p.name); if(kg && kg.userKg!==kg.prodKg){ fp=Math.round((p.price/kg.prodKg)*kg.userKg); note=` (${kg.prodKg}KG Rs ${p.price} -> ${kg.userKg}KG Rs ${fp}); } reply+=\n${i+1}. ${p.name} - Rs ${fp}${note}\nOrder: Order ${p.id}`; });
      await sendWhatsApp(from, reply);
    }
    res.sendStatus(200);
  }catch(e){ console.error(e); res.sendStatus(200); }
});
app.listen(PORT, ()=>console.log(Live on ${PORT}));
