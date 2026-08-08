
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'dukandaar123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Health
app.get('/', (req,res)=> res.send('Dukandaar AI is LIVE 🚀'));

// Webhook verification (Meta will call this)
app.get('/webhook', (req,res)=>{
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if(mode==='subscribe' && token===VERIFY_TOKEN){
    console.log('WEBHOOK VERIFIED');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Receive messages
app.post('/webhook', async (req,res)=>{
  try{
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const msg = value?.messages?.[0];
    if(!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.trim() || '';
    const name = value.contacts?.[0]?.profile?.name || 'Customer';

    console.log(`Message from ${from}: ${text}`);

    await supabase.from('whatsapp_logs').insert({phone: from, message: text, direction: 'in'});

    let reply = await processMessage(from, name, text);

    await sendWhatsApp(from, reply);
    await supabase.from('whatsapp_logs').insert({phone: from, message: reply, direction: 'out'});

    res.sendStatus(200);
  }catch(e){
    console.error(e);
    res.sendStatus(200);
  }
});

async function processMessage(phone, name, text){
  const lower = text.toLowerCase();

  // HELP
  if(lower==='hi' || lower==='hello' || lower.includes('help') || lower==='menu'){
    return `Namaste ${name} 🙏 *Dukandaar AI*

1. *Udhar* - "Ramesh ko 500 udhar"
2. *Jama* - "Ramesh ne 200 jama kiya"
3. *Udhar List* - "udhar list" ya "khata"
4. *Stock Add* - "Add 50 Parle-G @10"
5. *Sale* - "Ramesh ko 2 Parle-G becha 20"
6. *Stock Check* - "stock check Parle"
7. *Aaj ka hisab* - "aaj ka sale"

Bolo kya karna hai?`;
  }

  // UDHAR LIST
  if(lower.includes('udhar list') || lower.includes('khata') || lower.includes('udhar dikhao')){
    const {data} = await supabase.from('customers').select('*').gt('total_udhar',0).order('total_udhar',{ascending:false}).limit(20);
    if(!data || data.length===0) return '✅ Koi udhar baki nahi hai!';
    let msg = '*📒 Udhar List:*
';
    data.forEach(c=> msg += `• ${c.name}: ₹${c.total_udhar}
`);
    const total = data.reduce((s,c)=>s+c.total_udhar,0);
    msg += `
*Total: ₹${total}*`;
    return msg;
  }

  // STOCK CHECK
  if(lower.startsWith('stock')){
    const term = text.replace(/stock check|stock/i,'').trim();
    let q = supabase.from('products').select('*').limit(10);
    if(term) q = q.ilike('name', `%${term}%`);
    const {data} = await q;
    if(!data || !data.length) return term ? `❌ "${term}" stock me nahi mila` : 'Stock khali hai';
    let msg='*📦 Stock:*
';
    data.forEach(p=> msg+=`• ${p.name}: ${p.stock_qty} qty @₹${p.selling_price}
`);
    return msg;
  }

  // AAJ KA HISAB
  if(lower.includes('aaj ka') || lower.includes('today sale') || lower.includes('hisab')){
    const today = new Date().toISOString().split('T')[0];
    const {data} = await supabase.from('sales').select('*').gte('created_at', today);
    const total = data ? data.reduce((s,r)=>s+Number(r.total_amount),0) : 0;
    const {data: exp} = await supabase.from('expenses').select('*').gte('created_at', today);
    const expTotal = exp ? exp.reduce((s,r)=>s+Number(r.amount),0) : 0;
    return `*📊 Aaj ka Hisab (${today})*
Sale: ₹${total}
Kharcha: ₹${expTotal}
Profit: ₹${total-expTotal}`;
  }

  // PARSE UDHAR: "Ramesh ko 500 udhar" or "Ramesh ne 500 jama"
  const udharMatch = text.match(/(.+?)\s+(ko\s+)?(\d+)\s*(rs|rupaye|₹)?\s*(udhar|udhaar)/i);
  const jamaMatch = text.match(/(.+?)\s+(ne\s+)?(\d+)\s*(rs|rupaye|₹)?\s*(jama|bhara|diya|paid)/i);

  if(udharMatch || jamaMatch){
    const isJama = !!jamaMatch;
    const m = jamaMatch || udharMatch;
    const custName = m[1].replace(/ko|ne|ne|ko|rupey|rupaye|rs/gi,'').trim();
    const amount = parseInt(m[3]);
    if(!custName || !amount) return 'Samajh nahi aaya. Example: "Ramesh ko 500 udhar"';

    // find or create customer
    let {data: cust} = await supabase.from('customers').select('*').ilike('name', custName).limit(1).single().then(r=>r).catch(()=>({data:null}));
    // try fetch
    const {data: list} = await supabase.from('customers').select('*').ilike('name', `%${custName}%`).limit(1);
    cust = list && list[0] ? list[0] : null;
    if(!cust){
      const {data: newCust} = await supabase.from('customers').insert({name: custName, phone: ''}).select().single();
      cust = newCust;
    }
    const newBalance = isJama ? Number(cust.total_udhar||0) - amount : Number(cust.total_udhar||0) + amount;
    await supabase.from('customers').update({total_udhar: newBalance}).eq('id', cust.id);
    await supabase.from('udhar_ledger').insert({
      customer_id: cust.id,
      customer_name: cust.name,
      type: isJama ? 'jama' : 'udhar',
      amount: amount,
      balance_after: newBalance,
      note: text
    });
    if(isJama){
      return `✅ *Jama* \n${cust.name} ne ₹${amount} diya\nBaki Udhar: ₹${newBalance}`;
    } else {
      return `✅ *Udhar* \n${cust.name} ko ₹${amount} udhar\nTotal Udhar: ₹${newBalance}`;
    }
  }

  // ADD STOCK: "Add 50 Parle-G @10 selling 12" or "Add 50 Parle-G 10"
  if(lower.startsWith('add ')){
    // parse: Add 50 Parle-G @10 or Add 50 Parle-G selling 12
    const addMatch = text.match(/add\s+(\d+)\s+(.+?)(?:\s+@\s*(\d+))?(?:\s+selling\s+(\d+))?$/i);
    if(addMatch){
      const qty = parseInt(addMatch[1]);
      const prodName = addMatch[2].replace(/@.*/, '').trim();
      const cost = addMatch[3] ? parseInt(addMatch[3]) : 0;
      const sell = addMatch[4] ? parseInt(addMatch[4]) : cost;
      const {data: existing} = await supabase.from('products').select('*').ilike('name', `%${prodName}%`).limit(1);
      if(existing && existing[0]){
        await supabase.from('products').update({stock_qty: Number(existing[0].stock_qty)+qty, cost_price: cost||existing[0].cost_price, selling_price: sell||existing[0].selling_price}).eq('id', existing[0].id);
        return `✅ Stock Updated: ${prodName} +${qty} = ${Number(existing[0].stock_qty)+qty} qty`;
      } else {
        await supabase.from('products').insert({name: prodName, stock_qty: qty, cost_price: cost, selling_price: sell||cost});
        return `✅ New Product Added: ${prodName} - ${qty} qty @₹${sell||cost}`;
      }
    }
  }

  return `Samajh nahi aaya: "${text}"\n\nType *help* for menu`;
}

async function sendWhatsApp(to, body){
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  await axios.post(url, {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: body }
  }, {
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log(`Dukandaar running on ${PORT}`));
