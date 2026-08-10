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
  let s = q.toLowerCase().trim().replace(/[?.!,]/g,'').trim();
  s = s.replace(/(\d+)\s*kg/gi, '$1kg');
  let tries = [s];
  if(s.includes('atta')) tries.push(s.replace('atta','aata'));
  if(s.includes('aata')) tries.push(s.replace('aata','atta'));
  const clean = s.replace(/\d+kg/g,'').trim();
  if(clean) tries.push(clean);
  for(let term of tries){
    if(!term) continue;
    const filter = 'name.ilike.%' + term + '%';
    const { data } = await supabase.from('products').select('*').or(filter).limit(5);
    if(data && data.length>0) return data;
  }
  return [];
}

async function sendWhatsApp(to, body){
  try{
    await axios.post('https://graph.facebook.com/v20.0/' + PHONE_ID + '/messages', {
      messaging_product: 'whatsapp', to: to, type: 'text', text: { body: body }
    }, { headers: { Authorization: 'Bearer ' + WHATSAPP_TOKEN } });
  }catch(e){
    console.error(JSON.stringify(e.response?.data || e.message));
  }
}

app.get('/', (req,res)=>res.send('Dukaandaar AI Live v3.2 Fixed'));
app.get('/api/products', async (req,res)=>{
  const { data } = await supabase.from('products').select('*').limit(100);
  res.json(data||[]);
});
app.post('/api/order', async (req,res)=>{
  const { phone, address, name, items, total, payment } = req.body;
  await supabase.from('orders').insert([{
    phone: phone,
    address: address,
    customer_name: name,
    product_name: items.map(i=>i.name + ' x' + i.qty).join(', '),
    price: total,
    payment_mode: payment
  }]);
  res.json({ success: true });
});

app.get('/shop', (req,res)=>{
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dukaandaar Shop</title>
<style>
body{font-family:system-ui;background:#f5f5f5;margin:0}
.header{background:#0a7c42;color:#fff;padding:16px;position:sticky;top:0}
.header h2{margin:0 0 10px 0}
.header input{width:100%;padding:10px;border-radius:8px;border:none;box-sizing:border-box}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px;padding-bottom:80px}
.card{background:#fff;border-radius:12px;padding:12px;box-shadow:0 2px 6px rgba(0,0,0,0.06)}
.card .name{font-size:13px;min-height:36px}
.card .price{color:#0a7c42;font-weight:700;margin:6px 0}
.card button{background:#0a7c42;color:#fff;border:none;padding:8px;border-radius:8px;width:100%}
.cart{position:fixed;bottom:0;left:0;right:0;background:#fff;padding:12px;border-top:1px solid #ddd;display:flex;justify-content:space-between;align-items:center}
</style>
</head>
<body>
<div class="header">
<h2>Dukaandaar AI - Mohone</h2>
<input id="searchBox" placeholder="Search Atta, Bucket, Oil...">
</div>
<div class="grid" id="grid"></div>
<div class="cart">
<div><b id="cartCount">0 items</b> - Rs <span id="cartTotal">0</span></div>
<button onclick="viewCart()" style="background:#0a7c42;color:#fff;border:none;padding:10px 16px;border-radius:8px">Cart</button>
</div>
<script>
let allProducts=[];
let cart=[];

async function loadProducts(){
  try{
    let r = await fetch('/api/products');
    allProducts = await r.json();
    if(!allProducts || !allProducts.length) throw 'empty';
  }catch(e){
    allProducts=[
      {id:1,name:'Aashirvaad Atta 5kg',price:250},
      {id:2,name:'Aata Local 1kg',price:55},
      {id:3,name:'Tata Salt 1kg',price:30},
      {id:4,name:'Lizol Bucket Small',price:2230}
    ];
  }
  renderProducts();
}

function renderProducts(){
  let q = document.getElementById('searchBox').value.toLowerCase();
  let grid = document.getElementById('grid');
  grid.innerHTML='';
  let filtered = allProducts.filter(p=>{
    let n = p.name.toLowerCase();
    if(!q) return true;
    if(n.includes(q)) return true;
    if(q.includes('atta') && n.includes('aata')) return true;
    if(q.includes('aata') && n.includes('atta')) return true;
    return false;
  });
  filtered.forEach(p=>{
    let div = document.createElement('div');
    div.className='card';
    div.innerHTML='<div class=name>'+p.name+'</div><div class=price>Rs '+p.price+'</div><button onclick="addToCart('+p.id+')">Add to Cart</button>';
    grid.appendChild(div);
  });
}

function addToCart(id){
  let product = allProducts.find(p=>p.id==id);
  if(!product) return;
  let item = cart.find(c=>c.id==id);
  if(item){ item.qty++; } else { cart.push({id:product.id,name:product.name,price:product.price,qty:1}); }
  updateCart();
}

function updateCart(){
  let total=0,count=0;
  cart.forEach(c=>{ total+=c.price*c.qty; count+=c.qty; });
  document.getElementById('cartCount').innerText=count+' items';
  document.getElementById('cartTotal').innerText=total;
}

function viewCart(){
  if(!cart.length){ alert('Cart empty'); return; }
  let text='Your Cart:\n';
  cart.forEach(c=>{ text+=c.name+' x'+c.qty+' = Rs '+(c.price*c.qty)+'\n'; });
  let total=0; cart.forEach(c=>total+=c.price*c.qty);
  text+='\nTotal: Rs '+total;
  text+='\n\nTo order, WhatsApp your address to shop owner';
  alert(text);
}

document.getElementById('searchBox').addEventListener('input',renderProducts);
loadProducts();
</script>
</body>
</html>
`;
  res.send(html);
});

app.get('/webhook', (req,res)=>{
  if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook', async (req,res)=>{
  try{
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(!msg) return res.sendStatus(200);
    if(seenMsg.has(msg.id)) return res.sendStatus(200);
    seenMsg.add(msg.id);
    setTimeout(()=>seenMsg.delete(msg.id),60000);
    const from = msg.from;
    const text = msg.text?.body || '';
    if(!text) return res.sendStatus(200);
    if(text.toLowerCase().startsWith('order')){
      const id = text.split(' ')[1];
      const { data: prod } = await supabase.from('products').select('*').eq('id', id).single();
      if(prod){
        await supabase.from('orders').insert([{ phone: from, product_id: id, product_name: prod.name, price: prod.price }]);
        await sendWhatsApp(from, 'Order Confirmed! ' + prod.name + ' Rs ' + prod.price + '. Jaldi deliver hoga!');
      }
      return res.sendStatus(200);
    }
    const clean = text.toLowerCase().replace(/[?.!,]/g,'').trim();
    if(GREETINGS.includes(clean)){
      await sendWhatsApp(from, 'Welcome to Dukaandaar AI! \n\n Pura saman ek click me dekho:\n' + SHOP_URL + '\n\n Link pe click karo -> Products + Price -> Cart Add -> Address + Payment -> Order!\n\nShop owner ko turant order + payment + address mil jayega.');
      return res.sendStatus(200);
    }
    const products = await findProducts(text);
    if(products.length===0){
      await sendWhatsApp(from, 'Maaf kijiye, \'' + text + '\' stock me nahi mila.\nPura list yaha dekho: ' + SHOP_URL);
    }else{
      let reply = 'Ye rahe ' + products.length + ' products \'' + text + '\' ke liye:\nPura shop: ' + SHOP_URL + '\n';
      products.forEach((p,i)=>{
        let fp=p.price, note='';
        const kg=getKg(text,p.name);
        if(kg && kg.userKg!==kg.prodKg){
          fp=Math.round((p.price/kg.prodKg)*kg.userKg);
          note=' (' + kg.prodKg + 'KG Rs ' + p.price + ' -> ' + kg.userKg + 'KG Rs ' + fp + ')';
        }
        reply+='\n' + (i+1) + '. ' + p.name + ' - Rs ' + fp + note + '\nOrder: Order ' + p.id;
      });
      await sendWhatsApp(from, reply);
    }
    res.sendStatus(200);
  }catch(e){
    console.error(e);
    res.sendStatus(200);
  }
});
app.listen(PORT, ()=>console.log('Live on ' + PORT));
