const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'dukandaar123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

app.get('/', (req, res) => {
  res.send('Dukandaar AI is Live!');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook Verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  console.log(JSON.stringify(req.body, null, 2));
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    if (message) {
      const from = message.from;
      const text = message.text?.body || '';
      let reply = 'Namaste! Aapne bheja: ' + text + ' Dukandaar AI kaam kar raha hai!';
      if (text.toLowerCase().includes('udhar')) {
        reply = 'Udhar List: Feature jald aayega!';
      }
      await axios.post('https://graph.facebook.com/v20.0/' + PHONE_NUMBER_ID + '/messages', {
        messaging_product: 'whatsapp',
        to: from,
        text: { body: reply }
      }, {
        headers: { Authorization: 'Bearer ' + WHATSAPP_TOKEN }
      });
    }
  } catch (e) {
    console.error(e.response?.data || e.message);
  }
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
