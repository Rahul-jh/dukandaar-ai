const express = require('express');
const axios = require('axios');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.get('/', (req, res) => {
  res.send('Dukaandaar AI is Live');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      const from = message.from;
      const name = value?.contacts?.[0]?.profile?.name || 'Customer';

      let text = '';
      let buttonId = '';
      if (message.type === 'text') {
        text = message.text?.body || 'Hi';
      } else if (message.type === 'interactive') {
        text = message.interactive?.button_reply?.title || '';
        buttonId = message.interactive?.button_reply?.id || '';
      }

      console.log('Incoming: ' + text + ' Button: ' + buttonId + ' from ' + from);
      await supabase.from('messages').insert([{ phone: from, message: text, name: name }]);

      // CASE 1: Customer clicked Order button
      if (buttonId.startsWith('order_')) {
        const productName = buttonId.replace('order_', '');
        await axios.post(
          'https://graph.facebook.com/v20.0/' + PHONE_NUMBER_ID + '/messages',
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: 'Order Confirmed! ' + name + ' ji, aapne ' + productName + ' order kiya.\n\nTotal Bill ban raha hai... Mohone shop se delivery 1 ghante me hogi. Cash on Delivery available!\n\nOrder ID: ORD-' + Date.now() }
          },
          { headers: { 'Authorization': 'Bearer ' + WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
        );
        await supabase.from('orders').insert([{ phone: from, product: productName, customer_name: name }]);
        return res.sendStatus(200);
      }

      // CASE 2: Search products
      const { data: products } = await supabase
     .from('products')
     .select('*')
     .ilike('name', '%' + text + '%')
     .limit(3);

      if (products && products.length > 0) {
        let replyText = 'Namaste ' + name + '! Dukaandaar AI - ' + products.length + ' products mile:\n\n';
        products.forEach((p, i) => {
          replyText += (i+1) + '. ' + p.name + '\n';
          replyText += ' ' + (p.brand || '') + ' | Stock: ' + p.stock_qty + '\n';
          replyText += ' MRP: Rs ' + p.mrp + ' | Price: Rs ' + p.price_incl_gst + ' (incl GST)\n\n';
        });
        await axios.post(
          'https://graph.facebook.com/v20.0/' + PHONE_NUMBER_ID + '/messages',
          { messaging_product: "whatsapp", to: from, text: { body: replyText } },
          { headers: { 'Authorization': 'Bearer ' + WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
        );

        // Then send ORDER BUTTONS
        const buttons = products.map((p, i) => ({
          type: "reply",
          reply: { id: 'order_' + p.name.substring(0, 20), title: 'Order ' + (i+1) }
        }));

        await axios.post(
          'https://graph.facebook.com/v20.0/' + PHONE_NUMBER_ID + '/messages',
          {
            messaging_product: "whatsapp",
            to: from,
            type: "interactive",
            interactive: {
              type: "button",
              body: { text: 'Batao kaunsa order karna hai? Click button' },
              action: { buttons: buttons }
            }
          },
          { headers: { 'Authorization': 'Bearer ' + WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
        );
      } else {
        let replyText = 'Namaste ' + name + '! Product "' + text + '" nahi mila. Try: bucket, battery, doormat';
        await axios.post(
          'https://graph.facebook.com/v20.0/' + PHONE_NUMBER_ID + '/messages',
          { messaging_product: "whatsapp", to: from, text: { body: replyText } },
          { headers: { 'Authorization': 'Bearer ' + WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
        );
      }
    }
  } catch (error) {
    console.log('Error:', error.response?.data || error.message);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
